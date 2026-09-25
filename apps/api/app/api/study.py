import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from app.deps import db, current_user
from app.core.errors import NotFound, AppError
from app.services.analysis_service import generate_study_items, cards_from_text, explain_page
from app.services.tts_service import (synthesize, synthesize_pcm, wav_from_pcm, split_for_tts,
                                      cache_key, TtsQuota, TtsBusy, FEMALE_VOICES, DEFAULT_VOICE)
from app.db.session import get_pool

router = APIRouter(tags=["study"])
log = logging.getLogger(__name__)

# /tts dogrudan seslendirme siniri = split_for_tts parca boyu (tek parca, tek kullanim)
TTS_DIRECT_MAX = 2600


class GenerateIn(BaseModel):
    type: str = "flashcard"   # flashcard | quiz | open_question
    count: int = 8


def _sample_context(rows, max_chunks: int = 28) -> str:
    """Belgenin geneline yayilmis parca secer; kapak/ozet agirlikli ilk parcalari atlar."""
    rows = list(rows)
    n = len(rows)
    if n == 0:
        return ""
    # 8+ parcali belgelerde ilk %8 (kapak, kunye, ozet) atlanir
    skip = min(2, n // 12) if n >= 8 else 0
    pool = rows[skip:] if n - skip >= 3 else rows
    if len(pool) > max_chunks:
        step = len(pool) / max_chunks
        pool = [pool[int(i * step)] for i in range(max_chunks)]
    parts = []
    for r in pool:
        pg = r["page_number"]
        tag = f"[s.{pg}] " if pg else ""
        parts.append(tag + (r["content"] or ""))
    return "\n\n".join(parts)


@router.post("/documents/{doc_id}/study/generate")
async def generate(doc_id: str, body: GenerateIn, conn=Depends(db), user=Depends(current_user)):
    doc = await conn.fetchrow(
        "SELECT id, title, short_summary, key_concepts FROM documents WHERE id=$1 AND user_id=$2",
        doc_id, user["id"])
    if not doc:
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
    rows = await conn.fetch(
        "SELECT content, page_number FROM document_chunks WHERE document_id=$1 ORDER BY chunk_index", doc_id)
    context = _sample_context(rows)
    if not context.strip():
        raise AppError("Bu kaynağın metni henüz hazır değil. Kaynak 'Hazır' olunca tekrar dene.")
    existing_rows = await conn.fetch(
        "SELECT question FROM study_items WHERE document_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 60",
        doc_id, user["id"])
    existing = [r["question"] for r in existing_rows if r["question"]]
    kc = doc["key_concepts"]
    if isinstance(kc, str):
        try:
            kc = json.loads(kc)
        except Exception:
            kc = []
    kc_txt = ", ".join(str(k.get("term") if isinstance(k, dict) else k) for k in (kc or [])[:15])
    hint = f"Başlık: {doc['title']}\nÖzet: {doc['short_summary'] or ''}\nKavramlar: {kc_txt}"
    items = await asyncio.to_thread(generate_study_items, context, body.type, max(1, min(20, body.count)),
                                     existing=existing, topic_hint=hint)
    created = []
    for it in items:
        sid = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO study_items (id, user_id, document_id, type, question, answer, options,
                                        source_page, difficulty, due_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
            sid, user["id"], doc_id, it.get("type", body.type), it.get("question"), it.get("answer"),
            it.get("options", []), it.get("source_page"), it.get("difficulty"),
            datetime.now(timezone.utc))
        created.append(sid)
    return {"created": len(created)}


class FromTextIn(BaseModel):
    text: str
    page: int | None = None
    count: int = 2


@router.post("/documents/{doc_id}/study/from-text")
async def study_from_text(doc_id: str, body: FromTextIn, conn=Depends(db), user=Depends(current_user)):
    """PDF'te secilen metinden aninda flashcard uretir."""
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not doc:
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
    txt = (body.text or "").strip()
    if len(txt) < 15:
        raise AppError("Seçilen metin çok kısa. Biraz daha uzun bir bölüm seç.")
    items = await asyncio.to_thread(cards_from_text, txt, max(1, min(5, body.count)))
    created = 0
    for it in items:
        sid = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO study_items (id, user_id, document_id, type, question, answer, options,
                                        source_page, difficulty, due_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
            sid, user["id"], doc_id, "flashcard", it.get("question"), it.get("answer"),
            [], body.page or it.get("source_page"), it.get("difficulty"),
            datetime.now(timezone.utc))
        created += 1
    return {"created": created}


class ExplainIn(BaseModel):
    text: str
    page: int | None = None


@router.post("/documents/{doc_id}/explain-page")
async def explain(doc_id: str, body: ExplainIn, conn=Depends(db), user=Depends(current_user)):
    """Acik olan sayfayi sade dille anlatir (sesli okumaya uygun)."""
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not doc:
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
    txt = (body.text or "").strip()
    if len(txt) < 40 and body.page:
        rows = await conn.fetch(
            "SELECT content FROM document_chunks WHERE document_id=$1 AND page_number=$2 ORDER BY chunk_index",
            doc_id, body.page)
        txt = "\n".join(r["content"] for r in rows).strip()
    if len(txt) < 40:
        raise AppError("Bu sayfada anlatılacak yeterli metin bulunamadı.")
    return {"explanation": await asyncio.to_thread(explain_page, txt)}


class TtsIn(BaseModel):
    text: str
    voice: str | None = None
    style: str | None = None


@router.get("/tts/voices")
async def tts_voices(user=Depends(current_user)):
    """Kullanilabilir Turkce kadin sesleri."""
    return {"voices": [{"id": k, "label": v} for k, v in FEMALE_VOICES.items()],
            "default": DEFAULT_VOICE}


@router.post("/tts")
async def tts(body: TtsIn, user=Depends(current_user)):
    """Kisa metinler icin dogrudan WAV (tek parca). Daha uzun metinler is kuyruguna gider.

    Sinir, is kuyrugunun parca boyuyla (split_for_tts, ~2600 karakter) aynidir:
    okuyucudaki "Anlat" metinlerinin neredeyse tamami tek cagrida seslenir ve
    maliyet iki yolda da ayni kalir (parca basina 1 kullanim)."""
    txt = (body.text or "").strip()
    if len(txt) < 2:
        raise AppError("Seslendirilecek metin boş.")
    if len(txt) > TTS_DIRECT_MAX:
        # Istemci uzun metni zaten is kuyruguna gonderir; bu yalniz savunma amacli.
        raise AppError("Bu metin tek seferde seslendirilemeyecek kadar uzun. "
                       "Sayfayı yenileyip tekrar dene ya da cihaz sesiyle dinle.")
    voice, style = body.voice or DEFAULT_VOICE, body.style or ""
    key = "wav:" + cache_key(txt, voice, style)
    wav = await _cache_get(key)
    if wav is None:
        wav = await asyncio.to_thread(synthesize, txt, voice, style)
        await _cache_put(key, wav, len(txt))
    return Response(content=wav, media_type="audio/wav",
                    headers={"Cache-Control": "no-store"})


# ---- Uzun seslendirme: arka plan isi (parcali, ilerlemeli) ----
# Tek worker calistigi icin bellekte tutmak yeterli; is bitince ~20 dk saklanir.
_TTS_JOBS: dict[str, dict] = {}
_TTS_TTL = 20 * 60


def _tts_cleanup():
    now = time.time()
    for k in [k for k, v in _TTS_JOBS.items() if now - v.get("at", now) > _TTS_TTL]:
        _TTS_JOBS.pop(k, None)


async def _cache_get(key: str) -> bytes | None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT wav FROM tts_cache WHERE key=$1", key)
            if row:
                await conn.execute("UPDATE tts_cache SET used_at=now() WHERE key=$1", key)
                return bytes(row["wav"])
    except Exception:  # noqa
        pass
    return None


async def _cache_put(key: str, wav: bytes, chars: int):
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO tts_cache (key, wav, chars) VALUES ($1,$2,$3) "
                "ON CONFLICT (key) DO UPDATE SET used_at=now()", key, wav, chars)
            # Depoyu sinirla: en eski kullanilanlardan 120 kaydin uzerini temizle.
            await conn.execute(
                "DELETE FROM tts_cache WHERE key IN ("
                " SELECT key FROM tts_cache ORDER BY used_at DESC OFFSET 120)")
    except Exception:  # noqa
        pass


