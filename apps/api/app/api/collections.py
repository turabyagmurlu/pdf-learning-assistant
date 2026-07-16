import uuid
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.deps import db, current_user
from app.services import rag_service
from app.ai.factory import get_embeddings

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


@router.get("/graph")
async def graph(conn=Depends(db), user=Depends(current_user)):
    nodes = await conn.fetch("SELECT id, label, mastery, document_id FROM concepts WHERE user_id=$1", user["id"])
    edges = await conn.fetch(
        """SELECT e.source_id, e.target_id, e.relation FROM concept_edges e
           JOIN concepts c ON c.id = e.source_id WHERE c.user_id=$1""", user["id"])
    return {"nodes": [dict(n) for n in nodes], "edges": [dict(e) for e in edges]}
