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


def synthesize(text: str, voice: str = DEFAULT_VOICE, style: str = "") -> bytes:
    """Metni WAV baytlarina cevirir."""
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
        r = httpx.post(url, json=payload, timeout=120)
        if r.status_code >= 400:
            raise AiUnavailable(f"Seslendirme başarısız (kod {r.status_code}).")
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
        pcm = base64.b64decode(b64)
        return _wav_header(len(pcm)) + pcm
    except AiUnavailable:
        raise
    except Exception:  # noqa
        raise AiUnavailable("Seslendirme servisi şu an yanıt vermiyor.")
