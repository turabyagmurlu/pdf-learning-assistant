import json
import uuid
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.deps import db, current_user
from app.db.session import get_pool
from app.core.errors import NotFound, AiUnavailable
from app.core.security import decode_token
from app.services import rag_service
from app.ai.factory import get_embeddings, get_llm
from app.ai.prompts.system import build_system_prompt
from app.config import settings

router = APIRouter(prefix="/chat", tags=["chat"])

ADVANCED_MODES = {"academic", "critical", "socratic", "concept_map"}


class SessionIn(BaseModel):
    document_id: str
    mode: str = "default"
    title: str | None = None


class MessageIn(BaseModel):
    content: str
    fresh: bool = False          # True: kayitli cevabi kullanma, yeniden uret


DOC_ANSWER_SIM = 0.95


async def _cached_doc_answer(conn, doc_id: str, mode: str, q: str, q_emb):
    """Ayni belgede ayni/cok benzer soru daha once sorulduysa kayitli cevap (0 kota)."""
    qn = rag_service.norm_q(q)
    try:
        hit = await conn.fetchrow(
            "SELECT id, answer, citations FROM doc_answer_cache WHERE document_id=$1 AND mode=$2 AND qnorm=$3",
            doc_id, mode, qn)
        if not hit and q_emb is not None:
            hit = await conn.fetchrow(
                """SELECT id, answer, citations, 1 - (qvec <=> $3) AS sim FROM doc_answer_cache
                   WHERE document_id=$1 AND mode=$2 ORDER BY qvec <=> $3 LIMIT 1""", doc_id, mode, q_emb)
            if hit and float(hit["sim"]) < DOC_ANSWER_SIM:
                hit = None
        if hit:
            await conn.execute("UPDATE doc_answer_cache SET hits=hits+1, used_at=now() WHERE id=$1", hit["id"])
        return hit
    except Exception:  # noqa
        return None


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/sessions")
async def create_session(body: SessionIn, conn=Depends(db), user=Depends(current_user)):
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2",
                              body.document_id, user["id"])
    if not doc:
        raise NotFound("Belge bulunamadı.")
    sid = str(uuid.uuid4())
    await conn.execute(
        "INSERT INTO chat_sessions (id, user_id, document_id, mode, title) VALUES ($1,$2,$3,$4,$5)",
        sid, user["id"], body.document_id, body.mode, body.title or "Yeni sohbet")
    return {"id": sid, "mode": body.mode}


@router.get("/sessions")
async def list_sessions(document_id: str | None = None, nonempty: int = 1,
                        conn=Depends(db), user=Depends(current_user)):
    # Varsayilan: bos (hic mesaj yazilmamis) oturumlar gizlenir
    extra = " AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id=chat_sessions.id)" if nonempty else ""
    if document_id:
        rows = await conn.fetch(
            "SELECT *, (SELECT content FROM chat_messages m WHERE m.session_id=chat_sessions.id AND m.role='user'"
            " ORDER BY m.created_at LIMIT 1) AS first_q FROM chat_sessions WHERE user_id=$1 AND document_id=$2" + extra +
            " ORDER BY created_at DESC LIMIT 50",
            user["id"], document_id)
    else:
        rows = await conn.fetch(
            "SELECT * FROM chat_sessions WHERE user_id=$1" + extra + " ORDER BY created_at DESC", user["id"])
    return [dict(r) for r in rows]


@router.get("/sessions/{sid}/messages")
async def messages(sid: str, conn=Depends(db), user=Depends(current_user)):
    s = await conn.fetchrow("SELECT id FROM chat_sessions WHERE id=$1 AND user_id=$2", sid, user["id"])
    if not s:
        raise NotFound("Oturum bulunamadı.")
    rows = await conn.fetch(
        "SELECT role, content, citations, created_at FROM chat_messages WHERE session_id=$1 ORDER BY created_at",
        sid)
    return [dict(r) for r in rows]


