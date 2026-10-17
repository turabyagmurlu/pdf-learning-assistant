"""Sesli ozet uclari (defter -> podcast metni -> parcali seslendirme).

- GET  /collections/{cid}/lecture/options    : sure secenekleri (kisa/standart/derin), ⚡ maliyeti, hangi surum onbellekte
- POST /collections/{cid}/lecture            : metni tek seferde (eski yol; format=solo|dialog, length=kisa|standart|derin)
- POST /collections/{cid}/lecture/stream     : metni AKISLA (SSE: meta / plan / token / chapter / note / done / error)
- POST /collections/{cid}/lecture/tts        : parcali seslendirme isi baslatir (head = on parca)
- GET  /lecture/voices                       : anlatici (kadin) + ogrenci (erkek) sesleri
Parca durumu ve sesleri: study.py -> GET /tts/jobs/{id}/chunks, GET /tts/jobs/{id}/chunks/{n}

P2 (podcast kalitesi):
- Girdi DENGELI: defterdeki her hazir kaynaktan L0/L1 + ogrenme hedefleri + bolum basliklari + (varsa) L2 ders notu
  + bas-orta-son temsili parcalar; toplam ~40K karakter, kaynak basina butce su-doldurma ile (tek kaynaga yigilma yok).
- Metin `## Bölüm` isaretli; `chapters: [{title, char_start, chunk, offset}]` meta (onbellekte) ve done olayinda.
- Sure: length = kisa (~5 dk) | standart (~12 dk, varsayilan) | derin (~25 dk; plan + iki yazim adimi).
- Onbellek: collections.lecture_variants[format|length|surum]; `lecture` sutunu son metni tutar (geriye uyum).
- Parametreler sorgu dizisinden ya da JSON govdeden gelebilir (govde onceliklidir).
"""
import asyncio
import hashlib
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.ai import usage
from app.ai.factory import get_llm
from app.config import settings
from app.core.errors import AppError, NotFound
from app.db.session import get_pool
from app.deps import db, current_user
from app.services import tts_jobs
from app.services.analysis_service import (
    LECTURE_LENGTHS, LECTURE_PROMPT_VERSION, build_lecture_context, lecture_cost, lecture_options,
    lecture_part_prompt, lecture_plan, lecture_prompt, lecture_script, normalize_length, tidy_script, warm_kwargs,
)
from app.services.tts_service import FEMALE_VOICES, DEFAULT_VOICE, MALE_VOICES, DEFAULT_MALE_VOICE
from app.api.study import samples_ready

router = APIRouter(tags=["lecture"])

COL_MISSING = "Defter bulunamadı; silinmiş olabilir. Defterler sayfasına dön."
NO_READY = "Bu defterde henüz hazır kaynak yok. Kaynak ekle ya da işlenmelerini bekle."
TOO_SHORT = "Sesli özet için yeterli içerik yok; deftere biraz daha kaynak ekle."
FAILED = "Sesli özet hazırlanamadı; birazdan tekrar dene."

_SCHEMA_OK = False


def _fmt(fmt: str | None) -> bool:
    """format=dialog -> True (sohbet), digerleri tek anlatici."""
    return (fmt or "").strip().lower() in ("dialog", "sohbet", "podcast")


