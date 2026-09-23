import asyncio
import hashlib
import json
import re
import threading
import time
import asyncpg
from pgvector.asyncpg import register_vector
from app.workers.celery_app import celery
from app.config import settings
from app.storage.object_store import get_object, put_object, ensure_bucket
from app.pdf.extractor import extract_pages, page_count
from app.pdf.chunking import chunk_pages
from app.ai.factory import get_embeddings
from app.services.analysis_service import analyze_document
from app.core.errors import AppError

# Ayni anda islenecek belge sayisi. Ucretsiz Gemini katmaninda gomme icin
# dakikada 100 istek / 30K token siniri var; 17 belgeyi birden vermek kotayi
# aninda yakiyordu. Iki belge paralel, gerisi sirada bekler.
_SLOTS = threading.BoundedSemaphore(2)
_QUEUED: set[str] = set()
_QUEUED_LOCK = threading.Lock()

# Gomme partisi: 20 parca x ~500 token = ~10K token/istek -> 30K TPM'e sigar.
EMBED_BATCH = 20
EMBED_PACE_SEC = 0.7      # istekler arasi nefes payi (100 RPM'in altinda kal)


def _dsn() -> str:
    return (settings.database_url
            .replace("postgresql+asyncpg://", "postgresql://")
            .replace("postgresql+psycopg://", "postgresql://"))


