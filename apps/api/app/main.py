from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Depends
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.core.errors import AppError
from app.db.session import close_pool
from app.storage.object_store import ensure_bucket
from app.api import auth, documents, chat, notes, study, collections, research
from app.deps import current_user


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
            # Kaynak turu: pdf | youtube (video: bolum zamanlari media icinde)
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'pdf'")
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_url text")
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS media jsonb")
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
            # Sohbet soru onerileri (kaynak kumesi degismedikce onbellekten)
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS suggestions jsonb")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS suggestions_hash text")
            await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS suggestions_at timestamptz")
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
            # --- kota tasarrufu ---
            # soru gommeleri (ayni soru bir daha gomulmez)
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS embed_cache (h text PRIMARY KEY, vec vector,"
                " used_at timestamptz NOT NULL DEFAULT now())")
            # defter cevaplari (ayni/cok benzer soru -> kayitli cevap)
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS answer_cache ("
                " id bigserial PRIMARY KEY,"
                " collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,"
                " docs_hash text NOT NULL, qnorm text NOT NULL, question text, qvec vector,"
                " payload jsonb, hits int NOT NULL DEFAULT 0,"
                " created_at timestamptz NOT NULL DEFAULT now(), used_at timestamptz NOT NULL DEFAULT now(),"
                " UNIQUE (collection_id, docs_hash, qnorm))")
            # ayni metin iki kez gomulmesin (yeniden yukleme / yeniden isleme)
            try:
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS chunks_md5_idx ON document_chunks (md5(content))")
            except Exception:  # noqa
                pass
            # defter sohbet gecmisi (sayfa yenilense de kaybolmaz)
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS collection_chats ("
                " id uuid PRIMARY KEY,"
                " collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,"
                " user_id uuid NOT NULL, title text,"
                " created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())")
            await conn.execute("CREATE INDEX IF NOT EXISTS collection_chats_col_idx ON collection_chats (collection_id, updated_at DESC)")
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS collection_messages ("
                " id bigserial PRIMARY KEY,"
                " chat_id uuid NOT NULL REFERENCES collection_chats(id) ON DELETE CASCADE,"
                " question text NOT NULL, payload jsonb,"
                " created_at timestamptz NOT NULL DEFAULT now())")
            await conn.execute("CREATE INDEX IF NOT EXISTS collection_messages_chat_idx ON collection_messages (chat_id, id)")
            # gunluk kullanim sayaci (kota gostergesi)
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS ai_usage (day date NOT NULL, model text NOT NULL, kind text NOT NULL,"
                " requests int NOT NULL DEFAULT 0, tokens bigint NOT NULL DEFAULT 0,"
                " PRIMARY KEY (day, model, kind))")
            from app.ai import usage as _usage
            _usage.load_rows(await conn.fetch(
                "SELECT day::text AS day, model, kind, requests, tokens FROM ai_usage WHERE day >= current_date - 1"))
    except Exception:  # noqa
        pass
    # Model havuzu: bu anahtarda olmayan modelleri bastan ele (bos istek harcamasin)
    import asyncio as _asyncio
    try:
        from app.ai.gemini_provider import refresh_pool
        await _asyncio.to_thread(refresh_pool)
    except Exception:  # noqa
        pass
    flusher = _asyncio.create_task(_flush_usage_loop())
    backuper = _asyncio.create_task(_backup_loop())
    # Yarim kalmis belgeleri kaldigi yerden isle (sunucu uyuyup uyandiginda sart)
    try:
        from app.workers.tasks import resume_unfinished
        await resume_unfinished()
    except Exception:  # noqa
        pass
    yield
    flusher.cancel()
    backuper.cancel()
    try:
        await _flush_usage()
    except Exception:  # noqa
        pass
    await close_pool()


async def _flush_usage():
    from app.ai import usage
    from app.db.session import get_pool
    rows = usage.pop_dirty()
    if not rows:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        for (day, model, kind), (req, tok) in rows:
            await conn.execute(
                """INSERT INTO ai_usage (day, model, kind, requests, tokens) VALUES ($1::text::date,$2,$3,$4,$5)
                   ON CONFLICT (day, model, kind) DO UPDATE
                   SET requests=GREATEST(ai_usage.requests, EXCLUDED.requests),
                       tokens=GREATEST(ai_usage.tokens, EXCLUDED.tokens)""",
                day, model, kind, req, tok)


async def _backup_loop():
    """Haftalik otomatik yedek: 6 saatte bir kontrol eder, son yedek 7 gunden eskiyse alir."""
    import asyncio as _asyncio
    await _asyncio.sleep(180)                  # acilis yukunu bekle
    while True:
        try:
            from app.services.backup import backup_if_due
            from app.db.session import get_pool
            pool = await get_pool()
            async with pool.acquire() as conn:
                await backup_if_due(conn)
        except Exception:  # noqa
            pass
        await _asyncio.sleep(6 * 3600)


async def _flush_usage_loop():
    import asyncio as _asyncio
    while True:
        await _asyncio.sleep(60)
        try:
            await _flush_usage()
        except Exception:  # noqa
            pass


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


@app.get("/me/export")
async def export_me(user=Depends(current_user)):
    """Kullanicinin tum verisi (defterler, kaynak bilgileri, notlar, sohbetler, taslaklar) tek JSON dosyasi."""
    from fastapi.responses import Response
    from app.services.backup import export_user
    from app.db.session import get_pool
    from datetime import date
    pool = await get_pool()
    async with pool.acquire() as conn:
        data = await export_user(conn, str(user["id"]))
    return Response(data, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="typdf-yedek-{date.today()}.json"'})


@app.get("/me/backup-status")
async def backup_status(user=Depends(current_user)):
    import asyncio as _asyncio
    from app.services.backup import last_backup_time
    try:
        t = await _asyncio.to_thread(last_backup_time)
    except Exception:  # noqa
        t = None
    return {"last_backup": t.isoformat() if t else None}


@app.get("/usage")
async def usage_status(user=Depends(current_user)):
    """Kota gostergesi: bugunku istekler (model/tur), model durumlari, sifirlanma saati."""
    from app.ai import usage
    from app.ai.gemini_provider import pool_models
    from app.services.tts_service import _tts_models
    snap = usage.snapshot()
    def models(lst, kind):
        out = []
        for m in lst:
            st = usage.status(m)
            if st == "yok":
                continue
            req = sum(r["requests"] for r in snap["rows"] if r["model"] == m)
            out.append({"model": m, "status": st, "requests": req, "kind": kind})
        return out
    kinds = {}
    for r in snap["rows"]:
        k = kinds.setdefault(r["kind"], {"requests": 0, "tokens": 0})
        k["requests"] += r["requests"]; k["tokens"] += r["tokens"]
    return {
        "day": snap["day"],
        "reset_at": usage.next_reset().isoformat(),
        "kinds": kinds,
        "text_models": models(pool_models(), "metin"),
        "tts_models": models(_tts_models(), "ses"),
        "embed": {"model": settings.gemini_embed_model, "status": usage.status(settings.gemini_embed_model)},
    }


app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(notes.router)
app.include_router(study.router)
app.include_router(collections.router)
app.include_router(research.router)
