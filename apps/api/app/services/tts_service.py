"""Gemini TTS ile dogal Turkce seslendirme.

Gemini TTS 24kHz, 16-bit, mono PCM dondurur. Varsayilan cikti artik MP3
(ffmpeg, 64 kb/s mono: WAV'in ~6'da biri); ffmpeg yoksa ya da hata verirse
WAV basligi eklenip olduğu gibi verilir.
"""
import base64
import hashlib
import logging
import re
import shutil
import struct
import subprocess
import httpx
from app.config import settings
from app.core.errors import AiUnavailable
from app.ai import usage

BASE = "https://generativelanguage.googleapis.com/v1beta"
log = logging.getLogger(__name__)

PCM_RATE = 24000                       # Gemini TTS: 24 kHz, 16 bit, mono
WAV_HEADER_LEN = 44
MP3_BITRATE = "64k"
FORMATS = {"mp3": "audio/mpeg", "wav": "audio/wav"}
DEFAULT_FORMAT = "mp3"

# Ses ornegi: her ses icin bir kez uretilir, `sample:<ses>:<format>` anahtariyla
# kalici saklanir (LectureTab'in gonderdigi cumleyle birebir ayni olmali).
SAMPLE_TEXT = "Merhaba, bu defterdeki kaynakları sana bu sesle anlatacağım."


class TtsBusy(AiUnavailable):
    """Gemini modeli gecici olarak yogun (500/503/504). Beklenip tekrar denenir."""

    code, status = "TTS_BUSY", 503

    def __init__(self, user_message: str | None = None, retry_after: int = 8):
        super().__init__(user_message)
        self.retry_after = retry_after


class TtsQuota(AiUnavailable):
    """Gemini ses kotasi doldu (429). retry_after: onerilen bekleme (sn)."""

    code, status = "TTS_QUOTA", 429      # 503 degil: istemci bunu tekrar denemesin

    def __init__(self, user_message: str | None = None, retry_after: int = 30, daily: bool = False):
        super().__init__(user_message)
        self.retry_after = retry_after
        self.daily = daily

# Gemini TTS kadin sesleri (etiket: dokumandaki karakter tanimi)
FEMALE_VOICES = {
    "Sulafat": "Sıcak",
    "Achernar": "Yumuşak",
    "Vindemiatrix": "Nazik",
    "Kore": "Kararlı",
    "Zephyr": "Parlak",
    "Leda": "Genç",
    "Aoede": "Ferah",
    "Autonoe": "Aydınlık",
    "Callirrhoe": "Rahat",
    "Despina": "Akıcı",
    "Erinome": "Net",
    "Laomedeia": "Neşeli",
    "Gacrux": "Olgun",
    "Pulcherrima": "İddialı",
    "Sadachbia": "Canlı",
}
DEFAULT_VOICE = "Sulafat"


def _wav_header(pcm_len: int, rate: int = 24000, channels: int = 1, bits: int = 16) -> bytes:
    byte_rate = rate * channels * bits // 8
    block_align = channels * bits // 8
    return (
        b"RIFF" + struct.pack("<I", 36 + pcm_len) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, rate, byte_rate, block_align, bits)
        + b"data" + struct.pack("<I", pcm_len)
    )


def wav_from_pcm(pcm: bytes) -> bytes:
    """Ham PCM'i calinabilir WAV'a cevirir."""
    return _wav_header(len(pcm)) + pcm


def pcm_from_wav(wav: bytes) -> bytes:
    """Bizim urettigimiz (44 baytlik sabit basliklı) WAV'dan PCM'i geri alir."""
    if wav[:4] == b"RIFF" and len(wav) > WAV_HEADER_LEN:
        return wav[WAV_HEADER_LEN:]
    return wav


_FFMPEG: str | None = None
_FFMPEG_CHECKED = False


def ffmpeg_path() -> str | None:
    """ffmpeg ikilisi (Dockerfile'da var); yoksa None -> WAV'a duselim."""
    global _FFMPEG, _FFMPEG_CHECKED
    if not _FFMPEG_CHECKED:
        _FFMPEG = shutil.which("ffmpeg")
        _FFMPEG_CHECKED = True
    return _FFMPEG


def pcm_to_mp3(pcm: bytes, bitrate: str = MP3_BITRATE) -> bytes | None:
    """PCM (s16le 24 kHz mono) -> MP3. ffmpeg yoksa/hata verirse None (cagiran WAV'a duser).

    Boru uzerinden calisir, gecici dosya yok. 9 dakikalik ses ~1-2 sn surer;
    engelleyici oldugu icin `asyncio.to_thread` icinden cagrilmali.
    """
    exe = ffmpeg_path()
    if not exe or not pcm:
        return None
    cmd = [exe, "-hide_banner", "-loglevel", "error", "-nostdin",
           "-f", "s16le", "-ar", str(PCM_RATE), "-ac", "1", "-i", "pipe:0",
           "-codec:a", "libmp3lame", "-b:a", bitrate, "-f", "mp3", "pipe:1"]
    try:
        p = subprocess.run(cmd, input=pcm, capture_output=True, timeout=120)
        if p.returncode == 0 and len(p.stdout) > 200:
            return p.stdout
        log.warning("ffmpeg mp3 basarisiz (rc=%s): %s", p.returncode, p.stderr[-300:].decode("utf-8", "ignore"))
    except Exception as e:  # noqa
        log.warning("ffmpeg mp3 calistirilamadi: %r", e)
    return None


