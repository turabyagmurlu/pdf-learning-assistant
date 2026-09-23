import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel
from app.deps import db, current_user
from app.config import settings
from app.core.errors import FileTooLarge, NotFound, AppError
from app.storage.object_store import put_object, presigned_url, delete_object
from app.workers.tasks import enqueue

router = APIRouter(prefix="/documents", tags=["documents"])

IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "gif"}
AUDIO_MAX_MB = 100


@router.post("")
async def upload(file: UploadFile = File(...), collection_id: str | None = Form(None),
                 conn=Depends(db), user=Depends(current_user)):
    """Kaynak yukle: PDF, Word, Excel/CSV, PowerPoint, Markdown/TXT/RTF, EPUB, HTML.
    collection_id verilirse belge dogrudan o deftere duser. Isleme kuyrukta."""
    from app.sources.extract import kind_of
    from app.sources.audio import EXTS as AUDIO_EXTS
    fname = file.filename or "Adsız"
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    is_pdf = file.content_type in ("application/pdf", "application/x-pdf") or ext == "pdf"
    is_img = ext in IMAGE_EXTS or (file.content_type or "").startswith("image/")
    is_audio = ext in AUDIO_EXTS or (file.content_type or "").startswith("audio/")
    kind = "pdf" if is_pdf else "image" if is_img else "audio" if is_audio else kind_of(fname)
    if not kind:
        raise AppError("Bu dosya türü desteklenmiyor. PDF, Word, Excel, CSV, PowerPoint, Markdown, TXT, RTF, EPUB, HTML, "
                       "fotoğraf (JPG/PNG) veya ses kaydı (MP3/M4A/WAV) yükleyebilirsin.")
    data = await file.read()
    limit = (AUDIO_MAX_MB if kind == "audio" else settings.max_upload_mb) * 1024 * 1024
    if len(data) > limit:
        raise FileTooLarge(f"Dosya sınırı {limit // (1024 * 1024)} MB.")
    if kind == "pdf" and data[:5] != b"%PDF-":
        raise AppError("Bu dosya geçerli bir PDF değil.")
    cid = await _check_collection(conn, user, collection_id)
    title = fname.rsplit(".", 1)[0]
    if kind == "image":
        # fotograf -> tek sayfalik PDF; metin yoksa isleme hatti OCR ile okur
        import asyncio
        from app.sources.ocr import image_to_pdf
        data = await asyncio.to_thread(image_to_pdf, data, ext if ext in IMAGE_EXTS else "png")
        kind, ext = "pdf", "pdf"
    if kind == "audio" and not ext:
        ext = "mp3"
    ext = ext or kind
    doc_id = await _create_doc(conn, user, cid, kind, title, fname, data, ext)
    return {"id": doc_id, "title": title, "status": "uploaded", "collection_id": cid, "source_type": kind}


_CTYPES = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "ogg": "audio/ogg", "webm": "audio/webm",
           "pdf": "application/pdf", "json": "application/json", "html": "text/html; charset=utf-8",
           "txt": "text/plain; charset=utf-8", "md": "text/markdown; charset=utf-8", "csv": "text/csv"}


async def _check_collection(conn, user, collection_id):
    if not collection_id:
        return None
    ok = await conn.fetchval("SELECT 1 FROM collections WHERE id=$1 AND user_id=$2", collection_id, user["id"])
    if not ok:
        raise NotFound("Defter bulunamadı.")
    return collection_id


async def _create_doc(conn, user, cid, kind, title, fname, data: bytes, ext: str,
                      source_url: str | None = None, media: dict | None = None) -> str:
    doc_id = str(uuid.uuid4())
    key = f"{user['id']}/{doc_id}.{ext}"
    put_object(key, data, content_type=_CTYPES.get(ext, "application/octet-stream"))
    await conn.execute(
        """INSERT INTO documents (id, user_id, title, original_filename, file_path, file_size, status,
                                  collection_id, source_type, source_url, media)
           VALUES ($1,$2,$3,$4,$5,$6,'uploaded',$7,$8,$9,$10)""",
        doc_id, user["id"], (title or "Adsız")[:300], fname, key, len(data), cid, kind, source_url, media,
    )
    enqueue(doc_id)
    return doc_id


class WebIn(BaseModel):
    url: str
    collection_id: str | None = None
    title: str | None = None          # kesif panelinden gelen bilinen baslik (PDF linklerinde dosya adi yerine)


