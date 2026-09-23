import json
from typing import AsyncIterator, Sequence
import httpx
from app.config import settings
from app.ai.provider import EmbeddingProvider, LLMProvider
from app.core.errors import AiUnavailable
from app.ai import usage

BASE = "https://generativelanguage.googleapis.com/v1beta"


def _to_gemini(messages: list[dict]):
    """OpenAI tarzı mesajları Gemini formatına çevir."""
    system = None
    contents = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            role = "model" if m["role"] == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": m["content"]}]})
    sys_obj = {"parts": [{"text": system}]} if system else None
    return sys_obj, contents


class GeminiEmbeddings(EmbeddingProvider):
    def __init__(self):
        self.dim = settings.embedding_dim
        self.model = settings.gemini_embed_model.strip()
        self.key = settings.gemini_api_key.strip()

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Toplu gomme. Kota (429) ve gecici (5xx) hatalarda Google'in onerdigi kadar
        bekleyip tekrar dener; ucretsiz katmanda 100 istek/dk ve 30K token/dk siniri var."""
        if not texts:
            return []
        import re
        import time
        url = f"{BASE}/models/{self.model}:batchEmbedContents?key={self.key}"
        payload = {"requests": [
            {"model": f"models/{self.model}",
             "content": {"parts": [{"text": t[:8000]}]},
             "outputDimensionality": self.dim}
            for t in texts
        ]}
        last = ""
        for attempt in range(6):
            try:
                r = httpx.post(url, json=payload, timeout=90)
            except httpx.HTTPError as e:
                last = str(e)
                time.sleep(4 * (attempt + 1))
                continue
            if r.status_code == 200:
                try:
                    out = [e["values"] for e in r.json()["embeddings"]]
                    usage.record(self.model, "dizin", sum(len(t) for t in texts) // 4)
                    return out
                except Exception as e:  # noqa
                    raise AiUnavailable(detail=f"embedding parse: {e}")
            if r.status_code in (429, 500, 502, 503, 504):
                wait = 8.0 * (attempt + 1)
                try:
                    err = (r.json() or {}).get("error") or {}
                    last = (err.get("message") or "")[:200]
                    for d in err.get("details") or []:
                        if str(d.get("@type", "")).endswith("RetryInfo"):
                            m = re.match(r"(\d+(?:\.\d+)?)s", str(d.get("retryDelay") or ""))
                            if m:
                                wait = min(120.0, float(m.group(1)) + 1.0)
                    if "PerDay" in last:
                        usage.mark_limited(self.model, True)
                        raise AiUnavailable("Günlük gömme kotası doldu; yarın otomatik devam eder.", detail=last)
                except AiUnavailable:
                    raise
                except Exception:  # noqa
                    pass
                time.sleep(wait)
                continue
            try:
                last = (r.json().get("error") or {}).get("message", "")[:200]
            except Exception:  # noqa
                last = r.text[:200]
            raise AiUnavailable(detail=f"embedding {r.status_code}: {last}")
        raise AiUnavailable("Gömme servisi yoğun; belge daha sonra yeniden denenecek.", detail=last)


def _is_daily(text: str) -> bool:
    t = text or ""
    return "PerDay" in t or "per day" in t.lower() or "RequestsPerDay" in t


def _retry_after(text: str) -> float | None:
    import re
    m = re.search(r'"retryDelay":\s*"(\d+(?:\.\d+)?)s"', text or "")
    return float(m.group(1)) if m else None


_POOL_CHECKED = False


def refresh_pool():
    """Acilista bir kez: anahtarin gorebildigi modelleri listeler, havuzda
    olmayanlari 'yok' isaretler (bos istek harcamamak icin)."""
    global _POOL_CHECKED
    try:
        r = httpx.get(f"{BASE}/models?pageSize=1000&key={settings.gemini_api_key.strip()}", timeout=20)
        if r.status_code != 200:
            return
        names = {m["name"].split("/", 1)[-1] for m in r.json().get("models", [])}
        cands = list(pool_models())
        try:
            from app.services.tts_service import _tts_models
            cands += _tts_models()
        except Exception:  # noqa
            pass
        for m in cands:
            if m not in names:
                usage.mark_dead(m)
        _POOL_CHECKED = True
    except Exception:  # noqa
        pass


def pool_models(first: str | None = None) -> list[str]:
    items = [first] if first else []
    items += [m.strip() for m in (settings.gemini_model_pool or "").split(",") if m.strip()]
    items.append(settings.gemini_model)
    return list(dict.fromkeys(i for i in items if i))


class GeminiLLM(LLMProvider):
    """Metin modelleri: istek, havuzdaki ilk kullanilabilir modele gider.
    Model kotasi dolarsa (429) ya da yoksa (404) sessizce siradakine gecer;
    boylece her modelin ayri gunluk kotasi birlikte kullanilir."""

    def __init__(self):
        self.key = settings.gemini_api_key.strip()

    def _gen_url(self, model: str, stream: bool) -> str:
        method = "streamGenerateContent" if stream else "generateContent"
        sse = "&alt=sse" if stream else ""
        return f"{BASE}/models/{model}:{method}?key={self.key}{sse}"

    _RETRY_CODES = (429, 500, 502, 503, 504)
    _WAITS = (3, 8, 15)

    @staticmethod
    def _friendly(status: int, text: str) -> AiUnavailable:
        if status == 429 and _is_daily(text):
            from zoneinfo import ZoneInfo
            reset = usage.next_reset().astimezone(ZoneInfo("Europe/Istanbul")).strftime("%H:%M")
            return AiUnavailable(f"Bugünkü yapay zekâ kotası tüm modellerde doldu; {reset} civarı yenilenir.",
                                 detail=text[:200])
        if status == 429:
            return AiUnavailable("Yapay zekâ kotası şu an dolu; bir dakika sonra tekrar dene.", detail=text[:200])
        if status in (500, 502, 503, 504):
            return AiUnavailable("Model şu an yoğun; birkaç saniye sonra tekrar dene.", detail=text[:200])
        return AiUnavailable(detail=f"{status}: {text[:200]}")

    def _handle_fail(self, model: str, status: int, text: str) -> bool:
        """Hata sonrasi modeli isaretler. True -> baska modele gec."""
        if status == 404:
            usage.mark_dead(model); return True
        if status == 429:
            usage.mark_limited(model, _is_daily(text), _retry_after(text)); return True
        if status in (500, 502, 503, 504):
            usage.mark_limited(model, False, 20); return True
        return False

    def _post(self, base_model: str, body: dict, stream: bool = False) -> dict:
        import time
        last_status, last_text = 0, ""
        for round_ in range(3):
            tried = False
            for m in pool_models(base_model):
                if not usage.available(m):
                    continue
                tried = True
                try:
                    r = httpx.post(self._gen_url(m, False), json=body, timeout=120)
                except httpx.HTTPError as e:
                    last_status, last_text = 0, str(e)
                    usage.mark_limited(m, False, 10)
                    continue
                if r.status_code == 200:
                    j = r.json()
                    usage.record(m, "metin", (j.get("usageMetadata") or {}).get("totalTokenCount", 0))
                    return j
                last_status, last_text = r.status_code, r.text
                if not self._handle_fail(m, r.status_code, r.text):
                    raise self._friendly(r.status_code, r.text)
            # hepsi dolu/yogun: dakikalik bekleme varsa kisa bekle, gunlukse birak
            if not tried and all(usage.status(m) in ("gunluk_doldu", "yok") for m in pool_models(base_model)):
                break
            time.sleep(self._WAITS[min(round_, len(self._WAITS) - 1)] * 2)
        if last_status == 0 and not last_text:
            last_status, last_text = 429, "PerDay"
        raise self._friendly(last_status or 503, last_text)

    async def stream_chat(self, messages, model=None) -> AsyncIterator[str]:
        import asyncio
        model = model or settings.active_llm_model
        system, contents = _to_gemini(messages)
        body = {"contents": contents, "generationConfig": {"temperature": 0.2}}
        if system:
            body["systemInstruction"] = system
        last_status, last_text = 503, ""
        for round_ in range(3):
            for m in pool_models(model):
                if not usage.available(m):
                    continue
                yielded = False
                toks = 0
                try:
                    async with httpx.AsyncClient(timeout=120) as client:
                        async with client.stream("POST", self._gen_url(m, True), json=body) as resp:
                            if resp.status_code >= 400:
                                txt = (await resp.aread()).decode("utf-8", "ignore")
                                last_status, last_text = resp.status_code, txt
                                if self._handle_fail(m, resp.status_code, txt):
                                    continue
                                raise self._friendly(resp.status_code, txt)
                            async for line in resp.aiter_lines():
                                if not line.startswith("data:"):
                                    continue
                                data = line[5:].strip()
                                if not data or data == "[DONE]":
                                    continue
                                try:
                                    j = json.loads(data)
                                    toks = (j.get("usageMetadata") or {}).get("totalTokenCount", toks)
                                    for p in j["candidates"][0]["content"]["parts"]:
                                        if "text" in p:
                                            yielded = True
                                            yield p["text"]
                                except Exception:  # noqa
                                    continue
                    usage.record(m, "metin", toks)
                    return
                except AiUnavailable:
                    raise
                except Exception as e:  # noqa  (ag hatasi vb.)
                    if yielded:
                        raise AiUnavailable(detail=str(e))
                    last_status, last_text = 0, str(e)
                    usage.mark_limited(m, False, 10)
                    continue
            if all(usage.status(m) in ("gunluk_doldu", "yok") for m in pool_models(model)):
                break
            await asyncio.sleep(self._WAITS[min(round_, len(self._WAITS) - 1)] * 2)
        raise self._friendly(last_status or 503, last_text)

    def complete(self, messages, model=None) -> str:
        model = model or settings.active_llm_model
        system, contents = _to_gemini(messages)
        body = {"contents": contents, "generationConfig": {"temperature": 0.2}}
        if system:
            body["systemInstruction"] = system
        try:
            return self._post(model, body)["candidates"][0]["content"]["parts"][0]["text"]
        except AiUnavailable:
            raise
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))

    def structured(self, messages, schema, model=None) -> str:
        """Gemini'de JSON modu: responseMimeType=application/json.
        schema OpenAI formatında geldiği için sadece JSON iste ve prompt'a şema ipucu ekle."""
        model = model or settings.active_llm_model
        system, contents = _to_gemini(messages)
        hint = f"\n\nSADECE geçerli JSON döndür. Beklenen alanlar: {json.dumps(schema.get('schema', schema), ensure_ascii=False)[:1500]}"
        if contents:
            contents[-1]["parts"][0]["text"] += hint
        body = {"contents": contents,
                "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}}
        if system:
            body["systemInstruction"] = system
        try:
            return self._post(model, body)["candidates"][0]["content"]["parts"][0]["text"]
        except AiUnavailable:
            raise
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))