def mp3_to_pcm(mp3: bytes) -> bytes | None:
    """MP3 -> PCM (s16le 24 kHz mono); yalniz eski istemci WAV isterse gerekir."""
    exe = ffmpeg_path()
    if not exe or not mp3:
        return None
    cmd = [exe, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", "pipe:0",
           "-f", "s16le", "-ar", str(PCM_RATE), "-ac", "1", "pipe:1"]
    try:
        p = subprocess.run(cmd, input=mp3, capture_output=True, timeout=120)
        if p.returncode == 0 and p.stdout:
            return p.stdout
    except Exception:  # noqa
        pass
    return None


def normalize_format(fmt: str | None, accept: str | None = None) -> str:
    """Istemcinin istedigi format: `?fmt=` once, sonra Accept basligi, yoksa MP3."""
    f = (fmt or "").strip().lower()
    if f in ("mp3", "mpeg"):
        return "mp3"
    if f in ("wav", "wave"):
        return "wav"
    a = (accept or "").lower()
    if "audio/wav" in a and "audio/mpeg" not in a:
        return "wav"
    return DEFAULT_FORMAT


def encode_audio(pcm: bytes, fmt: str = DEFAULT_FORMAT) -> tuple[bytes, str, str]:
    """PCM'i istenen bicime kodlar -> (bayt, mime, gercek_format). MP3 olmazsa WAV."""
    if fmt == "mp3":
        mp3 = pcm_to_mp3(pcm)
        if mp3:
            return mp3, FORMATS["mp3"], "mp3"
    return wav_from_pcm(pcm), FORMATS["wav"], "wav"


def cache_key(text: str, voice: str, style: str = "") -> str:
    """Ayni metin+ses icin sabit anahtar; uretilen ses bir daha uretilmez.

    Format anahtara DAHIL DEGIL: cagiran `mp3:`/`wav:`/`pcm:` on ekiyle ayirir,
    boylece eski `wav:` kayitlari gecerli kalir (bkz. api/study.py).
    """
    h = hashlib.sha256()
    h.update((text or "").strip().encode("utf-8"))
    h.update(b"\x00" + (voice or "").encode("utf-8"))
    h.update(b"\x00" + (style or "").strip().encode("utf-8"))
    return h.hexdigest()


def sample_key(voice: str, fmt: str = DEFAULT_FORMAT) -> str:
    """Ses ornegi icin kalici anahtar (LRU temizliginde silinmez)."""
    return f"sample:{voice}:{fmt}"


def estimate_seconds(chars: int, sec_per_100: float = 1.0) -> int:
    """Kabaca uretim suresi: ~1 sn / 100 karakter (istemci kendi olcumuyle kalibre eder)."""
    return max(3, int(round(chars / 100.0 * sec_per_100)) + 2)


def _quota_from_response(r: httpx.Response) -> "TtsQuota":
    """429 govdesinden Google'in onerdigi bekleme suresini okur."""
    delay, daily, msg = 30, False, ""
    try:
        err = (r.json() or {}).get("error") or {}
        msg = (err.get("message") or "")[:300]
        for d in err.get("details") or []:
            if str(d.get("@type", "")).endswith("RetryInfo"):
                m = re.match(r"(\d+(?:\.\d+)?)s", str(d.get("retryDelay") or ""))
                if m:
                    delay = int(float(m.group(1))) + 1
            if str(d.get("@type", "")).endswith("QuotaFailure"):
                for v in d.get("violations") or []:
                    if "PerDay" in str(v.get("quotaId", "")):
                        daily = True
    except Exception:
        pass
    if "PerDay" in msg or "per day" in msg.lower():
        daily = True
    if daily:
        return TtsQuota("Seslendirme bugünlük doldu, yarın yeniden açılır. "
                        "Şimdilik cihaz sesiyle dinleyebilirsin.", retry_after=3600, daily=True)
    delay = max(5, min(delay, 90))
    return TtsQuota(f"Seslendirme şu an yoğun; {delay} saniye sonra kendiliğinden yeniden denenecek.",
                    retry_after=delay)


def split_for_tts(text: str, max_chars: int = 2600) -> list[str]:
    """Metni cumle sinirlarindan ~max_chars'lik parcalara boler.

    Parca ne kadar buyukse o kadar az Gemini cagrisi -> kota o kadar az yanar.
    """
    text = (text or "").strip()
    if not text:
        return []
    sentences = re.split(r"(?<=[.!?…])\s+", text)
    chunks, cur = [], ""
    for sent in sentences:
        if len(cur) + len(sent) + 1 <= max_chars:
            cur = (cur + " " + sent).strip()
        else:
            if cur:
                chunks.append(cur)
            while len(sent) > max_chars:          # tek cumle cok uzunsa kes
                cut = sent.rfind(" ", 0, max_chars)
                cut = cut if cut > max_chars // 2 else max_chars
                chunks.append(sent[:cut].strip())
                sent = sent[cut:].strip()
            cur = sent
    if cur:
        chunks.append(cur)
    return chunks


