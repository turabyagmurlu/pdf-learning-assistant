import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.deps import db, current_user
from app.services import rag_service
from app.services.analysis_service import (generate_study_items, feynman_review, lecture_script,
                                           extract_glossary, extract_timeline, extract_relations)
from app.ai.factory import get_embeddings, get_llm
from app.core.errors import NotFound, AppError
from app.config import settings

router = APIRouter(tags=["collections/search/graph"])


class CollectionIn(BaseModel):
    title: str
    description: str | None = None


@router.post("/collections")
async def create_collection(body: CollectionIn, conn=Depends(db), user=Depends(current_user)):
    cid = str(uuid.uuid4())
    await conn.execute("INSERT INTO collections (id, user_id, title, description) VALUES ($1,$2,$3,$4)",
                       cid, user["id"], body.title, body.description)
    return {"id": cid}


@router.get("/collections")
async def list_collections(conn=Depends(db), user=Depends(current_user)):
    """Defter listesi: kaynak/not sayilari ve son etkinlik (buyuk JSON alanlari haric)."""
    rows = await conn.fetch(
        """SELECT c.id, c.title, c.description, c.created_at, c.draft_at,
                  (c.draft IS NOT NULL AND length(c.draft) > 60) AS has_draft,
                  (SELECT COUNT(*) FROM documents d WHERE d.collection_id=c.id AND d.user_id=c.user_id) AS doc_count,
                  (SELECT COALESCE(SUM(d.page_count),0) FROM documents d WHERE d.collection_id=c.id AND d.user_id=c.user_id) AS page_count,
                  (SELECT COUNT(*) FROM notes n JOIN documents d ON d.id=n.document_id
                     WHERE d.collection_id=c.id AND n.user_id=c.user_id) AS note_count,
                  (c.glossary IS NOT NULL) AS has_glossary,
                  (c.timeline IS NOT NULL) AS has_timeline,
                  (c.concept_map IS NOT NULL) AS has_concept_map,
                  GREATEST(c.created_at, COALESCE(c.draft_at, c.created_at), COALESCE(c.glossary_at, c.created_at),
                           COALESCE(c.timeline_at, c.created_at), COALESCE(c.concept_map_at, c.created_at),
                           COALESCE((SELECT MAX(d.created_at) FROM documents d WHERE d.collection_id=c.id), c.created_at)) AS last_activity
           FROM collections c WHERE c.user_id=$1 ORDER BY last_activity DESC""",
        user["id"])
    return [dict(r) for r in rows]


@router.get("/collections/{cid}")
async def get_collection(cid: str, conn=Depends(db), user=Depends(current_user)):
    """Defter: bilgiler, kaynaklar, notlar ve studyo durumu."""
    col = await conn.fetchrow("SELECT * FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Defter bulunamadı.")
    docs = await conn.fetch(
        """SELECT id, title, status, page_count, short_summary, category, tags,
                  is_favorite, difficulty_level, created_at,
                  processing_stage, progress_done, progress_total, error_message
           FROM documents WHERE user_id=$1 AND collection_id=$2
           ORDER BY created_at DESC""",
        user["id"], cid)
    docs = [dict(d) for d in docs]
    ids = [str(d["id"]) for d in docs]
    notes = 0
    if ids:
        notes = await conn.fetchval(
            "SELECT COUNT(*) FROM notes WHERE user_id=$1 AND document_id = ANY($2::uuid[])",
            user["id"], ids) or 0
    c = dict(col)
    # buyuk JSON alanlari listeden cikar; varligini bayrak olarak ver
    def _has(v):
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except Exception:
                return False
        if not isinstance(v, dict):
            return False
        return bool(v.get("items") or v.get("events") or v.get("nodes"))
    studio = {
        "glossary": _has(c.pop("glossary", None)),
        "timeline": _has(c.pop("timeline", None)),
        "concept_map": _has(c.pop("concept_map", None)),
    }
    draft = c.get("draft") or ""
    draft_words = 0
    if draft.strip():
        try:
            j = json.loads(draft)
            for b in (j.get("blocks") or []):
                if b.get("type") in ("p", "h"):
                    draft_words += len((b.get("text") or "").split())
        except Exception:
            draft_words = len(draft.split())
    return {
        "collection": c,
        "documents": docs,
        "studio": studio,
        "stats": {
            "documents": len(docs),
            "ready": sum(1 for d in docs if d.get("status") == "ready"),
            "pages": sum((d.get("page_count") or 0) for d in docs),
            "notes": notes,
            "draft_words": draft_words,
        },
    }


class CollectionPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    draft: str | None = None


@router.patch("/collections/{cid}")
async def update_collection(cid: str, body: CollectionPatch, conn=Depends(db), user=Depends(current_user)):
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    if body.title is not None:
        await conn.execute("UPDATE collections SET title=$1 WHERE id=$2 AND user_id=$3",
                           body.title, cid, user["id"])
    if body.description is not None:
        await conn.execute("UPDATE collections SET description=$1 WHERE id=$2 AND user_id=$3",
                           body.description, cid, user["id"])
    if body.draft is not None:
        await conn.execute("UPDATE collections SET draft=$1, draft_at=now() WHERE id=$2 AND user_id=$3",
                           body.draft, cid, user["id"])
    return {"ok": True}