# Not: SSE için token'ı query param olarak da kabul ediyoruz (EventSource header gönderemez)
@router.post("/sessions/{sid}/messages")
async def send(sid: str, body: MessageIn, token: str | None = None):
    uid = decode_token(token) if token else None
    pool = await get_pool()

    async def gen():
        async with pool.acquire() as conn:
            s = await conn.fetchrow("SELECT * FROM chat_sessions WHERE id=$1", sid)
            if not s or (uid and str(s["user_id"]) != uid):
                yield _sse("error", {"message": "Oturum bulunamadı."}); return
            try:
                from app.ai import usage as _u
                from app.deps import is_owner as _own
                _u.set_user(str(s["user_id"]), await _own(conn, str(s["user_id"])))
            except Exception:  # noqa
                pass

            await conn.execute(
                "INSERT INTO chat_messages (session_id, role, content) VALUES ($1,'user',$2)",
                sid, body.content)

            embedder = get_embeddings()
            mode = s["mode"] or "default"
            q_emb = None
            try:
                q_emb = await rag_service.embed_query(conn, embedder, body.content)
            except Exception:  # noqa
                pass
            if not body.fresh:
                hit = await _cached_doc_answer(conn, str(s["document_id"]), mode, body.content, q_emb)
                if hit:
                    ans = hit["answer"] or ""
                    for i in range(0, len(ans), 60):
                        yield _sse("token", {"text": ans[i:i + 60]})
                    cits = hit["citations"] or []
                    for c in cits:
                        yield _sse("citation", c)
                    await conn.execute(
                        "INSERT INTO chat_messages (session_id, role, content, citations) VALUES ($1,'assistant',$2,$3)",
                        sid, ans, cits)
                    yield _sse("done", {"cached": True}); return
            try:
                chunks = await rag_service.retrieve(conn, str(s["document_id"]), body.content, embedder)
            except Exception as e:  # noqa
                yield _sse("error", {"message": "Asistan şu an yanıt veremiyor."}); return

            if not chunks:
                msg = "Bu bilgi PDF içinde açıkça geçmiyor. İstersen genel bilgiyle açıklayayım."
                yield _sse("token", {"text": msg})
                await conn.execute(
                    "INSERT INTO chat_messages (session_id, role, content) VALUES ($1,'assistant',$2)",
                    sid, msg)
                yield _sse("done", {}); return

            context = rag_service.build_context(chunks)
            system = build_system_prompt(s["mode"], context)
            model = settings.active_llm_model_advanced if s["mode"] in ADVANCED_MODES else settings.active_llm_model
            messages = [{"role": "system", "content": system},
                        {"role": "user", "content": body.content}]

            llm = get_llm()
            full = ""
            try:
                async for tok in llm.stream_chat(messages, model=model):
                    full += tok
                    yield _sse("token", {"text": tok})
            except Exception as e:  # noqa
                msg = getattr(e, "user_message", None) or "Asistan şu an yanıt veremiyor."
                if msg == AiUnavailable.user_message:
                    msg = "Asistan şu an yanıt veremiyor; birkaç saniye sonra tekrar dene."
                yield _sse("error", {"message": msg}); return

            citations = [{"n": i + 1, "chunk_id": str(c["id"]), "page": c["page_number"],
                          "section": c.get("section_title"), "snippet": c["content"][:180]}
                         for i, c in enumerate(chunks)]
            for c in citations:
                yield _sse("citation", c)

            await conn.execute(
                "INSERT INTO chat_messages (session_id, role, content, citations) VALUES ($1,'assistant',$2,$3)",
                sid, full, citations)
            if q_emb is not None and len(full) > 40:
                try:
                    await conn.execute(
                        """INSERT INTO doc_answer_cache (document_id, mode, qnorm, question, qvec, answer, citations)
                           VALUES ($1,$2,$3,$4,$5,$6,$7)
                           ON CONFLICT (document_id, mode, qnorm) DO UPDATE
                           SET answer=EXCLUDED.answer, citations=EXCLUDED.citations, used_at=now()""",
                        s["document_id"], mode, rag_service.norm_q(body.content), body.content, q_emb, full, citations)
                except Exception:  # noqa
                    pass
            yield _sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream")
