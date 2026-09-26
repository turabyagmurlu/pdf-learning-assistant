"""Sesli ozet uclari (defter -> akici ders metni -> parcali seslendirme).

- POST /collections/{cid}/lecture            : metni tek seferde (eski yol; format=solo|dialog)
- POST /collections/{cid}/lecture/stream     : metni AKISLA (SSE: meta / token / note / done / error)
- POST /collections/{cid}/lecture/tts        : parcali seslendirme isi baslatir (head = on parca)
- GET  /lecture/voices                       : anlatici (kadin) + ogrenci (erkek) sesleri
Parca durumu ve sesleri: study.py -> GET /tts/jobs/{id}/chunks, GET /tts/jobs/{id}/chunks/{n}
"""
import asyncio
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.ai import usage
from app.ai.factory import get_llm
from app.config import settings
from app.core.errors import AppError, NotFound
from app.db.session import get_pool
from app.deps import db, current_user
from app.services import tts_jobs
from app.services.analysis_service import lecture_prompt, lecture_script
from app.services.tts_service import FEMALE_VOICES, DEFAULT_VOICE

router = APIRouter(tags=["lecture"])

COL_MISSING = "Defter bulunamadı; silinmiş olabilir. Defterler sayfasına dön."
NO_READY = "Bu defterde henüz hazır kaynak yok. Kaynak ekle ya da işlenmelerini bekle."
TOO_SHORT = "Sesli özet için yeterli içerik yok; deftere biraz daha kaynak ekle."


def _fmt(fmt: str | None) -> bool:
    """format=dialog -> True (sohbet), digerleri tek anlatici."""
    return (fmt or "").strip().lower() in ("dialog", "sohbet", "podcast")


async def _col(conn, cid: str, uid) -> dict:
    col = await conn.fetchrow("SELECT id, title, lecture, lecture_at FROM collections WHERE id=$1 AND user_id=$2",
                              cid, uid)
    if not col:
        raise NotFound(COL_MISSING)
    return dict(col)


async def _ready_count(conn, cid: str, uid) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM documents d JOIN document_collections l ON l.document_id = d.id "
        "WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'", uid, cid)


async def _context(conn, cid: str, uid) -> tuple[str, int]:
    docs = await conn.fetch(
        "SELECT id, title, short_summary FROM documents d JOIN document_collections l ON l.document_id = d.id "
        "WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'", uid, cid)
    if not docs:
        raise AppError(NO_READY)
    ids = [str(d["id"]) for d in docs]
    rows = await conn.fetch(
        """SELECT content FROM document_chunks WHERE document_id = ANY($1::uuid[])
           ORDER BY document_id, chunk_index LIMIT 40""", ids)
    parts = [f"{d['title']}: {d['short_summary']}" for d in docs if d["short_summary"]]
    context = "\n".join(parts) + "\n\n" + "\n\n".join(r["content"] for r in rows)
    if len(context) < 200:
        raise AppError(TOO_SHORT)
    return context, len(docs)


def _cached_matches(col: dict, dialog: bool) -> bool:
    txt = (col.get("lecture") or "").strip()
    return bool(txt) and tts_jobs.is_dialog(txt) == dialog


@router.post("/collections/{cid}/lecture")
async def lecture(cid: str, refresh: bool = False, format: str | None = None,
                  conn=Depends(db), user=Depends(current_user)):
    """Sesli ozet metni (tek seferde). Kaydedilir; ayni bicimdeki metin yeniden yazilmaz."""
    dialog = _fmt(format)
    col = await _col(conn, cid, user["id"])
    if not refresh and _cached_matches(col, dialog):
        n = await _ready_count(conn, cid, user["id"])
        return {"script": col["lecture"], "title": col["title"], "documents": n, "cached": True,
                "format": "dialog" if dialog else "solo",
                "at": col["lecture_at"].isoformat() if col["lecture_at"] else None}
    context, n = await _context(conn, cid, user["id"])
    script = await asyncio.to_thread(lecture_script, context, col["title"], dialog)
    await conn.execute("UPDATE collections SET lecture=$1, lecture_at=now() WHERE id=$2", script, cid)
    return {"script": script, "title": col["title"], "documents": n, "cached": False,
            "format": "dialog" if dialog else "solo"}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/collections/{cid}/lecture/stream")
