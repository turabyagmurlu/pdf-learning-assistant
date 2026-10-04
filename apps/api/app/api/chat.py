"""Okuyucu sohbeti ("Bu kaynağa sor") — SSE.

Sor v3 akisi (SPEC-v3 "Sor" 1–7):
  niyet anlama (hafif model, ucretsiz sayilir) -> arama rewritten_question ile (k derinlige gore + komsu
  parcalar + belge L1 ozeti) -> Turkce ogretmen istemi (kisa/ayrintili/derin) -> gecmis (son 6 mesaj) modele
  gider -> akis. Derin: once taslak (1 istek), sonra genisletme (1 istek) = ⚡2.
SSE olaylari: meta {intent, rewritten_question, depth, cost} · token {text} · citation {...} ·
followups {items} · done {cached?} · error {code, message}.
Onbellek anahtari: mode|depth|prompt_version (doc_answer_cache.mode kolonunda; sema degismez).
"""
import json
import uuid
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.deps import db, current_user, user_id_from_token
from app.db.session import get_pool
from app.core.errors import NotFound, AppError
from app.services import rag_service, intent as intent_svc
from app.ai.factory import get_embeddings, get_llm
from app.ai.prompts.system import teacher_prompt, outline_prompt, PROMPT_VERSION
from app.config import settings

router = APIRouter(prefix="/chat", tags=["chat"])

ADVANCED_MODES = {"academic", "critical", "socratic", "concept_map"}
MAX_OUT_TOKENS = 8192
TEMPERATURE = 0.5
COST = {"kisa": 1, "ayrintili": 1, "derin": 2}


class SessionIn(BaseModel):
    document_id: str
    mode: str = "default"
    title: str | None = None


class MessageIn(BaseModel):
    content: str
    fresh: bool = False          # True: kayitli cevabi kullanma, yeniden uret
    depth: str = "ayrintili"     # kisa | ayrintili | derin
    page: int | None = None      # "Bu sayfayı anlat": acik sayfa
    page_text: str | None = None  # acik sayfanin metni (en fazla ~8000 kr), baglama eklenir


DOC_ANSWER_SIM = 0.95
MIN_CACHE_CHARS = 300


def cache_mode(mode: str, depth: str) -> str:
    """doc_answer_cache.mode = 'mode|depth|vN' — derinlik ve istem surumu anahtara girer."""
    return f"{mode or 'default'}|{depth}|{PROMPT_VERSION}"


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


async def _history(conn, sid: str, turns: int = intent_svc.HISTORY_TURNS) -> list[tuple[str, str]]:
    """Son N tur (soru, cevap) — eskiden yeniye."""
    try:
        rows = await conn.fetch(
            "SELECT role, content FROM chat_messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT $2",
            sid, turns * 2 + 2)
    except Exception:  # noqa
        return []
    msgs = [dict(r) for r in reversed(rows)]
    out: list[tuple[str, str]] = []
    q = None
    for m in msgs:
        if m["role"] == "user":
            if q is not None:
                out.append((q, ""))
            q = m["content"] or ""
        elif m["role"] == "assistant" and q is not None:
            out.append((q, m["content"] or ""))
            q = None
    # son user mesaji (az once yazilan) gecmise girmez
    return [t for t in out if t[1]][-turns:]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


GENERIC_FAIL = "Yapay zekâ şu an yanıt veremiyor; birkaç saniye sonra tekrar dene."


def _sse_error(e: Exception | None = None, message: str | None = None, code: str | None = None) -> str:
    """Hata olayi: {code, message}. Web, metne degil `code`a bakar (USAGE_LIMIT, AI_BUSY, ...)."""
    if isinstance(e, AppError):
        code = code or e.code
        message = message or e.user_message
        if e.code == "AI_UNAVAILABLE" and message == AppError.user_message:
            message = GENERIC_FAIL
    return _sse("error", {"code": code or "AI_UNAVAILABLE", "message": message or GENERIC_FAIL})


@router.post("/sessions")
async def create_session(body: SessionIn, conn=Depends(db), user=Depends(current_user)):
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2",
                              body.document_id, user["id"])
    if not doc:
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
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
        raise NotFound("Sohbet bulunamadı; silinmiş olabilir.")
    rows = await conn.fetch(
        "SELECT role, content, citations, created_at FROM chat_messages WHERE session_id=$1 ORDER BY created_at",
        sid)
    return [dict(r) for r in rows]