async def _run_tts_job(job_id: str, chunks: list[str], voice: str, style: str, key: str):
    """Parcalari SIRAYLA seslendirir; kota hatasinda Google'in onerdigi kadar bekler.

    Es zamanli istek yok: ucretsiz kotada dakikalik istek siniri cok dusuk,
    paralel gitmek kotayi aninda yakiyor.
    """
    job = _TTS_JOBS[job_id]
    parts: list[bytes] = []
    try:
        for i, text in enumerate(chunks):
            ck = cache_key(text, voice, style)
            hit = await _cache_get("pcm:" + ck)
            if hit is not None:
                parts.append(hit)
                job["done"] = i + 1
                continue
            for attempt in range(5):
                try:
                    pcm = await asyncio.to_thread(synthesize_pcm, text, voice, style)
                    parts.append(pcm)
                    await _cache_put("pcm:" + ck, pcm, len(text))
                    break
                except TtsQuota as q:
                    if q.daily or attempt == 4:
                        raise
                    job["waiting"] = int(q.retry_after)
                    job["note"] = (f"Seslendirme şu an yoğun; {int(q.retry_after)} saniye sonra "
                                   "kendiliğinden devam edecek…")
                    await asyncio.sleep(q.retry_after)
                    job["waiting"], job["note"] = 0, ""
                except TtsBusy as b:
                    if attempt == 4:
                        raise
                    wait = b.retry_after * (attempt + 1)     # 8, 16, 24, 32 sn
                    job["waiting"] = wait
                    job["note"] = f"Seslendirme şu an yoğun; {wait} saniye sonra yeniden denenecek…"
                    await asyncio.sleep(wait)
                    job["waiting"], job["note"] = 0, ""
                except Exception:  # noqa
                    if attempt >= 1:
                        raise
                    await asyncio.sleep(4)
            job["done"] = i + 1
            if i < len(chunks) - 1:
                await asyncio.sleep(2)      # dakikalik istek sinirina nefes payi
        wav = wav_from_pcm(b"".join(parts))
        job["wav"] = wav
        job["status"] = "ready"
        await _cache_put("wav:" + key, wav, sum(len(c) for c in chunks))
    except Exception as e:  # noqa
        job["status"] = "error"
        job["quota"] = isinstance(e, TtsQuota)
        job["daily"] = bool(getattr(e, "daily", False))
        # Ham hata metni kullaniciya gitmez; yalniz loga yazilir.
        if not getattr(e, "user_message", None):
            log.warning("tts job %s failed: %s", job_id, str(e)[:300])
        job["error"] = (getattr(e, "user_message", None)
                        or "Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.")
    job["note"] = ""
    job["waiting"] = 0
    job["at"] = time.time()


