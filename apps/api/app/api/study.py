import json
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.deps import db, current_user
from app.core.errors import NotFound
from app.services.analysis_service import generate_study_items

router = APIRouter(tags=["study"])


class GenerateIn(BaseModel):
    type: str = "flashcard"   # flashcard | quiz | open_question
    count: int = 8


@router.post("/documents/{doc_id}/study/generate")
async def generate(doc_id: str, body: GenerateIn, conn=Depends(db), user=Depends(current_user)):
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not doc:
        raise NotFound("Belge bulunamadı.")
    rows = await conn.fetch(
        "SELECT content, page_number FROM document_chunks WHERE document_id=$1 ORDER BY chunk_index LIMIT 25", doc_id)
    context = "\n\n".join(r["content"] for r in rows)
    items = generate_study_items(context, body.type, body.count)
    created = []
    for it in items:
        sid = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO study_items (id, user_id, document_id, type, question, answer, options,
                                        source_page, difficulty, due_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
            sid, user["id"], doc_id, it.get("type", body.type), it.get("question"), it.get("answer"),
            it.get("options", []), it.get("source_page"), it.get("difficulty"),
            datetime.now(timezone.utc))
        created.append(sid)
    return {"created": len(created)}


@router.get("/study/items")
async def list_items(document_id: str | None = None, type: str | None = None,
                     conn=Depends(db), user=Depends(current_user)):
    sql = "SELECT * FROM study_items WHERE user_id=$1"
    args = [user["id"]]
    if document_id:
        args.append(document_id); sql += f" AND document_id=${len(args)}"
    if type:
        args.append(type); sql += f" AND type=${len(args)}"
    sql += " ORDER BY created_at DESC"
    rows = await conn.fetch(sql, *args)
    return [dict(r) for r in rows]


class ReviewIn(BaseModel):
    quality: int   # 0..5 (SM-2)


@router.post("/study/items/{item_id}/review")
async def review(item_id: str, body: ReviewIn, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT ease_factor, interval_days FROM study_items WHERE id=$1 AND user_id=$2",
                              item_id, user["id"])
    if not row:
        raise NotFound("Öğe bulunamadı.")
    ef = row["ease_factor"] or 2.5
    interval = row["interval_days"] or 0
    q = max(0, min(5, body.quality))
    # SM-2
    ef = max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
    if q < 3:
        interval = 1
        status = "learning"
    else:
        interval = 1 if interval == 0 else (6 if interval == 1 else round(interval * ef))
        status = "mastered" if interval >= 21 else "review"
    due = datetime.now(timezone.utc) + timedelta(days=interval)
    await conn.execute(
        "UPDATE study_items SET ease_factor=$1, interval_days=$2, review_status=$3, due_at=$4 WHERE id=$5",
        ef, interval, status, due, item_id)
    return {"ease_factor": round(ef, 2), "interval_days": interval, "review_status": status}
