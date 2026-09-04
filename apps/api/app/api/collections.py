import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.deps import db, current_user
from app.services import rag_service
from app.services.analysis_service import generate_study_items, feynman_review, lecture_script
from app.ai.factory import get_embeddings, get_llm
from app.core.errors import NotFound, AppError
from app.config import settings

router = APIRouter(tags=["collections/search/graph"])


class CollectionIn(BaseModel):
    title: str
    description: str | None = None


@router.post("/collections")
async def create_collection(body: CollectionIn, conn=Depends(db), user=Depends(current_user)):
    cid = str(uuid.uuid4())
    await conn.execute("INSERT INTO collections (id, user_id, title, description) VALUES ($1,$2,$3,$4)",
                       cid, user["id"], body.title, body.description)
    return {"id": cid}


@router.get("/collections")
async def list_collections(conn=Depends(db), user=Depends(current_user)):
    rows = await conn.fetch("SELECT * FROM collections WHERE user_id=$1 ORDER BY created_at DESC", user["id"])
    return [dict(r) for r in rows]


@router.get("/collections/{cid}")
async def get_collection(cid: str, conn=Depends(db), user=Depends(current_user)):
    """Calisma kitabi: bilgiler + icindeki belgeler."""
    col = await conn.fetchrow("SELECT * FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    docs = await conn.fetch(
        """SELECT id, title, status, page_count, short_summary, category, tags,
                  is_favorite, difficulty_level, created_at
           FROM documents WHERE user_id=$1 AND collection_id=$2
           ORDER BY created_at DESC""",
        user["id"], cid)
    docs = [dict(d) for d in docs]
    ids = [str(d["id"]) for d in docs]
    cards = 0
    mastered = learning = review = due = 0
    notes = 0
    if ids:
        srow = await conn.fetchrow(
            """SELECT COUNT(*) AS total,
                      COUNT(*) FILTER (WHERE review_status='mastered') AS mastered,
                      COUNT(*) FILTER (WHERE review_status='learning') AS learning,
                      COUNT(*) FILTER (WHERE review_status='review')   AS review,
                      COUNT(*) FILTER (WHERE due_at IS NOT NULL AND due_at <= now()) AS due
               FROM study_items WHERE user_id=$1 AND document_id = ANY($2::uuid[])""",
            user["id"], ids)
        if srow:
            cards = srow["total"] or 0
            mastered = srow["mastered"] or 0
            learning = srow["learning"] or 0
            review = srow["review"] or 0
            due = srow["due"] or 0
        notes = await conn.fetchval(
            "SELECT COUNT(*) FROM notes WHERE user_id=$1 AND document_id = ANY($2::uuid[])",
            user["id"], ids) or 0
    return {
        "collection": dict(col),
        "documents": docs,
        "stats": {
            "documents": len(docs),
            "ready": sum(1 for d in docs if d.get("status") == "ready"),
            "pages": sum((d.get("page_count") or 0) for d in docs),
            "cards": cards,
            "mastered": mastered,
            "learning": learning,
            "review": review,
            "due": due,
            "notes": notes,
        },
    }


class CollectionPatch(BaseModel):
    title: str | None = None
    description: str | None = None


@router.patch("/collections/{cid}")
async def update_collection(cid: str, body: CollectionPatch, conn=Depends(db), user=Depends(current_user)):
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    if body.title is not None:
        await conn.execute("UPDATE collections SET title=$1 WHERE id=$2 AND user_id=$3",
                           body.title, cid, user["id"])
    if body.description is not None:
        await conn.execute("UPDATE collections SET description=$1 WHERE id=$2 AND user_id=$3",
                           body.description, cid, user["id"])
    return {"ok": True}


