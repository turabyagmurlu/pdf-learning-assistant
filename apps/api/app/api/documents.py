import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel
from app.deps import db, current_user
from app.config import settings
from app.core.errors import FileTooLarge, NotFound, AppError
from app.storage.object_store import put_object, presigned_url, delete_object
from app.workers.tasks import enqueue

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("")
async def upload(file: UploadFile = File(...), collection_id: str | None = Form(None),
                 conn=Depends(db), user=Depends(current_user)):
    """PDF yukle. collection_id verilirse belge dogrudan o deftere duser
    (defter icinden yukleme). Isleme kendi kuyrugunda, en fazla 2 belge paralel."""
    if file.content_type not in ("application/pdf", "application/x-pdf"):
        raise AppError("Yalnızca PDF dosyaları yüklenebilir.")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise FileTooLarge(f"Dosya sınırı {settings.max_upload_mb} MB.")
    cid = None
    if collection_id:
        ok = await conn.fetchval("SELECT 1 FROM collections WHERE id=$1 AND user_id=$2", collection_id, user["id"])
        if not ok:
            raise NotFound("Defter bulunamadı.")
        cid = collection_id
    doc_id = str(uuid.uuid4())
    key = f"{user['id']}/{doc_id}.pdf"
    put_object(key, data)
    title = (file.filename or "Adsız").rsplit(".", 1)[0]
    await conn.execute(
        """INSERT INTO documents (id, user_id, title, original_filename, file_path, file_size, status, collection_id)
           VALUES ($1,$2,$3,$4,$5,$6,'uploaded',$7)""",
        doc_id, user["id"], title, file.filename, key, len(data), cid,
    )
    enqueue(doc_id)
    return {"id": doc_id, "title": title, "status": "uploaded", "collection_id": cid}


class YoutubeIn(BaseModel):
    url: str
    collection_id: str | None = None


@router.post("/youtube")
async def add_youtube(body: YoutubeIn, conn=Depends(db), user=Depends(current_user)):
    """YouTube videosunu kaynak olarak ekler. Dokum arka planda cikarilir
    (once altyazi, yoksa Gemini videoyu izler); sonra PDF gibi islenir."""
    import asyncio
    from app.services import youtube_service as yt
    vid = yt.video_id(body.url)
    if not vid:
        raise AppError("Geçerli bir YouTube linki değil. Örnek: https://www.youtube.com/watch?v=…")
    cid = None
    if body.collection_id:
        ok = await conn.fetchval("SELECT 1 FROM collections WHERE id=$1 AND user_id=$2",
                                 body.collection_id, user["id"])
        if not ok:
            raise NotFound("Defter bulunamadı.")
        cid = body.collection_id
    q = "SELECT id FROM documents WHERE user_id=$1 AND source_type='youtube' AND media->>'video_id'=$2"
    if cid:
        dup = await conn.fetchval(q + " AND collection_id=$3", user["id"], vid, cid)
    else:
        dup = await conn.fetchval(q, user["id"], vid)
    if dup:
        raise AppError("Bu video zaten eklenmiş.")
    m = await asyncio.to_thread(yt.meta, vid)
    if m.get("unavailable"):
        raise AppError("Video bulunamadı ya da herkese açık değil.")
    title = m.get("title") or f"YouTube videosu ({vid})"
    doc_id = str(uuid.uuid4())
    key = f"{user['id']}/{doc_id}.json"
    url = f"https://www.youtube.com/watch?v={vid}"
    media = {"video_id": vid, "channel": m.get("channel"), "duration": m.get("duration")}
    await conn.execute(
        """INSERT INTO documents (id, user_id, title, original_filename, file_path, file_size, status,
                                  collection_id, source_type, source_url, media)
           VALUES ($1,$2,$3,$4,$5,0,'uploaded',$6,'youtube',$7,$8)""",
        doc_id, user["id"], title, url, key, cid, url, media,
    )
    enqueue(doc_id)
    return {"id": doc_id, "title": title, "status": "uploaded", "collection_id": cid, "source_type": "youtube"}


@router.get("/{doc_id}/transcript")
async def transcript(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    """Video dokumu: bolumler ve zaman damgali satirlar."""
    import asyncio, json as _json
    from app.storage.object_store import get_object
    from app.services import youtube_service as yt
    row = await conn.fetchrow("SELECT file_path, source_type, media FROM documents WHERE id=$1 AND user_id=$2",
                              doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    if row["source_type"] != "youtube":
        raise AppError("Bu kaynak bir video değil.")
    try:
        tr = _json.loads((await asyncio.to_thread(get_object, row["file_path"])).decode("utf-8"))
    except Exception:  # noqa
        return {"ready": False, "sections": [], "media": row["media"]}
    secs = [{k: s[k] for k in ("page", "start", "end", "lines")} for s in yt.sections(tr)]
    return {"ready": True, "sections": secs, "method": tr.get("method"), "media": row["media"]}


@router.get("")
async def list_docs(conn=Depends(db), user=Depends(current_user)):
    rows = await conn.fetch(
        """SELECT id, title, status, processing_stage, page_count, short_summary,
                  difficulty_level, key_concepts, category, tags, is_favorite, collection_id, created_at,
                  progress_done, progress_total, error_message, source_type, source_url, media
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
        "SELECT status, processing_stage, error_message, progress_done, progress_total "
        "FROM documents WHERE id=$1 AND user_id=$2",
        doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    return dict(row)


@router.get("/{doc_id}/file")
async def file_url(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT file_path, source_type, source_url FROM documents WHERE id=$1 AND user_id=$2",
                              doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    if row["source_type"] == "youtube":
        return {"url": row["source_url"], "kind": "youtube"}
    return {"url": presigned_url(row["file_path"])}


class DocPatch(BaseModel):
    title: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    is_favorite: bool | None = None
    collection_id: str | None = None


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
    if body.collection_id is not None:
        sets.append(f"collection_id=${i}::uuid"); vals.append(body.collection_id or None); i += 1
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
async def reprocess(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    await conn.execute("UPDATE documents SET status='uploaded', error_message=NULL WHERE id=$1", doc_id)
    enqueue(doc_id)
    return {"ok": True}


@router.post("/reprocess-stuck")
async def reprocess_stuck(conn=Depends(db), user=Depends(current_user)):
    """Kullanicinin takili/hatali tum belgelerini kuyruga geri koyar."""
    rows = await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND status IN ('uploaded','processing','failed')", user["id"])
    for r in rows:
        enqueue(str(r["id"]))
    return {"queued": len(rows)}
