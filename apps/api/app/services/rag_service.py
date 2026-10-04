import asyncio
import hashlib
import re
from app.ai.provider import EmbeddingProvider
from app.config import settings

MIN_SCORE = 0.20

# Sor — derinlige gore parca sayisi (T5-cevap §3.3). Komsu parcalar (±1) ayrica eklenir.
K_FOR_DEPTH = {"kisa": 6, "ayrintili": 16, "derin": 20}
# Cok kaynakli defterde tek belge tum yerleri almasin: belge basina ust sinir, ilgili her belgeye en az 1 yer.
PER_DOC_CAP = {"kisa": 3, "ayrintili": 5, "derin": 6}
NEIGHBOR_CHARS = 1400          # komsu parcadan alinacak en fazla karakter (her yon)
SUMMARY_CHARS = 900            # belge L1 ozetinden alinacak en fazla karakter


def k_for(depth: str | None) -> int:
    return K_FOR_DEPTH.get(depth or "", K_FOR_DEPTH["ayrintili"])


def norm_q(text: str) -> str:
    """Soruyu karsilastirma icin sadelestirir (buyuk/kucuk harf, noktalama, bosluk)."""
    t = (text or "").replace("İ", "i").replace("I", "ı").lower()
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


async def embed_query(conn, embedder: EmbeddingProvider, text: str) -> list[float]:
    """Soru gommesi: ayni metin daha once gomulduyse depodan (kota yok)."""
    key = hashlib.sha1(f"{settings.gemini_embed_model}|{settings.embedding_dim}|{norm_q(text)}".encode()).hexdigest()
    try:
        row = await conn.fetchrow("UPDATE embed_cache SET used_at=now() WHERE h=$1 RETURNING vec", key)
        if row and row["vec"] is not None:
            return list(row["vec"])
    except Exception:  # noqa - tablo yoksa normal yoldan devam
        row = None
    vec = (await asyncio.to_thread(embedder.embed, [text]))[0]
    try:
        await conn.execute("INSERT INTO embed_cache (h, vec) VALUES ($1, $2) ON CONFLICT (h) DO NOTHING", key, vec)
    except Exception:  # noqa
        pass
    return vec


async def retrieve(conn, document_id: str, question: str, embedder: EmbeddingProvider, k: int = 8,
                   q_emb: list[float] | None = None, neighbors: bool = False):
    if q_emb is None:
        q_emb = await embed_query(conn, embedder, question)
    rows = await conn.fetch(
        """
        SELECT id, page_number, section_title, content, chunk_index, document_id,
               1 - (embedding <=> $1) AS score
        FROM document_chunks
        WHERE document_id = $2 AND embedding IS NOT NULL
        ORDER BY embedding <=> $1
        LIMIT $3
        """,
        q_emb, document_id, max(20, k * 2),
    )
    rows = [dict(r) for r in rows]
    rows.sort(key=lambda r: r["score"], reverse=True)
    top = rows[:k]
    if not top or top[0]["score"] < MIN_SCORE:
        return []
    if neighbors:
        await expand_neighbors(conn, top)
    return top


def _balance(rows: list[dict], k: int, per_doc: int | None) -> list[dict]:
    """Skor sirasini korur; belge basina en fazla per_doc parca, aday listesindeki her belgeye en az 1 yer."""
    if not per_doc or per_doc <= 0:
        return rows[:k]
    picked: list[dict] = []
    seen_docs: set = set()
    count: dict = {}
    # 1) her belgenin en iyi parcasi (skor sirasiyla), yer kaldigi surece
    for r in rows:
        d = str(r.get("document_id"))
        if d in seen_docs or len(picked) >= k:
            continue
        seen_docs.add(d)
        count[d] = 1
        picked.append(r)
    # 2) kalan yerler skor sirasiyla, belge basina ust sinirla
    chosen = {id(r) for r in picked}
    for r in rows:
        if len(picked) >= k:
            break
        if id(r) in chosen:
            continue
        d = str(r.get("document_id"))
        if count.get(d, 0) >= per_doc:
            continue
        count[d] = count.get(d, 0) + 1
        picked.append(r)
        chosen.add(id(r))
    picked.sort(key=lambda r: r["score"], reverse=True)
    return picked


async def retrieve_many(conn, document_ids: list[str], question: str,
                        embedder: EmbeddingProvider, k: int = 10, q_emb: list[float] | None = None,
                        per_doc: int | None = None, neighbors: bool = False):
    """Birden fazla belge icinde arama (defter). per_doc verilirse belge basina ust sinir uygulanir."""
    if not document_ids:
        return []
    if q_emb is None:
        q_emb = await embed_query(conn, embedder, question)
    rows = await conn.fetch(
        """
        SELECT dc.id, dc.page_number, dc.section_title, dc.content, dc.chunk_index,
               dc.document_id, d.title AS doc_title,
               1 - (dc.embedding <=> $1) AS score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE dc.document_id = ANY($2::uuid[]) AND dc.embedding IS NOT NULL AND d.deleted_at IS NULL
        ORDER BY dc.embedding <=> $1
        LIMIT $3
        """,
        q_emb, document_ids, max(30, k * 3),
    )
    rows = [dict(r) for r in rows]
    rows.sort(key=lambda r: r["score"], reverse=True)
    if not rows or rows[0]["score"] < MIN_SCORE:
        return []
    rows = [r for r in rows if r["score"] >= MIN_SCORE * 0.5]      # cok alakasiz kuyruk girmesin
    top = _balance(rows, k, per_doc)
    if neighbors:
        await expand_neighbors(conn, top)
    return top


