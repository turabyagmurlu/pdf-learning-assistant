import hashlib
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel
from app.deps import db, current_user
from app.config import settings
from app.core.errors import FileTooLarge, NotFound, AppError
from app.storage.object_store import put_object, presigned_url, delete_object
from app.workers.tasks import enqueue
from app.services import membership

router = APIRouter(prefix="/documents", tags=["documents"])

IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "gif"}
AUDIO_MAX_MB = 100


@router.post("")
async def upload(file: UploadFile = File(...), collection_id: str | None = Form(None),
                 conn=Depends(db), user=Depends(current_user)):
    """Kaynak yukle: PDF, Word, Excel/CSV, PowerPoint, Markdown/TXT/RTF, EPUB, HTML.
    collection_id verilirse kaynak o deftere baglanir. Ayni icerik (sha1) kullanicida zaten varsa
    yeni kopya olusturulmaz: var olan kaynak deftere baglanir ve linked_existing=true doner."""
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
        raise FileTooLarge(f"Dosya çok büyük (en fazla {limit // (1024 * 1024)} MB). "
                           "Dosyayı bölerek ya da sıkıştırarak yükle.")
    if kind == "pdf" and data[:5] != b"%PDF-":
        raise AppError("Bu dosya geçerli bir PDF değil; dosya bozuk olabilir. Başka bir dosya dene.")
    cid = await _check_collection(conn, user, collection_id)
    fhash = hashlib.sha1(data).hexdigest()
    dup = await conn.fetchrow(
        "SELECT id FROM documents WHERE user_id=$1 AND file_hash=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
        user["id"], fhash)
    if dup:
        return await _link_existing(conn, user, str(dup["id"]), cid)
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
    doc_id = await _create_doc(conn, user, cid, kind, title, fname, data, ext, file_hash=fhash)
    return _created(doc_id, title, cid, kind)


_CTYPES = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "ogg": "audio/ogg", "webm": "audio/webm",
           "pdf": "application/pdf", "json": "application/json", "html": "text/html; charset=utf-8",
           "txt": "text/plain; charset=utf-8", "md": "text/markdown; charset=utf-8", "csv": "text/csv"}


COL_MISSING = "Defter bulunamadı; silinmiş olabilir. Defterler sayfasına dön."
DOC_MISSING = "Kaynak bulunamadı; silinmiş olabilir."


async def _check_collection(conn, user, collection_id):
    if not collection_id:
        return None
    try:
        collection_id = str(uuid.UUID(str(collection_id)))
    except Exception:  # noqa
        raise NotFound(COL_MISSING)
    ok = await conn.fetchval("SELECT 1 FROM collections WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
                             collection_id, user["id"])
    if not ok:
        raise NotFound(COL_MISSING)
    return collection_id


def _created(doc_id: str, title: str, cid: str | None, kind: str) -> dict:
    return {"id": doc_id, "title": title, "status": "uploaded", "collection_id": cid,
            "collection_ids": [cid] if cid else [], "source_type": kind, "linked_existing": False}


