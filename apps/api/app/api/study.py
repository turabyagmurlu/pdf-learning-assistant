"""Okuyucu yardimcilari: sayfayi sade dille anlatma (explain-page) ve seslendirme (TTS).

Kart/quiz (study_items) uclari kaldirildi: web arayuzu bu ozelligi cagirmiyor
(tek kullanicili sadelestirme, TK-6). Tablo veride durmaya devam eder; hesap silme ve yedek
onu hala kapsar.

Ses akisi (S1):
- Anlatim metni belge+sayfa+metin-ozeti bazinda `explain_cache`'te saklanir; ayni sayfaya
  ikinci basis 0 kullanim, aninda (`cached: true`). `force: true` ile yeniden uretilir.
- Ses varsayilan olarak MP3 doner (`?fmt=wav` ya da `Accept: audio/wav` ile WAV);
  onbellek anahtari `mp3:` / `wav:` / `pcm:` on ekiyle formati tasir, eski `wav:` kayitlari
  gecerli kalir (MP3 istenirse WAV'dan cevrilip `mp3:` olarak da yazilir).
- `tts_cache` toplam bayt butcesiyle sinirlanir (en eski `used_at` silinir); ses ornekleri
  (`sample:<ses>:<format>`) sabitlenir, silinmez.
"""
import asyncio
import hashlib
import logging
import time
import uuid
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from app.deps import db, current_user
from app.core.errors import NotFound, AppError
from app.services.analysis_service import explain_page
from app.services.tts_service import (synthesize_pcm, synthesize_pcm_retry, encode_audio, pcm_from_wav,
                                      mp3_to_pcm, normalize_format, split_for_tts, cache_key, sample_key,
                                      estimate_seconds, TtsQuota, TtsBusy, FEMALE_VOICES, DEFAULT_VOICE,
                                      SAMPLE_TEXT, FORMATS)
from app.db.session import get_pool
from app.ai import usage

router = APIRouter(tags=["reader"])
log = logging.getLogger(__name__)

# /tts dogrudan seslendirme siniri = split_for_tts parca boyu (tek parca, tek kullanim)
TTS_DIRECT_MAX = 2600
# tts_cache toplam bayt butcesi (MP3'te ~10 saat ses). Asilinca en eski kullanilanlar silinir.
TTS_CACHE_BUDGET = 300 * 1024 * 1024


class ExplainIn(BaseModel):
    text: str
    page: int | None = None
    force: bool = False            # "Yeniden anlat": kayitli anlatimi atla, 1 kullanim harca


def _text_hash(txt: str) -> str:
    return hashlib.sha256(" ".join(txt.split()).encode("utf-8")).hexdigest()


@router.post("/documents/{doc_id}/explain-page")
async def explain(doc_id: str, body: ExplainIn, conn=Depends(db), user=Depends(current_user)):
    """Acik olan sayfayi sade dille anlatir (sesli okumaya uygun).

    Yanit: {explanation, cached, page}. Ayni belge+sayfa+metin icin kayitli anlatim varsa
    yapay zekaya gidilmez (`cached: true`, 0 kullanim)."""
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
    page = int(body.page or 0)
    h = _text_hash(txt[:8000])
    if not body.force:
        try:
            row = await conn.fetchrow(
                "SELECT explanation FROM explain_cache WHERE document_id=$1 AND page=$2 AND input_hash=$3",
                doc_id, page, h)
            if row and row["explanation"]:
                await conn.execute(
                    "UPDATE explain_cache SET used_at=now(), hits=hits+1 WHERE document_id=$1 AND page=$2",
                    doc_id, page)
                return {"explanation": row["explanation"], "cached": True, "page": page}
        except Exception:  # noqa - tablo henuz yoksa uretime devam
            pass
    explanation = await asyncio.to_thread(explain_page, txt)
    try:
        await conn.execute(
            """INSERT INTO explain_cache (document_id, page, input_hash, explanation, created_at, used_at, hits)
               VALUES ($1,$2,$3,$4,now(),now(),0)
               ON CONFLICT (document_id, page) DO UPDATE
               SET input_hash=EXCLUDED.input_hash, explanation=EXCLUDED.explanation,
                   created_at=now(), used_at=now(), hits=0""",
            doc_id, page, h, explanation)
    except Exception:  # noqa
        pass
    return {"explanation": explanation, "cached": False, "page": page}


