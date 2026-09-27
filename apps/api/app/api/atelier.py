"""Atolye (TY PDF 2.0): taslaklardaki alintilarla okuma ve calisma pratikleri. Yapay zeka HARCAMAZ.

- GET  /atelier/deck?scope=all|collection:<id>|document:<id>&mode=due|all&limit=40
       -> {items:[{key, kind, text, note, color, style, page, document_id, source, box, due, seen, ink?}], total, due}
       (el yazisi karti: style "ink", text "El yazısı notu", ink:{strokes, box})
- POST /atelier/review {key, result:"again"|"hard"|"good"|"easy"} -> {box, due}
- GET  /atelier/today  -> {due, new_available, reviewed_today, streak_days, week, recent, resume, scopes}
- GET  /atelier/counts -> {due_total, by_collection:{cid: n}}

Kart anahtari: `note:<note_id>` (vurgu) ya da `blk:<scope_kind>:<scope_id>:<block_id>`
(kullanicinin kendi paragrafi >= 40 karakter; note_id'siz alinti da bu bicimdedir).
Kart kaynagi: kapsamdaki taslak bloklari. `all` = butun defter + belge taslaklari (note_id'ye gore tekil).
Leitner: kutu 0..6, aralik gun [0,1,2,4,8,16,32]. again -> kutu 0, +10 dk; hard -> kutu ayni,
+max(1, aralik/2) gun; good -> kutu+1; easy -> kutu+2 (yeni kutunun araligi kadar gun).
Gunluk yeni kart siniri 15 (study_state.created_at yerel gune gore). Gun sinirlari Europe/Istanbul.
"""
from __future__ import annotations

import re
import uuid as _uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.drafts import parse_draft
from app.core.errors import AppError, NotFound
from app.deps import current_user, db

router = APIRouter(prefix="/atelier", tags=["atelier"])

LOCAL_TZ = ZoneInfo("Europe/Istanbul")
INTERVALS = [0, 1, 2, 4, 8, 16, 32]
MAX_BOX = len(INTERVALS) - 1
NEW_PER_DAY = 15
MIN_P_CHARS = 40
AGAIN_MINUTES = 10
RESULTS = ("again", "hard", "good", "easy")


# ---------------------------------------------------------------- saf fonksiyonlar (DB'siz)
def local_day(now: datetime) -> date:
    return now.astimezone(LOCAL_TZ).date()


def leitner(box: int | None, result: str, now: datetime) -> tuple[int, datetime]:
    """(yeni kutu, sonraki tekrar zamani)."""
    if result not in RESULTS:
        raise ValueError(result)
    b = max(0, min(MAX_BOX, int(box or 0)))
    if result == "again":
        return 0, now + timedelta(minutes=AGAIN_MINUTES)
    if result == "hard":
        return b, now + timedelta(days=max(1, INTERVALS[b] / 2))
    nb = min(MAX_BOX, b + (1 if result == "good" else 2))
    return nb, now + timedelta(days=max(1, INTERVALS[nb]))