@router.post("/web")
async def add_web(body: WebIn, conn=Depends(db), user=Depends(current_user)):
    """Web sayfasini (ya da PDF linkini) kaynak olarak ekler. YouTube linki gelirse videoya yonlendirir."""
    import asyncio
    from app.services import youtube_service as yt
    from app.sources import web
    from app.sources.extract import html_to_sections
    if yt.video_id(body.url) and ("youtu" in body.url):
        return await add_youtube(YoutubeIn(url=body.url, collection_id=body.collection_id), conn, user)
    cid = await _check_collection(conn, user, body.collection_id)
    got = await asyncio.to_thread(web.fetch, body.url)
    final = got["final_url"]
    dup = await conn.fetchval(
        "SELECT id FROM documents WHERE user_id=$1 AND source_url=$2 AND collection_id IS NOT DISTINCT FROM $3",
        user["id"], final, cid)
    if dup:
        raise AppError("Bu sayfa zaten eklenmiş.")
    from urllib.parse import urlparse
    host = urlparse(final).hostname or ""
    if got["kind"] == "pdf":
        name = final.rstrip("/").rsplit("/", 1)[-1].split("?")[0] or host
        title = (body.title or "").strip() or (name.rsplit(".", 1)[0] if name.lower().endswith(".pdf") else name)
        doc_id = await _create_doc(conn, user, cid, "pdf", title, name, got["data"], "pdf", source_url=final,
                                   media={"site": host})
        return {"id": doc_id, "title": title, "status": "uploaded", "collection_id": cid, "source_type": "pdf"}
    title, meta = None, {}
    if got["kind"] == "html":
        secs, title, meta = await asyncio.to_thread(html_to_sections, got["data"].decode("utf-8", "ignore"))
        words = sum(len(t.split()) for _, t in secs)
        if words < 60:
            raise AppError("Bu sayfada okunabilir bir yazı bulunamadı (sayfa içeriğini tarayıcıda "
                           "yüklüyor ya da giriş istiyor olabilir). Metni kopyalayıp 'Metin yapıştır' ile ekleyebilirsin.")
    title = ((body.title or "").strip() or title or host).strip()
    ext = "html" if got["kind"] == "html" else "txt"
    doc_id = await _create_doc(conn, user, cid, "web", title, final, got["data"], ext, source_url=final,
                               media={"site": meta.get("site") or host, "author": meta.get("author"),
                                      "date": meta.get("date"), "description": meta.get("description"),
                                      "format": ext})
    return {"id": doc_id, "title": title, "status": "uploaded", "collection_id": cid, "source_type": "web"}


class TextIn(BaseModel):
    text: str
    title: str | None = None
    collection_id: str | None = None


@router.post("/text")
async def add_text(body: TextIn, conn=Depends(db), user=Depends(current_user)):
    """Yapistirilan metni (not, e-posta, yazisma, makale parcasi) kaynak yapar."""
    text = (body.text or "").strip()
    if len(text) < 40:
        raise AppError("Metin çok kısa (en az birkaç cümle yapıştır).")
    if len(text) > 2_000_000:
        raise AppError("Metin çok uzun; dosya olarak yüklemeyi dene.")
    cid = await _check_collection(conn, user, body.collection_id)
    title = (body.title or "").strip() or next((l.strip() for l in text.splitlines() if l.strip()), "Not")[:90]
    doc_id = await _create_doc(conn, user, cid, "text", title, "yapistirilan-metin.md", text.encode("utf-8"), "md")
    return {"id": doc_id, "title": title, "status": "uploaded", "collection_id": cid, "source_type": "text"}


@router.get("/{doc_id}/content")
async def content(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    """PDF disi kaynaklarin okunabilir hali: bolumler (baslik, metin, varsa tablo)."""
    import asyncio, json as _json
    from app.storage.object_store import get_object
    row = await conn.fetchrow("SELECT file_path, source_type, source_url, media FROM documents WHERE id=$1 AND user_id=$2",
                              doc_id, user["id"])
    if not row:
        raise NotFound("Belge bulunamadı.")
    try:
        pages = _json.loads((await asyncio.to_thread(get_object, row["file_path"] + ".pages.json")).decode("utf-8"))
    except Exception:  # noqa - henuz islenmedi
        return {"ready": False, "pages": [], "source_type": row["source_type"]}
    return {"ready": True, "pages": pages, "source_type": row["source_type"],
            "source_url": row["source_url"], "media": row["media"]}


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
    if row["source_type"] not in ("youtube", "audio"):
        raise AppError("Bu kaynak bir video ya da ses kaydı değil.")
    tkey = row["file_path"] if row["source_type"] == "youtube" else row["file_path"] + ".transcript.json"
    try:
        tr = _json.loads((await asyncio.to_thread(get_object, tkey)).decode("utf-8"))
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
    for k in (row["file_path"], row["file_path"] + ".pages.json", row["file_path"] + ".ocr.json",
              row["file_path"] + ".transcript.json"):
        try:
            delete_object(k)
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