class TtsIn(BaseModel):
    text: str
    voice: str | None = None
    style: str | None = None
    fmt: str | None = None         # "mp3" (varsayilan) | "wav"


@router.get("/tts/voices")
async def tts_voices(user=Depends(current_user)):
    """Kullanilabilir Turkce kadin sesleri + seslendirme durumu.

    `state`: {"state": aktif|yogun|doldu, "retry_min": int|None} — dolu iken istemci
    "Sesli oku" yerine dogrudan cihaz sesini onerir.
    `sample_text`: ornek cumle (her ses icin bir kez uretilir, sonra ucretsiz)."""
    return {"voices": [{"id": k, "label": v} for k, v in FEMALE_VOICES.items()],
            "default": DEFAULT_VOICE, "state": usage.tts_state(), "sample_text": SAMPLE_TEXT,
            "sec_per_100_chars": 1.0}


def _audio_response(data: bytes, mime: str, cached: bool, chars: int = 0) -> Response:
    return Response(content=data, media_type=mime,
                    headers={"Cache-Control": "no-store",
                             "X-Tts-Cached": "1" if cached else "0",
                             "X-Tts-Chars": str(chars)})


async def _get_cached_audio(ck: str, fmt: str) -> tuple[bytes, str] | None:
    """Istenen formatta onbellek; MP3 istenmis ve yalniz eski WAV varsa cevirip MP3 olarak da yazar."""
    hit = await _cache_get(f"{fmt}:{ck}")
    if hit is not None:
        return hit, FORMATS[fmt]
    if fmt == "mp3":
        wav = await _cache_get("wav:" + ck)
        if wav is not None:
            data, mime, real = await asyncio.to_thread(encode_audio, pcm_from_wav(wav), "mp3")
            if real == "mp3":
                asyncio.create_task(_cache_put("mp3:" + ck, data, 0))
            return data, mime
    elif fmt == "wav":
        mp3 = await _cache_get("mp3:" + ck)
        if mp3 is not None:
            pcm = await asyncio.to_thread(mp3_to_pcm, mp3)
            if pcm:
                return encode_audio(pcm, "wav")[0], FORMATS["wav"]
            return mp3, FORMATS["mp3"]        # cevrilemedi: MP3'u oldugu gibi ver, tarayici calar
    return None


@router.post("/tts")
async def tts(body: TtsIn, request: Request, user=Depends(current_user), fmt: str | None = None):
    """Kisa metinler icin dogrudan ses (tek parca). Daha uzun metinler is kuyruguna gider.

    Sinir, is kuyrugunun parca boyuyla (split_for_tts, ~2600 karakter) aynidir:
    okuyucudaki "Anlat" metinlerinin neredeyse tamami tek cagrida seslenir ve
    maliyet iki yolda da ayni kalir (parca basina 1 kullanim).
    Varsayilan cikti MP3 (`?fmt=wav` ile WAV). Ornek cumle (SAMPLE_TEXT) kalici anahtarla saklanir."""
    txt = (body.text or "").strip()
    if len(txt) < 2:
        raise AppError("Seslendirilecek metin boş.")
    if len(txt) > TTS_DIRECT_MAX:
        # Istemci uzun metni zaten is kuyruguna gonderir; bu yalniz savunma amacli.
        raise AppError("Bu metin tek seferde seslendirilemeyecek kadar uzun. "
                       "Sayfayı yenileyip tekrar dene ya da cihaz sesiyle dinle.")
    voice, style = body.voice or DEFAULT_VOICE, body.style or ""
    if voice not in FEMALE_VOICES:
        voice = DEFAULT_VOICE
    want = normalize_format(fmt or body.fmt, request.headers.get("accept"))
    if txt == SAMPLE_TEXT and not style:
        return await _voice_sample(voice, want)
    ck = cache_key(txt, voice, style)
    hit = await _get_cached_audio(ck, want)
    if hit is not None:
        return _audio_response(hit[0], hit[1], True, len(txt))
    pcm = await asyncio.to_thread(synthesize_pcm_retry, txt, voice, style)
    data, mime, real = await asyncio.to_thread(encode_audio, pcm, want)
    # Onbellege yazma yaniti bekletmesin (H4): arka planda.
    asyncio.create_task(_cache_put(f"{real}:{ck}", data, len(txt)))
    return _audio_response(data, mime, False, len(txt))


