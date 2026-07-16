from app.config import settings
from app.ai.provider import EmbeddingProvider, LLMProvider


def get_embeddings() -> EmbeddingProvider:
    if settings.ai_provider == "openai":
        from app.ai.openai_provider import OpenAIEmbeddings
        return OpenAIEmbeddings()
    from app.ai.gemini_provider import GeminiEmbeddings
    return GeminiEmbeddings()


def get_llm() -> LLMProvider:
    if settings.ai_provider == "openai":
        from app.ai.openai_provider import OpenAILLM
        return OpenAILLM()
    from app.ai.gemini_provider import GeminiLLM
    return GeminiLLM()