async def lecture_stream(cid: str, refresh: bool = False, format: str | None = None,
                         user=Depends(current_user)):
    """Metni akisla gonderir: `token` olaylari, sonda `done {script, cached, format}`; hata `error {code, message}`.

    Istemci ilk iki paragraf gelince ilk ses parcasini (head) on-uretmeye baslar; metin biterken ses hazir olur.
    """
    dialog = _fmt(format)
    uid = user["id"]
    pool = await get_pool()

    is_owner = bool(user.get("is_owner"))

    async def gen():
        # Akis ureteci istek baglamindan ayri calisabilir: kullanim sayaci bu kullaniciya yazilsin (chat.py ile ayni)
        usage.set_user(str(uid), is_owner)
        async with pool.acquire() as conn:
            try:
                col = await _col(conn, cid, uid)
                if not refresh and _cached_matches(col, dialog):
                    txt = col["lecture"]
                    yield _sse("meta", {"cached": True})
                    for i in range(0, len(txt), 400):
                        yield _sse("token", {"text": txt[i:i + 400]})
                    yield _sse("done", {"script": txt, "cached": True, "format": "dialog" if dialog else "solo"})
                    return
                context, _n = await _context(conn, cid, uid)
            except AppError as e:
                yield _sse("error", {"code": e.code, "message": e.user_message}); return
            llm = get_llm()
            yield _sse("meta", {"cached": False})
            full = ""
            try:
                async for tok in llm.stream_chat(lecture_prompt(context, col["title"], dialog),
                                                 model=settings.active_llm_model):
                    full += tok
                    yield _sse("token", {"text": tok})
            except AppError as e:
                if len(full) < 200:
                    yield _sse("error", {"code": e.code, "message": e.user_message}); return
                # Yarida kesildi ama okunabilir bir metin var: kaydet, kullaniciya soyle
                yield _sse("note", {"message": "Metin yarıda kesildi; olan kısmı kaydettim. "
                                               "İstersen 'Yeniden hazırla' ile tamamını yazdır."})
            except Exception:  # noqa
                yield _sse("error", {"code": "AI_UNAVAILABLE",
                                     "message": "Sesli özet hazırlanamadı; birazdan tekrar dene."}); return
            full = full.strip()
            if len(full) < 100:
                yield _sse("error", {"code": "AI_UNAVAILABLE",
                                     "message": "Sesli özet hazırlanamadı; birazdan tekrar dene."}); return
            try:
                await conn.execute("UPDATE collections SET lecture=$1, lecture_at=now() WHERE id=$2", full, cid)
            except Exception:  # noqa
                pass
            yield _sse("done", {"script": full, "cached": False, "format": "dialog" if dialog else "solo"})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.get("/lecture/voices")
async def lecture_voices(user=Depends(current_user)):
    """Anlatici (kadin) ve ogrenci (erkek) sesleri; sohbet bicimi ikisini birlikte kullanir."""
    return {
        "voices": [{"id": k, "label": v} for k, v in FEMALE_VOICES.items()],
        "default": DEFAULT_VOICE,
        "student_voices": [{"id": k, "label": v} for k, v in tts_jobs.MALE_VOICES.items()],
        "default_student": tts_jobs.DEFAULT_MALE_VOICE,
        "speakers": {"teacher": tts_jobs.SPEAKER_A, "student": tts_jobs.SPEAKER_B},
    }


class LectureTtsIn(BaseModel):
    text: str
    voice: str | None = None        # anlatici / Ayşe
    voice2: str | None = None       # Kerem (yalniz sohbet)
    format: str | None = None       # solo | dialog | None (metinden anla)
    head: str | None = None         # daha once on-uretilen bas kisim (1. parca aynen bu olur)


@router.post("/collections/{cid}/lecture/tts")
async def lecture_tts(cid: str, body: LectureTtsIn, conn=Depends(db), user=Depends(current_user)):
    """Parcali seslendirme isi. Yanit: durum (ready_chunks, durations, texts, total...).

    Parcalar hazir oldukca GET /tts/jobs/{id}/chunks/{n} ile alinir; tamami onbellekteyse aninda hazir (ucretsiz).
    """
    await _col(conn, cid, user["id"])
    txt = (body.text or "").strip()
    if len(txt) < 2:
        raise AppError("Seslendirilecek metin boş.")
    dialog = _fmt(body.format) if body.format else None
    return await tts_jobs.create_job(str(user["id"]), bool(user.get("is_owner")), txt,
                                     body.voice, body.voice2, dialog=dialog, head=body.head)