async def _voice_sample(voice: str, fmt: str) -> Response:
    """Ses ornegi: bir kez uretilir, `sample:<ses>:<format>` ile sabitlenmis saklanir (H6)."""
    key = sample_key(voice, fmt)
    hit = await _cache_get(key)
    if hit is not None:
        return _audio_response(hit, FORMATS[fmt], True, len(SAMPLE_TEXT))
    if fmt == "mp3":
        wav = await _cache_get(sample_key(voice, "wav"))
        if wav is not None:
            data, mime, real = await asyncio.to_thread(encode_audio, pcm_from_wav(wav), "mp3")
            if real == "mp3":
                asyncio.create_task(_cache_put(key, data, len(SAMPLE_TEXT), pinned=True))
            return _audio_response(data, mime, True, len(SAMPLE_TEXT))
    pcm = await asyncio.to_thread(synthesize_pcm_retry, SAMPLE_TEXT, voice, "")
    data, mime, real = await asyncio.to_thread(encode_audio, pcm, fmt)
    asyncio.create_task(_cache_put(sample_key(voice, real), data, len(SAMPLE_TEXT), pinned=True))
    return _audio_response(data, mime, False, len(SAMPLE_TEXT))


@router.get("/tts/voices/{voice}/sample")
async def tts_voice_sample(voice: str, request: Request, user=Depends(current_user), fmt: str | None = None):
    """Secilen sesin ornek cumlesi; ilk dinleme 1 kullanim, sonrasi herkese ucretsiz."""
    if voice not in FEMALE_VOICES:
        raise NotFound("Bu ses bulunamadı.")
    return await _voice_sample(voice, normalize_format(fmt, request.headers.get("accept")))


# ---- Uzun seslendirme: arka plan isi (parcali, ilerlemeli) ----
# Tek worker calistigi icin bellekte tutmak yeterli; is bitince ~20 dk saklanir.
_TTS_JOBS: dict[str, dict] = {}
_TTS_TTL = 20 * 60


def _tts_cleanup():
    """Suresi dolan isleri bellekten atar; onbellek butcesini de (arka planda) kontrol eder."""
    now = time.time()
    for k in [k for k, v in _TTS_JOBS.items() if now - v.get("at", now) > _TTS_TTL]:
        _TTS_JOBS.pop(k, None)
    try:
        asyncio.get_running_loop().create_task(trim_tts_cache())
    except RuntimeError:
        pass


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


async def _cache_put(key: str, data: bytes, chars: int, pinned: bool = False):
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO tts_cache (key, wav, chars, bytes, pinned) VALUES ($1,$2,$3,$4,$5) "
                "ON CONFLICT (key) DO UPDATE SET used_at=now(), pinned=tts_cache.pinned OR EXCLUDED.pinned",
                key, data, chars, len(data), pinned)
        await trim_tts_cache()
    except Exception:  # noqa
        pass


_TRIM_LOCK = asyncio.Lock()


async def trim_tts_cache(budget: int = TTS_CACHE_BUDGET) -> dict:
    """tts_cache toplam boyutunu butcenin altina indirir (M6).

    En eski `used_at` once silinir; sabitlenmis (ses ornegi) kayitlara dokunulmaz.
    Butce asilinca %85'e kadar iner ki her yazimda yeniden silme olmasin.
    main.py'deki gunluk dongu ve her onbellek yazimi bunu cagirir."""
    if _TRIM_LOCK.locked():
        return {"skipped": True}
    async with _TRIM_LOCK:
        try:
            pool = await get_pool()
            async with pool.acquire() as conn:
                total = int(await conn.fetchval("SELECT coalesce(sum(bytes),0) FROM tts_cache") or 0)
                if total <= budget:
                    return {"total": total, "deleted": 0}
                target = int(budget * 0.85)
                rows = await conn.fetch(
                    "SELECT key, bytes FROM tts_cache WHERE NOT pinned ORDER BY used_at ASC LIMIT 500")
                doomed, freed = [], 0
                for r in rows:
                    if total - freed <= target:
                        break
                    doomed.append(r["key"])
                    freed += int(r["bytes"] or 0)
                if doomed:
                    await conn.execute("DELETE FROM tts_cache WHERE key = ANY($1::text[])", doomed)
                    log.info("tts_cache trim: %d kayit, %.1f MB serbest (toplam %.1f MB -> %.1f MB)",
                             len(doomed), freed / 1e6, total / 1e6, (total - freed) / 1e6)
                return {"total": total - freed, "deleted": len(doomed)}
        except Exception as e:  # noqa
            log.warning("tts_cache trim basarisiz: %r", e)
            return {"error": True}