@router.post("/tts/jobs")
async def tts_job_create(body: TtsIn, user=Depends(current_user)):
    """Uzun metni arka planda parca parca seslendirir; is kimligi doner."""
    _tts_cleanup()
    txt = (body.text or "").strip()
    if len(txt) < 2:
        raise AppError("Seslendirilecek metin boş.")
    txt = txt[:12000]
    voice = body.voice or DEFAULT_VOICE
    style = body.style or ""
    chunks = split_for_tts(txt)
    if not chunks:
        raise AppError("Seslendirilecek metin boş.")
    job_id = str(uuid.uuid4())
    key = cache_key(txt, voice, style)
    job = {"status": "running", "done": 0, "total": len(chunks), "wav": None,
           "error": None, "quota": False, "daily": False, "note": "", "waiting": 0,
           "at": time.time(), "user": str(user["id"])}
    _TTS_JOBS[job_id] = job

    cached = await _cache_get("wav:" + key)          # ayni ders daha once seslendirildiyse
    if cached:
        job.update(status="ready", wav=cached, done=len(chunks))
        return {"job_id": job_id, "total": len(chunks), "cached": True}

    asyncio.create_task(_run_tts_job(job_id, chunks, voice, style, key))
    return {"job_id": job_id, "total": len(chunks), "cached": False}


@router.get("/tts/jobs/{job_id}")
async def tts_job_status(job_id: str, user=Depends(current_user)):
    job = _TTS_JOBS.get(job_id)
    if not job or job.get("user") != str(user["id"]):
        raise NotFound("Ses hazırlığı yarıda kaldı; seslendirmeyi yeniden başlat.")
    return {"status": job["status"], "done": job["done"], "total": job["total"],
            "error": job["error"], "quota": job.get("quota", False),
            "daily": job.get("daily", False), "note": job.get("note", ""),
            "waiting": job.get("waiting", 0),
            "bytes": len(job["wav"]) if job.get("wav") else 0}


@router.get("/tts/jobs/{job_id}/audio")
async def tts_job_audio(job_id: str, user=Depends(current_user)):
    job = _TTS_JOBS.get(job_id)
    if not job or job.get("user") != str(user["id"]):
        raise NotFound("Ses hazırlığı yarıda kaldı; seslendirmeyi yeniden başlat.")
    if job["status"] != "ready" or not job.get("wav"):
        raise AppError("Ses hâlâ hazırlanıyor; birkaç saniye sonra tekrar dene.")
    return Response(content=job["wav"], media_type="audio/wav",
                    headers={"Cache-Control": "no-store"})


