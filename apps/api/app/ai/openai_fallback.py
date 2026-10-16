"""ChatGPT (OpenAI) yedegi: Gemini'nin ucretsiz kotasi dolunca ya da Gemini yanit veremeyince
ayni istek OpenAI'ye gider. OPENAI_API_KEY tanimli degilse hicbir sey degismez (kapali).

- Metin: chat/completions (akisli ve tek seferlik). Model listesi sirayla denenir; hesapta
  olmayan model (404/400 model_not_found) atlanir.
- Ses: audio/speech, ham PCM (24 kHz, 16 bit, mono) -> Gemini sesiyle ayni bicim; birlestirme,
  MP3 kodlama ve onbellek oldugu gibi calisir.

Kutuphane surumune bagli kalmamak icin dogrudan HTTP (httpx) kullanilir."""
from __future__ import annotations

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import AsyncIterator

import httpx

from app.config import settings
from app.ai import usage
from app.core.errors import AiUnavailable, AiBusy

log = logging.getLogger(__name__)
BASE = "https://api.openai.com/v1"

# Kotasi dolan / hesapta olmayan modeller (surec boyunca)
_DEAD: set[str] = set()


def _key() -> str:
    k = (settings.openai_api_key or os.environ.get("OPENAI_API_KEY") or "").strip()
    return "" if (not k or "REPLACE" in k) else k


def enabled() -> bool:
    return bool(_key())


def _headers() -> dict:
    return {"Authorization": f"Bearer {_key()}", "Content-Type": "application/json"}


def text_models(strong: bool = False) -> list[str]:
    first = (settings.openai_model_strong if strong else settings.openai_model).strip()
    items = [first] + [m.strip() for m in (settings.openai_model_pool or "").split(",") if m.strip()]
    return [m for m in dict.fromkeys(items) if m and m not in _DEAD]


def _is_reasoning(model: str) -> bool:
    m = model.lower()
    return m.startswith(("gpt-5", "o1", "o3", "o4"))


def _body(model: str, messages: list[dict], temperature, max_output_tokens, json_mode: bool, stream: bool) -> dict:
    b: dict = {"model": model, "messages": messages}
    if _is_reasoning(model):
        # bu ailede sicaklik sabit; cikti siniri ayri alan
        if max_output_tokens:
            b["max_completion_tokens"] = int(max_output_tokens) * 2   # dusunme payi
        b["reasoning_effort"] = "low"
    else:
        b["temperature"] = 0.2 if temperature is None else float(temperature)
        if max_output_tokens:
            b["max_tokens"] = int(max_output_tokens)
    if json_mode:
        b["response_format"] = {"type": "json_object"}
    if stream:
        b["stream"] = True
        b["stream_options"] = {"include_usage": True}
    return b


def _model_missing(status: int, text: str) -> bool:
    t = (text or "").lower()
    return status == 404 or (status == 400 and ("model" in t and ("not exist" in t or "not found" in t
                                                                  or "does not have access" in t)))


def _fail(status: int, text: str) -> AiUnavailable:
    t = (text or "")[:200]
    if status == 429 and "insufficient_quota" in (text or ""):
        return AiBusy("Yapay zekâ bakiyesi bitti; yedek hesaba kredi yüklenince yeniden açılır.", detail=t)
    if status in (429, 500, 502, 503, 504):
        return AiBusy("Yapay zekâ şu an yoğun; birkaç saniye sonra tekrar dene.", detail=t)
    return AiUnavailable(detail=f"openai {status}: {t}")


def complete(messages: list[dict], *, strong: bool = False, temperature=None, max_output_tokens=None,
             json_mode: bool = False, kind: str = "metin") -> str:
    if not enabled():
        raise AiUnavailable(detail="openai kapali")
    if json_mode and not any("json" in (m.get("content") or "").lower() for m in messages):
        messages = [{"role": "system", "content": "Yanıtı yalnızca geçerli JSON olarak ver."}] + list(messages)
    last = AiUnavailable(detail="openai: model yok")
    for model in text_models(strong):
        try:
            r = httpx.post(f"{BASE}/chat/completions", headers=_headers(), timeout=150,
                           json=_body(model, messages, temperature, max_output_tokens, json_mode, False))
        except httpx.HTTPError as e:
            last = AiBusy("Yapay zekâ şu an yoğun; birkaç saniye sonra tekrar dene.", detail=str(e)[:200])
            continue
        if r.status_code == 200:
            j = r.json()
            usage.record("openai:" + model, kind or "metin", (j.get("usage") or {}).get("total_tokens", 0))
            return j["choices"][0]["message"].get("content") or ""
        if _model_missing(r.status_code, r.text):
            _DEAD.add(model)
            continue
        last = _fail(r.status_code, r.text)
        if r.status_code not in (429, 500, 502, 503, 504):
            raise last
    raise last