# Not: SSE için token'ı query param olarak da kabul ediyoruz (EventSource header gönderemez)
@router.post("/sessions/{sid}/messages")
async def send(sid: str, body: MessageIn, token: str | None = None):
    import asyncio
    pool = await get_pool()
    depth = intent_svc.normalize_depth(body.depth)

    async def gen():
        async with pool.acquire() as conn:
            uid = None
            if token:
                try:
                    uid = await user_id_from_token(conn, token)
                except Exception:  # noqa
                    uid = None
            if not uid:
                yield _sse_error(message="Oturumun kapanmış. Tekrar giriş yap.", code="UNAUTHORIZED"); return
            try:
                s = await conn.fetchrow("SELECT * FROM chat_sessions WHERE id=$1::uuid", sid)
            except Exception:  # noqa - gecersiz kimlik
                s = None
            if not s or str(s["user_id"]) != str(uid):
                yield _sse_error(message="Sohbet bulunamadı; sayfayı yenileyip tekrar dene.", code="NOT_FOUND"); return
            try:
                from app.ai import usage as _u
                from app.deps import is_owner as _own
                _u.set_user(str(s["user_id"]), await _own(conn, str(s["user_id"])))
            except Exception:  # noqa
                pass

            question = (body.content or "").strip()
            turns = await _history(conn, sid)
            await conn.execute(
                "INSERT INTO chat_messages (session_id, role, content) VALUES ($1,'user',$2)",
                sid, question)

            llm = get_llm()
            embedder = get_embeddings()
            mode = s["mode"] or "default"
            doc_id = str(s["document_id"])

            # 1) Niyet anlama (hafif, ucretsiz sayilir; basarisizsa soru oldugu gibi)
            it = await asyncio.to_thread(intent_svc.understand, llm, question, turns)
            rq = it["rewritten_question"] or question
            yield _sse("meta", {"intent": it["intent"], "rewritten_question": rq, "depth": depth,
                                "cost": COST.get(depth, 1), "understood": bool(it.get("ok"))})

            q_emb = None
            try:
                q_emb = await rag_service.embed_query(conn, embedder, rq)
            except Exception:  # noqa
                pass
            ckey = cache_mode(mode, depth)
            if not body.fresh and not body.page_text:
                hit = await _cached_doc_answer(conn, doc_id, ckey, rq, q_emb)
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

            # 2) Baglam: k derinlige gore + komsu parcalar + belge ozeti
            try:
                chunks = await rag_service.retrieve(conn, doc_id, rq, embedder, k=rag_service.k_for(depth),
                                                    q_emb=q_emb, neighbors=(depth != "kisa"))
            except Exception as e:  # noqa
                yield _sse_error(e); return

            if not chunks and depth == "kisa" and not body.page_text:
                msg = ("Bu bilgi kaynakta açıkça geçmiyor. Derinliği \"Ayrıntılı\" yapıp tekrar sorarsan "
                       "genel bilgiyle açıklarım.")
                yield _sse("token", {"text": msg})
                await conn.execute(
                    "INSERT INTO chat_messages (session_id, role, content) VALUES ($1,'assistant',$2)",
                    sid, msg)
                yield _sse("done", {}); return

            summaries = await rag_service.doc_summaries(conn, [doc_id]) if depth != "kisa" else ""
            context = rag_service.build_context(chunks, summaries)
            page_note = None
            if body.page_text and body.page_text.strip():
                pg = body.page or 0
                context = (f"AÇIK SAYFA (s.{pg}) METNİ — öğrenci şu an bu sayfaya bakıyor; atıfta [Sayfa s.{pg}] yaz:\n"
                           f"{body.page_text.strip()[:8000]}\n\n" + context)
                page_note = f"Öğrenci {pg}. sayfaya bakıyor; soruyu öncelikle bu sayfa üzerinden anlat."

            # 3) Model + gecmis
            strong = depth != "kisa"
            model = settings.active_llm_model_strong if strong else (
                settings.active_llm_model_advanced if mode in ADVANCED_MODES else settings.active_llm_model_light)
            history = intent_svc.history_messages(turns)
            user_msg = question if rq == question else f"{question}\n\n(Anladığım soru: {rq})"

            outline = None
            if depth == "derin":
                try:
                    outline = await asyncio.to_thread(
                        llm.complete, outline_prompt(context, rq), model=model,
                        temperature=0.3, max_output_tokens=900)
                except Exception as e:  # noqa
                    yield _sse_error(e); return

            system = teacher_prompt(context, depth=depth, intent=it["intent"], mode=mode,
                                    scope_hint=it.get("scope_hint"), outline=outline, page_note=page_note)
            messages = [{"role": "system", "content": system}, *history,
                        {"role": "user", "content": user_msg}]

            full = ""
            guard = intent_svc.TailGuard()
            try:
                async for tok in llm.stream_chat(messages, model=model, temperature=TEMPERATURE,
                                                 max_output_tokens=MAX_OUT_TOKENS):
                    full += tok
                    vis = guard.feed(tok)
                    if vis:
                        yield _sse("token", {"text": vis})
                tail = guard.flush()
                if tail:
                    yield _sse("token", {"text": tail})
            except Exception as e:  # noqa
                yield _sse_error(e); return

            answer, followups = intent_svc.split_followups(full)
            citations = [{"n": i + 1, "chunk_id": str(c["id"]), "page": c["page_number"],
                          "section": c.get("section_title"), "snippet": c["content"][:180]}
                         for i, c in enumerate(chunks)]
            for c in citations:
                yield _sse("citation", c)
            if followups:
                yield _sse("followups", {"items": followups})

            await conn.execute(
                "INSERT INTO chat_messages (session_id, role, content, citations) VALUES ($1,'assistant',$2,$3)",
                sid, answer, citations)
            if q_emb is not None and len(answer) >= MIN_CACHE_CHARS and not body.page_text:
                try:
                    await conn.execute(
                        """INSERT INTO doc_answer_cache (document_id, mode, qnorm, question, qvec, answer, citations)
                           VALUES ($1,$2,$3,$4,$5,$6,$7)
                           ON CONFLICT (document_id, mode, qnorm) DO UPDATE
                           SET answer=EXCLUDED.answer, citations=EXCLUDED.citations, used_at=now()""",
                        s["document_id"], ckey, rag_service.norm_q(rq), rq, q_emb, answer, citations)
                except Exception:  # noqa
                    pass
            yield _sse("done", {"cost": COST.get(depth, 1)})

    return StreamingResponse(gen(), media_type="text/event-stream")