@router.delete("/collections/{cid}")
async def delete_collection(cid: str, conn=Depends(db), user=Depends(current_user)):
    """Calisma kitabini siler; icindeki belgeler silinmez, sadece kitaptan cikar."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    await conn.execute("UPDATE documents SET collection_id=NULL WHERE collection_id=$1 AND user_id=$2",
                       cid, user["id"])
    await conn.execute("DELETE FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    return {"ok": True}


class AskIn(BaseModel):
    question: str


@router.post("/collections/{cid}/ask")
async def ask_collection(cid: str, body: AskIn, conn=Depends(db), user=Depends(current_user)):
    """Calisma kitabindaki TUM belgelere birden soru sorar."""
    col = await conn.fetchrow("SELECT id, title FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    q = (body.question or "").strip()
    if len(q) < 3:
        raise AppError("Soru çok kısa.")
    rows = await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
        user["id"], cid)
    ids = [str(r["id"]) for r in rows]
    if not ids:
        raise AppError("Bu çalışma kitabında hazır belge yok.")
    chunks = await rag_service.retrieve_many(conn, ids, q, get_embeddings())
    if not chunks:
        return {"answer": "Bu soruya bu çalışma kitabındaki belgelerde karşılık bulamadım.",
                "sources": []}
    ctx = rag_service.build_context(chunks)
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen bir çalışma asistanısın. SADECE verilen kaynaklara dayanarak Türkçe cevap ver. "
            "Kaynakta olmayan bir şey uydurma. Cevabında hangi kaynağa dayandığını [K1], [K2] "
            "biçiminde belirt. Sade ve öğretici anlat."},
        {"role": "user", "content": f"Kaynaklar:\n\n{ctx}\n\nSoru: {q}"},
    ]
    answer = llm.complete(messages, model=settings.active_llm_model)
    sources = [{"document_id": str(c["document_id"]), "title": c.get("doc_title"),
                "page": c["page_number"], "score": round(float(c["score"]), 3)} for c in chunks]
    return {"answer": answer, "sources": sources}


class FeynmanIn(BaseModel):
    concept: str
    explanation: str


@router.post("/collections/{cid}/feynman")
async def feynman(cid: str, body: FeynmanIn, conn=Depends(db), user=Depends(current_user)):
    """Anlat Bakalim: kullanicinin anlatimini kaynakla karsilastirir."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    concept = (body.concept or "").strip()
    expl = (body.explanation or "").strip()
    if len(concept) < 2:
        raise AppError("Hangi kavramı anlattığını yaz.")
    if len(expl) < 20:
        raise AppError("Biraz daha uzun anlat; en az birkaç cümle olsun.")
    rows = await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
        user["id"], cid)
    ids = [str(r["id"]) for r in rows]
    if not ids:
        raise AppError("Bu çalışma kitabında hazır belge yok.")
    chunks = await rag_service.retrieve_many(conn, ids, concept + "\n" + expl[:500], get_embeddings(), k=10)
    if not chunks:
        raise AppError("Bu kavramla ilgili kaynak bulamadım. Farklı bir kavram dene.")
    ctx = rag_service.build_context(chunks)
    review = feynman_review(concept, expl, ctx)
    sources = [{"document_id": str(c["document_id"]), "title": c.get("doc_title"),
                "page": c["page_number"]} for c in chunks[:5]]
    return {"review": review, "sources": sources}