async def stream(messages: list[dict], *, strong: bool = False, temperature=None, max_output_tokens=None,
                 kind: str = "metin") -> AsyncIterator[str]:
    if not enabled():
        raise AiUnavailable(detail="openai kapali")
    last: AiUnavailable = AiUnavailable(detail="openai: model yok")
    for model in text_models(strong):
        yielded = False
        toks = 0
        try:
            async with httpx.AsyncClient(timeout=150) as client:
                async with client.stream("POST", f"{BASE}/chat/completions", headers=_headers(),
                                         json=_body(model, messages, temperature, max_output_tokens,
                                                    False, True)) as resp:
                    if resp.status_code >= 400:
                        txt = (await resp.aread()).decode("utf-8", "ignore")
                        if _model_missing(resp.status_code, txt):
                            _DEAD.add(model)
                            continue
                        last = _fail(resp.status_code, txt)
                        if resp.status_code in (429, 500, 502, 503, 504):
                            continue
                        raise last
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            j = json.loads(data)
                        except Exception:  # noqa
                            continue
                        if j.get("usage"):
                            toks = j["usage"].get("total_tokens", toks)
                        for ch in j.get("choices") or []:
                            d = (ch.get("delta") or {}).get("content")
                            if d:
                                yielded = True
                                yield d
            usage.record("openai:" + model, kind or "metin", toks)
            return
        except AiUnavailable:
            raise
        except Exception as e:  # noqa
            if yielded:
                raise AiUnavailable(detail=str(e)[:200])
            last = AiBusy("Yapay zekâ şu an yoğun; birkaç saniye sonra tekrar dene.", detail=str(e)[:200])
            continue
    raise last


# ---------------------------------------------------------------- ses ----------------------------------
SAMPLE_RATE = 24000
_TTS_STYLE_SOLO = ("Speak in natural, fluent Turkish like a calm, warm educational radio host talking to one "
                   "listener. Unhurried pace, clear articulation of Turkish vowels and consonants, natural "
                   "pauses between sentences, slight emphasis on key ideas. Never monotone, never theatrical.")
_TTS_STYLE_A = ("Speak in natural, fluent Turkish as Ayşe, a warm, confident female teacher hosting an "
                "educational podcast. Calm storytelling pace, gentle emphasis on key ideas, smiling tone.")
_TTS_STYLE_B = ("Speak in natural, fluent Turkish as Kerem, a bright, curious young male student on a podcast. "
                "Slightly faster and more energetic; questions rise at the end; sounds genuinely interested.")


def _silence(ms: int) -> bytes:
    return b"\x00\x00" * int(SAMPLE_RATE * ms / 1000)


def tts_pcm(text: str, voice: str | None = None, style: str = _TTS_STYLE_SOLO) -> bytes:
    """Tek istek: metni ham PCM'e cevirir (24 kHz, 16 bit, mono)."""
    if not enabled():
        raise AiUnavailable(detail="openai kapali")
    model = (settings.openai_tts_model or "gpt-4o-mini-tts").strip()
    body = {"model": model, "input": text[:3800], "voice": voice or settings.openai_tts_voice,
            "response_format": "pcm"}
    if not model.startswith("tts-1"):
        body["instructions"] = style
    last: AiUnavailable = AiUnavailable(detail="openai tts")
    for attempt in range(3):
        try:
            r = httpx.post(f"{BASE}/audio/speech", headers=_headers(), json=body,
                           timeout=httpx.Timeout(connect=10, read=170, write=30, pool=10))
        except httpx.HTTPError as e:
            last = AiBusy("Seslendirme şu an yoğun; birkaç saniye içinde yeniden denenecek.", detail=str(e)[:200])
            continue
        if r.status_code == 200 and len(r.content) > 100:
            usage.record("openai:" + model, "ses", len(text))
            pcm = r.content
            return pcm[: len(pcm) - (len(pcm) % 2)]
        last = _fail(r.status_code, r.text)
        if r.status_code not in (429, 500, 502, 503, 504) or "insufficient_quota" in r.text:
            raise last
        import time
        time.sleep(3 * (attempt + 1))
    raise last


def _pieces(text: str, max_chars: int = 1400) -> list[str]:
    from app.services.tts_service import split_for_tts
    return [p for p in split_for_tts(text, max_chars) if p.strip()] or [text]


def tts_solo(text: str) -> bytes:
    """Tek anlatici: uzun metin paragraf sinirindan bolunur, paralel seslendirilir, sirayla birlestirilir."""
    parts = _pieces(text)
    with ThreadPoolExecutor(max_workers=min(4, len(parts))) as ex:
        pcms = list(ex.map(lambda p: tts_pcm(p, settings.openai_tts_voice, _TTS_STYLE_SOLO), parts))
    return _silence(0).join(x + _silence(350) for x in pcms)


def tts_dialog(lines: list[tuple[bool, str]]) -> bytes:
    """Sohbet: her replik kendi sesiyle (False=Ayşe, True=Kerem) seslendirilir; replikler arasi kisa ara."""
    def one(item):
        is_b, body = item
        if is_b:
            return tts_pcm(body, settings.openai_tts_voice_b, _TTS_STYLE_B)
        return tts_pcm(body, settings.openai_tts_voice, _TTS_STYLE_A)
    items = [(b, t) for b, t in lines if t.strip()]
    if not items:
        return b""
    with ThreadPoolExecutor(max_workers=min(4, len(items))) as ex:
        pcms = list(ex.map(one, items))
    return b"".join(x + _silence(300) for x in pcms)
