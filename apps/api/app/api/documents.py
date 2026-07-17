import uuid
from fastapi import APIRouter, Depends, UploadFile, File, BackgroundTasks
from pydantic import BaseModel
from app.deps import db, current_user
from app.config import settings
from app.core.errors import FileTooLarge, NotFound, AppError
from app.storage.object_store import put_object, presigned_url, delete_object
from app.workers.tasks import run_ingest_sync

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("")
async def upload(background: BackgroundTasks, file: UploadFile = File(...),
                 conn=Depends(db), user=Depends(current_user)):
    if file.content_type not in ("application/pdf", "application/x-pdf"):
        raise AppError("Yalnızca PDF dosyaları yüklenebilir.")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise FileTooLarge(f"Dosya sınırı {settings.max_upload_mb} MB.")
    doc_id = str(uuid.uuid4())
    key = f"{user['id']}/{doc_id}.pdf"
    put_object(key, data)
    title = (file.filename or "Adsız").rsplit(".", 1)[0]
    await conn.execute(
        """INSERT INTO documents (id, user_id, title, original_filename, file_path, file_size, status)
           VALUES ($1,$2,$3,$4,$5,$6,'uploaded')""",
        doc_id, user["id"], title, file.filename, key, len(data),
    )
    background.add_task(run_ingest_sync, doc_id)
    return {"id": doc_id, "title": title, "status": "uploaded"}


@router.get("")
async def list_docs(conn=Depends(db), user=Depends(current_user)):
    rows = await conn.fetch(
        """SELECT id, title, status, processing_stage, page_count, short_summary,
                  difficulty_level, key_concepts, category, tags, is_favorite, created_at
           FROM documents WHERE user_id=$1 ORDER BY created_at DESC""",
        user["id"],
    )
    return [dict(r) for r in rows]


@router.get("/{doc_id}")
async def get_doc(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT * FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    return dict(row)


@router.get("/{doc_id}/status")
async def status(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow(
        "SELECT status, processing_stage, error_message FROM documents WHERE id=$1 AND user_id=$2",
        doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    return dict(row)


@router.get("/{doc_id}/file")
async def file_url(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT file_path FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    return {"url": presigned_url(row["file_path"])}


class DocPatch(BaseModel):
    title: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    is_favorite: bool | None = None


@router.patch("/{doc_id}")
async def update_doc(doc_id: str, body: DocPatch, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    sets, vals, i = [], [], 1
    if body.title is not None:
        sets.append(f"title=${i}"); vals.append(body.title); i += 1
    if body.category is not None:
        sets.append(f"category=${i}"); vals.append(body.category); i += 1
    if body.tags is not None:
        sets.append(f"tags=${i}"); vals.append(body.tags); i += 1
    if body.is_favorite is not None:
        sets.append(f"is_favorite=${i}"); vals.append(body.is_favorite); i += 1
    if sets:
        vals.append(doc_id); vals.append(user["id"])
        await conn.execute(f"UPDATE documents SET {', '.join(sets)} WHERE id=${i} AND user_id=${i + 1}", *vals)
    return {"ok": True}


@router.delete("/{doc_id}")
async def delete_doc(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT file_path FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    try:
        delete_object(row["file_path"])
    except Exception:  # noqa
        pass
    await conn.execute("DELETE FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    return {"ok": True}


@router.post("/{doc_id}/reprocess")
async def reprocess(doc_id: str, background: BackgroundTasks,
                    conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    await conn.execute("UPDATE documents SET status='uploaded', error_message=NULL WHERE id=$1", doc_id)
    background.add_task(run_ingest_sync, doc_id)
    return {"ok": True}