async def _run_tts_job(job_id: str, chunks: list[str], voice: str, style: str, key: str):
    """Parcalari SIRAYLA seslendirir; kota hatasinda Google'in onerdigi kadar bekler.

    Es zamanli istek yok: ucretsiz kotada dakikalik istek siniri cok dusuk,
    paralel gitmek kotayi aninda yakiyor.
    Sonuc: job["pcm"] (ham ses); istemci /audio ile istedigi formatta alir, MP3 onbellege yazilir.
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
                    t0 = time.monotonic()
                    pcm = await asyncio.to_thread(synthesize_pcm, text, voice, style)
                    log.info("tts job %s parca %d/%d: %d kr, %.1f sn, %d bayt", job_id[:8], i + 1,
                             len(chunks), len(text), time.monotonic() - t0, len(pcm))
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
        pcm_all = b"".join(parts)
        job["pcm"] = pcm_all
        job["status"] = "ready"
        # Tam sesi MP3 olarak sakla (WAV'in 6'da biri); olmazsa WAV.
        data, _mime, real = await asyncio.to_thread(encode_audio, pcm_all, "mp3")
        job[real] = data
        await _cache_put(f"{real}:{key}", data, sum(len(c) for c in chunks))
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
    """Uzun metni arka planda parca parca seslendirir; is kimligi doner.

    Yanit: {job_id, total, cached, chars, eta_sec} — eta_sec kabaca tahmin (~1 sn/100 kr)."""
    _tts_cleanup()
    txt = (body.text or "").strip()
    if len(txt) < 2:
        raise AppError("Seslendirilecek metin boş.")
    txt = txt[:12000]
    voice = body.voice or DEFAULT_VOICE
    if voice not in FEMALE_VOICES:
        voice = DEFAULT_VOICE
    style = body.style or ""
    chunks = split_for_tts(txt)
    if not chunks:
        raise AppError("Seslendirilecek metin boş.")
    job_id = str(uuid.uuid4())
    key = cache_key(txt, voice, style)
    job = {"status": "running", "done": 0, "total": len(chunks), "pcm": None, "mp3": None, "wav": None,
           "error": None, "quota": False, "daily": False, "note": "", "waiting": 0,
           "at": time.time(), "user": str(user["id"]), "chars": len(txt), "key": key}
    _TTS_JOBS[job_id] = job

    # Ayni metin daha once seslendirildiyse: once MP3, sonra eski WAV kaydi.
    cached_mp3 = await _cache_get("mp3:" + key)
    if cached_mp3 is not None:
        job.update(status="ready", mp3=cached_mp3, done=len(chunks))
        return {"job_id": job_id, "total": len(chunks), "cached": True, "chars": len(txt), "eta_sec": 0}
    cached_wav = await _cache_get("wav:" + key)
    if cached_wav is not None:
        job.update(status="ready", wav=cached_wav, pcm=pcm_from_wav(cached_wav), done=len(chunks))
        return {"job_id": job_id, "total": len(chunks), "cached": True, "chars": len(txt), "eta_sec": 0}

    asyncio.create_task(_run_tts_job(job_id, chunks, voice, style, key))
    return {"job_id": job_id, "total": len(chunks), "cached": False, "chars": len(txt),
            "eta_sec": estimate_seconds(len(txt)) + 2 * (len(chunks) - 1)}


@router.get("/tts/jobs/{job_id}")
async def tts_job_status(job_id: str, user=Depends(current_user)):
    job = _TTS_JOBS.get(job_id)
    if not job or job.get("user") != str(user["id"]):
        raise NotFound("Ses hazırlığı yarıda kaldı; seslendirmeyi yeniden başlat.")
    size = len(job["mp3"]) if job.get("mp3") else (len(job["pcm"]) + 44 if job.get("pcm") else 0)
    return {"status": job["status"], "done": job["done"], "total": job["total"],
            "error": job["error"], "quota": job.get("quota", False),
            "daily": job.get("daily", False), "note": job.get("note", ""),
            "waiting": job.get("waiting", 0), "chars": job.get("chars", 0),
            "bytes": size}


@router.get("/tts/jobs/{job_id}/audio")
async def tts_job_audio(job_id: str, request: Request, user=Depends(current_user), fmt: str | None = None):
    """Hazir isin sesi; varsayilan MP3 (`?fmt=wav` ile WAV)."""
    job = _TTS_JOBS.get(job_id)
    if not job or job.get("user") != str(user["id"]):
        raise NotFound("Ses hazırlığı yarıda kaldı; seslendirmeyi yeniden başlat.")
    if job["status"] != "ready" or not (job.get("pcm") or job.get("mp3") or job.get("wav")):
        raise AppError("Ses hâlâ hazırlanıyor; birkaç saniye sonra tekrar dene.")
    want = normalize_format(fmt, request.headers.get("accept"))
    chars = job.get("chars", 0)
    if want == "mp3":
        if job.get("mp3"):
            return _audio_response(job["mp3"], FORMATS["mp3"], True, chars)
        pcm = job.get("pcm") or pcm_from_wav(job["wav"])
        data, mime, real = await asyncio.to_thread(encode_audio, pcm, "mp3")
        job[real] = data
        if real == "mp3" and job.get("key"):
            asyncio.create_task(_cache_put("mp3:" + job["key"], data, chars))
        return _audio_response(data, mime, True, chars)
    # WAV istendi
    if job.get("wav"):
        return _audio_response(job["wav"], FORMATS["wav"], True, chars)
    pcm = job.get("pcm")
    if not pcm and job.get("mp3"):
        pcm = await asyncio.to_thread(mp3_to_pcm, job["mp3"])
        if not pcm:
            return _audio_response(job["mp3"], FORMATS["mp3"], True, chars)
    data, mime, _real = encode_audio(pcm or b"", "wav")
    job["wav"] = data
    return _audio_response(data, mime, True, chars)


# ---- Parcali isler (S2): parca hazir oldukca sunulur; durum kalici (tts_jobs tablosu) ----
# Is olusturma: POST /collections/{cid}/lecture/tts (api/lecture.py). Kayit: services/tts_jobs.py
JOB_LOST = "Ses hazırlığı yarıda kaldı (sunucu yenilenmiş olabilir); seslendirmeyi yeniden başlat."


@router.get("/tts/jobs/{job_id}/chunks")
async def tts_job_chunks(job_id: str, user=Depends(current_user)):
    """Parcali is durumu: {status, done, total, ready_chunks:[n...], durations:{n: sn}, texts, mime, ...}.

    Bellekte yoksa tablodan yuklenir; yarim kalmissa kaldigi yerden devam ettirilir (M7)."""
    from app.services import tts_jobs
    job = await tts_jobs.get_job(job_id, str(user["id"]))
    if not job:
        raise NotFound(JOB_LOST)
    return tts_jobs.public(job)


@router.get("/tts/jobs/{job_id}/chunks/{n}")
async def tts_job_chunk_audio(job_id: str, n: int, user=Depends(current_user)):
    """n. parcanin sesi (hazirsa; degilse 409 benzeri AppError). MP3 kodlayici varsa MP3, yoksa WAV."""
    from app.services import tts_jobs
    job = await tts_jobs.get_job(job_id, str(user["id"]))
    if not job:
        raise NotFound(JOB_LOST)
    out = await tts_jobs.chunk_audio(job, n)
    if out is None:
        raise AppError("Bu parça hâlâ hazırlanıyor; birkaç saniye sonra tekrar dene.")
    data, mime = out
    return Response(content=data, media_type=mime,
                    headers={"Cache-Control": "private, max-age=3600", "X-Tts-Chunk": str(n)})