def _tts_models() -> list[str]:
    first = (settings.gemini_tts_model or "gemini-2.5-flash-preview-tts").strip()
    return list(dict.fromkeys([first, "gemini-2.5-flash-tts", "gemini-2.5-flash-preview-tts",
                               "gemini-2.5-pro-preview-tts", "gemini-2.5-pro-tts"]))


def synthesize_pcm(text: str, voice: str = DEFAULT_VOICE, style: str = "") -> bytes:
    """Metni ham PCM baytlarina cevirir (tek Gemini cagrisi)."""
    key = (settings.gemini_api_key or "").strip()
    if not key:
        # yapilandirma eksik (GEMINI_API_KEY); ayrinti kullaniciya degil loga
        raise AiUnavailable("Seslendirme şu an kullanılamıyor. Cihaz sesiyle dinleyebilirsin.",
                            detail="GEMINI_API_KEY tanimli degil")
    if voice not in FEMALE_VOICES:
        voice = DEFAULT_VOICE

    directive = style.strip() or (
        "Sıcak, sakin ve anlaşılır bir öğretmen tonuyla, doğal bir tempoda oku"
    )
    prompt = f"{directive}:\n\n{text[:8000]}"

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}
            },
        },
    }
    try:
        # Ses modeli havuzu: biri gunluk kotayi doldurursa digerine gec (her birinin ayri kotasi var)
        r = None
        quota_err = None
        usage.check_user()
        for model in _tts_models():
            if not usage.available(model):
                continue
            url = f"{BASE}/models/{model}:generateContent?key={key}"
            r = httpx.post(url, json=payload, timeout=httpx.Timeout(connect=10, read=170, write=30, pool=10))
            if r.status_code == 404:
                usage.mark_dead(model); r = None; continue
            if r.status_code == 429:
                quota_err = _quota_from_response(r)
                usage.mark_limited(model, getattr(quota_err, "daily", False), getattr(quota_err, "retry_after", None))
                r = None; continue
            break
        if r is None:
            if quota_err is None and any(usage.status(m) == "gunluk_doldu" for m in _tts_models()):
                quota_err = TtsQuota("Seslendirme bugünlük doldu, yarın yeniden açılır. "
                                     "Şimdilik cihaz sesiyle dinleyebilirsin.", daily=True)
            raise quota_err or TtsQuota("Seslendirme şu an yoğun; biraz sonra tekrar dene ya da cihaz sesiyle dinle.")
        if r.status_code in (500, 502, 503, 504):
            raise TtsBusy("Seslendirme şu an yoğun; birkaç saniye içinde yeniden denenecek.")
        if r.status_code >= 400:
            detail = ""
            try:
                detail = (r.json().get("error") or {}).get("message", "")[:160]
            except Exception:
                pass
            raise AiUnavailable("Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.",
                                detail=f"tts {r.status_code}: {detail}")
        usage.record(model, "ses", len(text) // 4)
        data = r.json()
        parts = data["candidates"][0]["content"]["parts"]
        b64 = None
        for p in parts:
            inline = p.get("inlineData") or p.get("inline_data")
            if inline and inline.get("data"):
                b64 = inline["data"]
                break
        if not b64:
            raise AiUnavailable("Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.",
                                detail="tts: bos ses verisi")
        return base64.b64decode(b64)
    except AiUnavailable:
        raise
    except httpx.TimeoutException:
        raise AiUnavailable("Seslendirme çok uzun sürdü. Metni kısaltıp tekrar dene.")
    except Exception:  # noqa
        raise AiUnavailable("Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.")


def synthesize_pcm_retry(text: str, voice: str = DEFAULT_VOICE, style: str = "") -> bytes:
    """Tek parca PCM (kisa metinler icin); gecici yogunlukta kendi kendine tekrar dener."""
    import time as _time
    last: Exception | None = None
    for attempt in range(3):
        try:
            return synthesize_pcm(text, voice, style)
        except TtsBusy as e:
            last = e
            if attempt < 2:
                _time.sleep(e.retry_after)
        except Exception:  # noqa - kota ve diger hatalar dogrudan yukari
            raise
    raise last or AiUnavailable("Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.")


def synthesize(text: str, voice: str = DEFAULT_VOICE, style: str = "") -> bytes:
    """Geriye uyum: tek parca WAV."""
    return wav_from_pcm(synthesize_pcm_retry(text, voice, style))


def synthesize_audio(text: str, voice: str = DEFAULT_VOICE, style: str = "",
                     fmt: str = DEFAULT_FORMAT) -> tuple[bytes, str, str]:
    """Tek parca ses, istenen bicimde -> (bayt, mime, gercek_format)."""
    return encode_audio(synthesize_pcm_retry(text, voice, style), fmt)
