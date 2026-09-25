"""Okuyucu notlari ve vurgulari (documents/{id}/notes, notes/{id})."""
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

# Kaldirilan uclar (TK-6, web cagirmiyor): GET /notes (eski Vurgular sayfasi), GET /notes/search.
# PATCH /notes/{id} duruyor: okuyucu notu simdilik sil+yeniden olustur ile guncelliyor
# (hooks/useAnnotations.ts), ileride PATCH'e gecebilir.
