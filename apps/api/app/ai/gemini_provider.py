import json
from typing import AsyncIterator, Sequence
import httpx
from app.config import settings
from app.ai.provider import EmbeddingProvider, LLMProvider
from app.core.errors import AiUnavailable

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
                    return [e["values"] for e in r.json()["embeddings"]]
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


class GeminiLLM(LLMProvider):
    def __init__(self):
        self.key = settings.gemini_api_key.strip()

    def _gen_url(self, model: str, stream: bool) -> str:
        method = "streamGenerateContent" if stream else "generateContent"
        sse = "&alt=sse" if stream else ""
        return f"{BASE}/models/{model}:{method}?key={self.key}{sse}"

    # Gecici hatalar (kota dakikalik siniri, model yogun): kisa bekleyip tekrar dene.
    _RETRY_CODES = (429, 500, 502, 503, 504)
    _WAITS = (3, 8, 15)

    @staticmethod
    def _friendly(status: int, text: str) -> AiUnavailable:
        if status == 429 and "PerDay" in text:
            return AiUnavailable("Günlük yapay zekâ kotası doldu; yarın yenilenir.", detail=text[:200])
        if status == 429:
            return AiUnavailable("Yapay zekâ kotası şu an dolu; bir dakika sonra tekrar dene.", detail=text[:200])
        if status in (500, 502, 503, 504):
            return AiUnavailable("Model şu an yoğun; birkaç saniye sonra tekrar dene.", detail=text[:200])
        return AiUnavailable(detail=f"{status}: {text[:200]}")

    async def stream_chat(self, messages, model=None) -> AsyncIterator[str]:
        model = model or settings.active_llm_model
        system, contents = _to_gemini(messages)
        body = {"contents": contents, "generationConfig": {"temperature": 0.2}}
        if system:
            body["systemInstruction"] = system
        import asyncio
        last_err: Exception | None = None
        for attempt in range(len(self._WAITS) + 1):
            yielded = False
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    async with client.stream("POST", self._gen_url(model, True), json=body) as resp:
                        if resp.status_code in self._RETRY_CODES and attempt < len(self._WAITS):
                            txt = (await resp.aread()).decode("utf-8", "ignore")
                            last_err = self._friendly(resp.status_code, txt)
                            await asyncio.sleep(self._WAITS[attempt])
                            continue
                        if resp.status_code >= 400:
                            txt = (await resp.aread()).decode("utf-8", "ignore")
                            raise self._friendly(resp.status_code, txt)
                        async for line in resp.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if not data or data == "[DONE]":
                                continue
                            try:
                                j = json.loads(data)
                                parts = j["candidates"][0]["content"]["parts"]
                                for p in parts:
                                    if "text" in p:
                                        yielded = True
                                        yield p["text"]
                            except Exception:  # noqa
                                continue
                return
            except AiUnavailable:
                raise
            except Exception as e:  # noqa  (ag hatasi vb.)
                last_err = e
                if yielded or attempt >= len(self._WAITS):
                    raise AiUnavailable(detail=str(e))
                await asyncio.sleep(self._WAITS[attempt])
        raise last_err if isinstance(last_err, AiUnavailable) else AiUnavailable(detail=str(last_err))

    def _post_retry(self, url: str, body: dict) -> dict:
        import time
        last = ""
        for attempt in range(len(self._WAITS) + 1):
            try:
                r = httpx.post(url, json=body, timeout=120)
            except httpx.HTTPError as e:
                last = str(e)
                if attempt < len(self._WAITS):
                    time.sleep(self._WAITS[attempt]); continue
                raise AiUnavailable(detail=last)
            if r.status_code == 200:
                return r.json()
            if r.status_code in self._RETRY_CODES and attempt < len(self._WAITS) and "PerDay" not in r.text:
                time.sleep(self._WAITS[attempt]); continue
            raise self._friendly(r.status_code, r.text)
        raise AiUnavailable(detail=last)

    def complete(self, messages, model=None) -> str:
        model = model or settings.active_llm_model
        system, contents = _to_gemini(messages)
        body = {"contents": contents, "generationConfig": {"temperature": 0.2}}
        if system:
            body["systemInstruction"] = system
        try:
            return self._post_retry(self._gen_url(model, False), body)["candidates"][0]["content"]["parts"][0]["text"]
        except AiUnavailable:
            raise
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))

    def structured(self, messages, schema, model=None) -> str:
        """Gemini'de JSON modu: responseMimeType=application/json.
        schema OpenAI formatında geldiği için sadece JSON iste ve prompt'a şema ipucu ekle."""
        model = model or settings.active_llm_model
        system, contents = _to_gemini(messages)
        # şema adını/gövdesini prompt'a ipucu olarak ekle
        hint = f"\n\nSADECE geçerli JSON döndür. Beklenen alanlar: {json.dumps(schema.get('schema', schema), ensure_ascii=False)[:1500]}"
        if contents:
            contents[-1]["parts"][0]["text"] += hint
        body = {"contents": contents,
                "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}}
        if system:
            body["systemInstruction"] = system
        try:
            return self._post_retry(self._gen_url(model, False), body)["candidates"][0]["content"]["parts"][0]["text"]
        except AiUnavailable:
            raise
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))
