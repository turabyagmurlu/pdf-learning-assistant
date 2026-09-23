"""Gemini TTS ile dogal Turkce seslendirme.

Gemini TTS 24kHz, 16-bit, mono PCM dondurur; onune WAV basligi ekleyip
tarayicida dogrudan calinabilir hale getiririz.
"""
import base64
import hashlib
import io
import re
import struct
import httpx
from app.config import settings
from app.core.errors import AiUnavailable
from app.ai import usage

BASE = "https://generativelanguage.googleapis.com/v1beta"


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


def cache_key(text: str, voice: str, style: str = "") -> str:
    """Ayni metin+ses icin sabit anahtar; uretilen WAV bir daha uretilmez."""
    h = hashlib.sha256()
    h.update((text or "").strip().encode("utf-8"))
    h.update(b"\x00" + (voice or "").encode("utf-8"))
    h.update(b"\x00" + (style or "").strip().encode("utf-8"))
    return h.hexdigest()


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
        return TtsQuota("Günlük ses kotası doldu. Yarın yenilenir; o zamana kadar "
                        "tarayıcı sesiyle dinleyebilirsin.", retry_after=3600, daily=True)
    delay = max(5, min(delay, 90))
    return TtsQuota(f"Ses kotası şu an dolu; {delay} saniye sonra otomatik denenecek.",
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
        raise AiUnavailable("Gemini API anahtarı tanımlı değil.")
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
                quota_err = TtsQuota("Bugünkü seslendirme kotası doldu; yarın yenilenir. "
                                     "Şimdilik tarayıcı sesiyle dinleyebilirsin.", daily=True)
            raise quota_err or TtsQuota("Seslendirme kotası şu an dolu.")
        if r.status_code in (500, 502, 503, 504):
            raise TtsBusy("Ses motoru şu an yoğun; birkaç saniye içinde tekrar denenecek.")
        if r.status_code >= 400:
            detail = ""
            try:
                detail = (r.json().get("error") or {}).get("message", "")[:160]
            except Exception:
                pass
            raise AiUnavailable(f"Seslendirme başarısız (kod {r.status_code}). {detail}".strip())
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
            raise AiUnavailable("Ses verisi alınamadı.")
        return base64.b64decode(b64)
    except AiUnavailable:
        raise
    except httpx.TimeoutException:
        raise AiUnavailable("Seslendirme çok uzun sürdü. Metni kısaltıp tekrar dene.")
    except Exception:  # noqa
        raise AiUnavailable("Seslendirme servisi şu an yanıt vermiyor.")


def synthesize(text: str, voice: str = DEFAULT_VOICE, style: str = "") -> bytes:
    """Tek parca WAV (kisa metinler icin); gecici yogunlukta kendi kendine tekrar dener."""
    import time as _time
    last: Exception | None = None
    for attempt in range(3):
        try:
            return wav_from_pcm(synthesize_pcm(text, voice, style))
        except TtsBusy as e:
            last = e
            if attempt < 2:
                _time.sleep(e.retry_after)
        except Exception as e:  # noqa - kota ve diger hatalar dogrudan yukari
            raise
    raise last or AiUnavailable("Seslendirme başarısız.")
