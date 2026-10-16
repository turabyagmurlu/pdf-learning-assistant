"""Parcali seslendirme isleri (sesli ozet).

Farklari (study.py'deki eski is kuyruguna gore):
- Her parca hazir oldugu anda ayri ayri sunulur (GET /tts/jobs/{id}/chunks/{n});
  istemci ilk parca hazir olunca calmaya baslar, kalanlar arkada uretilir.
- Is durumu kucuk `tts_jobs` tablosuna yazilir; sunucu yeniden basladiginda is
  kaybolmaz, "running" kalan isler ilk sorguda kaldigi yerden devam eder
  (parca sesleri zaten `pcm:` onbelleginde oldugu icin hizli tamamlanir).
- Iki kisilik sohbet (Ayse + Kerem): Gemini cok konusmacili ses ayari ile tek
  cagrida iki ses; parcalama replik ortasindan bolmez.
- Ayni parca ayni anda iki isten istenirse (on parca + tam is) tek Gemini cagrisi
  yapilir; digeri sonucu bekler (kota bosa gitmez).
- V3: metin `tts_prepare`'den gecer; parcalar paragraf hizali; her parcanin sonunda 500 ms
  sessizlik; yonerge Ingilizce/ayrik/parca baglamli (tekli ve sohbet ortak sablon); bolumler
  (`chapters`) paragraf bazli, kota 0.
- P2: metindeki `## Bölüm adı` satirlari bolum isaretidir; seslendirilmez, parca sinirlari bolum
  basina hizalanir (her bolum yeni parcada baslar). Is yanitinda `chapter_chunks: [{title, chunk_index}]`.
"""
import asyncio
import json
import logging
import re
import time
import uuid

from app.ai import usage
from app.core.errors import AiUnavailable
from app.db.session import get_pool
from app.services import tts_service as T
from app.services.tts_service import (TtsBusy, TtsQuota, DEFAULT_VOICE, FEMALE_VOICES, MALE_VOICES,  # noqa: F401
                                      DEFAULT_MALE_VOICE, cache_key, split_for_tts, wav_from_pcm,
                                      tts_prepare, normalize_voice, with_tail_silence, build_prompt)

log = logging.getLogger(__name__)

# S1 ajani MP3 kodlayiciyi ekleyince kullanilir; yoksa WAV'a dusulur.
try:  # pragma: no cover - ortama bagli
    from app.services.tts_service import encode_audio as _encode_audio  # type: ignore
except Exception:  # noqa
    _encode_audio = None

# ---- Sohbet formati ------------------------------------------------------------
SPEAKER_A = "Ayşe"        # ogretmen / anlatici (kadin sesi; kullanicinin sectigi)
SPEAKER_B = "Kerem"       # merakli ogrenci (erkek sesi)

# Erkek sesleri (3 ses) ve varsayilan: tts_service.MALE_VOICES / DEFAULT_MALE_VOICE (buradan yeniden disa verilir)

MAX_JOB_CHARS = 40000     # derin podcast (~3500 kelime ≈ 25K karakter) sigsin; eskiden 12000

_LINE_RE = re.compile(r"^\s*(Ayşe|Ayse|Kerem)\s*:\s*(.*)$", re.IGNORECASE)
# Bolum isareti: satir basinda 1-3 '#', ardindan baslik (seslendirilmez)
_CHAPTER_RE = re.compile(r"^[ \t]*#{1,3}[ \t]+(?P<t>[^\n]*?)[ \t#]*$", re.MULTILINE)


def chapter_marks(text: str) -> list[dict]:
    """Metindeki `## Bölüm adı` satirlari -> [{title, char_start}] (char_start: isaret satirinin metindeki yeri)."""
    out = []
    for m in _CHAPTER_RE.finditer(text or ""):
        t = m.group("t").strip().strip("*_ ").rstrip(":").strip()
        if t:
            out.append({"title": t[:90], "char_start": m.start()})
    return out


def split_sections(text: str) -> list[tuple[str | None, str]]:
    """Metni bolum isaretlerinden boler: [(baslik|None, govde)]. Isaretten onceki kisim basliksiz bolumdur.
    Govdelerde isaret satiri yoktur (seslendirmeye girmez)."""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    out: list[tuple[str | None, str]] = []
    title: str | None = None
    pos = 0
    for m in _CHAPTER_RE.finditer(text):
        body = text[pos:m.start()]
        if body.strip() or title is not None:
            out.append((title, body))
        t = m.group("t").strip().strip("*_ ").rstrip(":").strip()
        title = t[:90] if t else (title or "")
        pos = m.end()
    out.append((title, text[pos:]))
    return [(t, b) for t, b in out if b.strip() or t]


