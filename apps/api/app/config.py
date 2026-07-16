from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # AI provider seçimi: "gemini" (ücretsiz) veya "openai"
    ai_provider: str = "gemini"

    # Gemini (ücretsiz)
    gemini_api_key: str = "REPLACE_ME"
    gemini_model: str = "gemini-flash-lite-latest"
    gemini_model_advanced: str = "gemini-flash-lite-latest"
    gemini_embed_model: str = "gemini-embedding-001"

    # OpenAI (opsiyonel alternatif)
    openai_api_key: str = "sk-REPLACE_ME"
    llm_model: str = "gpt-4o-mini"
    llm_model_advanced: str = "gpt-4o"
    openai_embed_model: str = "text-embedding-3-small"

    # Embedding boyutu: gemini text-embedding-004 -> 768, openai small -> 1536
    embedding_dim: int = 768

    # Auth
    jwt_secret: str = "dev-secret-change-me"
    jwt_expire_minutes: int = 10080

    # DB / Redis
    database_url: str = "postgresql://pdfapp:pdfapp@db:5432/pdfapp"
    redis_url: str = "redis://redis:6379/0"

    # Storage
    s3_endpoint: str = "http://minio:9000"
    s3_public_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "pdfs"
    s3_region: str = "us-east-1"

    # App
    max_upload_mb: int = 50
    cors_origins: str = "http://localhost:3000"

    @property
    def active_llm_model(self) -> str:
        return self.gemini_model if self.ai_provider == "gemini" else self.llm_model

    @property
    def active_llm_model_advanced(self) -> str:
        return self.gemini_model_advanced if self.ai_provider == "gemini" else self.llm_model_advanced


settings = Settings()
