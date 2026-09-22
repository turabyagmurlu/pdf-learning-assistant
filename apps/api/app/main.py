from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.core.errors import AppError
from app.db.session import close_pool
from app.storage.object_store import ensure_bucket
from app.api import auth, documents, chat, notes, study, collections


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        ensure_bucket()
    except Exception:  # noqa
        pass
    try:
        from app.db.session import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS category text")
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]'::jsonb")
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_favorite boolean DEFAULT false")
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS collection_id uuid")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS glossary jsonb")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS glossary_at timestamptz")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS timeline jsonb")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS timeline_at timestamptz")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS concept_map jsonb")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS concept_map_at timestamptz")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS draft text")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS draft_at timestamptz")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS lecture text")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS lecture_at timestamptz")
            # Belge bazli cikarim onbellegi: sozluk/iliski/olay sonucu belgeye yazilir,
            # "Yenile" yalniz yeni belgeler icin LLM'e gider.
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS doc_extracts ("
                " document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,"
                " kind text NOT NULL,"
                " input_hash text NOT NULL,"
                " payload jsonb,"
                " created_at timestamptz NOT NULL DEFAULT now(),"
                " PRIMARY KEY (document_id, kind))"
            )
            # Isleme ilerlemesi (gomulen parca / toplam parca) ve kaldigi yerden devam icin tekillik
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS progress_done int DEFAULT 0")
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS progress_total int DEFAULT 0")
            try:
                await conn.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_chunks_doc_idx ON document_chunks (document_id, chunk_index)")
            except Exception:  # noqa - eski kalinti tekrarlar varsa indeks olmaz, islem yine calisir
                pass
            # Uretilen seslendirmeler: ayni metin bir daha kota harcamasin.
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS tts_cache ("
                " key text PRIMARY KEY,"
                " wav bytea NOT NULL,"
                " chars int NOT NULL DEFAULT 0,"
                " used_at timestamptz NOT NULL DEFAULT now(),"
                " created_at timestamptz NOT NULL DEFAULT now())"
            )
            await conn.execute("CREATE INDEX IF NOT EXISTS tts_cache_used_idx ON tts_cache (used_at)")
    except Exception:  # noqa
        pass
    # Yarim kalmis belgeleri kaldigi yerden isle (sunucu uyuyup uyandiginda sart)
    try:
        from app.workers.tasks import resume_unfinished
        await resume_unfinished()
    except Exception:  # noqa
        pass
    yield
    await close_pool()


app = FastAPI(title="PDF Öğrenme Asistanı API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=False, allow_methods=["*"], allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(status_code=exc.status,
                        content={"error": {"code": exc.code, "user_message": exc.user_message}})


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/keepalive")
async def keepalive():
    # Supabase'i uyanik tutmak icin hafif bir DB sorgusu calistirir.
    try:
        from app.db.session import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
        return {"status": "ok", "db": True}
    except Exception:  # noqa
        return {"status": "ok", "db": False}


app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(notes.router)
app.include_router(study.router)
app.include_router(collections.router)