def strip_chapter_marks(text: str) -> str:
    return _CHAPTER_RE.sub("", text or "")


def is_dialog(text: str) -> bool:
    """Metin 'Ayşe: … / Kerem: …' satirlarindan mi olusuyor? (bolum isareti satirlari sayilmaz)"""
    lines = [ln for ln in strip_chapter_marks(text).splitlines() if ln.strip()]
    if len(lines) < 4:
        return False
    hits = sum(1 for ln in lines if _LINE_RE.match(ln))
    return hits >= 4 and hits * 2 >= len(lines)


def _norm_dialog_lines(text: str) -> list[str]:
    """Replikleri 'Ayşe: …' / 'Kerem: …' biciminde normaller; etiketsiz satirlari onceki konusmaciya ekler."""
    out: list[str] = []
    last = SPEAKER_A
    for raw in (text or "").splitlines():
        ln = raw.strip()
        if not ln:
            continue
        m = _LINE_RE.match(ln)
        if m:
            who = SPEAKER_B if m.group(1).lower().startswith("k") else SPEAKER_A
            last = who
            body = m.group(2).strip()
            if body:
                out.append(f"{who}: {body}")
        else:
            out.append(f"{last}: {ln}")
    return out


def split_dialog_for_tts(text: str, max_chars: int = 2600) -> list[str]:
    """Sohbeti replik sinirlarindan parcalara boler; bir replik asla ikiye bolunmez
    (cok uzunsa cumle sinirindan bolunur ve devam satiri ayni etiketi alir)."""
    lines = _norm_dialog_lines(text)
    chunks: list[str] = []
    cur = ""
    for ln in lines:
        pieces = [ln]
        if len(ln) > max_chars:
            who, body = ln.split(":", 1)
            pieces = [f"{who}: {p}" for p in split_for_tts(body.strip(), max_chars - len(who) - 2)]
        for p in pieces:
            if cur and len(cur) + len(p) + 1 > max_chars:
                chunks.append(cur)
                cur = p
            else:
                cur = (cur + "\n" + p).strip()
    if cur:
        chunks.append(cur)
    return chunks


def split_any(text: str, dialog: bool, max_chars: int = 2600) -> list[str]:
    return split_dialog_for_tts(text, max_chars) if dialog else split_for_tts(text, max_chars)


def _title_of(text: str, words: int = 6) -> str:
    first = re.split(r"(?<=[.!?])\s+", text.strip(), maxsplit=1)[0]
    ws = first.split()
    t = " ".join(ws[:words])
    return (t + "…") if len(ws) > words else t.rstrip(".!?")


def chapters_for(chunks: list[str], dialog: bool = False) -> list[dict]:
    """Bolum isaretleri (kota 0): tekli anlatimda her paragraf bir bolum, sohbette Ayşe'nin her 3. repligi.
    Donus: [{chunk, offset (karakter, parca icinde), title}]. Istemci karakter orantisiyla saniyeye cevirir."""
    out: list[dict] = []
    for ci, text in enumerate(chunks):
        if dialog:
            pos, k = 0, 0
            for ln in text.split("\n"):
                if ln.lower().startswith("ay") and ":" in ln:
                    if k % 3 == 0:
                        body = ln.split(":", 1)[1].strip()
                        out.append({"chunk": ci, "offset": pos, "title": _title_of(body)})
                    k += 1
                pos += len(ln) + 1
        else:
            pos = 0
            for para in re.split(r"(\n\s*\n)", text):
                if para.strip() and not para.isspace():
                    out.append({"chunk": ci, "offset": pos, "title": _title_of(para)})
                pos += len(para)
    return out[:200]


