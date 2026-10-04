"""Çalışma notu uçları (SPEC-v3 "Çalışma notu", T5-ozet §3).

Belge:
- GET  /documents/{id}/study-note            : L0 + L1 (mevcut analizden, kota 0) + varsa L2 (doc_extracts kind='study_note') + plan (⚡ sayısı)
- POST /documents/{id}/study-note?force=     : L2 ders notunu üret (kısa belge ⚡1, uzun belge map+reduce ⚡2); text_md5 ile önbellek,
                                               aynı metinli başka belgeden kopya (kota 0); force=1 yeniler
- POST /documents/{id}/study-note/feedback   : "Kendi sözlerinle anlat" → ders notuna göre geri bildirim (⚡1)

Defter:
- GET  /collections/{cid}/study-note          : kaynak listesi (L0'lar) + varsa Sentez notu + plan (⚡1)
- POST /collections/{cid}/study-note?force=   : Sentez notu üret (kaynaklar arası ortak kavramlar, çelişkiler, tamamlayıcı noktalar); önbellek
- POST /collections/{cid}/study-note/feedback : sentez notuna göre geri bildirim (⚡1)

Kullanım sayacı: sağlayıcı (gemini_provider) her başarılı isteği kendisi kaydeder; burada ayrıca sayılmaz.
Önbellekten dönen cevaplarda `cached: true` ve hiçbir model çağrısı yok.
"""
import asyncio
import hashlib
import json
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.errors import AppError, NotFound
from app.deps import db, current_user
from app.services.analysis_service import (
    STUDY_NOTE_VERSION, build_sections, difficulty_tr, generate_study_note, note_to_markdown,
    reading_minutes, study_feedback, study_note_plan, synthesis_note,
)

router = APIRouter(tags=["study-notes"])

DOC_MISSING = "Kaynak bulunamadı; silinmiş olabilir. Kütüphaneye dön."
COL_MISSING = "Defter bulunamadı; silinmiş olabilir. Defterler sayfasına dön."
NOT_READY = "Bu kaynak henüz hazır değil; işlenmesi bitince ders notu hazırlanabilir."
NO_TEXT = "Bu kaynaktan metin çıkarılamadı; ders notu hazırlanamıyor."
NO_SOURCES = "Bu defterde hazır kaynak yok. Kaynak ekle ya da işlenmelerini bekle."
TOO_SHORT = "Biraz daha yaz: en az iki-üç cümleyle, kendi sözlerinle anlat; sonra geri bildirim alalım."

_schema_ready = False


async def ensure_study_schema(conn):
    """Idempotent: documents.learn_goals, collections.study_note/_hash/_at. İlk istekte bir kez çalışır."""
    global _schema_ready
    if _schema_ready:
        return
    try:
        await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS learn_goals jsonb")
        await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS study_note jsonb")
        await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS study_note_hash text")
        await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS study_note_at timestamptz")
        _schema_ready = True
    except Exception:  # noqa - bir sonraki istekte yeniden denenir
        pass


