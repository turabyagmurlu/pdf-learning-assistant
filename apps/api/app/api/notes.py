import uuid
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.deps import db, current_user
from app.core.errors import NotFound

router = APIRouter(tags=["notes"])


class NoteIn(BaseModel):
    page_number: int | None = None
    selected_text: str | None = None
    note_content: str
    highlight_color: str | None = None
    anchor: dict | None = None
    tags: list[str] = []


@router.post("/documents/{doc_id}/notes")
async def add_note(doc_id: str, body: NoteIn, conn=Depends(db), user=Depends(current_user)):
    own = await conn.fetchval("SELECT 1 FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not own:
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
    nid = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO notes (id, user_id, document_id, page_number, selected_text, note_content,
                              highlight_color, anchor, tags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
        nid, user["id"], doc_id, body.page_number, body.selected_text, body.note_content,
        body.highlight_color, body.anchor, body.tags)
    return {"id": nid}


@router.get("/documents/{doc_id}/notes")
async def list_notes(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    rows = await conn.fetch(
        "SELECT * FROM notes WHERE document_id=$1 AND user_id=$2 ORDER BY page_number, created_at",
        doc_id, user["id"])
    return [dict(r) for r in rows]


@router.get("/notes")
async def list_all_notes(conn=Depends(db), user=Depends(current_user)):
    """Kullanicinin tum vurgu ve notlari, belge basligiyla (Vurgular sayfasi)."""
    rows = await conn.fetch(
        """SELECT n.id, n.document_id, n.page_number, n.selected_text, n.note_content,
                  n.highlight_color, n.anchor, n.tags, n.created_at,
                  d.title AS document_title,
                  COALESCE((SELECT array_agg(l.collection_id::text ORDER BY l.added_at, l.collection_id)
                            FROM document_collections l WHERE l.document_id = d.id), ARRAY[]::text[]) AS collection_ids
           FROM notes n JOIN documents d ON d.id = n.document_id
           WHERE n.user_id=$1
           ORDER BY d.title, n.page_number NULLS LAST, n.created_at""",
        user["id"])
    out = []
    for r in rows:
        d = dict(r)
        d["collection_ids"] = list(d.get("collection_ids") or [])
        d["collection_id"] = d["collection_ids"][0] if d["collection_ids"] else None   # geriye uyum
        out.append(d)
    return out


class NotePatch(BaseModel):
    note_content: str | None = None
    highlight_color: str | None = None
    tags: list[str] | None = None


@router.patch("/notes/{note_id}")
async def patch_note(note_id: str, body: NotePatch, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT id FROM notes WHERE id=$1 AND user_id=$2", note_id, user["id"])
    if not row:
        raise NotFound("Not bulunamadı; silinmiş olabilir.")
    sets, vals, i = [], [], 1
    if body.note_content is not None:
        sets.append(f"note_content=${i}"); vals.append(body.note_content); i += 1
    if body.highlight_color is not None:
        sets.append(f"highlight_color=${i}"); vals.append(body.highlight_color); i += 1
    if body.tags is not None:
        sets.append(f"tags=${i}"); vals.append(body.tags); i += 1
    if sets:
        vals.append(note_id)
        await conn.execute(f"UPDATE notes SET {', '.join(sets)} WHERE id=${i}", *vals)
    return {"ok": True}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, conn=Depends(db), user=Depends(current_user)):
    await conn.execute("DELETE FROM notes WHERE id=$1 AND user_id=$2", note_id, user["id"])
    return {"ok": True}


@router.get("/notes/search")
async def search_notes(q: str, conn=Depends(db), user=Depends(current_user)):
    rows = await conn.fetch(
        "SELECT * FROM notes WHERE user_id=$1 AND note_content ILIKE $2 ORDER BY created_at DESC",
        user["id"], f"%{q}%")
    return [dict(r) for r in rows]
