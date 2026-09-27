"""Belge taslagi (TY PDF 2.0 "Taslak her yerde"). Defter taslagiyla ayni blok bicimi
({"v":1,"blocks":[...]}; bkz. drafts.parse_draft / serialize_draft).

- GET   /documents/{id}/draft                    -> {draft, draft_rev, draft_at}
- PATCH /documents/{id}/draft  {draft, draft_rev?} -> {ok, draft_rev}
        draft_rev verilip eslesmezse 409: {ok:false, conflict:true, code:"DRAFT_CONFLICT", draft, draft_rev,
        error:{code, user_message}}  (istemci tazeleyip yerel degisikligi korur)
- POST  /documents/{id}/draft/blocks  {blocks}   -> {ok, added, block_ids, draft_rev}  (atomik, FOR UPDATE)
- POST  /documents/{id}/draft/import-highlights  -> {added, draft_rev}  (taslakta olmayan notlar, sayfa sirasiyla)
"""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.drafts import BlocksIn, check_blocks_in, clean_blocks
from app.core.errors import AppError, NotFound
from app.deps import current_user, db
from app.services import accumulate

router = APIRouter(tags=["doc-drafts"])

DOC_MISSING = "Kaynak bulunamadı; silinmiş olabilir. Kütüphaneye dön."
CONFLICT_MSG = "Taslak başka bir yerde değişti; en son hâli yüklendi, yazdıkların korunuyor."
MAX_DRAFT = 2_000_000


async def _own(conn, doc_id: str, uid) -> dict:
    try:
        row = await conn.fetchrow(
            "SELECT draft, COALESCE(draft_rev,0) AS draft_rev, draft_at FROM documents "
            "WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL", doc_id, uid)
    except Exception:  # noqa - gecersiz uuid
        row = None
    if not row:
        raise NotFound(DOC_MISSING)
    return dict(row)


@router.get("/documents/{doc_id}/draft")
async def get_doc_draft(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    row = await _own(conn, doc_id, user["id"])
    return {"draft": row["draft"], "draft_rev": int(row["draft_rev"]),
            "draft_at": row["draft_at"].isoformat() if row["draft_at"] else None}


class DocDraftIn(BaseModel):
    draft: str
    draft_rev: int | None = None


def conflict_response(draft: str | None, rev: int) -> JSONResponse:
    return JSONResponse(status_code=409, content={
        "ok": False, "conflict": True, "code": "DRAFT_CONFLICT", "draft": draft, "draft_rev": int(rev),
        "error": {"code": "DRAFT_CONFLICT", "user_message": CONFLICT_MSG}})


@router.patch("/documents/{doc_id}/draft")
async def patch_doc_draft(doc_id: str, body: DocDraftIn, conn=Depends(db), user=Depends(current_user)):
    await _own(conn, doc_id, user["id"])
    if len(body.draft) > MAX_DRAFT:
        raise AppError("Taslak çok uzun; bir kısmını deftere taşı ya da böl.")
    if body.draft_rev is None:
        rev = await conn.fetchval(
            "UPDATE documents SET draft=$1, draft_at=now(), draft_rev=COALESCE(draft_rev,0)+1 "
            "WHERE id=$2::uuid AND user_id=$3 AND deleted_at IS NULL RETURNING draft_rev",
            body.draft, doc_id, user["id"])
        return {"ok": True, "draft_rev": int(rev or 0)}
    rev = await conn.fetchval(
        "UPDATE documents SET draft=$1, draft_at=now(), draft_rev=COALESCE(draft_rev,0)+1 "
        "WHERE id=$2::uuid AND user_id=$3 AND deleted_at IS NULL AND COALESCE(draft_rev,0)=$4 RETURNING draft_rev",
        body.draft, doc_id, user["id"], int(body.draft_rev))
    if rev is None:
        cur = await _own(conn, doc_id, user["id"])
        return conflict_response(cur["draft"], cur["draft_rev"])
    return {"ok": True, "draft_rev": int(rev)}


@router.post("/documents/{doc_id}/draft/blocks")
async def append_doc_blocks(doc_id: str, body: BlocksIn, conn=Depends(db), user=Depends(current_user)):
    """Bloklari belge taslaginin sonuna ekler (defter ucuyla ayni temizlik; ayni note_id tekrar eklenmez)."""
    await _own(conn, doc_id, user["id"])
    check_blocks_in(body.blocks)
    clean = await clean_blocks(conn, user["id"], body.blocks)
    if not clean:
        raise AppError("Bu metin taslağa eklenemedi; kaynağı yenileyip tekrar dene.")
    added_ids: list[str] = []

    def fn(bl):
        out, k = accumulate.append_unique(bl, clean)
        fresh = {str(b["id"]) for b in clean}
        added_ids[:] = [str(x["id"]) for x in out if str(x.get("id")) in fresh]
        return out, k
    rev, n = await accumulate.mutate_draft(conn, "documents", doc_id, user["id"], fn)
    if n < 0:
        raise NotFound(DOC_MISSING)
    if rev is None:
        rev = (await _own(conn, doc_id, user["id"]))["draft_rev"]
    return {"ok": True, "added": max(0, n), "block_ids": added_ids, "draft_rev": int(rev)}


@router.post("/documents/{doc_id}/draft/import-highlights")
async def import_doc_highlights(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    """Belgedeki, taslakta olmayan (note_id'ye gore) butun vurgu ve notlari sayfa sirasiyla ekler."""
    await _own(conn, doc_id, user["id"])
    rev, n = await accumulate.import_highlights(conn, user["id"], "documents", doc_id, [doc_id])
    if n < 0:
        raise NotFound(DOC_MISSING)
    if rev is None:
        rev = (await _own(conn, doc_id, user["id"]))["draft_rev"]
    return {"added": max(0, n), "draft_rev": int(rev)}