def _j(v):
    """jsonb değeri: codec varsa zaten Python nesnesi; metin geldiyse çöz."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:  # noqa
            return None
    return v


def _iso(v):
    return v.isoformat() if v is not None and hasattr(v, "isoformat") else None


def _hash(*parts: str) -> str:
    return hashlib.sha256("\x00".join(parts).encode("utf-8")).hexdigest()[:32]


# ------------------------------------------------------------------ belge

async def _doc(conn, doc_id: str, uid) -> dict:
    row = await conn.fetchrow(
        """SELECT id, title, status, source_type, media, text_md5, short_summary, detailed_summary, purpose,
                  difficulty_level, outline, key_concepts, difficult_concepts, learn_goals
           FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL""", doc_id, uid)
    if not row:
        raise NotFound(DOC_MISSING)
    return dict(row)


async def _chunks(conn, doc_id: str) -> list[dict]:
    rows = await conn.fetch(
        "SELECT page_number, section_title, content, token_count FROM document_chunks WHERE document_id=$1 ORDER BY chunk_index",
        doc_id)
    return [dict(r) for r in rows]


def _l1(d: dict, tokens: int) -> dict:
    goals = _j(d.get("learn_goals")) or []
    diff = _j(d.get("difficult_concepts")) or []
    return {
        "paragraph": d.get("detailed_summary"),
        "purpose": d.get("purpose"),
        "learn_goals": [str(g) for g in goals if str(g).strip()][:5],
        "reading_minutes": reading_minutes(tokens, _j(d.get("media")) if isinstance(_j(d.get("media")), dict) else None),
        "difficulty_level": d.get("difficulty_level"),
        "difficulty_tr": difficulty_tr(d.get("difficulty_level")),
        "difficult_concepts": [str(x) for x in diff if str(x).strip()][:6],
        "key_concepts": [k for k in (_j(d.get("key_concepts")) or []) if isinstance(k, dict)][:12],
        "outline": [o if isinstance(o, str) else (o or {}).get("title", "") for o in (_j(d.get("outline")) or [])],
    }


async def _cached_note(conn, doc_id: str):
    row = await conn.fetchrow(
        "SELECT payload, input_hash, created_at FROM doc_extracts WHERE document_id=$1 AND kind='study_note'", doc_id)
    if not row or row["payload"] is None:
        return None
    p = _j(row["payload"])
    return {"payload": p, "hash": row["input_hash"], "at": row["created_at"]} if isinstance(p, dict) else None


def _doc_hash(text_md5: str | None, chunks: list[dict]) -> str:
    base = text_md5 or hashlib.md5("\n".join((c.get("content") or "") for c in chunks).encode("utf-8")).hexdigest()
    return _hash(base, STUDY_NOTE_VERSION)


async def _doc_payload(conn, d: dict, chunks: list[dict]) -> dict:
    tokens = sum(int(c.get("token_count") or 0) for c in chunks)
    secs = build_sections(chunks)
    total = sum(s["chars"] for s in secs)
    plan = study_note_plan(total)
    plan.update({"sections": len(secs), "chars": total})
    h = _doc_hash(d.get("text_md5"), chunks)
    cached = await _cached_note(conn, str(d["id"]))
    media = _j(d.get("media"))
    return {
        "scope": "document",
        "id": str(d["id"]),
        "title": d["title"],
        "status": d["status"],
        "source_type": d.get("source_type") or "pdf",
        "media_sections": (media or {}).get("sections") if isinstance(media, dict) else None,
        "l0": d.get("short_summary"),
        "l1": _l1(d, tokens),
        "l2": cached["payload"] if cached else None,
        "l2_at": _iso(cached["at"]) if cached else None,
        "l2_stale": bool(cached and cached["hash"] != h),
        "plan": plan,
    }


@router.get("/documents/{doc_id}/study-note")
async def get_doc_study_note(doc_id: str, conn=Depends(db), user=Depends(current_user)):
    await ensure_study_schema(conn)
    d = await _doc(conn, doc_id, user["id"])
    chunks = await _chunks(conn, doc_id)
    out = await _doc_payload(conn, d, chunks)
    out["cached"] = True
    return out


@router.post("/documents/{doc_id}/study-note")
async def make_doc_study_note(doc_id: str, force: bool = False, conn=Depends(db), user=Depends(current_user)):
    await ensure_study_schema(conn)
    d = await _doc(conn, doc_id, user["id"])
    if d["status"] != "ready":
        raise AppError(NOT_READY)
    chunks = await _chunks(conn, doc_id)
    if not chunks:
        raise AppError(NO_TEXT)
    h = _doc_hash(d.get("text_md5"), chunks)
    cached = await _cached_note(conn, doc_id)
    if cached and cached["hash"] == h and not force:
        out = await _doc_payload(conn, d, chunks)
        out["cached"] = True
        return out
    note = None
    copied = False
    # Aynı metin başka bir belgede zaten notlandıysa kopyala (kota 0) — force'ta bile yeniden üretme gereksiz
    if d.get("text_md5") and not force:
        twin = await conn.fetchrow(
            """SELECT e.payload FROM doc_extracts e JOIN documents x ON x.id = e.document_id
               WHERE e.kind='study_note' AND e.input_hash=$1 AND e.document_id<>$2 AND x.text_md5=$3 AND e.payload IS NOT NULL
               LIMIT 1""", h, doc_id, d["text_md5"])
        if twin:
            p = _j(twin["payload"])
            if isinstance(p, dict) and p.get("sections"):
                note, copied = p, True
    if note is None:
        try:
            note = await asyncio.to_thread(generate_study_note, d["title"] or "Kaynak", chunks)
        except ValueError:
            raise AppError(NO_TEXT)
        except json.JSONDecodeError:
            raise AppError("Ders notu bu kez düzgün oluşmadı; bir daha dene.")
    await conn.execute(
        """INSERT INTO doc_extracts (document_id, kind, input_hash, payload, created_at)
           VALUES ($1,'study_note',$2,$3,now())
           ON CONFLICT (document_id, kind) DO UPDATE SET input_hash=EXCLUDED.input_hash, payload=EXCLUDED.payload, created_at=now()""",
        doc_id, h, note)
    out = await _doc_payload(conn, d, chunks)
    out["cached"] = copied
    out["copied"] = copied
    return out


class FeedbackIn(BaseModel):
    text: str


def _check_text(t: str) -> str:
    t = (t or "").strip()
    if len(re.findall(r"\S+", t)) < 20:
        raise AppError(TOO_SHORT)
    return t[:6000]


async def _doc_note_md(conn, d: dict, chunks: list[dict]) -> str:
    """Geri bildirim bağlamı: L2 varsa o; yoksa L1 + bölüm metinlerinden örnek (kota 0)."""
    cached = await _cached_note(conn, str(d["id"]))
    if cached:
        return note_to_markdown(cached["payload"], d["title"] or "")
    l1 = _l1(d, 0)
    parts = [f"# {d['title']}"]
    if d.get("short_summary"):
        parts.append(d["short_summary"])
    if l1["paragraph"]:
        parts.append(l1["paragraph"])
    if l1["learn_goals"]:
        parts.append("Öğrenme hedefleri:\n" + "\n".join(f"- {g}" for g in l1["learn_goals"]))
    if l1["key_concepts"]:
        parts.append("Kavramlar:\n" + "\n".join(f"- {k.get('term')}: {k.get('definition', '')}" for k in l1["key_concepts"]))
    secs = build_sections(chunks)
    if secs:
        per = max(1200, 20000 // len(secs))
        parts.append("\n\n".join(f"## {s['title']}\n{s['text'][:per]}" for s in secs))
    return "\n\n".join(parts)


@router.post("/documents/{doc_id}/study-note/feedback")
async def doc_feedback(doc_id: str, body: FeedbackIn, conn=Depends(db), user=Depends(current_user)):
    await ensure_study_schema(conn)
    text = _check_text(body.text)
    d = await _doc(conn, doc_id, user["id"])
    chunks = await _chunks(conn, doc_id)
    if not chunks and not d.get("detailed_summary"):
        raise AppError(NOT_READY)
    ctx = await _doc_note_md(conn, d, chunks)
    fb = await asyncio.to_thread(study_feedback, text, ctx, d["title"] or "Kaynak")
    return {"feedback_md": fb, "basis": "l2" if await _cached_note(conn, doc_id) else "l1"}


# ------------------------------------------------------------------ defter

async def _col(conn, cid: str, uid) -> dict:
    row = await conn.fetchrow(
        "SELECT id, title, study_note, study_note_hash, study_note_at FROM collections WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
        cid, uid)
    if not row:
        raise NotFound(COL_MISSING)
    return dict(row)


async def _col_sources(conn, cid: str, uid) -> list[dict]:
    rows = await conn.fetch(
        """SELECT d.id, d.title, d.status, d.text_md5, d.short_summary, d.detailed_summary, d.learn_goals, d.key_concepts,
                  e.payload AS note, e.created_at AS note_at
           FROM documents d JOIN document_collections l ON l.document_id = d.id
           LEFT JOIN doc_extracts e ON e.document_id = d.id AND e.kind='study_note'
           WHERE d.user_id=$1 AND l.collection_id=$2 AND d.deleted_at IS NULL
           ORDER BY l.added_at, d.id""", uid, cid)
    out = []
    for i, r in enumerate(rows, 1):
        note = _j(r["note"])
        out.append({
            "k": i, "document_id": str(r["id"]), "title": r["title"], "status": r["status"],
            "text_md5": r["text_md5"], "l0": r["short_summary"], "l1": r["detailed_summary"],
            "goals": [str(g) for g in (_j(r["learn_goals"]) or [])],
            "concepts": [k.get("term") for k in (_j(r["key_concepts"]) or []) if isinstance(k, dict) and k.get("term")],
            "note": note if isinstance(note, dict) else None, "note_at": _iso(r["note_at"]),
        })
    return out


def _col_hash(sources: list[dict]) -> str:
    parts = [f"{s['document_id']}|{s.get('text_md5') or ''}|{'n' if s.get('note') else '-'}|{s.get('note_at') or ''}"
             for s in sources if s["status"] == "ready"]
    return _hash(*sorted(parts), STUDY_NOTE_VERSION)


def _col_payload(col: dict, sources: list[dict]) -> dict:
    ready = [s for s in sources if s["status"] == "ready"]
    note = _j(col.get("study_note"))
    h = _col_hash(sources)
    return {
        "scope": "collection",
        "id": str(col["id"]),
        "title": col["title"],
        "sources": [{"k": s["k"], "document_id": s["document_id"], "title": s["title"], "status": s["status"],
                     "l0": s["l0"], "has_note": bool(s.get("note"))} for s in sources],
        "ready": len(ready),
        "l2": note if isinstance(note, dict) else None,
        "l2_at": _iso(col.get("study_note_at")),
        "l2_stale": bool(note and col.get("study_note_hash") != h),
        "plan": {"calls": 1, "mode": "single", "sections": len(ready)},
    }


@router.get("/collections/{cid}/study-note")
async def get_col_study_note(cid: str, conn=Depends(db), user=Depends(current_user)):
    await ensure_study_schema(conn)
    col = await _col(conn, cid, user["id"])
    sources = await _col_sources(conn, cid, user["id"])
    out = _col_payload(col, sources)
    out["cached"] = True
    return out


@router.post("/collections/{cid}/study-note")
async def make_col_study_note(cid: str, force: bool = False, conn=Depends(db), user=Depends(current_user)):
    await ensure_study_schema(conn)
    col = await _col(conn, cid, user["id"])
    sources = await _col_sources(conn, cid, user["id"])
    ready = [s for s in sources if s["status"] == "ready" and (s.get("l0") or s.get("l1") or s.get("note"))]
    if not ready:
        raise AppError(NO_SOURCES)
    h = _col_hash(sources)
    if not force and col.get("study_note") and col.get("study_note_hash") == h:
        out = _col_payload(col, sources)
        out["cached"] = True
        return out
    inp = [{"k": s["k"], "title": s["title"], "l0": s.get("l0"), "l1": s.get("l1"), "goals": s.get("goals"),
            "concepts": s.get("concepts"),
            "note_md": note_to_markdown(s["note"])[:12000] if s.get("note") else ""} for s in ready]
    try:
        note = await asyncio.to_thread(synthesis_note, col["title"] or "Defter", inp)
    except json.JSONDecodeError:
        raise AppError("Sentez notu bu kez düzgün oluşmadı; bir daha dene.")
    await conn.execute("UPDATE collections SET study_note=$2, study_note_hash=$3, study_note_at=now() WHERE id=$1",
                       cid, note, h)
    col = await _col(conn, cid, user["id"])
    out = _col_payload(col, sources)
    out["cached"] = False
    return out


def _synthesis_md(note: dict, title: str) -> str:
    out = [f"# {title}", note.get("overview_md") or "",
           "## Ortak kavramlar", note.get("common_md") or "",
           "## Çelişkiler", note.get("conflicts_md") or "",
           "## Tamamlayıcı noktalar", note.get("complementary_md") or ""]
    return "\n\n".join(x for x in out if x)


@router.post("/collections/{cid}/study-note/feedback")
async def col_feedback(cid: str, body: FeedbackIn, conn=Depends(db), user=Depends(current_user)):
    await ensure_study_schema(conn)
    text = _check_text(body.text)
    col = await _col(conn, cid, user["id"])
    sources = await _col_sources(conn, cid, user["id"])
    note = _j(col.get("study_note"))
    if isinstance(note, dict) and note.get("overview_md"):
        ctx = _synthesis_md(note, col["title"] or "Defter")
        basis = "synthesis"
    else:
        ready = [s for s in sources if s["status"] == "ready" and (s.get("l0") or s.get("l1"))]
        if not ready:
            raise AppError(NO_SOURCES)
        ctx = "\n\n".join(f"[K{s['k']}] {s['title']}\n{s.get('l0') or ''}\n{s.get('l1') or ''}" for s in ready)[:40000]
        basis = "l1"
    fb = await asyncio.to_thread(study_feedback, text, ctx, col["title"] or "Defter")
    return {"feedback_md": fb, "basis": basis}