def prepare_sections(raw: str, dialog: bool) -> tuple[str, list[dict]]:
    """Bolum isaretli metni seslendirmeye hazirlar: her bolum govdesi ayri `tts_prepare`'den gecer,
    isaret satirlari atilir. Donus: (hazir metin, [{title, start}] — bolumun hazir metindeki baslangici).
    Isaretsiz metinde tek basliksiz bolum (eski davranisla ayni metin)."""
    sep = "\n" if dialog else "\n\n"
    out, starts, pos = [], [], 0
    for title, body in split_sections(raw):
        prepared = tts_prepare(body, dialog=dialog)
        if not prepared.strip():
            continue
        if out:
            pos += len(sep)
        if title:
            starts.append({"title": title, "start": pos})
        out.append(prepared)
        pos += len(prepared)
    return sep.join(out), starts


def aligned_chunks(txt: str, starts: list[dict], dialog: bool, consumed: int = 0,
                   first: list[str] | None = None, max_chars: int = 2600,
                   lead: list[int] | None = None) -> tuple[list[str], list[dict]]:
    """Hazir metni parcalar; her bolum basi yeni bir parcada baslar.
    `first`/`consumed`: on parca (head) kullanildiysa ilk parcalar ve metinden tukettigi karakter.
    Donus: (parcalar, [{title, chunk_index}]). On parcanin icinde baslayan bolum -> chunk_index 0."""
    chunks: list[str] = [c for c in (first or []) if c.strip()]
    lead = list(lead or [])
    marks: list[dict] = []
    for st in starts:
        if st["start"] < consumed:
            marks.append({"title": st["title"], "chunk_index": 0})
    bounds = sorted({st["start"] for st in starts if st["start"] >= consumed} | {consumed})
    bounds.append(len(txt))
    by_start = {st["start"]: st["title"] for st in starts}
    for a, b in zip(bounds, bounds[1:]):
        seg = txt[a:b].strip()
        if not seg:
            continue
        if a in by_start and a >= consumed:
            marks.append({"title": by_start[a], "chunk_index": len(chunks)})
        if lead:
            pieces, seg = _lead_pieces(seg, dialog, lead)
            lead = lead[len(pieces):] if seg else []
            chunks.extend(pieces)
            if not seg:
                continue
        chunks.extend(c for c in split_any(seg, dialog, max_chars) if c.strip())
    return chunks, marks


# Hizli baslangic: ilk parcalar kucuk (birkac saniyede uretilir, ses hemen baslar), sonrakiler buyur.
LEAD_SIZES = [700]   # ucretsiz katman gunde ~10 ses istegi: yalniz ilk parca kucuk, gerisi buyuk (az istek)


def _lead_pieces(seg: str, dialog: bool, sizes: list[int]) -> tuple[list[str], str]:
    """`seg`in basindan `sizes` boylarinda parcalar keser; (parcalar, kalan) dondurur.
    Kesim paragraf/replik sinirina duser; esleme bozulursa hic kesmez (guvenli)."""
    out: list[str] = []
    rest = seg
    for n in sizes:
        if not rest.strip() or len(rest) <= n * 1.3:
            break
        first = next((c for c in split_any(rest, dialog, n) if c.strip()), "")
        r = strip_head(rest, first) if first else None
        if r is None or not r.strip():
            break
        out.append(first)
        rest = r.strip()
    return out, rest


def strip_head(text: str, head: str) -> str | None:
    """`head` metnin basiysa (bosluk/satir farklari onemsiz) kalan kismi dondurur; degilse None.
    Istemci akan metinden on parcayi paragraflari birlestirerek secer; bosluklar birebir tutmayabilir."""
    i = j = 0
    n, m = len(text), len(head)
    while j < m:
        if head[j].isspace():
            j += 1
            continue
        while i < n and text[i].isspace():
            i += 1
        if i >= n or text[i] != head[j]:
            return None
        i += 1
        j += 1
    return text[i:]


# ---- Gemini cagrisi: tts_service.gemini_audio (ortak havuz, karakter bazli kullanim kaydi) ------------
def synthesize_pcm_dialog(text: str, voice_a: str = DEFAULT_VOICE, voice_b: str = DEFAULT_MALE_VOICE,
                          part: int | None = None, total: int | None = None) -> bytes:
    """Iki konusmacili parca: Ayse (voice_a) + Kerem (voice_b) tek Gemini cagrisinda.
    Yonerge tekli anlatimla ortak sablondan (Ingilizce, ayrik, parca baglamli); sonuna 500 ms sessizlik."""
    voice_a = normalize_voice(voice_a)
    voice_b = normalize_voice(voice_b, male=True)
    prompt = build_prompt(text, "", part, total, dialog=True)
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "multiSpeakerVoiceConfig": {
                    "speakerVoiceConfigs": [
                        {"speaker": SPEAKER_A, "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice_a}}},
                        {"speaker": SPEAKER_B, "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice_b}}},
                    ]
                }
            },
        },
    }
    return with_tail_silence(T.gemini_audio(payload, len(text)))