@router.delete("/collections/{cid}")
async def delete_collection(cid: str, conn=Depends(db), user=Depends(current_user)):
    """Calisma kitabini siler; icindeki belgeler silinmez, sadece kitaptan cikar."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    await conn.execute("UPDATE documents SET collection_id=NULL WHERE collection_id=$1 AND user_id=$2",
                       cid, user["id"])
    await conn.execute("DELETE FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    return {"ok": True}


class AskIn(BaseModel):
    question: str


@router.post("/collections/{cid}/ask")
async def ask_collection(cid: str, body: AskIn, conn=Depends(db), user=Depends(current_user)):
    """Calisma kitabindaki TUM belgelere birden soru sorar."""
    col = await conn.fetchrow("SELECT id, title FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    q = (body.question or "").strip()
    if len(q) < 3:
        raise AppError("Soru çok kısa.")
    rows = await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
        user["id"], cid)
    ids = [str(r["id"]) for r in rows]
    if not ids:
        raise AppError("Bu çalışma kitabında hazır belge yok.")
    chunks = await rag_service.retrieve_many(conn, ids, q, get_embeddings())
    if not chunks:
        return {"answer": "Bu soruya bu çalışma kitabındaki belgelerde karşılık bulamadım.",
                "sources": []}
    ctx = rag_service.build_context(chunks)
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen bir çalışma asistanısın. SADECE verilen kaynaklara dayanarak Türkçe cevap ver. "
            "Kaynakta olmayan bir şey uydurma. Cevabında hangi kaynağa dayandığını [K1], [K2] "
            "biçiminde belirt. Sade ve öğretici anlat."},
        {"role": "user", "content": f"Kaynaklar:\n\n{ctx}\n\nSoru: {q}"},
    ]
    answer = await asyncio.to_thread(llm.complete, messages, model=settings.active_llm_model)
    sources = [{"document_id": str(c["document_id"]), "title": c.get("doc_title"),
                "page": c["page_number"], "score": round(float(c["score"]), 3)} for c in chunks]
    return {"answer": answer, "sources": sources}


class FeynmanIn(BaseModel):
    concept: str
    explanation: str


@router.post("/collections/{cid}/feynman")
async def feynman(cid: str, body: FeynmanIn, conn=Depends(db), user=Depends(current_user)):
    """Anlat Bakalim: kullanicinin anlatimini kaynakla karsilastirir."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    concept = (body.concept or "").strip()
    expl = (body.explanation or "").strip()
    if len(concept) < 2:
        raise AppError("Hangi kavramı anlattığını yaz.")
    if len(expl) < 20:
        raise AppError("Biraz daha uzun anlat; en az birkaç cümle olsun.")
    rows = await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
        user["id"], cid)
    ids = [str(r["id"]) for r in rows]
    if not ids:
        raise AppError("Bu çalışma kitabında hazır belge yok.")
    chunks = await rag_service.retrieve_many(conn, ids, concept + "\n" + expl[:500], get_embeddings(), k=10)
    if not chunks:
        raise AppError("Bu kavramla ilgili kaynak bulamadım. Farklı bir kavram dene.")
    ctx = rag_service.build_context(chunks)
    review = await asyncio.to_thread(feynman_review, concept, expl, ctx)
    sources = [{"document_id": str(c["document_id"]), "title": c.get("doc_title"),
                "page": c["page_number"]} for c in chunks[:5]]
    return {"review": review, "sources": sources}


