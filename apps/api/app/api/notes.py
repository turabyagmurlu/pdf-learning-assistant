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
