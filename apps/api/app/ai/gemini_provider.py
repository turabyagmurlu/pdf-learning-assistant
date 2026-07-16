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
        if not texts:
            return []
        url = f"{BASE}/models/{self.model}:batchEmbedContents?key={self.key}"
        payload = {"requests": [
            {"model": f"models/{self.model}",
             "content": {"parts": [{"text": t[:8000]}]},
             "outputDimensionality": self.dim}
            for t in texts
        ]}
        try:
            r = httpx.post(url, json=payload, timeout=60)
            r.raise_for_status()
            return [e["values"] for e in r.json()["embeddings"]]
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))


class GeminiLLM(LLMProvider):
    def __init__(self):
        self.key = settings.gemini_api_key.strip()

    def _gen_url(self, model: str, stream: bool) -> str:
        method = "streamGenerateContent" if stream else "generateContent"
        sse = "&alt=sse" if stream else ""
        return f"{BASE}/models/{model}:{method}?key={self.key}{sse}"

    async def stream_chat(self, messages, model=None) -> AsyncIterator[str]:
        model = model or settings.active_llm_model
        system, contents = _to_gemini(messages)
        body = {"contents": contents, "generationConfig": {"temperature": 0.2}}
        if system:
            body["systemInstruction"] = system
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream("POST", self._gen_url(model, True), json=body) as resp:
                    resp.raise_for_status()
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
                                    yield p["text"]
                        except Exception:  # noqa
                            continue
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))

    def complete(self, messages, model=None) -> str:
        model = model or settings.active_llm_model
        system, contents = _to_gemini(messages)
        body = {"contents": contents, "generationConfig": {"temperature": 0.2}}
        if system:
            body["systemInstruction"] = system
        try:
            r = httpx.post(self._gen_url(model, False), json=body, timeout=120)
            r.raise_for_status()
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]
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
            r = httpx.post(self._gen_url(model, False), json=body, timeout=120)
            r.raise_for_status()
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))