@router.post("/collections/{cid}/lecture")
async def lecture(cid: str, conn=Depends(db), user=Depends(current_user)):
    """Sesli Ders: koleksiyonu akici bir anlatim metnine cevirir."""
    col = await conn.fetchrow("SELECT id, title FROM collections WHERE id=$1 AND user_id=$2",
                              cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    docs = await conn.fetch(
        "SELECT id, title, short_summary FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
        user["id"], cid)
    if not docs:
        raise AppError("Bu çalışma kitabında hazır belge yok.")
    ids = [str(d["id"]) for d in docs]
    rows = await conn.fetch(
        """SELECT content FROM document_chunks WHERE document_id = ANY($1::uuid[])
           ORDER BY document_id, chunk_index LIMIT 40""", ids)
    parts = [f"{d['title']}: {d['short_summary']}" for d in docs if d["short_summary"]]
    context = "\n".join(parts) + "\n\n" + "\n\n".join(r["content"] for r in rows)
    if len(context) < 200:
        raise AppError("Ders oluşturmak için yeterli içerik yok.")
    script = lecture_script(context, col["title"])
    return {"script": script, "title": col["title"], "documents": len(docs)}


class ColStudyIn(BaseModel):
    type: str = "flashcard"
    count: int = 10


@router.post("/collections/{cid}/study/generate")
async def collection_study(cid: str, body: ColStudyIn, conn=Depends(db), user=Depends(current_user)):
    """Calisma kitabindaki tum belgelerden karisik kart/quiz uretir."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    docs = await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
        user["id"], cid)
    ids = [str(d["id"]) for d in docs]
    if not ids:
        raise AppError("Bu çalışma kitabında hazır belge yok.")
    per = max(3, min(12, (body.count or 10)))
    rows = await conn.fetch(
        """SELECT content, document_id FROM document_chunks
           WHERE document_id = ANY($1::uuid[]) ORDER BY random() LIMIT 30""", ids)
    context = "\n\n".join(r["content"] for r in rows)
    if len(context) < 100:
        raise AppError("Kart üretmek için yeterli içerik bulunamadı.")
    items = generate_study_items(context, body.type, per)
    created = 0
    first_doc = ids[0]
    for it in items:
        sid = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO study_items (id, user_id, document_id, type, question, answer, options,
                                        source_page, difficulty, due_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
            sid, user["id"], first_doc, it.get("type", body.type), it.get("question"),
            it.get("answer"), it.get("options", []), it.get("source_page"),
            it.get("difficulty"), datetime.now(timezone.utc))
        created += 1
    return {"created": created}


class SearchIn(BaseModel):
    query: str
    document_ids: list[str] | None = None


@router.post("/search")
async def search(body: SearchIn, conn=Depends(db), user=Depends(current_user)):
    """Kullanıcının belgeleri arasında semantik arama (çoklu belge)."""
    emb = get_embeddings().embed([body.query])[0]
    if body.document_ids:
        rows = await conn.fetch(
            """SELECT dc.id, dc.document_id, dc.page_number, dc.section_title, dc.content,
                      1 - (dc.embedding <=> $1) AS score, d.title
               FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
               WHERE d.user_id=$2 AND dc.document_id = ANY($3::uuid[]) AND dc.embedding IS NOT NULL
               ORDER BY dc.embedding <=> $1 LIMIT 15""",
            emb, user["id"], body.document_ids)
    else:
        rows = await conn.fetch(
            """SELECT dc.id, dc.document_id, dc.page_number, dc.section_title, dc.content,
                      1 - (dc.embedding <=> $1) AS score, d.title
               FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
               WHERE d.user_id=$2 AND dc.embedding IS NOT NULL
               ORDER BY dc.embedding <=> $1 LIMIT 15""",
            emb, user["id"])
    return [dict(r) for r in rows]


@router.get("/documents/{doc_id}/connections")
async def connections(doc_id: str, page: int, conn=Depends(db), user=Depends(current_user)):
    """Baglanti Kesfi: bu sayfadaki icerigin DIGER belgelerdeki karsiliklarini bulur."""
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not doc:
        raise NotFound("Belge bulunamadı.")
    src = await conn.fetch(
        """SELECT content, embedding FROM document_chunks
           WHERE document_id=$1 AND page_number=$2 AND embedding IS NOT NULL
           ORDER BY chunk_index LIMIT 3""", doc_id, page)
    if not src:
        return {"connections": []}
    seen, out = set(), []
    for s in src:
        rows = await conn.fetch(
            """SELECT dc.document_id, dc.page_number, dc.section_title, dc.content,
                      d.title AS doc_title, 1 - (dc.embedding <=> $1) AS score
               FROM document_chunks dc
               JOIN documents d ON d.id = dc.document_id
               WHERE d.user_id=$2 AND dc.document_id <> $3 AND dc.embedding IS NOT NULL
               ORDER BY dc.embedding <=> $1 LIMIT 5""",
            s["embedding"], user["id"], doc_id)
        for r in rows:
            score = float(r["score"])
            if score < 0.55:
                continue
            key = (str(r["document_id"]), r["page_number"])
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "document_id": str(r["document_id"]),
                "title": r["doc_title"],
                "page": r["page_number"],
                "section": r["section_title"],
                "excerpt": (r["content"] or "")[:220],
                "score": round(score, 3),
            })
    out.sort(key=lambda x: x["score"], reverse=True)
    return {"connections": out[:6]}


@router.get("/graph")
async def graph(conn=Depends(db), user=Depends(current_user)):
    nodes = await conn.fetch("SELECT id, label, mastery, document_id FROM concepts WHERE user_id=$1", user["id"])
    edges = await conn.fetch(
        """SELECT e.source_id, e.target_id, e.relation FROM concept_edges e
           JOIN concepts c ON c.id = e.source_id WHERE c.user_id=$1""", user["id"])
    return {"nodes": [dict(n) for n in nodes], "edges": [dict(e) for e in edges]}