def _encode(pcm: bytes) -> tuple[bytes, str]:
    """PCM -> tarayicinin calacagi bicim. S1'in MP3 kodlayicisi varsa o, yoksa WAV."""
    if _encode_audio is not None:
        try:
            out = _encode_audio(pcm)
            if isinstance(out, tuple) and len(out) >= 2:      # S1: (bayt, mime, gercek_format)
                return bytes(out[0]), str(out[1])
            if isinstance(out, (bytes, bytearray)) and len(out) > 4:
                return bytes(out), ("audio/mpeg" if bytes(out[:3]) in (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2") else "audio/wav")
        except Exception as e:  # noqa - kodlayici bozuksa WAV'a dus
            log.warning("encode_audio basarisiz, WAV'a dusuldu: %s", str(e)[:120])
    return wav_from_pcm(pcm), "audio/wav"


# ---- Onbellek (pcm parcalari study.py ile ortak) --------------------------------
async def _pcm_get(key: str) -> bytes | None:
    from app.api import study as _s          # gec import: dongusel bagimlilik yok
    return await _s._cache_get("pcm:" + key)


async def _pcm_put(key: str, pcm: bytes, chars: int):
    from app.api import study as _s
    await _s._cache_put("pcm:" + key, pcm, chars)


async def _full_put(key: str, pcm: bytes, chars: int):
    """Birlesik sesi onbellege yazar: MP3 kodlanabiliyorsa `mp3:` (WAV'in ~1/6'si), yoksa `wav:`."""
    from app.api import study as _s
    if _encode_audio is not None:
        try:
            data, _mime, real = await asyncio.to_thread(_encode_audio, pcm, "mp3")
            await _s._cache_put(f"{real}:" + key, data, chars)
            return
        except Exception:  # noqa
            pass
    await _s._cache_put("wav:" + key, wav_from_pcm(pcm), chars)


# ---- Is kaydi -----------------------------------------------------------------------
_JOBS: dict[str, dict] = {}
_INFLIGHT: dict[str, asyncio.Future] = {}
_TTL = 30 * 60
_SCHEMA_OK = False
_HEARTBEAT = 15          # sn: calisan is kaydini bu aralikla "canli" isaretler
_STALE = 45              # sn: bu kadar suredir guncellenmeyen "running" is sahipsiz sayilir -> devam ettirilir


async def _ensure_schema(conn):
    global _SCHEMA_OK
    if _SCHEMA_OK:
        return
    await conn.execute(
        "CREATE TABLE IF NOT EXISTS tts_jobs ("
        " id text PRIMARY KEY,"
        " user_id text NOT NULL,"
        " state jsonb NOT NULL,"
        " updated_at timestamptz NOT NULL DEFAULT now())")
    _SCHEMA_OK = True


def _public(job: dict) -> dict:
    """Istemciye giden durum (ses baytlari haric)."""
    return {
        "job_id": job["id"], "status": job["status"], "done": job["done"], "total": job["total"],
        "ready_chunks": sorted(job["ready"]),
        "durations": {str(i): round(job["durations"].get(str(i), 0.0), 2) for i in job["ready"]},
        "chars": [len(c) for c in job["chunks"]],
        "texts": job["chunks"],
        "dialog": job["dialog"], "voice": job["voice"], "voice2": job["voice2"],
        "error": job["error"], "quota": job.get("quota", False), "daily": job.get("daily", False),
        "note": job.get("note", ""), "waiting": job.get("waiting", 0),
        "mime": job.get("mime") or "audio/wav",
        "cached": job.get("cached", False), "resumed": job.get("resumed", False),
        # Bolum isaretli metinde bolumler parca basina hizali (offset 0); isaretsiz metinde eski paragraf bolumleri
        "chapters": ([{"chunk": c["chunk_index"], "offset": 0, "title": c["title"]} for c in job["chapter_marks"]]
                     if job.get("chapter_marks") else chapters_for(job["chunks"], job["dialog"])),
        "chapter_chunks": list(job.get("chapter_marks") or []),
    }


def _persistable(job: dict) -> dict:
    return {k: v for k, v in job.items() if k not in ("audio",)}


async def _save(job: dict):
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await _ensure_schema(conn)
            await conn.execute(
                "INSERT INTO tts_jobs (id, user_id, state, updated_at) VALUES ($1,$2,$3::jsonb,now()) "
                "ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, updated_at=now()",
                job["id"], job["user"], json.dumps(_persistable(job), ensure_ascii=False))
    except Exception as e:  # noqa - kalicilik iyi niyetli; bellek yeter
        log.debug("tts_jobs save atlandi: %s", str(e)[:120])


async def _load(job_id: str) -> tuple[dict, bool] | None:
    """Tablodan isi yukler. Donus: (is, sahipsiz_mi). sahipsiz: 'running' ama son _STALE sn'dir guncellenmemis
    (sunucu yeniden basladi / baska bir surec oldu) -> devam ettirilebilir."""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await _ensure_schema(conn)
            row = await conn.fetchrow(
                "SELECT state, extract(epoch FROM now() - updated_at) AS age FROM tts_jobs WHERE id=$1", job_id)
            if not row:
                return None
            st = row["state"]
            job = json.loads(st) if isinstance(st, str) else dict(st)
            job["audio"] = {}
            return job, float(row["age"] or 0) > _STALE
    except Exception:  # noqa
        return None


async def _heartbeat(job_id: str):
    """Is calisirken kaydi canli tutar (baska surec/yeniden baslatma ayni isi ikinci kez calistirmasin)."""
    try:
        while True:
            await asyncio.sleep(_HEARTBEAT)
            pool = await get_pool()
            async with pool.acquire() as conn:
                await conn.execute("UPDATE tts_jobs SET updated_at=now() WHERE id=$1", job_id)
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa
        pass


async def _cleanup():
    now = time.time()
    for k in [k for k, v in _JOBS.items() if now - v.get("at", now) > _TTL]:
        _JOBS.pop(k, None)
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await _ensure_schema(conn)
            await conn.execute("DELETE FROM tts_jobs WHERE updated_at < now() - interval '1 day'")
    except Exception:  # noqa
        pass


def _chunk_key(text: str, job: dict) -> str:
    return cache_key(text, job["voice"], job["style"])


async def _synth_chunk(job: dict, i: int) -> bytes:
    """Parcayi uretir; onbellek/ortak ucus varsa Gemini'ye gitmez."""
    text = job["chunks"][i]
    ck = _chunk_key(text, job)
    hit = await _pcm_get(ck)
    if hit is not None:
        return with_tail_silence(hit)
    fut = _INFLIGHT.get(ck)
    if fut is not None:
        return await asyncio.shield(fut)
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    _INFLIGHT[ck] = fut
    try:
        # Parca baglami: on parca isi (head_only) tek parcadir ama dersin basidir -> "part 1 of 2" gibi davran
        total = job["total"] if not job.get("head_only") else max(2, job["total"])
        part = i + 1
        if job["dialog"]:
            pcm = await asyncio.to_thread(synthesize_pcm_dialog, text, job["voice"], job["voice2"], part, total)
        else:
            pcm = await asyncio.to_thread(T.synthesize_pcm, text, job["voice"], "", part, total)
        await _pcm_put(ck, pcm, len(text))
        if not fut.done():
            fut.set_result(pcm)
        return pcm
    except BaseException as e:
        if not fut.done():
            fut.set_exception(e)
        raise
    finally:
        _INFLIGHT.pop(ck, None)


# Ayni anda en fazla bu kadar parca uretilir (model havuzu 429'da kendiliginden yedek modele gecer).
PARALLEL = 3


async def _synth_with_retry(job: dict, i: int, gate: dict) -> bytes:
    pcm: bytes | None = None
    for attempt in range(5):
        # Ortak bekleme: bir parca 429 aldiysa digerleri de ayni sureyi bekler (kotayi zorlamasin)
        delay = gate["until"] - time.time()
        if delay > 0:
            await asyncio.sleep(delay)
        try:
            pcm = await _synth_chunk(job, i)
            break
        except TtsQuota as q:
            if q.daily or attempt == 4:
                raise
            gate["until"] = max(gate["until"], time.time() + q.retry_after)
            job["waiting"] = int(q.retry_after)
            job["note"] = (f"Seslendirme şu an yoğun; {int(q.retry_after)} saniye sonra "
                           "kendiliğinden devam edecek…")
            await _save(job)
        except TtsBusy as b:
            if attempt == 4:
                raise
            wait = b.retry_after * (attempt + 1)
            gate["until"] = max(gate["until"], time.time() + wait)
            job["waiting"] = wait
            job["note"] = f"Seslendirme şu an yoğun; {wait} saniye sonra yeniden denenecek…"
            await _save(job)
        except Exception:  # noqa
            if attempt >= 1:
                raise
            await asyncio.sleep(3)
    if pcm is None:
        raise AiUnavailable("Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.")
    return pcm


async def _run(job: dict):
    job_id = job["id"]
    hb = asyncio.create_task(_heartbeat(job_id))
    try:
        todo = [i for i in range(job["total"]) if i not in job["ready"]]
        gate = {"until": 0.0}
        lock = asyncio.Lock()

        async def worker(w: int):
            # Kucuk gecikmeli baslangic: istekler ayni milisaniyede patlamasin
            await asyncio.sleep(w * 0.4)
            while True:
                async with lock:
                    if not todo:
                        return
                    i = todo.pop(0)          # sirayla: once dinlenecek parca once uretilir
                pcm = await _synth_with_retry(job, i, gate)
                async with lock:
                    job["durations"][str(i)] = len(pcm) / 48000.0
                    if i not in job["ready"]:
                        job["ready"].append(i)
                    job["done"] = len(job["ready"])
                    if gate["until"] <= time.time():
                        job["note"], job["waiting"] = "", 0
                    job["at"] = time.time()
                await _save(job)

        n = max(1, min(PARALLEL, len(todo)))
        tasks = [asyncio.create_task(worker(w)) for w in range(n)]
        try:
            await asyncio.gather(*tasks)
        except BaseException:
            for t in tasks:
                t.cancel()
            raise
        # Tamami hazir: birlesik ses onbellege (eski /tts/jobs yolu da bundan yararlanir)
        try:
            parts = []
            for i in range(job["total"]):
                p = await _pcm_get(_chunk_key(job["chunks"][i], job))
                if p is None:
                    parts = []
                    break
                parts.append(with_tail_silence(p))
            if parts:
                await _full_put(job["full_key"], b"".join(parts), sum(len(c) for c in job["chunks"]))
        except Exception:  # noqa
            pass
        job["status"] = "ready"
    except Exception as e:  # noqa
        job["status"] = "error"
        job["quota"] = isinstance(e, TtsQuota)
        job["daily"] = bool(getattr(e, "daily", False))
        if not getattr(e, "user_message", None):
            log.warning("tts job %s failed: %s", job_id, str(e)[:300])
        job["error"] = (getattr(e, "user_message", None)
                        or "Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.")
    hb.cancel()
    job["note"], job["waiting"] = "", 0
    job["at"] = time.time()
    await _save(job)


async def create_job(user_id: str, is_owner: bool, text: str, voice: str | None, voice2: str | None,
                     dialog: bool | None = None, head: str | None = None) -> dict:
    """Yeni parcali is. `head`: metnin basindaki, daha once on-uretilmis bolum;
    verilirse 1. parca tam olarak o olur (onbellekten aninda gelir).

    Metin ve on parca `tts_prepare`'den gecer (tire, atif, kisaltma, sayi, noktalama); `texts` alani
    islenmis metindir, cumle vurgusu da ayni metni gosterir. Parcalar paragraf sonuna hizalidir."""
    await _cleanup()
    raw = (text or "").strip()[:MAX_JOB_CHARS]
    if len(raw) < 2:
        raise AiUnavailable("Seslendirilecek metin boş.")
    if dialog is None:
        dialog = is_dialog(raw)
    txt, starts = prepare_sections(raw, dialog)
    if len(txt) < 2:
        raise AiUnavailable("Seslendirilecek metin boş.")
    voice = normalize_voice(voice)
    voice2 = normalize_voice(voice2, male=True)
    style = f"sohbet|{voice2}" if dialog else ""
    head = tts_prepare(strip_chapter_marks((head or "").strip()), dialog=dialog)
    rest = strip_head(txt, head) if head and len(head) <= 2600 else None
    head_only = bool(head) and rest is not None and not rest.strip()
    def _chunking(lead: list[int] | None):
        if rest is not None:
            # 1. parca tam olarak on parca: onbellek anahtari ayni -> on-uretilmis ses aninda kullanilir
            first = [head] if not dialog else split_dialog_for_tts(head)
            return aligned_chunks(txt, starts, dialog, consumed=len(txt) - len(rest), first=first,
                                  lead=None)
        return aligned_chunks(txt, starts, dialog, lead=lead)

    # Hizli baslangic parcalamasi; ama eski parcalamayla tamami onbellekteyse onu kullan (kota yanmasin)
    chunks, marks = _chunking(LEAD_SIZES)
    legacy, legacy_marks = _chunking(None)
    if legacy and legacy != chunks:
        probe = {"voice": voice, "style": style}
        hits = 0
        for c in legacy:
            if await _pcm_get(_chunk_key(c, probe)) is None:
                break
            hits += 1
        if hits == len(legacy):
            chunks, marks = legacy, legacy_marks
    if not chunks:
        raise AiUnavailable("Seslendirilecek metin boş.")
    job = {
        "id": str(uuid.uuid4()), "user": str(user_id), "owner": bool(is_owner),
        "status": "running", "done": 0, "total": len(chunks), "ready": [], "durations": {},
        "chunks": chunks, "voice": voice, "voice2": voice2, "dialog": dialog, "style": style,
        "head_only": head_only, "chapter_marks": marks,
        "full_key": cache_key(txt, voice, style),
        "error": None, "quota": False, "daily": False, "note": "", "waiting": 0,
        "at": time.time(), "mime": None, "cached": False, "resumed": False, "audio": {},
    }
    # Parcalarin hepsi onbellekteyse aninda hazir (ucretsiz)
    all_hit = True
    for i, c in enumerate(chunks):
        p = await _pcm_get(_chunk_key(c, job))
        if p is None:
            all_hit = False
            break
        job["durations"][str(i)] = len(with_tail_silence(p)) / 48000.0
        job["ready"].append(i)
    if all_hit:
        job["status"], job["done"], job["cached"] = "ready", len(chunks), True
    else:
        job["ready"], job["durations"], job["done"] = [], {}, 0
    _JOBS[job["id"]] = job
    await _save(job)
    if not all_hit:
        asyncio.create_task(_run(job))
    return _public(job)


async def get_job(job_id: str, user_id: str) -> dict | None:
    """Bellekten; yoksa tablodan (yeniden baslatma sonrasi) yukler ve yarim kalmissa devam ettirir."""
    job = _JOBS.get(job_id)
    if job is None:
        loaded = await _load(job_id)
        if loaded is None:
            return None
        job, orphan = loaded
        if job.get("user") != str(user_id):
            return None
        if job["status"] != "running":
            _JOBS[job_id] = job
        elif orphan:
            # Sunucu yenilenmis: kaldigi parcadan devam (hazir parcalar pcm onbelleginde)
            job["resumed"] = True
            job["note"] = "Sunucu yenilendi; ses hazırlığı kaldığı yerden sürüyor…"
            _JOBS[job_id] = job
            usage.set_user(job["user"], bool(job.get("owner")))
            asyncio.create_task(_run(job))
        # else: baska bir surec hala calistiriyor; bellege alma, her sorguda tablodan taze oku
        return job
    if job.get("user") != str(user_id):
        return None
    return job


def public(job: dict) -> dict:
    return _public(job)


async def chunk_audio(job: dict, n: int) -> tuple[bytes, str] | None:
    """n. parcanin sesi (hazirsa); yoksa None."""
    if n < 0 or n >= job["total"] or n not in job["ready"]:
        return None
    cached = job.setdefault("audio", {}).get(n)
    if cached:
        return cached
    pcm = await _pcm_get(_chunk_key(job["chunks"][n], job))
    if pcm is None:
        return None
    pcm = with_tail_silence(pcm)        # eski parcalar da sunumda 500 ms nefes alir
    out = await asyncio.to_thread(_encode, pcm)     # MP3 kodlama CPU isi; dongusu kilitlemesin
    job["mime"] = out[1]
    # Bellekte en fazla birkac parca tut (25 MB WAV riski)
    if len(job["audio"]) > 6:
        job["audio"].clear()
    job["audio"][n] = out
    return out
