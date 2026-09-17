"""Gemini TTS ile dogal Turkce seslendirme.

Gemini TTS 24kHz, 16-bit, mono PCM dondurur; onune WAV basligi ekleyip
tarayicida dogrudan calinabilir hale getiririz.
"""
import base64
import io
import struct
import httpx
from app.config import settings
from app.core.errors import AiUnavailable

BASE = "https://generativelanguage.googleapis.com/v1beta"

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


def split_for_tts(text: str, max_chars: int = 1100) -> list[str]:
    """Metni cumle sinirlarindan ~max_chars'lik parcalara boler."""
    text = (text or "").strip()
    if not text:
        return []
    import re
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
    prompt = f"{directive}:\n\n{text[:6000]}"

    model = (settings.gemini_tts_model or "gemini-2.5-flash-preview-tts").strip()
    url = f"{BASE}/models/{model}:generateContent?key={key}"
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
        r = httpx.post(url, json=payload, timeout=httpx.Timeout(connect=10, read=100, write=30, pool=10))
        if r.status_code == 429:
            raise AiUnavailable("Seslendirme kotası doldu. Biraz sonra tekrar dene.")
        if r.status_code >= 400:
            detail = ""
            try:
                detail = (r.json().get("error") or {}).get("message", "")[:160]
            except Exception:
                pass
            raise AiUnavailable(f"Seslendirme başarısız (kod {r.status_code}). {detail}".strip())
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
    """Tek parca WAV (kisa metinler icin)."""
    return wav_from_pcm(synthesize_pcm(text, voice, style))
