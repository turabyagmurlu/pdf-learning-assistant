import json
import uuid
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.deps import db, current_user
from app.db.session import get_pool
from app.core.errors import NotFound
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
async def list_sessions(document_id: str | None = None, conn=Depends(db), user=Depends(current_user)):
    if document_id:
        rows = await conn.fetch(
            "SELECT * FROM chat_sessions WHERE user_id=$1 AND document_id=$2 ORDER BY created_at DESC",
            user["id"], document_id)
    else:
        rows = await conn.fetch(
            "SELECT * FROM chat_sessions WHERE user_id=$1 ORDER BY created_at DESC", user["id"])
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

            await conn.execute(
                "INSERT INTO chat_messages (session_id, role, content) VALUES ($1,'user',$2)",
                sid, body.content)

            embedder = get_embeddings()
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
            except Exception:  # noqa
                yield _sse("error", {"message": "Asistan şu an yanıt veremiyor."}); return

            citations = [{"n": i + 1, "chunk_id": str(c["id"]), "page": c["page_number"],
                          "section": c.get("section_title"), "snippet": c["content"][:180]}
                         for i, c in enumerate(chunks)]
            for c in citations:
                yield _sse("citation", c)

            await conn.execute(
                "INSERT INTO chat_messages (session_id, role, content, citations) VALUES ($1,'assistant',$2,$3)",
                sid, full, json.dumps(citations))
            yield _sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream")
