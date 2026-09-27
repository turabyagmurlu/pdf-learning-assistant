"""Okuyucu notlari ve vurgulari (documents/{id}/notes, notes/{id}).

anchor JSON'u (sutun eklemeden):
  {type:"highlight", rects:[...], style:"highlight"|"underline", opacity:0.35|0.55|0.8}
  {type:"sticky", x, y}
Silme yumusaktir (deleted_at); 30 gun icinde POST /trash/note/{id}/restore ile geri gelir.

Biriktirme (TY PDF 2.0): ekleme/duzenleme/silme sonrasi services.accumulate kancalari belge ve
defter taslaklarini gunceller. Kanca hatasi not islemini bozmaz (yalniz log).
GET /notes/recent?limit=6 -> son vurgular (belge basligiyla; silinmis belge/not haric).
"""
import uuid
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.deps import db, current_user
from app.core.errors import NotFound
from app.services import accumulate

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
    own = await conn.fetchval("SELECT 1 FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
                              doc_id, user["id"])
    if not own:
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
    nid = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO notes (id, user_id, document_id, page_number, selected_text, note_content,
                              highlight_color, anchor, tags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
        nid, user["id"], doc_id, body.page_number, body.selected_text, body.note_content,
        body.highlight_color, body.anchor, body.tags)
    await accumulate.safe(accumulate.accumulate_note, conn, user["id"], nid)
    return {"id": nid}


@router.get("/notes/recent")
async def recent_notes(limit: int = 6, conn=Depends(db), user=Depends(current_user)):
    """Son biriken vurgular (en yeni once). Metni ve yorumu bos olan kenar notlari atlanir."""
    limit = max(1, min(int(limit or 6), 50))
    rows = await conn.fetch(
        """SELECT n.id, n.document_id, n.page_number, n.selected_text, n.note_content, n.highlight_color,
                  n.anchor, n.created_at, d.title
           FROM notes n JOIN documents d ON d.id = n.document_id
           WHERE n.user_id=$1 AND n.deleted_at IS NULL AND d.deleted_at IS NULL
             AND (COALESCE(btrim(n.selected_text),'') <> '' OR COALESCE(btrim(n.note_content),'') <> '')
           ORDER BY n.created_at DESC LIMIT $2""", user["id"], limit * 2)
    return recent_items(rows, limit)


def recent_items(rows, limit: int) -> list[dict]:
    out = []
    for r in rows:
        b = accumulate.build_quote_block(dict(r), r["title"], auto=False)
        if not b:
            continue
        out.append({"id": b["note_id"], "note_id": b["note_id"], "text": b["text"], "note": b.get("note"),
                    "color": b["color"], "style": b["style"], "page": b["page"],
                    "document_id": b["document_id"], "source": b["source"], "at": b["at"]})
        if len(out) >= limit:
            break
    return out


@router.get("/documents/{doc_id}/notes")
async def list_notes(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    rows = await conn.fetch(
        "SELECT * FROM notes WHERE document_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY page_number, created_at",
        doc_id, user["id"])
    return [dict(r) for r in rows]


class NotePatch(BaseModel):
    note_content: str | None = None
    highlight_color: str | None = None
    tags: list[str] | None = None
    # kalem paleti: stil (vurgu / alt cizgi) ve opaklik anchor icinde tasinir
    anchor: dict | None = None


@router.patch("/notes/{note_id}")
async def patch_note(note_id: str, body: NotePatch, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT id FROM notes WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
                              note_id, user["id"])
    if not row:
        raise NotFound("Not bulunamadı; silinmiş olabilir.")
    sets, vals, i = [], [], 1
    if body.note_content is not None:
        sets.append(f"note_content=${i}"); vals.append(body.note_content); i += 1
    if body.highlight_color is not None:
        sets.append(f"highlight_color=${i}"); vals.append(body.highlight_color); i += 1
    if body.tags is not None:
        sets.append(f"tags=${i}"); vals.append(body.tags); i += 1
    if body.anchor is not None:
        sets.append(f"anchor=${i}"); vals.append(body.anchor); i += 1
    if sets:
        vals.append(note_id)
        await conn.execute(f"UPDATE notes SET {', '.join(sets)} WHERE id=${i}", *vals)
        await accumulate.safe(accumulate.update_note_blocks, conn, user["id"], note_id)
    return {"ok": True}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, conn=Depends(db), user=Depends(current_user)):
    """Cop kutusuna tasir (yumusak silme). Geri al: POST /trash/note/{id}/restore."""
    r = await conn.execute("UPDATE notes SET deleted_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
                           note_id, user["id"])
    if str(r).endswith(" 1"):
        await accumulate.safe(accumulate.remove_note_blocks, conn, user["id"], note_id)
    return {"ok": True, "trashed": True, "restore": f"/trash/note/{note_id}/restore"}

# Kaldirilan uclar (TK-6, web cagirmiyor): GET /notes (eski Vurgular sayfasi), GET /notes/search.
