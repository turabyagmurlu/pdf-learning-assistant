from abc import ABC, abstractmethod
from typing import AsyncIterator, Iterable, Sequence


class EmbeddingProvider(ABC):
    dim: int
    @abstractmethod
    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class LLMProvider(ABC):
    @abstractmethod
    async def stream_chat(self, messages: list[dict], model: str) -> AsyncIterator[str]: ...
    @abstractmethod
    def complete(self, messages: list[dict], model: str) -> str: ...
    @abstractmethod
    def structured(self, messages: list[dict], schema: dict, model: str) -> str: ...