@router.post("/collections/{cid}/lecture")
async def lecture(cid: str, refresh: bool = False, conn=Depends(db), user=Depends(current_user)):
    """Sesli Ders: koleksiyonu akici bir anlatim metnine cevirir.

    Metin kaydedilir: ayni ders her acilista yeniden yazilmaz, boylece uretilen
    seslendirme de onbellekte kalir (kota bosa gitmez). refresh=1 yeniden yazar.
    """
    col = await conn.fetchrow("SELECT id, title, lecture, lecture_at FROM collections "
                              "WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    if not refresh and (col["lecture"] or "").strip():
        n = await conn.fetchval(
            "SELECT count(*) FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
            user["id"], cid)
        return {"script": col["lecture"], "title": col["title"], "documents": n,
                "cached": True, "at": col["lecture_at"].isoformat() if col["lecture_at"] else None}
    docs = await conn.fetch(
        "SELECT id, title, short_summary FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
        user["id"], cid)
    if not docs:
        raise AppError("Bu çalışma kitabında hazır belge yok.")
    ids = [str(d["id"]) for d in docs]
    rows = await conn.fetch(
        """SELECT content FROM document_chunks WHERE document_id = ANY($1::uuid[])
           ORDER BY document_id, chunk_index LIMIT 40""", ids)
    parts = [f"{d['title']}: {d['short_summary']}" for d in docs if d["short_summary"]]
    context = "\n".join(parts) + "\n\n" + "\n\n".join(r["content"] for r in rows)
    if len(context) < 200:
        raise AppError("Ders oluşturmak için yeterli içerik yok.")
    script = await asyncio.to_thread(lecture_script, context, col["title"])
    await conn.execute("UPDATE collections SET lecture=$1, lecture_at=now() WHERE id=$2", script, cid)
    return {"script": script, "title": col["title"], "documents": len(docs), "cached": False}


def _norm_term(t: str) -> str:
    t = t.strip().lower()
    for a, b in (("â", "a"), ("î", "i"), ("û", "u"), ("’", "'"), ("‘", "'")):
        t = t.replace(a, b)
    return " ".join(t.split())


def _glossary_context(rows, max_chunks: int = 45) -> str:
    rows = list(rows)
    n = len(rows)
    if n == 0:
        return ""
    skip = min(2, n // 12) if n >= 8 else 0
    pool = rows[skip:] if n - skip >= 3 else rows
    if len(pool) > max_chunks:
        step = len(pool) / max_chunks
        pool = [pool[int(i * step)] for i in range(max_chunks)]
    return "\n\n".join((f"[s.{r['page_number']}] " if r["page_number"] else "") + (r["content"] or "")
                       for r in pool)


@router.get("/collections/{cid}/glossary")
async def get_glossary(cid: str, conn=Depends(db), user=Depends(current_user)):
    col = await conn.fetchrow("SELECT id, glossary, glossary_at FROM collections WHERE id=$1 AND user_id=$2",
                              cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    g = col["glossary"]
    if isinstance(g, str):
        try:
            g = json.loads(g)
        except Exception:
            g = None
    return {"items": (g or {}).get("items", []) if isinstance(g, dict) else [],
            "generated_at": col["glossary_at"].isoformat() if col["glossary_at"] else None}


# ---- Belge bazli cikarim onbellegi -------------------------------------------
# Sozluk / iliski / olay cikarimi belge basina yapilir ve sonuc BELGEYE yazilir.
# Boylece "Yenile" yalniz yeni (ya da degisen) belgeler icin LLM'e gider;
# 17 kaynakli defterde 1 yeni kaynak = 1 istek, 17 degil. Kota boşa yanmaz.

def _ctx_hash(ctx: str, extra: str = "") -> str:
    import hashlib
    return hashlib.sha256((ctx + "\x00" + extra).encode("utf-8")).hexdigest()[:24]


async def _extract_cached(conn, doc_id, kind: str, ctx: str, extra: str, fn, *args):
    """Onbellekte ayni girdiye ait sonuc varsa onu dondur; yoksa uret ve sakla.
    Donen: (sonuc_listesi, onbellekten_mi)"""
    h = _ctx_hash(ctx, extra)
    row = await conn.fetchrow(
        "SELECT payload FROM doc_extracts WHERE document_id=$1 AND kind=$2 AND input_hash=$3", doc_id, kind, h)
    if row and row["payload"] is not None:
        p = row["payload"]
        if isinstance(p, str):
            try:
                p = json.loads(p)
            except Exception:
                p = None
        if isinstance(p, list):
            return p, True
    out = await asyncio.to_thread(fn, *args)
    await conn.execute(
        """INSERT INTO doc_extracts (document_id, kind, input_hash, payload, created_at)
           VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (document_id, kind) DO UPDATE SET input_hash=EXCLUDED.input_hash,
             payload=EXCLUDED.payload, created_at=now()""",
        doc_id, kind, h, out)
    return out, False


def _jload(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v


async def _seed_from_collection(conn, cid: str, docs) -> int:
    """Onbellek bu ozellikten ONCE uretilmis defterler icin: defter duzeyindeki
    sozluk/harita/zaman sonucunu belgelere geri dagitip onbellege yazar.
    Boylece ilk 'Yenile' de kota harcamaz. Yalniz onbellegi olmayan belgeler icin calisir."""
    col = await conn.fetchrow("SELECT glossary, concept_map, timeline FROM collections WHERE id=$1", cid)
    if not col:
        return 0
    g = _jload(col["glossary"]) or {}
    m = _jload(col["concept_map"]) or {}
    t = _jload(col["timeline"]) or {}
    items = g.get("items", []) if isinstance(g, dict) else []
    edges = m.get("edges", []) if isinstance(m, dict) else []
    events = t.get("events", []) if isinstance(t, dict) else []
    if not (items or edges or events):
        return 0
    all_terms = [it["term"] for it in items]
    seeded = 0
    for d in docs:
        did = str(d["id"])
        have = {r["kind"] for r in await conn.fetch(
            "SELECT kind FROM doc_extracts WHERE document_id=$1", d["id"])}
        need = {"glossary", "relations", "timeline"} - have
        if not need:
            continue
        rows = await conn.fetch(
            "SELECT content, page_number FROM document_chunks WHERE document_id=$1 ORDER BY chunk_index", d["id"])
        ctx = _glossary_context(rows)
        if len(ctx) < 200:
            continue

        async def put(kind, extra, payload):
            nonlocal seeded
            await conn.execute(
                """INSERT INTO doc_extracts (document_id, kind, input_hash, payload, created_at)
                   VALUES ($1,$2,$3,$4,now()) ON CONFLICT (document_id, kind) DO NOTHING""",
                d["id"], kind, _ctx_hash(ctx, extra), payload)
            seeded += 1

        if "glossary" in need and items:
            mine = []
            for it in items:
                for mn in it.get("mentions", []):
                    if mn.get("document_id") == did:
                        mine.append({"term": it["term"], "kind": it["kind"],
                                     "definition": it["definition"], "pages": mn.get("pages", [])})
                        break
            await put("glossary", "", mine)
        if "relations" in need and edges:
            doc_terms = [it["term"] for it in items
                         if any(mn.get("document_id") == did for mn in it.get("mentions", []))] or all_terms
            mine = [e for e in edges if e.get("document_id") == did]
            await put("relations", "|".join(sorted(doc_terms)), mine)
        if "timeline" in need and events:
            mine = [e for e in events if e.get("document_id") == did]
            await put("timeline", "", mine)
    return seeded


@router.get("/collections/{cid}/extract-status")
async def extract_status(cid: str, conn=Depends(db), user=Depends(current_user)):
    """Yenile butonuna basmadan once: kac belge onbellekte, kac belge yeni islenecek?
    Arayuz bunu 'X belge hazir, Y belge icin kota harcanir' diye gosterir.
    Eski defterlerde onbellegi mevcut sonuctan tohumlar (kota harcamadan)."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Defter bulunamadı.")
    docs = await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'", user["id"], cid)
    ids = [d["id"] for d in docs]
    try:
        await _seed_from_collection(conn, cid, docs)
    except Exception:  # noqa - tohumlama basarisiz olsa da durum donsun
        pass
    out = {}
    for kind in ("glossary", "relations", "timeline"):
        n = await conn.fetchval(
            "SELECT count(*) FROM doc_extracts WHERE kind=$1 AND document_id = ANY($2::uuid[])", kind, ids) if ids else 0
        out[kind] = {"cached": int(n or 0), "pending": max(0, len(ids) - int(n or 0))}
    return {"documents": len(ids), **out}


@router.post("/collections/{cid}/glossary")
async def build_glossary(cid: str, force: bool = False, conn=Depends(db), user=Depends(current_user)):
    """Kitaptaki tum belgelerden kisi / yer / olay / antlasma / kurum / kavram sozlugu cikarir.
    force=1 -> onbellegi yok say, her belgeyi yeniden uret (kota harcar)."""
    col = await conn.fetchrow("SELECT id, title FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    docs = await conn.fetch(
        "SELECT id, title FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready' ORDER BY created_at",
        user["id"], cid)
    if not docs:
        raise AppError("Bu çalışma kitabında hazır belge yok.")

    merged: dict[str, dict] = {}
    cached_n = fresh_n = 0
    for d in docs:
        rows = await conn.fetch(
            "SELECT content, page_number FROM document_chunks WHERE document_id=$1 ORDER BY chunk_index", d["id"])
        ctx = _glossary_context(rows)
        if len(ctx) < 200:
            continue
        try:
            if force:
                await conn.execute("DELETE FROM doc_extracts WHERE document_id=$1 AND kind='glossary'", d["id"])
            items, hit = await _extract_cached(conn, d["id"], "glossary", ctx, "", extract_glossary, ctx, d["title"])
            cached_n += int(hit); fresh_n += int(not hit)
        except Exception:
            continue
        for it in items:
            key = _norm_term(it["term"])
            entry = merged.get(key)
            if not entry:
                entry = {"term": it["term"], "kind": it["kind"], "definition": it["definition"], "mentions": []}
                merged[key] = entry
            elif len(it["definition"]) > len(entry["definition"]):
                entry["definition"] = it["definition"]
            entry["mentions"].append({"document_id": str(d["id"]), "title": d["title"], "pages": it["pages"]})

    items = sorted(merged.values(), key=lambda x: _norm_term(x["term"]))
    payload = {"items": items}
    now = datetime.now(timezone.utc)
    await conn.execute("UPDATE collections SET glossary=$1, glossary_at=$2 WHERE id=$3", payload, now, cid)
    return {"items": items, "generated_at": now.isoformat(), "documents": len(docs),
            "cached": cached_n, "fresh": fresh_n}


@router.get("/collections/{cid}/concept-map")
async def get_concept_map(cid: str, conn=Depends(db), user=Depends(current_user)):
    col = await conn.fetchrow("SELECT id, concept_map, concept_map_at FROM collections WHERE id=$1 AND user_id=$2",
                              cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    m = col["concept_map"]
    if isinstance(m, str):
        try:
            m = json.loads(m)
        except Exception:
            m = None
    m = m if isinstance(m, dict) else {}
    return {"nodes": m.get("nodes", []), "edges": m.get("edges", []),
            "generated_at": col["concept_map_at"].isoformat() if col["concept_map_at"] else None}


@router.post("/collections/{cid}/concept-map")
async def build_concept_map(cid: str, force: bool = False, conn=Depends(db), user=Depends(current_user)):
    """Sozluk maddelerini dugum, metindeki iliskileri kenar yaparak kavram haritasi kurar.
    Sozluk yoksa once onu uretir. force=1 -> belge onbellegini yok say."""
    col = await conn.fetchrow("SELECT id, title, glossary FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    g = col["glossary"]
    if isinstance(g, str):
        try:
            g = json.loads(g)
        except Exception:
            g = None
    items = (g or {}).get("items", []) if isinstance(g, dict) else []
    if not items:
        r = await build_glossary(cid, force, conn, user)  # type: ignore[arg-type]
        items = r["items"]
    cached_n = fresh_n = 0
    if not items:
        raise AppError("Sözlük boş; önce belge ekle.")
    terms = [it["term"] for it in items]
    nodes = [{"id": it["term"], "kind": it["kind"], "definition": it["definition"], "mentions": it["mentions"]}
             for it in items]

    docs = await conn.fetch(
        "SELECT id, title FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready' ORDER BY created_at",
        user["id"], cid)
    edges: list[dict] = []
    seen: set[tuple] = set()
    for d in docs:
        rows = await conn.fetch(
            "SELECT content, page_number FROM document_chunks WHERE document_id=$1 ORDER BY chunk_index", d["id"])
        ctx = _glossary_context(rows)
        if len(ctx) < 200:
            continue
        # bu belgede gecen maddelerle sinirla
        doc_terms = [it["term"] for it in items
                     if any(m.get("document_id") == str(d["id"]) for m in it.get("mentions", []))] or terms
        try:
            if force:
                await conn.execute("DELETE FROM doc_extracts WHERE document_id=$1 AND kind='relations'", d["id"])
            # Terim listesi degisirse iliskiler de yeniden cikarilmali -> hash'e katiyoruz
            rels, hit = await _extract_cached(conn, d["id"], "relations", ctx, "|".join(sorted(doc_terms)),
                                              extract_relations, ctx, d["title"], doc_terms)
            cached_n += int(hit); fresh_n += int(not hit)
        except Exception:
            continue
        for r in rels:
            key = (r["source"], r["target"], r["label"].lower())
            if key in seen:
                continue
            seen.add(key)
            r["document_id"] = str(d["id"]); r["document_title"] = d["title"]
            edges.append(r)
    # kenari olmayan dugumleri de tut ama sona koy
    payload = {"nodes": nodes, "edges": edges}
    now = datetime.now(timezone.utc)
    await conn.execute("UPDATE collections SET concept_map=$1, concept_map_at=$2 WHERE id=$3", payload, now, cid)
    return {"nodes": nodes, "edges": edges, "generated_at": now.isoformat(),
            "cached": cached_n, "fresh": fresh_n}


@router.get("/collections/{cid}/timeline")
async def get_timeline(cid: str, conn=Depends(db), user=Depends(current_user)):
    col = await conn.fetchrow("SELECT id, timeline, timeline_at FROM collections WHERE id=$1 AND user_id=$2",
                              cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    t = col["timeline"]
    if isinstance(t, str):
        try:
            t = json.loads(t)
        except Exception:
            t = None
    return {"events": (t or {}).get("events", []) if isinstance(t, dict) else [],
            "generated_at": col["timeline_at"].isoformat() if col["timeline_at"] else None}


@router.post("/collections/{cid}/timeline")
async def build_timeline(cid: str, force: bool = False, conn=Depends(db), user=Depends(current_user)):
    """Kitaptaki belgelerden tarihli olaylari cikarip kronolojik birlestirir. force=1 -> onbellegi yok say."""
    col = await conn.fetchrow("SELECT id, title FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    docs = await conn.fetch(
        "SELECT id, title FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready' ORDER BY created_at",
        user["id"], cid)
    if not docs:
        raise AppError("Bu çalışma kitabında hazır belge yok.")
    events: list[dict] = []
    seen: set[tuple] = set()
    cached_n = fresh_n = 0
    for d in docs:
        rows = await conn.fetch(
            "SELECT content, page_number FROM document_chunks WHERE document_id=$1 ORDER BY chunk_index", d["id"])
        ctx = _glossary_context(rows)
        if len(ctx) < 200:
            continue
        try:
            if force:
                await conn.execute("DELETE FROM doc_extracts WHERE document_id=$1 AND kind='timeline'", d["id"])
            evs, hit = await _extract_cached(conn, d["id"], "timeline", ctx, "", extract_timeline, ctx, d["title"])
            cached_n += int(hit); fresh_n += int(not hit)
        except Exception:
            continue
        for ev in evs:
            key = (ev["year"], ev["month"], _norm_term(ev["title"])[:40])
            if key in seen:
                continue
            seen.add(key)
            ev["document_id"] = str(d["id"]); ev["document_title"] = d["title"]
            events.append(ev)
    events.sort(key=lambda e: (e["year"], e["month"] or 0, e["day"] or 0))
    payload = {"events": events}
    now = datetime.now(timezone.utc)
    await conn.execute("UPDATE collections SET timeline=$1, timeline_at=$2 WHERE id=$3", payload, now, cid)
    return {"events": events, "generated_at": now.isoformat(), "documents": len(docs),
            "cached": cached_n, "fresh": fresh_n}


class DraftAssistIn(BaseModel):
    action: str            # shorten | academic | paraphrase | suggest_sources
    text: str
    instruction: str | None = None


@router.post("/collections/{cid}/draft-assist")
async def draft_assist(cid: str, body: DraftAssistIn, conn=Depends(db), user=Depends(current_user)):
    """Taslaktaki bir blok icin AI yardimi. Metni degistirmez, oneri dondurur; kullanici uygular."""
    col = await conn.fetchrow("SELECT id, title FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Defter bulunamadı.")
    text = (body.text or "").strip()
    if len(text) < 8:
        raise AppError("Metin çok kısa.")
    llm = get_llm()
    base = ("Sen titiz bir editörsün. Yalnızca Türkçe yaz. Metnin anlamını, iddialarını ve olgularını değiştirme; "
            "yeni bilgi, tarih ya da isim ekleme. Başlık, açıklama, tırnak ya da 'İşte' gibi girişler yazma; "
            "yalnızca sonuç metnini döndür.")
    if body.action == "shorten":
        sysm = base + " Metni yaklaşık yarı uzunluğa indir; en önemli cümleleri koru, tekrarları ve dolgu ifadeleri at."
        usr = text
    elif body.action == "academic":
        sysm = base + (" Metni akademik bir tona çevir: nesnel, üçüncü şahıs, kesin ve ölçülü ifadeler, konuşma dili yok, "
                       "gereksiz sıfat yok. Uzunluğu yaklaşık koru.")
        usr = text
    elif body.action == "paraphrase":
        sysm = base + (" Bu bir kaynaktan alıntıdır. Aynı bilgiyi tamamen kendi cümlelerinle, farklı sözcük ve cümle yapısıyla "
                       "yeniden anlat (parafraz); alıntıdaki hiçbir cümleyi olduğu gibi kopyalama. Kaynak adı ya da sayfa ekleme; "
                       "bu bilgi ayrıca gösterilecek.")
        usr = text
    elif body.action == "custom":
        sysm = base + " Kullanıcının talimatını uygula."
        usr = f"Talimat: {body.instruction or ''}\n\nMetin:\n{text}"
    elif body.action == "suggest_sources":
        # defterdeki vurgular arasindan bu paragrafa uyanlari bul (anlam bazli)
        rows = await conn.fetch(
            """SELECT n.id, n.selected_text, n.note_content, n.page_number, n.highlight_color,
                      d.id AS document_id, d.title AS document_title
               FROM notes n JOIN documents d ON d.id = n.document_id
               WHERE n.user_id=$1 AND d.collection_id=$2 AND n.selected_text IS NOT NULL AND length(n.selected_text) > 20""",
            user["id"], cid)
        if not rows:
            return {"action": body.action, "suggestions": [], "note": "Bu defterin kaynaklarında henüz vurgu yok."}
        # embedding ile siralama
        try:
            emb = get_embeddings()
            qv = (await asyncio.to_thread(emb.embed, [text]))[0]
            cands = [r["selected_text"] for r in rows]
            vs = await asyncio.to_thread(emb.embed, cands)
            import math
            def cos(a, b):
                dot = sum(x * y for x, y in zip(a, b)); na = math.sqrt(sum(x * x for x in a)); nb = math.sqrt(sum(y * y for y in b))
                return dot / (na * nb) if na and nb else 0.0
            scored = sorted(((cos(qv, v), r) for v, r in zip(vs, rows)), key=lambda t: -t[0])
        except Exception:
            scored = [(0.0, r) for r in rows]
        top = [{"id": str(r["id"]), "text": r["selected_text"], "note": r["note_content"], "page": r["page_number"],
                "color": r["highlight_color"], "document_id": str(r["document_id"]), "document_title": r["document_title"],
                "score": round(float(sc), 3)} for sc, r in scored[:6]]
        # kisa gerekce
        why = ""
        try:
            listing = "\n".join(f"[{i+1}] {t['text'][:300]}" for i, t in enumerate(top[:4]))
            why = await asyncio.to_thread(llm.complete, [
                {"role": "system", "content": "Yalnızca Türkçe. Çok kısa yaz."},
                {"role": "user", "content": f"Paragraf:\n{text}\n\nAday alıntılar:\n{listing}\n\n"
                                            "Her aday için tek satır: [n] bu paragrafı nasıl destekler ya da desteklemez. En fazla 4 satır."},
            ], model=settings.active_llm_model)
        except Exception:
            pass
        return {"action": body.action, "suggestions": top, "why": why}
    else:
        raise AppError("Bilinmeyen işlem.")
    out = await asyncio.to_thread(llm.complete, [{"role": "system", "content": sysm}, {"role": "user", "content": usr}], model=settings.active_llm_model)
    return {"action": body.action, "text": (out or "").strip()}


class ColStudyIn(BaseModel):
    type: str = "flashcard"
    count: int = 10


@router.post("/collections/{cid}/study/generate")
async def collection_study(cid: str, body: ColStudyIn, conn=Depends(db), user=Depends(current_user)):
    """Calisma kitabindaki tum belgelerden karisik kart/quiz uretir."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Çalışma kitabı bulunamadı.")
    docs = await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
        user["id"], cid)
    ids = [str(d["id"]) for d in docs]
    if not ids:
        raise AppError("Bu çalışma kitabında hazır belge yok.")
    per = max(3, min(12, (body.count or 10)))
    rows = await conn.fetch(
        """SELECT content, document_id FROM document_chunks
           WHERE document_id = ANY($1::uuid[]) ORDER BY random() LIMIT 30""", ids)
    context = "\n\n".join(r["content"] for r in rows)
    if len(context) < 100:
        raise AppError("Kart üretmek için yeterli içerik bulunamadı.")
    items = await asyncio.to_thread(generate_study_items, context, body.type, per)
    created = 0
    first_doc = ids[0]
    for it in items:
        sid = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO study_items (id, user_id, document_id, type, question, answer, options,
                                        source_page, difficulty, due_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
            sid, user["id"], first_doc, it.get("type", body.type), it.get("question"),
            it.get("answer"), it.get("options", []), it.get("source_page"),
            it.get("difficulty"), datetime.now(timezone.utc))
        created += 1
    return {"created": created}


class SearchIn(BaseModel):
    query: str
    document_ids: list[str] | None = None


@router.post("/search")
async def search(body: SearchIn, conn=Depends(db), user=Depends(current_user)):
    """Kullanıcının belgeleri arasında semantik arama (çoklu belge)."""
    emb = (await asyncio.to_thread(get_embeddings().embed, [body.query]))[0]
    if body.document_ids:
        rows = await conn.fetch(
            """SELECT dc.id, dc.document_id, dc.page_number, dc.section_title, dc.content,
                      1 - (dc.embedding <=> $1) AS score, d.title
               FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
               WHERE d.user_id=$2 AND dc.document_id = ANY($3::uuid[]) AND dc.embedding IS NOT NULL
               ORDER BY dc.embedding <=> $1 LIMIT 15""",
            emb, user["id"], body.document_ids)
    else:
        rows = await conn.fetch(
            """SELECT dc.id, dc.document_id, dc.page_number, dc.section_title, dc.content,
                      1 - (dc.embedding <=> $1) AS score, d.title
               FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
               WHERE d.user_id=$2 AND dc.embedding IS NOT NULL
               ORDER BY dc.embedding <=> $1 LIMIT 15""",
            emb, user["id"])
    return [dict(r) for r in rows]


def _snippet(text: str, q: str, width: int = 220) -> str:
    """Eslesen kelimenin etrafindan kisa bir parca; yoksa bastan."""
    t = " ".join((text or "").split())
    low, terms = t.lower(), [w for w in q.lower().split() if len(w) >= 3]
    pos = -1
    for w in terms:
        i = low.find(w)
        if i >= 0 and (pos < 0 or i < pos):
            pos = i
    if pos < 0:
        return t[:width] + ("…" if len(t) > width else "")
    a = max(0, pos - width // 3)
    b = min(len(t), a + width)
    return ("…" if a > 0 else "") + t[a:b] + ("…" if b < len(t) else "")


@router.get("/collections/{cid}/search")
async def search_collection(cid: str, q: str, mode: str = "hybrid",
                            conn=Depends(db), user=Depends(current_user)):
    """Defter ici arama: yalniz bu defterin hazir kaynaklarinda.

    mode=text   -> tam metin (kelime birebir; hic kota harcamaz, aninda)
    mode=meaning-> anlamsal (yakin kavramlar; 1 gomme istegi)
    mode=hybrid -> ikisi birlesik (varsayilan). Sonuclar belgeye gore gruplanir.
    """
    q = (q or "").strip()
    if len(q) < 2:
        raise AppError("En az 2 karakter yaz.")
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Defter bulunamadı.")
    docs = await conn.fetch(
        "SELECT id, title FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'",
        user["id"], cid)
    if not docs:
        return {"query": q, "groups": [], "total": 0, "mode": mode}
    ids = [str(d["id"]) for d in docs]
    titles = {str(d["id"]): d["title"] for d in docs}

    hits: dict[str, dict] = {}     # chunk_id -> satir

    if mode in ("text", "hybrid"):
        # Kelime birebir: her terim parcada gecmeli (ILIKE -> Turkce ekleri de yakalar:
        # "kreatin" -> "kreatinin", "kreatini"). Tirnakli ifade tek terim sayilir.
        terms = [t.strip('"') for t in re.findall(r'"[^"]+"|\S+', q) if len(t.strip('"')) >= 2][:6]
        if terms:
            conds = " AND ".join(f"dc.content ILIKE ${i + 3}" for i in range(len(terms)))
            pats = [f"%{t}%" for t in terms]
            rows = await conn.fetch(
                f"""SELECT dc.id, dc.document_id, dc.page_number, dc.section_title, dc.content,
                           ts_rank_cd(dc.content_tsv, plainto_tsquery('simple', $1)) AS trank
                    FROM document_chunks dc
                    WHERE dc.document_id = ANY($2::uuid[]) AND {conds}
                    ORDER BY trank DESC, dc.page_number LIMIT 80""", q, ids, *pats)
            for r in rows:
                low = (r["content"] or "").lower()
                occ = sum(low.count(t.lower()) for t in terms)
                hits[str(r["id"])] = {**dict(r), "score": 1.0 + min(occ, 8) * 0.15 + float(r["trank"]),
                                      "how": "text"}

    if mode in ("meaning", "hybrid"):
        try:
            emb = (await asyncio.to_thread(get_embeddings().embed, [q]))[0]
            rows = await conn.fetch(
                """SELECT dc.id, dc.document_id, dc.page_number, dc.section_title, dc.content,
                          1 - (dc.embedding <=> $1) AS sim
                   FROM document_chunks dc
                   WHERE dc.document_id = ANY($2::uuid[]) AND dc.embedding IS NOT NULL
                   ORDER BY dc.embedding <=> $1 LIMIT 40""", emb, ids)
            for r in rows:
                sim = float(r["sim"])
                if sim < 0.35:
                    continue
                k = str(r["id"])
                if k in hits:
                    hits[k]["score"] += sim
                    hits[k]["how"] = "both"
                else:
                    hits[k] = {**dict(r), "score": sim, "how": "meaning"}
        except Exception:  # noqa - gomme kotasi dolsa bile tam-metin sonuclar gelsin
            if mode == "meaning":
                raise
            mode = "text"

    # Belgeye gore grupla; her belgede en iyi 6 parca, sayfaya gore sirali
    by_doc: dict[str, list[dict]] = {}
    for h in hits.values():
        by_doc.setdefault(str(h["document_id"]), []).append(h)
    groups = []
    for did, lst in by_doc.items():
        lst.sort(key=lambda x: -x["score"])
        top = lst[:6]
        top.sort(key=lambda x: (x["page_number"] or 0))
        groups.append({
            "document_id": did, "title": titles.get(did, "Belge"),
            "best": max(x["score"] for x in lst), "count": len(lst),
            "hits": [{"page": x["page_number"], "section": x.get("section_title"),
                      "snippet": _snippet(x["content"], q), "how": x["how"],
                      "score": round(x["score"], 3)} for x in top],
        })
    groups.sort(key=lambda g: -g["best"])
    return {"query": q, "groups": groups, "total": len(hits), "mode": mode,
            "documents": len(docs)}


@router.get("/documents/{doc_id}/connections")
async def connections(doc_id: str, page: int, conn=Depends(db), user=Depends(current_user)):
    """Baglanti Kesfi: bu sayfadaki icerigin DIGER belgelerdeki karsiliklarini bulur."""
    doc = await conn.fetchrow("SELECT id FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not doc:
        raise NotFound("Belge bulunamadı.")
    src = await conn.fetch(
        """SELECT content, embedding FROM document_chunks
           WHERE document_id=$1 AND page_number=$2 AND embedding IS NOT NULL
           ORDER BY chunk_index LIMIT 3""", doc_id, page)
    if not src:
        return {"connections": []}
    seen, out = set(), []
    for s in src:
        rows = await conn.fetch(
            """SELECT dc.document_id, dc.page_number, dc.section_title, dc.content,
                      d.title AS doc_title, 1 - (dc.embedding <=> $1) AS score
               FROM document_chunks dc
               JOIN documents d ON d.id = dc.document_id
               WHERE d.user_id=$2 AND dc.document_id <> $3 AND dc.embedding IS NOT NULL
               ORDER BY dc.embedding <=> $1 LIMIT 5""",
            s["embedding"], user["id"], doc_id)
        for r in rows:
            score = float(r["score"])
            if score < 0.55:
                continue
            key = (str(r["document_id"]), r["page_number"])
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "document_id": str(r["document_id"]),
                "title": r["doc_title"],
                "page": r["page_number"],
                "section": r["section_title"],
                "excerpt": (r["content"] or "")[:220],
                "score": round(score, 3),
            })
    out.sort(key=lambda x: x["score"], reverse=True)
    return {"connections": out[:6]}


@router.get("/graph")
async def graph(conn=Depends(db), user=Depends(current_user)):
    nodes = await conn.fetch("SELECT id, label, mastery, document_id FROM concepts WHERE user_id=$1", user["id"])
    edges = await conn.fetch(
        """SELECT e.source_id, e.target_id, e.relation FROM concept_edges e
           JOIN concepts c ON c.id = e.source_id WHERE c.user_id=$1""", user["id"])
    return {"nodes": [dict(n) for n in nodes], "edges": [dict(e) for e in edges]}
