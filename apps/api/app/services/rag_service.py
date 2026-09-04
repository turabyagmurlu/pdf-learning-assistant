from app.ai.provider import EmbeddingProvider

MIN_SCORE = 0.20


async def retrieve(conn, document_id: str, question: str, embedder: EmbeddingProvider, k: int = 8):
    q_emb = embedder.embed([question])[0]
    rows = await conn.fetch(
        """
        SELECT id, page_number, section_title, content,
               1 - (embedding <=> $1) AS score
        FROM document_chunks
        WHERE document_id = $2 AND embedding IS NOT NULL
        ORDER BY embedding <=> $1
        LIMIT 20
        """,
        q_emb, document_id,
    )
    rows = [dict(r) for r in rows]
    rows.sort(key=lambda r: r["score"], reverse=True)
    top = rows[:k]
    if not top or top[0]["score"] < MIN_SCORE:
        return []
    return top


async def retrieve_many(conn, document_ids: list[str], question: str,
                        embedder: EmbeddingProvider, k: int = 10):
    """Birden fazla belge icinde arama (calisma kitabi icin)."""
    if not document_ids:
        return []
    q_emb = embedder.embed([question])[0]
    rows = await conn.fetch(
        """
        SELECT dc.id, dc.page_number, dc.section_title, dc.content,
               dc.document_id, d.title AS doc_title,
               1 - (dc.embedding <=> $1) AS score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE dc.document_id = ANY($2::uuid[]) AND dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> $1
        LIMIT 30
        """,
        q_emb, document_ids,
    )
    rows = [dict(r) for r in rows]
    rows.sort(key=lambda r: r["score"], reverse=True)
    top = rows[:k]
    if not top or top[0]["score"] < MIN_SCORE:
        return []
    return top


def build_context(chunks: list[dict]) -> str:
    parts = []
    for i, c in enumerate(chunks):
        sec = c.get("section_title") or ""
        doc = c.get("doc_title")
        src = f'"{doc}", s.{c["page_number"]}' if doc else f's.{c["page_number"]}'
        if sec:
            src += f', "{sec}"'
        parts.append(f'[K{i+1}] ({src})\n{c["content"]}')
    return "\n\n".join(parts)