async def expand_neighbors(conn, chunks: list[dict]) -> None:
    """Secilen her parcaya ayni belgeden onceki/sonraki parcayi ekler (kesik cumle/argüman sorunu).
    Parca sayisi ve [K#] numaralari degismez; icerik 'önce … | … | sonra …' olarak genisler.
    chunk_index yoksa ya da sorgu basarisizsa sessizce gecer."""
    want: dict[str, set] = {}
    have: dict[tuple, dict] = {}
    for c in chunks:
        ci = c.get("chunk_index")
        if ci is None:
            continue
        d = str(c.get("document_id"))
        have[(d, int(ci))] = c
        want.setdefault(d, set()).update({int(ci) - 1, int(ci) + 1})
    if not want:
        return
    nb: dict[tuple, dict] = {}
    try:
        for d, idxs in want.items():
            idxs = sorted(i for i in idxs if i >= 0 and (d, i) not in have)
            if not idxs:
                continue
            rows = await conn.fetch(
                "SELECT chunk_index, page_number, content FROM document_chunks "
                "WHERE document_id=$1::uuid AND chunk_index = ANY($2::int[])", d, idxs)
            for r in rows:
                nb[(d, int(r["chunk_index"]))] = dict(r)
    except Exception:  # noqa - komsu alinamazsa ana parcalar yeter
        return
    for c in chunks:
        ci = c.get("chunk_index")
        if ci is None:
            continue
        d = str(c.get("document_id"))
        prev = nb.get((d, int(ci) - 1))
        nxt = nb.get((d, int(ci) + 1))
        parts = []
        if prev and prev.get("content"):
            parts.append("… " + prev["content"][-NEIGHBOR_CHARS:].strip())
        parts.append(c.get("content") or "")
        if nxt and nxt.get("content"):
            parts.append(nxt["content"][:NEIGHBOR_CHARS].strip() + " …")
        c["content"] = "\n".join(p for p in parts if p)
        # sayfa araligi (atifta ana sayfa kalir; model gerekirse araligi gorur)
        pages = sorted({int(x["page_number"]) for x in (prev, c, nxt) if x and x.get("page_number")})
        if len(pages) > 1:
            c["page_span"] = f"{pages[0]}–{pages[-1]}"


async def doc_summaries(conn, document_ids: list[str]) -> str:
    """Ilgili belgelerin L1 ozeti (detailed_summary / short_summary / amac / kavramlar) — baglamin basina.
    Alanlar bossa o belge atlanir; tablo/kolon yoksa bos doner."""
    ids = list(dict.fromkeys(str(i) for i in document_ids if i))
    if not ids:
        return ""
    try:
        rows = await conn.fetch(
            """SELECT id, title, short_summary, detailed_summary, purpose, key_concepts
               FROM documents WHERE id = ANY($1::uuid[]) ORDER BY created_at""", ids)
    except Exception:  # noqa
        return ""
    import json
    out = []
    for r in rows:
        summ = (r.get("detailed_summary") or r.get("short_summary") or "").strip()
        if not summ:
            continue
        s = f'• "{r["title"]}": {summ[:SUMMARY_CHARS]}'
        if r.get("purpose"):
            s += f"\n  Amaç: {str(r['purpose'])[:200]}"
        kc = r.get("key_concepts")
        try:
            kc = json.loads(kc) if isinstance(kc, str) else kc
        except Exception:  # noqa
            kc = None
        if isinstance(kc, list):
            terms = [k.get("term") for k in kc if isinstance(k, dict) and k.get("term")][:8]
            if terms:
                s += "\n  Kavramlar: " + ", ".join(terms)
        out.append(s)
    return "\n".join(out)


def build_context(chunks: list[dict], summaries: str | None = None) -> str:
    parts = []
    if summaries:
        parts.append("BELGE ÖZETLERİ (bütünü görmek için; atıf verilmez):\n" + summaries)
        parts.append("KAYNAK PARÇALARI (atıf buraya: [K# s.N]):")
    for i, c in enumerate(chunks):
        sec = c.get("section_title") or ""
        doc = c.get("doc_title")
        pg = c.get("page_span") or c["page_number"]
        src = f'"{doc}", s.{pg}' if doc else f's.{pg}'
        if sec:
            src += f', "{sec}"'
        parts.append(f'[K{i+1}] ({src})\n{c["content"]}')
    return "\n\n".join(parts)
