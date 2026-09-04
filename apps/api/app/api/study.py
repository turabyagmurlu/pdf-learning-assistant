import json
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from app.deps import db, current_user
from app.core.errors import NotFound, AppError
from app.services.analysis_service import generate_study_items, cards_from_text, explain_page
from app.services.tts_service import synthesize, FEMALE_VOICES, DEFAULT_VOICE

router = APIRouter(tags=["study"])


class GenerateIn(BaseModel):
    type: str = "flashcard"   # flashcard | quiz | open_question
    count: int = 8


def _sample_context(rows, max_chunks: int = 28) -> str:
    """Belgenin geneline yayilmis parca secer; kapak/ozet agirlikli ilk parcalari atlar."""
    rows = list(rows)
    n = len(rows)
    if n == 0:
        return ""
    # 8+ parcali belgelerde ilk %8 (kapak, kunye, ozet) atlanir
    skip = min(2, n // 12) if n >= 8 else 0
    pool = rows[skip:] if n - skip >= 3 else rows
    if len(pool) > max_chunks:
        step = len(pool) / max_chunks
        pool = [pool[int(i * step)] for i in range(max_chunks)]
    parts = []
    for r in pool:
        pg = r["page_number"]
        tag = f"[s.{pg}] " if pg else ""
        parts.append(tag + (r["content"] or ""))
    return "\n\n".join(parts)


@router.post("/documents/{doc_id}/study/generate")
async def generate(doc_id: str, body: GenerateIn, conn=Depends(db), user=Depends(current_user)):
    doc = await conn.fetchrow(
        "SELECT id, title, short_summary, key_concepts FROM documents WHERE id=$1 AND user_id=$2",
        doc_id, user["id"])
    if not doc:
        raise NotFound("Belge bulunamadı.")
    rows = await conn.fetch(
        "SELECT content, page_number FROM document_chunks WHERE document_id=$1 ORDER BY chunk_index", doc_id)
    context = _sample_context(rows)
    if not context.strip():
        raise AppError("Bu belgenin metni henüz çıkarılmamış. Belge 'Hazır' olunca tekrar dene.")
    existing_rows = await conn.fetch(
        "SELECT question FROM study_items WHERE document_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 60",
        doc_id, user["id"])
    existing = [r["question"] for r in existing_rows if r["question"]]
    kc = doc["key_concepts"]
    if isinstance(kc, str):
        try:
            kc = json.loads(kc)
        except Exception:
            kc = []
    kc_txt = ", ".join(str(k.get("term") if isinstance(k, dict) else k) for k in (kc or [])[:15])
    hint = f"Başlık: {doc['title']}\nÖzet: {doc['short_summary'] or ''}\nKavramlar: {kc_txt}"
    items = generate_study_items(context, body.type, max(1, min(20, body.count)), existing=existing, topic_hint=hint)
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


class FromTextIn(BaseModel):
    text: str
    page: int | None = None
    count: int = 2


@router.post("/documents/{doc_id}/study/from-text")
async def study_from_text(doc_id: str, body: FromTextIn, conn=Depends(db), user=Depends(current_user)):
    """PDF'te secilen metinden aninda flashcard uretir."""
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not doc:
        raise NotFound("Belge bulunamadı.")
    txt = (body.text or "").strip()
    if len(txt) < 15:
        raise AppError("Seçilen metin çok kısa. Biraz daha uzun bir bölüm seç.")
    items = cards_from_text(txt, max(1, min(5, body.count)))
    created = 0
    for it in items:
        sid = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO study_items (id, user_id, document_id, type, question, answer, options,
                                        source_page, difficulty, due_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
            sid, user["id"], doc_id, "flashcard", it.get("question"), it.get("answer"),
            [], body.page or it.get("source_page"), it.get("difficulty"),
            datetime.now(timezone.utc))
        created += 1
    return {"created": created}


class ExplainIn(BaseModel):
    text: str
    page: int | None = None


@router.post("/documents/{doc_id}/explain-page")
async def explain(doc_id: str, body: ExplainIn, conn=Depends(db), user=Depends(current_user)):
    """Acik olan sayfayi sade dille anlatir (sesli okumaya uygun)."""
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not doc:
        raise NotFound("Belge bulunamadı.")
    txt = (body.text or "").strip()
    if len(txt) < 40 and body.page:
        rows = await conn.fetch(
            "SELECT content FROM document_chunks WHERE document_id=$1 AND page_number=$2 ORDER BY chunk_index",
            doc_id, body.page)
        txt = "\n".join(r["content"] for r in rows).strip()
    if len(txt) < 40:
        raise AppError("Bu sayfada anlatılacak yeterli metin bulunamadı.")
    return {"explanation": explain_page(txt)}


class TtsIn(BaseModel):
    text: str
    voice: str | None = None
    style: str | None = None


@router.get("/tts/voices")
async def tts_voices(user=Depends(current_user)):
    """Kullanilabilir Turkce kadin sesleri."""
    return {"voices": [{"id": k, "label": v} for k, v in FEMALE_VOICES.items()],
            "default": DEFAULT_VOICE}


@router.post("/tts")
async def tts(body: TtsIn, user=Depends(current_user)):
    """Metni dogal kadin sesiyle seslendirir (WAV)."""
    txt = (body.text or "").strip()
    if len(txt) < 2:
        raise AppError("Seslendirilecek metin boş.")
    wav = synthesize(txt, body.voice or DEFAULT_VOICE, body.style or "")
    return Response(content=wav, media_type="audio/wav",
                    headers={"Cache-Control": "no-store"})


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


class ItemPatch(BaseModel):
    question: str | None = None
    answer: str | None = None


@router.patch("/study/items/{item_id}")
async def patch_item(item_id: str, body: ItemPatch, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT id FROM study_items WHERE id=$1 AND user_id=$2", item_id, user["id"])
    if not row:
        raise NotFound("Öğe bulunamadı.")
    if body.question is not None:
        q = body.question.strip()
        if len(q) < 3:
            raise AppError("Soru çok kısa.")
        await conn.execute("UPDATE study_items SET question=$1 WHERE id=$2", q, item_id)
    if body.answer is not None:
        await conn.execute("UPDATE study_items SET answer=$1 WHERE id=$2", body.answer.strip(), item_id)
    return {"ok": True}


@router.delete("/study/items/{item_id}")
async def delete_item(item_id: str, conn=Depends(db), user=Depends(current_user)):
    r = await conn.execute("DELETE FROM study_items WHERE id=$1 AND user_id=$2", item_id, user["id"])
    if r.endswith(" 0"):
        raise NotFound("Öğe bulunamadı.")
    return {"ok": True}


@router.delete("/study/items")
async def delete_items(document_id: str, type: str | None = None,
                       conn=Depends(db), user=Depends(current_user)):
    """Bir belgenin tum (ya da belli turdeki) kartlarini siler."""
    if type:
        r = await conn.execute("DELETE FROM study_items WHERE document_id=$1 AND user_id=$2 AND type=$3",
                               document_id, user["id"], type)
    else:
        r = await conn.execute("DELETE FROM study_items WHERE document_id=$1 AND user_id=$2",
                               document_id, user["id"])
    try:
        n = int(r.split()[-1])
    except Exception:
        n = 0
    return {"deleted": n}


class ItemCreate(BaseModel):
    document_id: str
    question: str
    answer: str
    type: str = "flashcard"
    source_page: int | None = None


@router.post("/study/items")
async def create_item(body: ItemCreate, conn=Depends(db), user=Depends(current_user)):
    """Elle kart olusturma (ve yanlis quiz sorusunu karta cevirme)."""
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", body.document_id, user["id"])
    if not doc:
        raise NotFound("Belge bulunamadı.")
    q, a = body.question.strip(), body.answer.strip()
    if len(q) < 3 or len(a) < 1:
        raise AppError("Soru ve cevap boş olamaz.")
    sid = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO study_items (id, user_id, document_id, type, question, answer, options,
                                    source_page, difficulty, due_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
        sid, user["id"], body.document_id, body.type if body.type in ("flashcard", "open_question") else "flashcard",
        q, a, [], body.source_page, "medium", datetime.now(timezone.utc))
    return {"id": sid}


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