def _j(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:  # noqa
            return None
    return v


async def _ensure_schema(conn):
    """Idempotent: collections.lecture_variants (format|length|surum -> metin). documents.learn_goals (study_notes)."""
    global _SCHEMA_OK
    if _SCHEMA_OK:
        return
    try:
        await conn.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS lecture_variants jsonb")
        await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS learn_goals jsonb")
        await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS lecture_variants jsonb")
        _SCHEMA_OK = True
    except Exception:  # noqa - bir sonraki istekte yeniden denenir
        pass


DOC_MISSING = "Kaynak bulunamadı; silinmiş olabilir."
DOC_NOT_READY = "Bu kaynak henüz hazırlanıyor; işlenince sesli özetini dinleyebilirsin."


async def _col(conn, cid: str, uid, doc: bool = False) -> dict:
    await _ensure_schema(conn)
    if doc:
        # Tek kaynak: ayni akis, kaynak satirindan (varyantlar documents.lecture_variants'ta)
        try:
            row = await conn.fetchrow(
                "SELECT id, title, NULL::text AS lecture, NULL::timestamptz AS lecture_at, lecture_variants "
                "FROM documents WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", cid, uid)
        except Exception:  # noqa
            row = await conn.fetchrow(
                "SELECT id, title, NULL::text AS lecture, NULL::timestamptz AS lecture_at, NULL::jsonb AS lecture_variants "
                "FROM documents WHERE id=$1 AND user_id=$2", cid, uid)
        if not row:
            raise NotFound(DOC_MISSING)
        out = dict(row)
        out["title"] = out.get("title") or "Kaynak"
        v = _j(out.get("lecture_variants"))
        out["lecture_variants"] = v if isinstance(v, dict) else {}
        return out
    try:
        col = await conn.fetchrow(
            "SELECT id, title, lecture, lecture_at, lecture_variants FROM collections WHERE id=$1 AND user_id=$2",
            cid, uid)
    except Exception:  # noqa - sutun henuz yoksa eski sorgu
        col = await conn.fetchrow("SELECT id, title, lecture, lecture_at FROM collections WHERE id=$1 AND user_id=$2",
                                  cid, uid)
    if not col:
        raise NotFound(COL_MISSING)
    out = dict(col)
    v = _j(out.get("lecture_variants"))
    out["lecture_variants"] = v if isinstance(v, dict) else {}
    return out


async def _ready_count(conn, cid: str, uid, doc: bool = False) -> int:
    if doc:
        return await conn.fetchval("SELECT count(*) FROM documents WHERE id=$1 AND user_id=$2 AND status='ready'", cid, uid)
    return await conn.fetchval(
        "SELECT count(*) FROM documents d JOIN document_collections l ON l.document_id = d.id "
        "WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'", uid, cid)


async def _source_rows(conn, cid: str, uid, doc: bool = False) -> list:
    """Hazir kaynaklar (eklenme sirasi) + varsa L2 ders notu. Eski semada (learn_goals/deleted_at yok) dar sorguya duser.
    doc=True: yalniz o kaynak."""
    if doc:
        return await conn.fetch(
            """SELECT d.id, d.title, d.text_md5, d.short_summary, d.detailed_summary, d.learn_goals, d.outline,
                      d.key_concepts, e.payload AS note
               FROM documents d LEFT JOIN doc_extracts e ON e.document_id = d.id AND e.kind='study_note'
               WHERE d.user_id=$1 AND d.id=$2 AND d.status='ready' AND d.deleted_at IS NULL""", uid, cid)
    try:
        return await conn.fetch(
            """SELECT d.id, d.title, d.text_md5, d.short_summary, d.detailed_summary, d.learn_goals, d.outline,
                      d.key_concepts, e.payload AS note
               FROM documents d JOIN document_collections l ON l.document_id = d.id
               LEFT JOIN doc_extracts e ON e.document_id = d.id AND e.kind='study_note'
               WHERE d.user_id=$1 AND l.collection_id=$2 AND d.status='ready' AND d.deleted_at IS NULL
               ORDER BY l.added_at, d.id""", uid, cid)
    except Exception:  # noqa
        return await conn.fetch(
            """SELECT d.id, d.title, NULL AS text_md5, d.short_summary, NULL AS detailed_summary, NULL AS learn_goals,
                      NULL AS outline, NULL AS key_concepts, NULL AS note
               FROM documents d JOIN document_collections l ON l.document_id = d.id
               WHERE d.user_id=$1 AND l.collection_id=$2 AND d.status='ready' ORDER BY d.id""", uid, cid)


async def _sources(conn, cid: str, uid, doc: bool = False) -> tuple[list[dict], str]:
    """Kaynak basina malzeme (L0, L1, hedefler, bolum basliklari, kavramlar, L2 bolumleri, bas-orta-son parcalar).
    Donus: (kaynaklar, kaynak_ozeti_hash) — hash, onbellekteki metnin bayatladigini anlamak icin."""
    docs = await _source_rows(conn, cid, uid, doc)
    if not docs:
        raise AppError(DOC_NOT_READY if doc else NO_READY)
    ids = [str(d["id"]) for d in docs]
    per_doc = max(6, min(24, 400 // max(1, len(ids))))     # SQL tarafinda bas-orta-son on ornekleme
    rows = await conn.fetch(
        """SELECT document_id, chunk_index, section_title, content, n FROM (
               SELECT document_id, chunk_index, section_title, content,
                      row_number() OVER (PARTITION BY document_id ORDER BY chunk_index) AS rn,
                      count(*) OVER (PARTITION BY document_id) AS n
               FROM document_chunks WHERE document_id = ANY($1::uuid[])) t
           WHERE n <= $2 OR rn = n OR (rn - 1) % GREATEST(1, n / $2) = 0
           ORDER BY document_id, chunk_index""", ids, per_doc)
    chunks: dict[str, list[dict]] = {}
    totals: dict[str, int] = {}
    sections: dict[str, list[str]] = {}
    for r in rows:
        k = str(r["document_id"])
        chunks.setdefault(k, []).append({"i": r["chunk_index"], "section": r["section_title"] or "",
                                         "text": r["content"] or ""})
        totals[k] = int(r["n"] or 0)
        st = (r["section_title"] or "").strip()
        if st and st not in sections.setdefault(k, []):
            sections[k].append(st)
    out = []
    for i, d in enumerate(docs, 1):
        k = str(d["id"])
        note = _j(d["note"])
        note_secs = []
        if isinstance(note, dict):
            note_secs = [(s.get("title") or "", s.get("body_md") or "") for s in (note.get("sections") or [])
                         if isinstance(s, dict)]
        outline = [o if isinstance(o, str) else (o or {}).get("title", "") for o in (_j(d["outline"]) or [])]
        out.append({
            "k": i, "document_id": k, "title": d["title"] or "Adsız kaynak",
            "l0": d["short_summary"], "l1": d["detailed_summary"],
            "goals": [str(g) for g in (_j(d["learn_goals"]) or []) if str(g).strip()],
            "outline": [o for o in outline if o] or sections.get(k, [])[:14],
            "concepts": [c.get("term") for c in (_j(d["key_concepts"]) or []) if isinstance(c, dict) and c.get("term")],
            "note_sections": note_secs,
            "chunks": chunks.get(k, []), "total_chunks": totals.get(k, 0),
        })
    return out, _rows_hash(docs)


def _rows_hash(docs) -> str:
    sig = []
    for d in docs:
        note = _j(d["note"])
        has = isinstance(note, dict) and bool(note.get("sections"))
        sig.append(f"{d['id']}|{d['text_md5'] or ''}|{'n' if has else '-'}")
    return hashlib.sha256("\x00".join(sorted(sig)).encode("utf-8")).hexdigest()[:16]


async def _current_hash(conn, cid: str, uid, doc: bool = False) -> str | None:
    """Onbellekteki metnin bayatligini anlamak icin kaynak imzasi (kota 0, tek hafif sorgu)."""
    try:
        docs = await _source_rows(conn, cid, uid, doc)
        return _rows_hash(docs) if docs else None
    except Exception:  # noqa
        return None


async def _context(conn, cid: str, uid, doc: bool = False) -> tuple[str, list[dict], str]:
    sources, h = await _sources(conn, cid, uid, doc)
    context, _alloc = build_lecture_context(sources)
    if len(context) < 200:
        raise AppError(TOO_SHORT)
    return context, sources, h


def _chapters(script: str, dialog: bool) -> list[dict]:
    """Bolumler (kota 0): `## ` isaretlerinden [{title, char_start, chunk, offset}].
    Isaretsiz (eski) metinde paragraf/replik bazli eski bolumler; char_start = offset (tek parca varsayimi)."""
    marks = tts_jobs.chapter_marks(script)
    if marks:
        return [{"title": m["title"], "char_start": m["char_start"], "chunk": 0, "offset": m["char_start"]}
                for m in marks]
    return [dict(c, char_start=c.get("offset", 0)) for c in tts_jobs.chapters_for([script], dialog)]


def _vkey(dialog: bool, length: str) -> str:
    return f"{'dialog' if dialog else 'solo'}|{length}|{LECTURE_PROMPT_VERSION}"


def _words(script: str) -> int:
    return len(tts_jobs.strip_chapter_marks(script).replace("Ayşe:", "").replace("Kerem:", "").split())


def _cached(col: dict, dialog: bool, length: str, length_given: bool) -> dict | None:
    """Onbellekteki surum: once format|length|surum anahtari; length verilmemisse (eski istemci) eski tek metin."""
    v = col["lecture_variants"].get(_vkey(dialog, length))
    if isinstance(v, dict) and (v.get("script") or "").strip():
        return {"script": v["script"], "at": v.get("at"), "hash": v.get("hash"), "legacy": False}
    txt = (col.get("lecture") or "").strip()
    if not length_given and txt and tts_jobs.is_dialog(txt) == dialog:
        at = col.get("lecture_at")
        return {"script": txt, "at": at.isoformat() if at else None, "hash": None, "legacy": True}
    return None


async def _store(conn, cid: str, dialog: bool, length: str, script: str, h: str, cost: int, doc: bool = False):
    from datetime import datetime, timezone
    at = datetime.now(timezone.utc).isoformat()
    entry = {"script": script, "at": at, "hash": h, "cost": cost, "words": _words(script)}
    if doc:
        await conn.execute(
            "UPDATE documents SET lecture_variants = COALESCE(lecture_variants, '{}'::jsonb) || $2::jsonb WHERE id=$1",
            cid, {_vkey(dialog, length): entry})
        return
    try:
        await conn.execute(
            "UPDATE collections SET lecture=$1, lecture_at=now(), "
            "lecture_variants = COALESCE(lecture_variants, '{}'::jsonb) || $3::jsonb WHERE id=$2",
            script, cid, {_vkey(dialog, length): entry})
    except Exception:  # noqa - varyant sutunu yoksa en azindan eski sutun
        await conn.execute("UPDATE collections SET lecture=$1, lecture_at=now() WHERE id=$2", script, cid)


def _meta_common(dialog: bool, length: str) -> dict:
    spec = LECTURE_LENGTHS[length]
    return {"format": "dialog" if dialog else "solo", "length": length, "minutes": spec["minutes"],
            "target_words": spec["words"], "version": LECTURE_PROMPT_VERSION}


def _cached_payload(c: dict, dialog: bool, length: str, cur_hash: str | None) -> dict:
    return {**_meta_common(dialog, length), "script": c["script"], "cached": True, "cost": 0,
            "chapters": _chapters(c["script"], dialog), "words": _words(c["script"]), "at": c["at"],
            "outdated": c["legacy"],                      # eski istemle yazilmis metin (bolum isareti yok)
            "stale": bool(cur_hash and c.get("hash") and c["hash"] != cur_hash)}   # kaynaklar degismis


class LectureIn(BaseModel):
    length: str | None = None       # kisa | standart | derin (varsayilan standart)
    format: str | None = None       # solo | dialog
    refresh: bool | None = None


def _params(body: LectureIn | None, format: str | None, length: str | None, refresh: bool):
    fmt = (body.format if body and body.format else format)
    ln = (body.length if body and body.length else length)
    rf = bool(body.refresh) if body and body.refresh is not None else refresh
    return _fmt(fmt), normalize_length(ln), ln is not None and str(ln).strip() != "", rf


@router.get("/collections/{cid}/lecture/options")
async def lecture_opts(cid: str, conn=Depends(db), user=Depends(current_user), _doc: bool = False):
    """Sure secenekleri ve ⚡ maliyeti; onbellekte hazir olan surumler icin maliyet 0 (format bazinda)."""
    col = await _col(conn, cid, user["id"], _doc)
    out = []
    for o in lecture_options():
        cached = {f: bool((col["lecture_variants"].get(_vkey(f == "dialog", o["id"])) or {}).get("script"))
                  for f in ("solo", "dialog")}
        out.append({**o, "cached": cached})
    return {"lengths": out, "default": "standart", "version": LECTURE_PROMPT_VERSION,
            "documents": await _ready_count(conn, cid, user["id"], _doc)}


@router.post("/collections/{cid}/lecture")
async def lecture(cid: str, body: LectureIn | None = None, refresh: bool = False, format: str | None = None,
                  length: str | None = None, conn=Depends(db), user=Depends(current_user)):
    """Sesli ozet metni (tek seferde). Kaydedilir; ayni bicim+sure+surumdeki metin yeniden yazilmaz."""
    dialog, length, given, refresh = _params(body, format, length, refresh)
    col = await _col(conn, cid, user["id"])
    if not refresh:
        c = _cached(col, dialog, length, given)
        if c:
            n = await _ready_count(conn, cid, user["id"])
            cur = await _current_hash(conn, cid, user["id"])
            return {**_cached_payload(c, dialog, length, cur), "title": col["title"], "documents": n}
    context, sources, h = await _context(conn, cid, user["id"])
    script = await asyncio.to_thread(lecture_script, context, col["title"], dialog, length, sources)
    cost = lecture_cost(length)
    await _store(conn, cid, dialog, length, script, h, cost)
    return {**_meta_common(dialog, length), "script": script, "title": col["title"], "documents": len(sources),
            "cached": False, "cost": cost, "chapters": _chapters(script, dialog), "words": _words(script),
            "outdated": False, "stale": False}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


class _ChapterScanner:
    """Akan metinde tamamlanan `## ` satirlarini bulur (canli `chapter` olayi; konum ham akisa goredir)."""

    def __init__(self):
        self.pos = 0

    def feed(self, full: str) -> list[dict]:
        found = []
        while True:
            nl = full.find("\n", self.pos)
            if nl < 0:
                return found
            line = full[self.pos:nl]
            for m in tts_jobs.chapter_marks(line):
                found.append({"title": m["title"], "char_start": self.pos})
            self.pos = nl + 1


@router.post("/collections/{cid}/lecture/stream")
async def lecture_stream(cid: str, body: LectureIn | None = None, refresh: bool = False, format: str | None = None,
                         length: str | None = None, user=Depends(current_user), _doc: bool = False):
    """Metni akisla gonderir. Olaylar:
    meta {cached, format, length, minutes, target_words, cost, version, sources[], (onbellekte: chapters)}
    plan {chapters:[baslik]}           (yalniz derin; plan adimi bitince)
    token {text}                       (metin parcasi; `## ` satirlari dahil)
    chapter {title, char_start}        (akista bir bolum isareti tamamlaninca; konum ham akisa gore)
    note {message} / error {code, message}
    done {script, cached, format, length, cost, chapters:[{title, char_start, chunk, offset}], words, ...}
    `done.script` duzenlenmis nihai metindir; `chapters.char_start` bu metne goredir.
    """
    dialog, length, given, refresh = _params(body, format, length, refresh)
    uid = user["id"]
    pool = await get_pool()
    is_owner = bool(user.get("is_owner"))

    async def gen():
        # Akis ureteci istek baglamindan ayri calisabilir: kullanim sayaci bu kullaniciya yazilsin (chat.py ile ayni)
        usage.set_user(str(uid), is_owner)
        async with pool.acquire() as conn:
            try:
                col = await _col(conn, cid, uid, _doc)
                c = None if refresh else _cached(col, dialog, length, given)
                if c:
                    txt = c["script"]
                    payload = _cached_payload(c, dialog, length, await _current_hash(conn, cid, uid, _doc))
                    yield _sse("meta", {k: v for k, v in payload.items() if k != "script"})
                    for i in range(0, len(txt), 400):
                        yield _sse("token", {"text": txt[i:i + 400]})
                    yield _sse("done", payload)
                    return
                context, sources, h = await _context(conn, cid, uid, _doc)
            except AppError as e:
                yield _sse("error", {"code": e.code, "message": e.user_message}); return
            llm = get_llm()
            yield _sse("meta", {**_meta_common(dialog, length), "cached": False, "cost": lecture_cost(length),
                                "sources": [{"k": s["k"], "title": s["title"]} for s in sources]})
            title = col["title"]
            calls = 0
            full = ""
            scan = _ChapterScanner()

            # Adimlar: kisa/standart tek istem; derin = plan (JSON) + iki yazim adimi
            steps: list = []
            if length == "derin":
                try:
                    calls += 1
                    plan = await asyncio.to_thread(lecture_plan, context, title, dialog, sources)
                    yield _sse("plan", {"chapters": [str(ch.get("title")) for ch in plan["chapters"]]})
                    steps = [("p1", plan), ("p2", plan)]
                except AppError as e:
                    yield _sse("error", {"code": e.code, "message": e.user_message}); return
                except Exception:  # noqa - plan bozuk: tek adimda derin metin
                    steps = [("single", None)]
            else:
                steps = [("single", None)]

            interrupted = False
            for kind, plan in steps:
                if kind == "single":
                    msgs = lecture_prompt(context, title, dialog, length, sources)
                else:
                    msgs = lecture_part_prompt(context, title, dialog, plan, 1 if kind == "p1" else 2, sources,
                                               prev_tail=full if kind == "p2" else "")
                    if kind == "p2" and full:
                        full += "\n\n"
                        yield _sse("token", {"text": "\n\n"})
                calls += 1
                try:
                    async for tok in llm.stream_chat(msgs, model=settings.active_llm_model,
                                                     **warm_kwargs(llm.stream_chat)):
                        full += tok
                        yield _sse("token", {"text": tok})
                        for ch in scan.feed(full):
                            yield _sse("chapter", ch)
                except AppError as e:
                    if len(full) < 200:
                        yield _sse("error", {"code": e.code, "message": e.user_message}); return
                    interrupted = True
                except Exception:  # noqa
                    if len(full) < 200:
                        yield _sse("error", {"code": "AI_UNAVAILABLE", "message": FAILED}); return
                    interrupted = True
                if interrupted:
                    # Yarida kesildi ama okunabilir bir metin var: kaydet, kullaniciya soyle
                    yield _sse("note", {"message": "Metin yarıda kesildi; olan kısmı kaydettim. "
                                                   "İstersen 'Yeniden hazırla' ile tamamını yazdır."})
                    break
            for ch in scan.feed(full + "\n"):
                yield _sse("chapter", ch)
            script = tidy_script(full, dialog)
            if len(script) < 100:
                yield _sse("error", {"code": "AI_UNAVAILABLE", "message": FAILED}); return
            try:
                await _store(conn, cid, dialog, length, script, h, calls, _doc)
            except Exception:  # noqa
                pass
            yield _sse("done", {**_meta_common(dialog, length), "script": script, "cached": False, "cost": calls,
                                "chapters": _chapters(script, dialog), "words": _words(script),
                                "outdated": False, "stale": False, "partial": interrupted})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.get("/lecture/voices")
async def lecture_voices(user=Depends(current_user)):
    """Anlatici (kadin) ve ogrenci (erkek) sesleri; sohbet bicimi ikisini birlikte kullanir.
    `sample_ready`: ornek cumlesi sabit onbellekte hazir (dinlemek ucretsiz)."""
    ready = await samples_ready()
    return {
        "voices": [{"id": k, "label": v, "sample_ready": k in ready} for k, v in FEMALE_VOICES.items()],
        "default": DEFAULT_VOICE,
        "student_voices": [{"id": k, "label": v, "sample_ready": k in ready} for k, v in MALE_VOICES.items()],
        "default_student": DEFAULT_MALE_VOICE,
        "speakers": {"teacher": tts_jobs.SPEAKER_A, "student": tts_jobs.SPEAKER_B},
    }


class LectureTtsIn(BaseModel):
    text: str
    voice: str | None = None        # anlatici / Ayşe
    voice2: str | None = None       # Kerem (yalniz sohbet)
    format: str | None = None       # solo | dialog | None (metinden anla)
    head: str | None = None         # daha once on-uretilen bas kisim (1. parca aynen bu olur)


@router.post("/collections/{cid}/lecture/tts")
async def lecture_tts(cid: str, body: LectureTtsIn, conn=Depends(db), user=Depends(current_user), _doc: bool = False):
    """Parcali seslendirme isi. Yanit: durum (ready_chunks, durations, texts, total, chapters, chapter_chunks...).

    `## Bölüm` satirlari seslendirilmez; her bolum yeni parcada baslar (`chapter_chunks: [{title, chunk_index}]`).
    Parcalar hazir oldukca GET /tts/jobs/{id}/chunks/{n} ile alinir; tamami onbellekteyse aninda hazir (ucretsiz).
    """
    await _col(conn, cid, user["id"], _doc)
    txt = (body.text or "").strip()
    if len(txt) < 2:
        raise AppError("Seslendirilecek metin boş.")
    dialog = _fmt(body.format) if body.format else None
    return await tts_jobs.create_job(str(user["id"]), bool(user.get("is_owner")), txt,
                                     body.voice, body.voice2, dialog=dialog, head=body.head)


# ---- Tek kaynagin sesli ozeti (okuyucu / defter kaynak karti): ayni akis, kaynak kapsaminda ----
@router.get("/documents/{did}/lecture/options")
async def doc_lecture_opts(did: str, conn=Depends(db), user=Depends(current_user)):
    return await lecture_opts(did, conn=conn, user=user, _doc=True)


@router.post("/documents/{did}/lecture/stream")
async def doc_lecture_stream(did: str, body: LectureIn | None = None, refresh: bool = False, format: str | None = None,
                             length: str | None = None, user=Depends(current_user)):
    return await lecture_stream(did, body=body, refresh=refresh, format=format, length=length, user=user, _doc=True)


@router.post("/documents/{did}/lecture/tts")
async def doc_lecture_tts(did: str, body: LectureTtsIn, conn=Depends(db), user=Depends(current_user)):
    return await lecture_tts(did, body, conn=conn, user=user, _doc=True)