async def _link_existing(conn, user, doc_id: str, cid: str | None) -> dict:
    """Ayni kaynak zaten var: kopya olusturma, deftere bagla (verildiyse)."""
    row = await conn.fetchrow(
        "SELECT id, title, status, source_type FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    already = False
    if cid:
        already = await membership.is_linked(conn, doc_id, cid)
        if not already:
            await membership.link(conn, [doc_id], cid)
    status = row["status"]
    if status == "failed":
        # daha once islenemediyse yeniden yukleme = yeniden deneme
        await conn.execute("UPDATE documents SET status='uploaded', error_message=NULL WHERE id=$1", doc_id)
        enqueue(doc_id)
        status = "uploaded"
    cids = (await membership.collection_ids(conn, [doc_id])).get(doc_id, [])
    return {"id": doc_id, "title": row["title"], "status": status, "source_type": row["source_type"] or "pdf",
            "collection_id": cid or (cids[0] if cids else None), "collection_ids": cids,
            "linked_existing": True, "already_in_collection": already}


async def _create_doc(conn, user, cid, kind, title, fname, data: bytes, ext: str,
                      source_url: str | None = None, media: dict | None = None,
                      file_hash: str | None = None) -> str:
    doc_id = str(uuid.uuid4())
    key = f"{user['id']}/{doc_id}.{ext}"
    put_object(key, data, content_type=_CTYPES.get(ext, "application/octet-stream"))
    await conn.execute(
        """INSERT INTO documents (id, user_id, title, original_filename, file_path, file_size, status,
                                  collection_id, source_type, source_url, media, file_hash)
           VALUES ($1,$2,$3,$4,$5,$6,'uploaded',$7,$8,$9,$10,$11)""",
        doc_id, user["id"], (title or "Adsız")[:300], fname, key, len(data), cid, kind, source_url, media,
        file_hash,
    )
    if cid:
        await membership.link(conn, [doc_id], cid)
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
    q_dup = "SELECT id FROM documents WHERE user_id=$1 AND source_url=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1"
    dup = await conn.fetchval(q_dup, user["id"], (body.url or "").strip())
    if dup:
        return await _link_existing(conn, user, str(dup), cid)
    got = await asyncio.to_thread(web.fetch, body.url)
    final = got["final_url"]
    dup = await conn.fetchval(q_dup, user["id"], final)
    if dup:
        return await _link_existing(conn, user, str(dup), cid)
    from urllib.parse import urlparse
    host = urlparse(final).hostname or ""
    if got["kind"] == "pdf":
        name = final.rstrip("/").rsplit("/", 1)[-1].split("?")[0] or host
        title = (body.title or "").strip() or (name.rsplit(".", 1)[0] if name.lower().endswith(".pdf") else name)
        fhash = hashlib.sha1(got["data"]).hexdigest()
        dup = await conn.fetchval("SELECT id FROM documents WHERE user_id=$1 AND file_hash=$2 AND deleted_at IS NULL "
                                  "ORDER BY created_at LIMIT 1", user["id"], fhash)
        if dup:
            return await _link_existing(conn, user, str(dup), cid)
        doc_id = await _create_doc(conn, user, cid, "pdf", title, name, got["data"], "pdf", source_url=final,
                                   media={"site": host}, file_hash=fhash)
        return _created(doc_id, title, cid, "pdf")
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
    return _created(doc_id, title, cid, "web")


class TextIn(BaseModel):
    text: str
    title: str | None = None
    collection_id: str | None = None


@router.post("/text")
async def add_text(body: TextIn, conn=Depends(db), user=Depends(current_user)):
    """Yapistirilan metni (not, e-posta, yazisma, makale parcasi) kaynak yapar."""
    text = (body.text or "").strip()
    if len(text) < 40:
        raise AppError("Metin çok kısa; en az birkaç cümle ekle.")
    if len(text) > 2_000_000:
        raise AppError("Metin çok uzun; dosya olarak yüklemeyi dene.")
    cid = await _check_collection(conn, user, body.collection_id)
    raw = text.encode("utf-8")
    fhash = hashlib.sha1(raw).hexdigest()
    dup = await conn.fetchval("SELECT id FROM documents WHERE user_id=$1 AND file_hash=$2 AND deleted_at IS NULL "
                              "ORDER BY created_at LIMIT 1", user["id"], fhash)
    if dup:
        return await _link_existing(conn, user, str(dup), cid)
    title = (body.title or "").strip() or next((l.strip() for l in text.splitlines() if l.strip()), "Metin")[:90]
    doc_id = await _create_doc(conn, user, cid, "text", title, "yapistirilan-metin.md", raw, "md", file_hash=fhash)
    return _created(doc_id, title, cid, "text")


@router.get("/{doc_id}/content")
async def content(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    """Kaynagin okunabilir metin hali: bolumler/sayfalar (baslik, metin, varsa tablo).
    PDF disi kaynaklar `.pages.json`'dan; PDF'ler icin de `.pages.json` (isleme hatti yaziyorsa)
    ya da OCR'li PDF'lerde `.ocr.json` (sayfa metinleri) okunur - hangisi varsa."""
    import asyncio, json as _json
    from app.storage.object_store import get_object
    row = await conn.fetchrow("SELECT file_path, source_type, source_url, media FROM documents WHERE id=$1 AND user_id=$2",
                              doc_id, user["id"])
    if not row:
        raise NotFound(DOC_MISSING)
    pages = None
    method = None
    for suffix, m in ((".pages.json", "pages"), (".ocr.json", "ocr")):
        try:
            got = _json.loads((await asyncio.to_thread(get_object, row["file_path"] + suffix)).decode("utf-8"))
        except Exception:  # noqa - dosya yok / henuz islenmedi
            continue
        if isinstance(got, list) and got:
            pages, method = got, m
            break
    if pages is None:
        return {"ready": False, "pages": [], "source_type": row["source_type"]}
    # OCR ciktisinda yalniz page_number + text var; okuyucu bekledigi alanlari tamamla
    if method == "ocr":
        pages = [{"page_number": p.get("page_number", i + 1), "title": None, "text": p.get("text") or ""}
                 for i, p in enumerate(pages) if isinstance(p, dict)]
    return {"ready": True, "pages": pages, "source_type": row["source_type"], "method": method,
            "source_url": row["source_url"], "media": row["media"]}


# ---------------------------------------------------------------- okuma konumu (cihazlar arasi)
class ReadingIn(BaseModel):
    page: int | None = None
    num_pages: int | None = None
    pct: int | None = None
    media_pos: float | None = None      # video / ses: saniye
    device: str | None = None           # Telefon | Tablet | Bilgisayar


def _reading_of(r) -> dict | None:
    """documents satirindan `reading` nesnesi (hic kaydedilmediyse None)."""
    try:
        if r["reading_at"] is None and r["last_page"] is None and r["media_pos"] is None:
            return None
    except (KeyError, IndexError):
        return None
    return {
        "page": r["last_page"],
        "num_pages": r["num_pages"],
        "pct": r["progress_pct"],
        "media_pos": r["media_pos"],
        "device": r["reading_device"],
        "updated_at": r["reading_at"].isoformat() if r["reading_at"] else None,
    }


@router.put("/{doc_id}/reading")
async def put_reading(doc_id: str, body: ReadingIn, conn=Depends(db), user=Depends(current_user)):
    """Okuma konumunu kaydeder: sayfa, toplam sayfa, yuzde, (video/ses) konum, cihaz adi.
    Istemci 3 sn gecikmeyle ve sekme gizlenirken keepalive ile cagirir. Yapay zeka yok."""
    page = body.page
    num = body.num_pages
    pct = body.pct
    if page is not None:
        page = max(1, int(page))
    if num is not None:
        num = max(0, int(num)) or None
    if pct is None and page and num:
        pct = round(page * 100 / num)
    if pct is not None:
        pct = max(0, min(100, int(pct)))
    mpos = float(body.media_pos) if body.media_pos is not None and body.media_pos >= 0 else None
    device = (body.device or "").strip()[:40] or None
    row = await conn.fetchrow(
        """UPDATE documents SET
             last_page = COALESCE($3, last_page),
             num_pages = COALESCE($4, num_pages),
             progress_pct = COALESCE($5, progress_pct),
             media_pos = COALESCE($6, media_pos),
             reading_device = COALESCE($7, reading_device),
             reading_at = now()
           WHERE id=$1 AND user_id=$2
           RETURNING last_page, num_pages, progress_pct, media_pos, reading_device, reading_at""",
        doc_id, user["id"], page, num, pct, mpos, device)
    if not row:
        raise NotFound(DOC_MISSING)
    return {"ok": True, "reading": _reading_of(row)}


async def backfill_file_hashes(conn, user_id: str | None, limit: int = 200) -> dict:
    """file_hash bos olan dosya kaynaklarinin (youtube haric) sha1'ini depodan okuyup yazar.
    user_id None ise tum kullanicilar (acilis isi). Buyuk dosyalar tek tek okunur; limit ile parcali."""
    import asyncio
    from app.storage.object_store import get_object
    q = ("SELECT id, file_path FROM documents WHERE file_hash IS NULL AND source_type <> 'youtube' "
         "AND file_path IS NOT NULL")
    args: list = []
    if user_id:
        q += " AND user_id=$1"
        args.append(user_id)
    q += f" ORDER BY created_at LIMIT {int(limit) + 1}"
    rows = await conn.fetch(q, *args)
    remaining = len(rows) > limit
    rows = rows[:limit]
    done, failed = 0, 0
    for r in rows:
        try:
            data = await asyncio.to_thread(get_object, r["file_path"])
            h = hashlib.sha1(data).hexdigest()
            await conn.execute("UPDATE documents SET file_hash=$2 WHERE id=$1 AND file_hash IS NULL", r["id"], h)
            done += 1
        except Exception:  # noqa - dosya depoda yoksa atla
            failed += 1
    return {"done": done, "failed": failed, "remaining": remaining}


@router.post("/backfill-hashes")
async def backfill_hashes(conn=Depends(db), user=Depends(current_user)):
    """Sahip: eski kaynaklarda bos kalan file_hash'i doldurur (kopya yukleme yakalansin). Bir kerelik temizlik."""
    if not user.get("is_owner"):
        raise AppError("Bu işlem yalnız sahip hesabıyla yapılabilir.")
    return await backfill_file_hashes(conn, str(user["id"]), limit=300)


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
        raise AppError("Bu bir YouTube video linki değil. Örnek: https://www.youtube.com/watch?v=…")
    cid = await _check_collection(conn, user, body.collection_id)
    dup = await conn.fetchval(
        "SELECT id FROM documents WHERE user_id=$1 AND source_type='youtube' AND media->>'video_id'=$2 "
        "AND deleted_at IS NULL ORDER BY created_at LIMIT 1", user["id"], vid)
    if dup:
        return await _link_existing(conn, user, str(dup), cid)
    m = await asyncio.to_thread(yt.meta, vid)
    if m.get("unavailable"):
        raise AppError("Video bulunamadı ya da herkese açık değil; linki kontrol et.")
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
    if cid:
        await membership.link(conn, [doc_id], cid)
    enqueue(doc_id)
    return _created(doc_id, title, cid, "youtube")


@router.get("/{doc_id}/transcript")
async def transcript(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    """Video dokumu: bolumler ve zaman damgali satirlar."""
    import asyncio, json as _json
    from app.storage.object_store import get_object
    from app.services import youtube_service as yt
    row = await conn.fetchrow("SELECT file_path, source_type, media FROM documents WHERE id=$1 AND user_id=$2",
                              doc_id, user["id"])
    if not row:
        raise NotFound(DOC_MISSING)
    if row["source_type"] not in ("youtube", "audio"):
        raise AppError("Bu kaynak bir video ya da ses kaydı değil.")
    tkey = row["file_path"] if row["source_type"] == "youtube" else row["file_path"] + ".transcript.json"
    try:
        tr = _json.loads((await asyncio.to_thread(get_object, tkey)).decode("utf-8"))
    except Exception:  # noqa
        return {"ready": False, "sections": [], "media": row["media"]}
    secs = [{k: s[k] for k in ("page", "start", "end", "lines")} for s in yt.sections(tr)]
    return {"ready": True, "sections": secs, "method": tr.get("method"), "media": row["media"]}


_LINKS_SQL = """COALESCE((SELECT array_agg(l.collection_id::text ORDER BY l.added_at, l.collection_id)
                     FROM document_collections l WHERE l.document_id = d.id), ARRAY[]::text[]) AS collection_ids"""


def _with_links(r) -> dict:
    d = dict(r)
    cids = list(d.get("collection_ids") or [])
    d["collection_ids"] = cids
    d["collection_id"] = cids[0] if cids else None      # geriye uyum: ilk bag
    return d


@router.get("")
async def list_docs(conn=Depends(db), user=Depends(current_user)):
    """Kullanicinin tum kaynaklari. collection_ids: bagli oldugu defterler (coka-cok)."""
    base = """SELECT d.id, d.title, d.status, d.processing_stage, d.page_count, d.short_summary,
                  d.difficulty_level, d.key_concepts, d.category, d.tags, d.is_favorite, d.created_at,
                  d.progress_done, d.progress_total, d.error_message, d.source_type, d.source_url, d.media"""
    try:
        rows = await conn.fetch(
            f"""{base}, d.progress_pct, d.last_page, d.reading_at, {_LINKS_SQL}
               FROM documents d WHERE d.user_id=$1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC""", user["id"])
    except Exception:  # noqa - okuma sutunlari henuz yoksa (migrasyon basarisiz) eski liste
        rows = await conn.fetch(
            f"""{base}, NULL::int AS progress_pct, NULL::int AS last_page, NULL::timestamptz AS reading_at, {_LINKS_SQL}
               FROM documents d WHERE d.user_id=$1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC""", user["id"])
    out = []
    for r in rows:
        d = _with_links(r)
        d["reading_at"] = r["reading_at"].isoformat() if r["reading_at"] else None
        out.append(d)
    return out


@router.get("/{doc_id}/locate")
async def locate(doc_id: str, q: str, conn=Depends(db), user=Depends(current_user)):
    """Icindekiler maddesinin gectigi sayfayi bulur (tam metin arama; yapay zeka yok, 0 kota)."""
    import re as _re
    own = await conn.fetchval("SELECT 1 FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not own:
        raise NotFound(DOC_MISSING)
    words = [w for w in _re.findall(r"[\wçğıöşüÇĞİÖŞÜ]+", q or "") if len(w) > 3][:8]
    if not words:
        return {"page": None}
    tsq = " or ".join(words)
    row = await conn.fetchrow(
        """SELECT page_number, ts_rank(to_tsvector('simple', coalesce(section_title,'') || ' ' || content),
                                      websearch_to_tsquery('simple', $2)) AS r
           FROM document_chunks WHERE document_id=$1
             AND to_tsvector('simple', coalesce(section_title,'') || ' ' || content) @@ websearch_to_tsquery('simple', $2)
           ORDER BY r DESC, chunk_index ASC LIMIT 1""", doc_id, tsq)
    return {"page": row["page_number"] if row else None}


@router.get("/{doc_id}")
async def get_doc(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow(f"SELECT d.*, {_LINKS_SQL} FROM documents d WHERE d.id=$1 AND d.user_id=$2 AND d.deleted_at IS NULL",
                              doc_id, user["id"])
    if not row:
        raise NotFound(DOC_MISSING)
    out = _with_links(row)
    # okuyucu basligi icin ("Defter › Kaynak"): bagli defterlerin adlari
    cols = await conn.fetch(
        """SELECT c.id, c.title FROM document_collections l JOIN collections c ON c.id = l.collection_id
           WHERE l.document_id=$1 AND c.user_id=$2 ORDER BY l.added_at, c.id""", doc_id, user["id"])
    out["collections"] = [{"id": str(c["id"]), "title": c["title"]} for c in cols]
    # okuma konumu (cihazlar arasi): {page, num_pages, pct, media_pos, device, updated_at} ya da None
    out["reading"] = _reading_of(row)
    for k in ("reading_at",):
        if out.get(k) is not None and hasattr(out[k], "isoformat"):
            out[k] = out[k].isoformat()
    return out


@router.get("/{doc_id}/status")
async def status(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow(
        "SELECT status, processing_stage, error_message, progress_done, progress_total "
        "FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
        doc_id, user["id"])
    if not row:
        raise NotFound(DOC_MISSING)
    return dict(row)


@router.get("/{doc_id}/file")
async def file_url(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT file_path, source_type, source_url FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
                              doc_id, user["id"])
    if not row:
        raise NotFound(DOC_MISSING)
    if row["source_type"] == "youtube":
        return {"url": row["source_url"], "kind": "youtube"}
    return {"url": presigned_url(row["file_path"])}


class DocPatch(BaseModel):
    title: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    is_favorite: bool | None = None
    # Geriye uyum: deger -> o deftere BAG EKLER (tasimaz); "" -> tum defterlerden cikarir.
    collection_id: str | None = None
    # Istege bagli: kaynagin defterlerini tam olarak bu listeye esitler (Kutuphane coklu secim).
    collection_ids: list[str] | None = None


@router.patch("/{doc_id}")
async def update_doc(doc_id: str, body: DocPatch, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", doc_id, user["id"])
    if not row:
        raise NotFound(DOC_MISSING)
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
    if body.collection_ids is not None:
        ok = await membership.owned_collections(conn, user["id"], body.collection_ids)
        await membership.set_links(conn, doc_id, ok)
    elif body.collection_id is not None:
        if body.collection_id.strip():
            cid = await _check_collection(conn, user, body.collection_id.strip())
            await membership.link(conn, [doc_id], cid)
        else:
            await membership.unlink_all(conn, doc_id)
    cids = (await membership.collection_ids(conn, [doc_id])).get(doc_id, [])
    return {"ok": True, "collection_ids": cids, "collection_id": cids[0] if cids else None}


@router.delete("/{doc_id}")
async def delete_doc(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    """Kaynagi COP KUTUSUNA tasir (yumusak silme). Dosyalar ve notlar durur; 30 gun icinde
    POST /trash/document/{id}/restore ile geri gelir, sonra gunluk temizlik kalici siler."""
    row = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
                              doc_id, user["id"])
    if not row:
        raise NotFound(DOC_MISSING)
    await trash_document(conn, user["id"], doc_id)
    return {"ok": True, "trashed": True, "restore": f"/trash/document/{doc_id}/restore"}


# ================================================================ COP KUTUSU (yumusak silme)
# Kaynak, defter, not/vurgu ve sohbet silinince satir DURUR, `deleted_at` dolar; listelemeler
# `deleted_at IS NULL` ile suzer. 30 gun sonra `purge_expired` (main.py gunluk dongu) kalici siler.
# Kaynak cope giderken defter baglari `trash_links`e (defter kimlikleri) yazilir ve baglar
# kaldirilir (defter sorgulari bag tablosundan gittigi icin baska sorguya dokunmadan gizlenir);
# geri getirince hala var olan defterlere yeniden baglanir. Defterle birlikte cope giden
# kaynaklar `trashed_with` = defter kimligi ile isaretlenir; defter geri gelince onlar da gelir.
TRASH_DAYS = 30
TRASH_KINDS = ("document", "collection", "note", "chat")


async def ensure_trash_schema(conn):
    """Idempotent migrasyon (main.py lifespan'dan cagrilir)."""
    await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz")
    await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS trash_links jsonb")
    await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS trashed_with uuid")
    await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS deleted_at timestamptz")
    await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS trash_links jsonb")
    await conn.execute("ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at timestamptz")
    await conn.execute("ALTER TABLE collection_chats ADD COLUMN IF NOT EXISTS deleted_at timestamptz")
    for t in ("documents", "collections", "notes", "collection_chats"):
        await conn.execute(
            f"CREATE INDEX IF NOT EXISTS {t}_deleted_idx ON {t} (user_id, deleted_at) WHERE deleted_at IS NOT NULL")


def _file_keys(file_path: str | None) -> list[str]:
    if not file_path:
        return []
    return [file_path, file_path + ".pages.json", file_path + ".ocr.json", file_path + ".transcript.json"]


async def _purge_document_row(conn, doc_id: str, file_path: str | None):
    """Kalici silme: depolama dosyalari + satir (parcalar, notlar, baglar CASCADE)."""
    import asyncio
    for k in _file_keys(file_path):
        try:
            await asyncio.to_thread(delete_object, k)
        except Exception:  # noqa - dosya zaten yoksa
            pass
    await conn.execute("DELETE FROM documents WHERE id=$1", doc_id)


async def trash_document(conn, user_id, doc_id: str, trashed_with: str | None = None):
    """Kaynagi cope tasir: baglari sakla, baglari kaldir, deleted_at doldur."""
    import json as _json
    links = (await membership.collection_ids(conn, [doc_id])).get(doc_id, [])
    async with conn.transaction():
        await conn.execute(
            """UPDATE documents SET deleted_at=now(), trash_links=$3::jsonb, trashed_with=$4::uuid
               WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL""",
            doc_id, user_id, _json.dumps(links), trashed_with)
        await membership.unlink_all(conn, doc_id)


async def restore_document(conn, user_id, doc_id: str) -> bool:
    """Copten geri getirir; saklanan baglari (hala var olan, silinmemis defterlere) kurar."""
    import json as _json
    row = await conn.fetchrow(
        "SELECT trash_links FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NOT NULL", doc_id, user_id)
    if not row:
        return False
    links = row["trash_links"]
    if isinstance(links, str):
        try:
            links = _json.loads(links)
        except Exception:  # noqa
            links = []
    cids = [str(c) for c in (links or []) if c]
    async with conn.transaction():
        await conn.execute(
            "UPDATE documents SET deleted_at=NULL, trash_links=NULL, trashed_with=NULL WHERE id=$1 AND user_id=$2",
            doc_id, user_id)
        if cids:
            live = [str(r["id"]) for r in await conn.fetch(
                "SELECT id FROM collections WHERE user_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL",
                user_id, cids)]
            for cid in live:
                await membership.link(conn, [doc_id], cid)
    return True


async def restore_collection(conn, user_id, cid: str) -> bool:
    """Defteri geri getirir: saklanan baglari kurar, defterle birlikte cope giden kaynaklari da geri getirir."""
    import json as _json
    row = await conn.fetchrow(
        "SELECT trash_links FROM collections WHERE id=$1 AND user_id=$2 AND deleted_at IS NOT NULL", cid, user_id)
    if not row:
        return False
    links = row["trash_links"]
    if isinstance(links, str):
        try:
            links = _json.loads(links)
        except Exception:  # noqa
            links = []
    doc_ids = [str(d) for d in (links or []) if d]
    async with conn.transaction():
        await conn.execute("UPDATE collections SET deleted_at=NULL, trash_links=NULL WHERE id=$1 AND user_id=$2",
                           cid, user_id)
        if doc_ids:
            live = [str(r["id"]) for r in await conn.fetch(
                "SELECT id FROM documents WHERE user_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL",
                user_id, doc_ids)]
            if live:
                await membership.link(conn, live, cid)
    # defterle birlikte cope gidenler (kendi baglari trash_links'te; defter artik canli oldugu icin baglanir)
    with_it = [str(r["id"]) for r in await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND trashed_with=$2::uuid AND deleted_at IS NOT NULL", user_id, cid)]
    for d in with_it:
        await restore_document(conn, user_id, d)
    if with_it:
        # defter baglari kaynak cope gitmeden once kaldirildigi icin kaynagin kendi listesinde bu defter yok
        await membership.link(conn, with_it, cid)
    return True


async def _purge_collection_row(conn, cid: str):
    await conn.execute("UPDATE documents SET trashed_with=NULL WHERE trashed_with=$1::uuid", cid)
    await conn.execute("DELETE FROM collections WHERE id=$1", cid)  # sohbetler, baglar, taslak surumleri CASCADE


async def purge_expired(conn, days: int = TRASH_DAYS) -> dict:
    """30 gunden eski cop ogelerini kalici siler (gunluk dongu). Tum kullanicilar."""
    out = {"document": 0, "collection": 0, "note": 0, "chat": 0}
    docs = await conn.fetch(
        "SELECT id, file_path FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)",
        int(days))
    for r in docs:
        try:
            await _purge_document_row(conn, str(r["id"]), r["file_path"])
            out["document"] += 1
        except Exception:  # noqa
            pass
    cols = await conn.fetch(
        "SELECT id FROM collections WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)",
        int(days))
    for r in cols:
        try:
            await _purge_collection_row(conn, str(r["id"]))
            out["collection"] += 1
        except Exception:  # noqa
            pass
    r1 = await conn.execute(
        "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)", int(days))
    r2 = await conn.execute(
        "DELETE FROM collection_chats WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)",
        int(days))
    for k, r in (("note", r1), ("chat", r2)):
        try:
            out[k] = int(r.split()[-1])
        except Exception:  # noqa
            pass
    return out


trash_router = APIRouter(prefix="/trash", tags=["trash"])
TRASH_MISSING = "Bu öğe çöp kutusunda bulunamadı; geri getirilmiş ya da kalıcı silinmiş olabilir."


def _kind_ok(kind: str):
    if kind not in TRASH_KINDS:
        raise NotFound(TRASH_MISSING)


def _expires(deleted_at):
    from datetime import timedelta
    try:
        return (deleted_at + timedelta(days=TRASH_DAYS)).isoformat()
    except Exception:  # noqa
        return None


@trash_router.get("")
async def list_trash(conn=Depends(db), user=Depends(current_user)):
    """Cop kutusu: kaynaklar, defterler, notlar/vurgular, sohbetler (en son silinen ustte).
    Silinmis bir kaynagin notlari ve silinmis bir defterin sohbetleri ayrica listelenmez (kaynak/defterle gelir)."""
    uid = user["id"]
    items = []
    for r in await conn.fetch(
            """SELECT id, title, deleted_at, file_size, page_count, source_type, trashed_with, trash_links
               FROM documents WHERE user_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500""", uid):
        links = r["trash_links"]
        n_links = len(links) if isinstance(links, list) else 0
        items.append({"kind": "document", "id": str(r["id"]), "title": r["title"] or "Adsız kaynak",
                      "deleted_at": r["deleted_at"].isoformat(), "expires_at": _expires(r["deleted_at"]),
                      "size": r["file_size"], "page_count": r["page_count"], "source_type": r["source_type"] or "pdf",
                      "notebook_count": n_links, "trashed_with": str(r["trashed_with"]) if r["trashed_with"] else None})
    for r in await conn.fetch(
            """SELECT c.id, c.title, c.deleted_at, c.trash_links,
                      (SELECT COUNT(*) FROM collection_chats ch WHERE ch.collection_id=c.id AND ch.deleted_at IS NULL) AS chats,
                      (SELECT COUNT(*) FROM documents d WHERE d.trashed_with=c.id AND d.deleted_at IS NOT NULL) AS with_docs
               FROM collections c WHERE c.user_id=$1 AND c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC LIMIT 500""", uid):
        links = r["trash_links"]
        items.append({"kind": "collection", "id": str(r["id"]), "title": r["title"] or "Adsız defter",
                      "deleted_at": r["deleted_at"].isoformat(), "expires_at": _expires(r["deleted_at"]),
                      "source_count": len(links) if isinstance(links, list) else 0,
                      "with_sources": int(r["with_docs"] or 0), "chat_count": int(r["chats"] or 0)})
    for r in await conn.fetch(
            """SELECT n.id, n.page_number, n.selected_text, n.note_content, n.highlight_color, n.anchor, n.deleted_at,
                      d.title AS doc_title, d.id AS doc_id
               FROM notes n JOIN documents d ON d.id = n.document_id
               WHERE n.user_id=$1 AND n.deleted_at IS NOT NULL AND d.deleted_at IS NULL
               ORDER BY n.deleted_at DESC LIMIT 500""", uid):
        anchor = r["anchor"]
        if isinstance(anchor, str):
            try:
                import json as _json
                anchor = _json.loads(anchor)
            except Exception:  # noqa
                anchor = None
        a = anchor if isinstance(anchor, dict) else {}
        style = "sticky" if a.get("type") == "sticky" else ("underline" if a.get("style") == "underline" else "highlight")
        text = (r["selected_text"] or r["note_content"] or "").strip().replace("\n", " ")
        items.append({"kind": "note", "id": str(r["id"]), "title": text[:140] or "(boş not)",
                      "deleted_at": r["deleted_at"].isoformat(), "expires_at": _expires(r["deleted_at"]),
                      "page_number": r["page_number"], "note_content": r["note_content"],
                      "highlight_color": r["highlight_color"], "style": style,
                      "parent_title": r["doc_title"], "parent_id": str(r["doc_id"])})
    for r in await conn.fetch(
            """SELECT ch.id, ch.title, ch.deleted_at, c.title AS col_title, c.id AS col_id,
                      (SELECT COUNT(*) FROM collection_messages m WHERE m.chat_id=ch.id) AS n
               FROM collection_chats ch JOIN collections c ON c.id = ch.collection_id
               WHERE ch.user_id=$1 AND ch.deleted_at IS NOT NULL AND c.deleted_at IS NULL
               ORDER BY ch.deleted_at DESC LIMIT 500""", uid):
        items.append({"kind": "chat", "id": str(r["id"]), "title": r["title"] or "Adsız sohbet",
                      "deleted_at": r["deleted_at"].isoformat(), "expires_at": _expires(r["deleted_at"]),
                      "message_count": int(r["n"] or 0), "parent_title": r["col_title"], "parent_id": str(r["col_id"])})
    items.sort(key=lambda x: x["deleted_at"], reverse=True)
    counts = {k: sum(1 for x in items if x["kind"] == k) for k in TRASH_KINDS}
    return {"items": items, "counts": counts, "total": len(items), "days": TRASH_DAYS}


@trash_router.get("/count")
async def trash_count(conn=Depends(db), user=Depends(current_user)):
    """Menu rozeti icin hafif sayim (kaynak notlari / defter sohbetleri ayrica sayilmaz)."""
    uid = user["id"]
    row = await conn.fetchrow(
        """SELECT (SELECT COUNT(*) FROM documents WHERE user_id=$1 AND deleted_at IS NOT NULL) AS d,
                  (SELECT COUNT(*) FROM collections WHERE user_id=$1 AND deleted_at IS NOT NULL) AS c,
                  (SELECT COUNT(*) FROM notes n JOIN documents d ON d.id=n.document_id
                     WHERE n.user_id=$1 AND n.deleted_at IS NOT NULL AND d.deleted_at IS NULL) AS n,
                  (SELECT COUNT(*) FROM collection_chats ch JOIN collections c ON c.id=ch.collection_id
                     WHERE ch.user_id=$1 AND ch.deleted_at IS NOT NULL AND c.deleted_at IS NULL) AS ch""", uid)
    counts = {"document": int(row["d"] or 0), "collection": int(row["c"] or 0),
              "note": int(row["n"] or 0), "chat": int(row["ch"] or 0)}
    return {"counts": counts, "total": sum(counts.values()), "days": TRASH_DAYS}


@trash_router.post("/{kind}/{item_id}/restore")
async def restore_item(kind: str, item_id: str, conn=Depends(db), user=Depends(current_user)):
    """Geri getir. Kaynak: baglari da doner. Defter: baglari ve birlikte silinen kaynaklari da doner."""
    _kind_ok(kind)
    uid = user["id"]
    ok = False
    if kind == "document":
        ok = await restore_document(conn, uid, item_id)
    elif kind == "collection":
        ok = await restore_collection(conn, uid, item_id)
    elif kind == "note":
        r = await conn.execute(
            "UPDATE notes SET deleted_at=NULL WHERE id=$1 AND user_id=$2 AND deleted_at IS NOT NULL", item_id, uid)
        ok = r.endswith(" 1")
    elif kind == "chat":
        r = await conn.execute(
            "UPDATE collection_chats SET deleted_at=NULL WHERE id=$1 AND user_id=$2 AND deleted_at IS NOT NULL", item_id, uid)
        ok = r.endswith(" 1")
    if not ok:
        raise NotFound(TRASH_MISSING)
    return {"ok": True, "kind": kind, "id": item_id}


@trash_router.delete("/{kind}/{item_id}")
async def purge_item(kind: str, item_id: str, conn=Depends(db), user=Depends(current_user)):
    """Kalici sil (yalniz copteki oge). Kaynakta depolama dosyalari da silinir."""
    _kind_ok(kind)
    uid = user["id"]
    if kind == "document":
        row = await conn.fetchrow("SELECT id, file_path FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NOT NULL",
                                  item_id, uid)
        if not row:
            raise NotFound(TRASH_MISSING)
        await _purge_document_row(conn, item_id, row["file_path"])
    elif kind == "collection":
        row = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2 AND deleted_at IS NOT NULL", item_id, uid)
        if not row:
            raise NotFound(TRASH_MISSING)
        await _purge_collection_row(conn, item_id)
    elif kind == "note":
        r = await conn.execute("DELETE FROM notes WHERE id=$1 AND user_id=$2 AND deleted_at IS NOT NULL", item_id, uid)
        if not r.endswith(" 1"):
            raise NotFound(TRASH_MISSING)
    elif kind == "chat":
        r = await conn.execute("DELETE FROM collection_chats WHERE id=$1 AND user_id=$2 AND deleted_at IS NOT NULL", item_id, uid)
        if not r.endswith(" 1"):
            raise NotFound(TRASH_MISSING)
    return {"ok": True}


@trash_router.delete("")
async def empty_trash(kind: str | None = None, conn=Depends(db), user=Depends(current_user)):
    """Copu bosalt (kalici). kind verilirse yalniz o tur."""
    uid = user["id"]
    if kind is not None:
        _kind_ok(kind)
    out = {"document": 0, "collection": 0, "note": 0, "chat": 0}
    if kind in (None, "document"):
        for r in await conn.fetch("SELECT id, file_path FROM documents WHERE user_id=$1 AND deleted_at IS NOT NULL", uid):
            try:
                await _purge_document_row(conn, str(r["id"]), r["file_path"])
                out["document"] += 1
            except Exception:  # noqa
                pass
    if kind in (None, "collection"):
        for r in await conn.fetch("SELECT id FROM collections WHERE user_id=$1 AND deleted_at IS NOT NULL", uid):
            try:
                await _purge_collection_row(conn, str(r["id"]))
                out["collection"] += 1
            except Exception:  # noqa
                pass
    if kind in (None, "note"):
        r = await conn.execute("DELETE FROM notes WHERE user_id=$1 AND deleted_at IS NOT NULL", uid)
        try:
            out["note"] = int(r.split()[-1])
        except Exception:  # noqa
            pass
    if kind in (None, "chat"):
        r = await conn.execute("DELETE FROM collection_chats WHERE user_id=$1 AND deleted_at IS NOT NULL", uid)
        try:
            out["chat"] = int(r.split()[-1])
        except Exception:  # noqa
            pass
    return {"ok": True, "purged": out}


@router.post("/{doc_id}/reprocess")
async def reprocess(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", doc_id, user["id"])
    if not row:
        raise NotFound(DOC_MISSING)
    await conn.execute("UPDATE documents SET status='uploaded', error_message=NULL WHERE id=$1", doc_id)
    enqueue(doc_id)
    return {"ok": True}


@router.post("/reprocess-stuck")
async def reprocess_stuck(conn=Depends(db), user=Depends(current_user)):
    """Kullanicinin takili/hatali tum belgelerini kuyruga geri koyar."""
    rows = await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND deleted_at IS NULL AND status IN ('uploaded','processing','failed')",
        user["id"])
    for r in rows:
        enqueue(str(r["id"]))
    return {"queued": len(rows)}
