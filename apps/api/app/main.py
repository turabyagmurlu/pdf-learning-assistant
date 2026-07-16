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


app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(notes.router)
app.include_router(study.router)
app.include_router(collections.router)
