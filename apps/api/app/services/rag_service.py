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


def build_context(chunks: list[dict]) -> str:
    parts = []
    for i, c in enumerate(chunks):
        sec = c.get("section_title") or ""
        parts.append(f'[K{i+1}] (s.{c["page_number"]}, "{sec}")\n{c["content"]}')
    return "\n\n".join(parts)