@router.get("/study/items")
async def list_items(document_id: str | None = None, type: str | None = None,
                     conn=Depends(db), user=Depends(current_user)):
    sql = "SELECT * FROM study_items WHERE user_id=$1"
    args = [user["id"]]
    if document_id:
        args.append(document_id); sql += f" AND document_id=${len(args)}"
    if type:
        args.append(type); sql += f" AND type=${len(args)}"
    sql += " ORDER BY created_at DESC"
    rows = await conn.fetch(sql, *args)
    return [dict(r) for r in rows]


class ItemPatch(BaseModel):
    question: str | None = None
    answer: str | None = None


@router.patch("/study/items/{item_id}")
async def patch_item(item_id: str, body: ItemPatch, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT id FROM study_items WHERE id=$1 AND user_id=$2", item_id, user["id"])
    if not row:
        raise NotFound("Aradığın içerik bulunamadı; silinmiş olabilir.")
    if body.question is not None:
        q = body.question.strip()
        if len(q) < 3:
            raise AppError("Soru çok kısa; en az birkaç kelime yaz.")
        await conn.execute("UPDATE study_items SET question=$1 WHERE id=$2", q, item_id)
    if body.answer is not None:
        await conn.execute("UPDATE study_items SET answer=$1 WHERE id=$2", body.answer.strip(), item_id)
    return {"ok": True}


@router.delete("/study/items/{item_id}")
async def delete_item(item_id: str, conn=Depends(db), user=Depends(current_user)):
    r = await conn.execute("DELETE FROM study_items WHERE id=$1 AND user_id=$2", item_id, user["id"])
    if r.endswith(" 0"):
        raise NotFound("Aradığın içerik bulunamadı; silinmiş olabilir.")
    return {"ok": True}


@router.delete("/study/items")
async def delete_items(document_id: str, type: str | None = None,
                       conn=Depends(db), user=Depends(current_user)):
    """Bir belgenin tum (ya da belli turdeki) kartlarini siler."""
    if type:
        r = await conn.execute("DELETE FROM study_items WHERE document_id=$1 AND user_id=$2 AND type=$3",
                               document_id, user["id"], type)
    else:
        r = await conn.execute("DELETE FROM study_items WHERE document_id=$1 AND user_id=$2",
                               document_id, user["id"])
    try:
        n = int(r.split()[-1])
    except Exception:
        n = 0
    return {"deleted": n}


class ItemCreate(BaseModel):
    document_id: str
    question: str
    answer: str
    type: str = "flashcard"
    source_page: int | None = None


@router.post("/study/items")
async def create_item(body: ItemCreate, conn=Depends(db), user=Depends(current_user)):
    """Elle kart olusturma (ve yanlis quiz sorusunu karta cevirme)."""
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", body.document_id, user["id"])
    if not doc:
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
    q, a = body.question.strip(), body.answer.strip()
    if len(q) < 3 or len(a) < 1:
        raise AppError("Soru ve cevap boş olamaz.")
    sid = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO study_items (id, user_id, document_id, type, question, answer, options,
                                    source_page, difficulty, due_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
        sid, user["id"], body.document_id, body.type if body.type in ("flashcard", "open_question") else "flashcard",
        q, a, [], body.source_page, "medium", datetime.now(timezone.utc))
    return {"id": sid}


class ReviewIn(BaseModel):
    quality: int   # 0..5 (SM-2)


@router.post("/study/items/{item_id}/review")
async def review(item_id: str, body: ReviewIn, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT ease_factor, interval_days FROM study_items WHERE id=$1 AND user_id=$2",
                              item_id, user["id"])
    if not row:
        raise NotFound("Aradığın içerik bulunamadı; silinmiş olabilir.")
    ef = row["ease_factor"] or 2.5
    interval = row["interval_days"] or 0
    q = max(0, min(5, body.quality))
    # SM-2
    ef = max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
    if q < 3:
        interval = 1
        status = "learning"
    else:
        interval = 1 if interval == 0 else (6 if interval == 1 else round(interval * ef))
        status = "mastered" if interval >= 21 else "review"
    due = datetime.now(timezone.utc) + timedelta(days=interval)
    await conn.execute(
        "UPDATE study_items SET ease_factor=$1, interval_days=$2, review_status=$3, due_at=$4 WHERE id=$5",
        ef, interval, status, due, item_id)
    return {"ease_factor": round(ef, 2), "interval_days": interval, "review_status": status}