async def _conn():
    conn = await asyncpg.connect(_dsn())
    await register_vector(conn)
    for t in ("jsonb", "json"):
        await conn.set_type_codec(t, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    return conn


async def _set(conn, document_id: str, **fields):
    """Belge alanlarini tek sorguda gunceller (ilerleme yazmak icin)."""
    if not fields:
        return
    cols = list(fields.keys())
    sets = ", ".join(f"{c}=${i + 2}" for i, c in enumerate(cols))
    await conn.execute(f"UPDATE documents SET {sets} WHERE id=$1", document_id, *[fields[c] for c in cols])


async def _youtube_pages(conn, document_id: str, key: str, media: dict):
    """Video dokumunu getirir (daha once cikarildiysa depodan: kota yok),
    2 dakikalik bolumlere boler ve bolum zamanlarini belgeye yazar."""
    from app.services import youtube_service as yt
    tr = None
    try:
        tr = json.loads(get_object(key).decode("utf-8"))
    except Exception:  # noqa - ilk isleme: dokum henuz yok
        tr = None
    if not tr or not tr.get("segments"):
        vid = media.get("video_id")
        loop = asyncio.get_running_loop()

        def prog(i, n):          # uzun videolarda dilim ilerlemesi
            try:
                asyncio.run_coroutine_threadsafe(
                    _set(conn, document_id, progress_done=i, progress_total=n), loop).result(timeout=15)
            except Exception:  # noqa
                pass

        tr = await asyncio.to_thread(yt.build_transcript, vid, media.get("duration"), prog)
        put_object(key, yt.dumps(tr), content_type="application/json")
    secs = yt.sections(tr)
    media = {**media, "method": tr.get("method"),
             "duration": media.get("duration") or tr.get("duration") or (secs[-1]["end"] if secs else None),
             "sections": [{"page": s["page"], "start": s["start"], "end": s["end"]} for s in secs]}
    await _set(conn, document_id, media=media)
    return [{"page_number": s["page"], "text": s["text"]} for s in secs], len(secs)


async def _run_ingest(document_id: str):
    conn = await _conn()
    try:
        row = await conn.fetchrow("SELECT file_path, source_type, media FROM documents WHERE id=$1", document_id)
        if not row:
            return
        key = row["file_path"]

        await _set(conn, document_id, status="processing", processing_stage="extracting",
                   progress_done=0, progress_total=0, error_message=None)

        if (row["source_type"] or "pdf") == "youtube":
            try:
                pages, pc = await _youtube_pages(conn, document_id, key, row["media"] or {})
            except AppError as e:
                await _set(conn, document_id, status="failed", error_message=e.user_message, processing_stage=None)
                return
        else:
            pdf_bytes = get_object(key)
            try:
                pages = extract_pages(pdf_bytes)
            except AppError as e:
                await _set(conn, document_id, status="failed", error_message=e.user_message, processing_stage=None)
                return
            pc = page_count(pdf_bytes)
        await _set(conn, document_id, processing_stage="chunking", page_count=pc)
        chunks = chunk_pages(pages)
        if not chunks:
            await _set(conn, document_id, status="failed", error_message="İçerik parçalanamadı.", processing_stage=None)
            return

        # Gomme: parca parca, ilerleme yazarak. Yarim kalmis bir islemde
        # daha once gomulmus parcalar korunur (kaldigi yerden devam).
        done_idx = {r["chunk_index"] for r in await conn.fetch(
            "SELECT chunk_index FROM document_chunks WHERE document_id=$1", document_id)}
        todo = [c for c in chunks if c["chunk_index"] not in done_idx]
        if done_idx and len(done_idx) > len(chunks):      # eski/uyumsuz kalinti -> temizle
            await conn.execute("DELETE FROM document_chunks WHERE document_id=$1", document_id)
            done_idx, todo = set(), chunks

        total = len(chunks)
        await _set(conn, document_id, processing_stage="embedding",
                   progress_done=len(done_idx), progress_total=total)
        embedder = get_embeddings()
        done = len(done_idx)

        # Kota tasarrufu 1: anlamsiz kisa parcalari (sayfa no, bos baslik) hic gomme
        def _meaningful(t: str) -> bool:
            return len(re.findall(r"[^\W\d_]", t or "")) >= 25
        skipped = [c for c in todo if not _meaningful(c["content"])]
        todo = [c for c in todo if _meaningful(c["content"])]
        done += len(skipped)

        # Kota tasarrufu 2: ayni metin daha once gomulduyse (ayni PDF tekrar yuklendi,
        # yeniden isleniyor vb.) o vektoru kullan, API'ye gitme
        hashes = {c["chunk_index"]: hashlib.md5(c["content"].encode("utf-8")).hexdigest() for c in todo}
        reuse: dict[str, list] = {}
        if hashes:
            try:
                for r in await conn.fetch(
                        """SELECT DISTINCT ON (md5(content)) md5(content) AS h, embedding
                           FROM document_chunks WHERE md5(content) = ANY($1::text[]) AND embedding IS NOT NULL""",
                        list(set(hashes.values()))):
                    reuse[r["h"]] = r["embedding"]
            except Exception:  # noqa
                reuse = {}
        cached = [c for c in todo if hashes[c["chunk_index"]] in reuse]
        for c in cached:
            await conn.execute(
                """INSERT INTO document_chunks
                   (document_id, chunk_index, page_number, page_end, section_title, content, token_count, embedding)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                   ON CONFLICT DO NOTHING""",
                document_id, c["chunk_index"], c["page_number"], c["page_end"],
                c["section_title"], c["content"], c["token_count"], reuse[hashes[c["chunk_index"]]])
        done += len(cached)
        todo = [c for c in todo if hashes[c["chunk_index"]] not in reuse]
        if skipped or cached:
            await _set(conn, document_id, progress_done=done, progress_total=total)

        for i in range(0, len(todo), EMBED_BATCH):
            part = todo[i:i + EMBED_BATCH]
            vectors = embedder.embed([c["content"] for c in part])     # kendi icinde retry yapar
            for c, vec in zip(part, vectors):
                await conn.execute(
                    """INSERT INTO document_chunks
                       (document_id, chunk_index, page_number, page_end, section_title, content, token_count, embedding)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                       ON CONFLICT DO NOTHING""",
                    document_id, c["chunk_index"], c["page_number"], c["page_end"],
                    c["section_title"], c["content"], c["token_count"], vec)
            done += len(part)
            await _set(conn, document_id, progress_done=done, progress_total=total)
            if i + EMBED_BATCH < len(todo):
                time.sleep(EMBED_PACE_SEC)

        await _set(conn, document_id, processing_stage="analyzing")
        full_text = "\n".join(p["text"] for p in pages)
        try:
            a = analyze_document(full_text)
            await conn.execute(
                """UPDATE documents SET short_summary=$2, detailed_summary=$3, purpose=$4,
                   difficulty_level=$5, outline=$6, key_concepts=$7, difficult_concepts=$8 WHERE id=$1""",
                document_id, a["short_summary"], a["detailed_summary"], a["purpose"],
                a["difficulty_level"], a["outline"], a["key_concepts"],
                a["difficult_concepts"])
        except Exception:  # analiz başarısız olsa da belge yine de sohbete hazır
            pass

        await _set(conn, document_id, status="ready", processing_stage=None,
                   progress_done=total, progress_total=total)
    except Exception as e:  # noqa - hicbir belge sessizce "isleniyor"da kalmasin
        msg = getattr(e, "user_message", None) or "İşleme sırasında hata oluştu; 'Yeniden işle' ile tekrar dene."
        try:
            await _set(conn, document_id, status="failed", error_message=msg[:300], processing_stage=None)
        except Exception:  # noqa
            pass
    finally:
        await conn.close()


@celery.task(name="ingest_document", bind=True, max_retries=2, default_retry_delay=15)
def ingest_document(self, document_id: str):
    try:
        ensure_bucket()
    except Exception:  # noqa
        pass
    asyncio.run(_run_ingest(document_id))
    return {"document_id": document_id, "ok": True}


def run_ingest_sync(document_id: str):
    """Backend içinde (ayrı worker olmadan) senkron ingest çalıştırıcı.
    FastAPI BackgroundTasks ile threadpool'da çağrılır; en fazla 2 belge paralel."""
    with _QUEUED_LOCK:
        if document_id in _QUEUED:
            return                      # zaten sirada
        _QUEUED.add(document_id)
    try:
        ensure_bucket()
    except Exception:  # noqa
        pass
    try:
        with _SLOTS:
            asyncio.run(_run_ingest(document_id))
    finally:
        with _QUEUED_LOCK:
            _QUEUED.discard(document_id)


def enqueue(document_id: str):
    """Arka planda, kuyruk disiplinine uyarak isle (acilista yeniden kuyruklama icin)."""
    threading.Thread(target=run_ingest_sync, args=(document_id,), daemon=True).start()


async def resume_unfinished():
    """Sunucu (yeniden) acilinca yarim kalmis belgeleri kuyruga geri koyar.
    Render ucretsiz katmani uyuyunca arka plan isleri olur; bu olmadan belgeler
    sonsuza kadar 'isleniyor'da kalir."""
    conn = await _conn()
    try:
        rows = await conn.fetch(
            "SELECT id FROM documents WHERE status IN ('uploaded','processing') ORDER BY created_at")
    finally:
        await conn.close()
    for r in rows:
        enqueue(str(r["id"]))
    return len(rows)