def _txt(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


_DEHYPH = re.compile(r"([^\W\d_])- ([a-zçğıöşüâîû])")


def extract_cards(blocks: list[dict], scope_kind: str, scope_id: str, scope_title: str | None = None) -> list[dict]:
    """Taslak bloklarindan kartlar. quote: metni dolu; p: >= 40 karakter. Metni bos olanlar atlanir."""
    out: list[dict] = []
    for i, b in enumerate(blocks):
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        text = _txt(b.get("text"))
        note_txt = _txt(b.get("note"))
        # el yazisi notu: metin yok, darbeler kartta tasinir (Hatirla'da perde uygulanmaz)
        ink = b.get("ink") if t == "quote" and b.get("style") == "ink" and isinstance(b.get("ink"), dict) else None
        if not text and ink:
            text = "El yazısı notu"
        # kenar notu: alinti metni bos, yorumu dolu -> kartin metni yorumun kendisi
        elif not text and t == "quote" and note_txt:
            text, b = note_txt, {**b, "note": None, "style": b.get("style") or "sticky"}
        if not text:
            continue
        # PDF satir sonu tireleri: "pro- tein" -> "protein" (yalniz kucuk harfle devam ediyorsa)
        text = _DEHYPH.sub(r"\1\2", text)
        if t == "quote":
            nid = str(b.get("note_id") or "")
            key = f"note:{nid}" if nid else f"blk:{scope_kind}:{scope_id}:{b.get('id') or i}"
            page = b.get("page")
            out.append({"key": key, "kind": "quote", "text": text, "note": _txt(b.get("note")) or None,
                        "color": b.get("color") or None, "style": b.get("style") or "highlight",
                        "page": page if isinstance(page, int) else None,
                        "document_id": str(b.get("document_id") or "") or None,
                        "source": _txt(b.get("source")) or None,
                        "at": str(b.get("at") or ""), "note_id": nid or None, "order": i,
                        **({"ink": ink} if ink else {})})
        elif t == "p" and len(text) >= MIN_P_CHARS:
            out.append({"key": f"blk:{scope_kind}:{scope_id}:{b.get('id') or i}", "kind": "p", "text": text,
                        "note": None, "color": None, "style": None, "page": None,
                        "document_id": scope_id if scope_kind == "document" else None,
                        "source": scope_title, "at": "", "note_id": None, "order": i})
    return out


def dedupe(cards: list[dict]) -> list[dict]:
    """Ayni anahtar (note_id) ya da ayni belge+metin alintisi bir kez."""
    seen: set = set()
    out = []
    for c in cards:
        # el yazisi kartlarinin metni ayni ("El yazısı notu"): yalniz anahtarla tekillenir
        k2 = ("q", c.get("document_id"), c["text"].lower()) if c["kind"] == "quote" and not c.get("ink") else None
        if c["key"] in seen or (k2 and k2 in seen):
            continue
        seen.add(c["key"])
        if k2:
            seen.add(k2)
        out.append(c)
    return out


def _due_dt(st: dict | None) -> datetime | None:
    return st.get("due") if st else None


def split_due(cards: list[dict], states: dict[str, dict], now: datetime) -> tuple[list[dict], list[dict]]:
    """(vadesi gelmis gorulmus kartlar [eski once], hic gorulmemis kartlar [eski once])."""
    due, new = [], []
    for c in cards:
        st = states.get(c["key"])
        if st is None:
            new.append(c)
        else:
            d = _due_dt(st)
            if d is None or d <= now:
                due.append(c)
    due.sort(key=lambda c: (_due_dt(states.get(c["key"])) or datetime.min.replace(tzinfo=timezone.utc), c["order"]))
    new.sort(key=lambda c: (c.get("at") or "~", c["order"]))
    return due, new


def due_count(cards: list[dict], states: dict[str, dict], now: datetime, new_quota: int) -> int:
    d, n = split_due(cards, states, now)
    return len(d) + min(len(n), max(0, new_quota))


def select_deck(cards: list[dict], states: dict[str, dict], now: datetime, mode: str, new_quota: int,
                limit: int) -> list[dict]:
    if mode == "all":
        picked = list(cards)
    else:
        d, n = split_due(cards, states, now)
        picked = d + n[:max(0, new_quota)]
    return picked[:max(1, limit)]


def card_out(c: dict, st: dict | None) -> dict:
    due = _due_dt(st)
    return {"key": c["key"], "kind": c["kind"], "text": c["text"], "note": c["note"], "color": c["color"],
            "style": c["style"], "page": c["page"], "document_id": c["document_id"], "source": c["source"],
            "box": int(st["box"]) if st else 0, "due": due.isoformat() if due else None,
            "seen": int(st["seen"]) if st else 0, **({"ink": c["ink"]} if c.get("ink") else {})}


def streak_days(active_days: set[date], today: date) -> int:
    """Bugun ya da dun calisildiysa seri surer; geriye dogru kesintisiz gun sayisi."""
    if today in active_days:
        d = today
    elif today - timedelta(days=1) in active_days:
        d = today - timedelta(days=1)
    else:
        return 0
    n = 0
    while d in active_days:
        n += 1
        d -= timedelta(days=1)
    return n


def week_strip(counts: dict[date, int], today: date) -> list[dict]:
    """Son 7 gun (bugun dahil), eskiden yeniye."""
    return [{"day": (today - timedelta(days=k)).isoformat(), "count": int(counts.get(today - timedelta(days=k), 0))}
            for k in range(6, -1, -1)]


def parse_scope(scope: str | None) -> tuple[str, str | None]:
    s = (scope or "all").strip()
    if s == "all":
        return "all", None
    m = re.fullmatch(r"(collection|document):([0-9a-fA-F-]{32,36})", s)
    if not m:
        raise AppError("Çalışma kapsamı anlaşılamadı; Atölye'yi yeniden aç.")
    try:
        return m.group(1), str(_uuid.UUID(m.group(2)))
    except Exception:  # noqa
        raise AppError("Çalışma kapsamı anlaşılamadı; Atölye'yi yeniden aç.")


# ---------------------------------------------------------------- veri yukleme
async def _load_cards(conn, uid, kind: str, sid: str | None) -> tuple[list[dict], dict[str, list[dict]]]:
    """(kapsamdaki tekil kartlar, {collection_id: kartlar}) — ikinci sozluk yalniz kind=all icin dolu."""
    per_col: dict[str, list[dict]] = {}
    cards: list[dict] = []
    if kind in ("all", "collection"):
        q = ("SELECT id, title, draft FROM collections WHERE user_id=$1 AND deleted_at IS NULL"
             " AND draft IS NOT NULL")
        args: list = [uid]
        if kind == "collection":
            q += " AND id=$2::uuid"
            args.append(sid)
        q += " ORDER BY created_at"
        for r in await conn.fetch(q, *args):
            cs = extract_cards(parse_draft(r["draft"]), "collection", str(r["id"]), r["title"])
            per_col[str(r["id"])] = cs
            cards.extend(cs)
    if kind in ("all", "document"):
        q = ("SELECT id, title, draft FROM documents WHERE user_id=$1 AND deleted_at IS NULL"
             " AND draft IS NOT NULL")
        args = [uid]
        if kind == "document":
            q += " AND id=$2::uuid"
            args.append(sid)
        q += " ORDER BY created_at"
        for r in await conn.fetch(q, *args):
            cards.extend(extract_cards(parse_draft(r["draft"]), "document", str(r["id"]), r["title"]))
    # silinmis (copteki) vurgularin kartlari gosterilmez
    nids = list({c["note_id"] for c in cards if c.get("note_id")})
    if nids:
        alive = await _alive_notes(conn, uid, nids)
        cards = [c for c in cards if not c.get("note_id") or c["note_id"] in alive]
        for k in per_col:
            per_col[k] = dedupe([c for c in per_col[k] if not c.get("note_id") or c["note_id"] in alive])
    return dedupe(cards), per_col


async def _alive_notes(conn, uid, nids: list[str]) -> set[str]:
    ok = []
    for n in nids:
        try:
            ok.append(str(_uuid.UUID(n)))
        except Exception:  # noqa
            continue
    if not ok:
        return set()
    rows = await conn.fetch(
        """SELECT n.id FROM notes n JOIN documents d ON d.id = n.document_id
           WHERE n.user_id=$1 AND n.id = ANY($2::uuid[]) AND n.deleted_at IS NULL AND d.deleted_at IS NULL""",
        uid, ok)
    return {str(r["id"]) for r in rows}


async def _states(conn, uid, keys: list[str]) -> dict[str, dict]:
    if not keys:
        return {}
    rows = await conn.fetch("SELECT key, box, due, seen FROM study_state WHERE user_id=$1 AND key = ANY($2::text[])",
                            uid, keys)
    return {r["key"]: dict(r) for r in rows}


async def _new_quota(conn, uid, now: datetime) -> int:
    start = datetime.combine(local_day(now), datetime.min.time(), tzinfo=LOCAL_TZ)
    n = await conn.fetchval("SELECT COUNT(*) FROM study_state WHERE user_id=$1 AND created_at >= $2", uid, start)
    return max(0, NEW_PER_DAY - int(n or 0))


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- uclar
@router.get("/deck")
async def deck(scope: str = "all", mode: str = "due", limit: int = 40, conn=Depends(db), user=Depends(current_user)):
    kind, sid = parse_scope(scope)
    mode = "all" if mode == "all" else "due"
    limit = max(1, min(int(limit or 40), 200))
    uid = user["id"]
    if kind == "collection":
        if not await conn.fetchval("SELECT 1 FROM collections WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL", sid, uid):
            raise NotFound("Defter bulunamadı; silinmiş olabilir.")
    elif kind == "document":
        if not await conn.fetchval("SELECT 1 FROM documents WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL", sid, uid):
            raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
    now = _now()
    cards, _ = await _load_cards(conn, uid, kind, sid)
    states = await _states(conn, uid, [c["key"] for c in cards])
    quota = await _new_quota(conn, uid, now)
    picked = select_deck(cards, states, now, mode, quota, limit)
    return {"items": [card_out(c, states.get(c["key"])) for c in picked],
            "total": len(cards), "due": due_count(cards, states, now, quota)}


class ReviewIn(BaseModel):
    key: str
    result: str


async def _key_ok(conn, uid, key: str) -> bool:
    m = re.fullmatch(r"note:([0-9a-fA-F-]{32,36})", key)
    if m:
        return bool(await conn.fetchval(
            "SELECT 1 FROM notes WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL", m.group(1), uid))
    m = re.fullmatch(r"blk:(collection|document):([0-9a-fA-F-]{32,36}):([\w-]{1,64})", key)
    if m:
        table = "collections" if m.group(1) == "collection" else "documents"
        return bool(await conn.fetchval(
            f"SELECT 1 FROM {table} WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL", m.group(2), uid))
    return False


@router.post("/review")
async def review(body: ReviewIn, conn=Depends(db), user=Depends(current_user)):
    if body.result not in RESULTS:
        raise AppError("Bu cevap anlaşılamadı; kartı yeniden değerlendir.")
    key = (body.key or "").strip()[:200]
    uid = user["id"]
    try:
        ok = await _key_ok(conn, uid, key)
    except Exception:  # noqa - gecersiz uuid
        ok = False
    if not ok:
        raise NotFound("Bu kart artık yok; taslaktan kaldırılmış olabilir.")
    now = _now()
    today = local_day(now)
    known = 0 if body.result == "again" else 1
    async with conn.transaction():
        cur = await conn.fetchrow("SELECT box FROM study_state WHERE user_id=$1 AND key=$2 FOR UPDATE", uid, key)
        box, due = leitner(cur["box"] if cur else 0, body.result, now)
        await conn.execute(
            """INSERT INTO study_state (user_id, key, box, due, seen, last, updated_at, created_at)
               VALUES ($1, $2, $3, $4, 1, $5, now(), now())
               ON CONFLICT (user_id, key) DO UPDATE SET box=EXCLUDED.box, due=EXCLUDED.due,
                   seen=COALESCE(study_state.seen,0)+1, last=EXCLUDED.last, updated_at=now()""",
            uid, key, box, due, body.result)
        await conn.execute(
            """INSERT INTO study_log (user_id, day, count, known) VALUES ($1, $2, 1, $3)
               ON CONFLICT (user_id, day) DO UPDATE SET count=study_log.count+1, known=study_log.known+EXCLUDED.known""",
            uid, today, known)
    return {"box": box, "due": due.isoformat()}


async def _collection_counts(conn, uid, now: datetime) -> tuple[int, int, int, dict[str, int]]:
    """(due_total, yeni kart sayisi (tum), kota, {cid: due})."""
    cards, per_col = await _load_cards(conn, uid, "all", None)
    keys = list({c["key"] for cs in per_col.values() for c in cs} | {c["key"] for c in cards})
    states = await _states(conn, uid, keys)
    quota = await _new_quota(conn, uid, now)
    by_col = {cid: due_count(cs, states, now, quota) for cid, cs in per_col.items()}
    _, new = split_due(cards, states, now)
    return due_count(cards, states, now, quota), len(new), quota, by_col


@router.get("/counts")
async def counts(conn=Depends(db), user=Depends(current_user)):
    total, _, _, by_col = await _collection_counts(conn, user["id"], _now())
    return {"due_total": total, "by_collection": {k: v for k, v in by_col.items() if v > 0}}


@router.get("/today")
async def today(conn=Depends(db), user=Depends(current_user)):
    from app.api.notes import recent_items
    uid = user["id"]
    now = _now()
    tday = local_day(now)
    due_total, new_n, quota, by_col = await _collection_counts(conn, uid, now)
    logs = await conn.fetch("SELECT day, count FROM study_log WHERE user_id=$1 AND day >= $2 AND count > 0",
                            uid, tday - timedelta(days=400))
    counts_by_day = {r["day"]: int(r["count"]) for r in logs}
    rows = await conn.fetch(
        """SELECT n.id, n.document_id, n.page_number, n.selected_text, n.note_content, n.highlight_color,
                  n.anchor, n.created_at, d.title
           FROM notes n JOIN documents d ON d.id = n.document_id
           WHERE n.user_id=$1 AND n.deleted_at IS NULL AND d.deleted_at IS NULL
             AND (COALESCE(btrim(n.selected_text),'') <> '' OR COALESCE(btrim(n.note_content),'') <> '')
           ORDER BY n.created_at DESC LIMIT 12""", uid)
    recent = recent_items(rows, 6)
    r = await conn.fetchrow(
        """SELECT id, title, last_page, num_pages, progress_pct, reading_at FROM documents
           WHERE user_id=$1 AND deleted_at IS NULL AND reading_at IS NOT NULL
           ORDER BY reading_at DESC LIMIT 1""", uid)
    resume = None
    if r:
        resume = {"document_id": str(r["id"]), "title": r["title"], "page": r["last_page"],
                  "num_pages": r["num_pages"], "pct": r["progress_pct"],
                  "reading_at": r["reading_at"].isoformat() if r["reading_at"] else None}
    cols = await conn.fetch(
        """SELECT id, title, cover_color, cover_icon FROM collections
           WHERE user_id=$1 AND deleted_at IS NULL
           ORDER BY GREATEST(created_at, COALESCE(draft_at, created_at)) DESC""", uid)
    scopes = [{"kind": "collection", "id": str(c["id"]), "title": c["title"], "cover_color": c["cover_color"],
               "cover_icon": c["cover_icon"], "due": by_col.get(str(c["id"]), 0)} for c in cols]
    return {"due": due_total, "new_available": min(new_n, quota),
            "reviewed_today": counts_by_day.get(tday, 0),
            "streak_days": streak_days(set(counts_by_day), tday),
            "week": week_strip(counts_by_day, tday),
            "recent": recent, "resume": resume, "scopes": scopes}
