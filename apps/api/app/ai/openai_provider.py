from typing import AsyncIterator, Sequence
from openai import OpenAI, AsyncOpenAI
from app.config import settings
from app.ai.provider import EmbeddingProvider, LLMProvider
from app.core.errors import AiUnavailable


class OpenAIEmbeddings(EmbeddingProvider):
    def __init__(self):
        self.dim = settings.embedding_dim
        self.model = settings.openai_embed_model
        self.client = OpenAI(api_key=settings.openai_api_key)

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            r = self.client.embeddings.create(model=self.model, input=list(texts))
            return [d.embedding for d in r.data]
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))


class OpenAILLM(LLMProvider):
    def __init__(self):
        self.sync = OpenAI(api_key=settings.openai_api_key)
        self.aclient = AsyncOpenAI(api_key=settings.openai_api_key)

    async def stream_chat(self, messages, model=None) -> AsyncIterator[str]:
        model = model or settings.llm_model
        try:
            stream = await self.aclient.chat.completions.create(
                model=model, messages=messages, stream=True, temperature=0.2)
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))

    def complete(self, messages, model=None) -> str:
        model = model or settings.llm_model
        try:
            r = self.sync.chat.completions.create(model=model, messages=messages, temperature=0.2)
            return r.choices[0].message.content or ""
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))

    def structured(self, messages, schema, model=None) -> str:
        model = model or settings.llm_model
        try:
            r = self.sync.chat.completions.create(
                model=model, messages=messages,
                response_format={"type": "json_schema", "json_schema": schema},
                temperature=0.2)
            return r.choices[0].message.content or "{}"
        except Exception as e:  # noqa
            raise AiUnavailable(detail=str(e))


def get_embeddings() -> EmbeddingProvider:
    return OpenAIEmbeddings()


def get_llm() -> LLMProvider:
    return OpenAILLM()
