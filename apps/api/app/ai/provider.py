from abc import ABC, abstractmethod
from typing import AsyncIterator, Sequence


class EmbeddingProvider(ABC):
    dim: int
    @abstractmethod
    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class LLMProvider(ABC):
    """Metin modeli. `temperature` / `max_output_tokens` verilmezse eski davranis (0.2, sinirsiz) korunur.
    `kind` kullanim sayacina gider: "metin" (varsayilan, kisinin gunluk hakkindan duser),
    "hafif" (niyet anlama gibi kucuk on adimlar; hakka sayilmaz)."""
    @abstractmethod
    async def stream_chat(self, messages: list[dict], model: str | None = None, *,
                          temperature: float | None = None, max_output_tokens: int | None = None,
                          kind: str = "metin") -> AsyncIterator[str]: ...
    @abstractmethod
    def complete(self, messages: list[dict], model: str | None = None, *,
                 temperature: float | None = None, max_output_tokens: int | None = None,
                 kind: str = "metin") -> str: ...
    @abstractmethod
    def structured(self, messages: list[dict], schema: dict, model: str | None = None, *,
                   temperature: float | None = None, max_output_tokens: int | None = None,
                   kind: str = "metin") -> str: ...
