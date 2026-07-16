import asyncio
import json
import asyncpg
from pgvector.asyncpg import register_vector
from app.workers.celery_app import celery
from app.config import settings
from app.storage.object_store import get_object, ensure_bucket
from app.pdf.extractor import extract_pages, page_count
from app.pdf.chunking import chunk_pages
from app.ai.factory import get_embeddings
from app.services.analysis_service import analyze_document
from app.core.errors import AppError


def _dsn() -> str:
    return (settings.database_url
            .replace("postgresql+asyncpg://", "postgresql://")
            .replace("postgresql+psycopg://", "postgresql://"))


async def _conn():
    conn = await asyncpg.connect(_dsn())
    await register_vector(conn)
    return conn


async def _run_ingest(document_id: str):
    conn = await _conn()
    try:
        row = await conn.fetchrow("SELECT file_path FROM documents WHERE id=$1", document_id)
        if not row:
            return
        key = row["file_path"]

        await conn.execute("UPDATE documents SET status='processing', processing_stage='extracting' WHERE id=$1",
                           document_id)
        pdf_bytes = get_object(key)

        try:
            pages = extract_pages(pdf_bytes)
        except AppError as e:
            await conn.execute("UPDATE documents SET status='failed', error_message=$2 WHERE id=$1",
                               document_id, e.user_message)
            return

        pc = page_count(pdf_bytes)

        await conn.execute("UPDATE documents SET processing_stage='chunking', page_count=$2 WHERE id=$1",
                           document_id, pc)
        chunks = chunk_pages(pages)
        if not chunks:
            await conn.execute("UPDATE documents SET status='failed', error_message=$2 WHERE id=$1",
                               document_id, "İçerik parçalanamadı.")
            return

        await conn.execute("UPDATE documents SET processing_stage='embedding' WHERE id=$1", document_id)
        embedder = get_embeddings()
        await conn.execute("DELETE FROM document_chunks WHERE document_id=$1", document_id)

        batch = 64
        for i in range(0, len(chunks), batch):
            part = chunks[i:i + batch]
            vectors = embedder.embed([c["content"] for c in part])
            for c, vec in zip(part, vectors):
                await conn.execute(
                    """INSERT INTO document_chunks
                       (document_id, chunk_index, page_number, page_end, section_title, content, token_count, embedding)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                    document_id, c["chunk_index"], c["page_number"], c["page_end"],
                    c["section_title"], c["content"], c["token_count"], vec)

        await conn.execute("UPDATE documents SET processing_stage='analyzing' WHERE id=$1", document_id)
        full_text = "\n".join(p["text"] for p in pages)
        try:
            a = analyze_document(full_text)
            await conn.execute(
                """UPDATE documents SET short_summary=$2, detailed_summary=$3, purpose=$4,
                   difficulty_level=$5, outline=$6, key_concepts=$7, difficult_concepts=$8 WHERE id=$1""",
                document_id, a["short_summary"], a["detailed_summary"], a["purpose"],
                a["difficulty_level"], json.dumps(a["outline"]), json.dumps(a["key_concepts"]),
                json.dumps(a["difficult_concepts"]))
        except Exception:  # analiz başarısız olsa da belge yine de sohbete hazır
            pass

        await conn.execute("UPDATE documents SET status='ready', processing_stage=NULL WHERE id=$1", document_id)
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
