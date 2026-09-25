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
                                           extract_glossary, extract_timeline, extract_relations,
                                           notebook_suggestions, template_suggestions)
from app.ai.factory import get_embeddings, get_llm
from app.core.errors import NotFound, AppError
from app.config import settings
from app.services import membership

router = APIRouter(tags=["collections/search/graph"])

COL_MISSING = "Defter bulunamadı; silinmiş olabilir. Defterler sayfasına dön."
NO_READY = "Bu defterde henüz hazır kaynak yok. Kaynak ekle ya da işlenmelerini bekle."


class CollectionIn(BaseModel):
    title: str
    description: str | None = None


@router.post("/collections")
async def create_collection(body: CollectionIn, conn=Depends(db), user=Depends(current_user)):
    title = (body.title or "").strip()
    if not title:
        raise AppError("Deftere bir ad ver.")
    # Cift kayit korumasi: ayni ad ~20 sn icinde tekrar gelirse (cift tiklama / ag tekrari) yenisini acma
    recent = await conn.fetchval(
        """SELECT id FROM collections WHERE user_id=$1 AND title=$2 AND created_at > now() - interval '20 seconds'
           ORDER BY created_at DESC LIMIT 1""", user["id"], title[:300])
    if recent:
        return {"id": str(recent), "existing": True}
    cid = str(uuid.uuid4())
    await conn.execute("INSERT INTO collections (id, user_id, title, description) VALUES ($1,$2,$3,$4)",
                       cid, user["id"], title[:300], body.description)
    return {"id": cid}


@router.get("/collections")
async def list_collections(conn=Depends(db), user=Depends(current_user)):
    """Defter listesi: kaynak/not sayilari ve son etkinlik (buyuk JSON alanlari haric)."""
    rows = await conn.fetch(
        """SELECT c.id, c.title, c.description, c.created_at, c.draft_at,
                  (c.draft IS NOT NULL AND length(c.draft) > 60) AS has_draft,
                  (SELECT COUNT(*) FROM document_collections l JOIN documents d ON d.id=l.document_id
                     WHERE l.collection_id=c.id AND d.user_id=c.user_id) AS doc_count,
                  (SELECT COUNT(*) FROM document_collections l JOIN documents d ON d.id=l.document_id
                     WHERE l.collection_id=c.id AND d.user_id=c.user_id AND d.status='ready') AS ready_count,
                  (SELECT COALESCE(SUM(d.page_count),0) FROM document_collections l JOIN documents d ON d.id=l.document_id
                     WHERE l.collection_id=c.id AND d.user_id=c.user_id) AS page_count,
                  (SELECT COUNT(*) FROM notes n JOIN document_collections l ON l.document_id=n.document_id
                     WHERE l.collection_id=c.id AND n.user_id=c.user_id) AS note_count,
                  (SELECT COUNT(*) FROM collection_chats ch WHERE ch.collection_id=c.id) AS chat_count,
                  (c.glossary IS NOT NULL) AS has_glossary,
                  (c.timeline IS NOT NULL) AS has_timeline,
                  (c.concept_map IS NOT NULL) AS has_concept_map,
                  c.topics AS topics_raw,
                  (SELECT json_agg(json_build_array(t.k, t.n)) FROM (
                     SELECT COALESCE(d.source_type,'pdf') AS k, COUNT(*) AS n
                     FROM document_collections l JOIN documents d ON d.id=l.document_id
                     WHERE l.collection_id=c.id AND d.user_id=c.user_id GROUP BY 1 ORDER BY 2 DESC) t) AS types,
                  (SELECT ch.title FROM collection_chats ch WHERE ch.collection_id=c.id ORDER BY ch.updated_at DESC LIMIT 1) AS last_chat,
                  (SELECT MAX(ch.updated_at) FROM collection_chats ch WHERE ch.collection_id=c.id) AS last_chat_at,
                  GREATEST(COALESCE((SELECT MAX(ch.updated_at) FROM collection_chats ch WHERE ch.collection_id=c.id), c.created_at),c.created_at, COALESCE(c.draft_at, c.created_at), COALESCE(c.glossary_at, c.created_at),
                           COALESCE(c.timeline_at, c.created_at), COALESCE(c.concept_map_at, c.created_at),
                           COALESCE((SELECT MAX(l.added_at) FROM document_collections l WHERE l.collection_id=c.id), c.created_at)) AS last_activity
           FROM collections c WHERE c.user_id=$1 ORDER BY last_activity DESC""",
        user["id"])
    # Konu gruplari: yalniz defterde HALA bagli olan kaynaklar sayilir (bag tablosu)
    members: dict[str, set[str]] = {}
    for m in await conn.fetch(
            """SELECT l.collection_id, l.document_id FROM document_collections l
               JOIN collections c ON c.id = l.collection_id WHERE c.user_id=$1""", user["id"]):
        members.setdefault(str(m["collection_id"]), set()).add(str(m["document_id"]))
    out = []
    for r in rows:
        d = dict(r)
        t = d.pop("topics_raw", None)
        mem = members.get(str(d["id"]), set())
        try:
            t = json.loads(t) if isinstance(t, str) else t
            topics = []
            for g in (t or {}).get("groups", []):
                n = sum(1 for x in (g.get("docs") or []) if str(x) in mem)
                if n:
                    topics.append({"label": g["label"], "n": n})
            d["topics"] = topics
        except Exception:  # noqa
            d["topics"] = []
        ty = d.get("types")
        d["types"] = json.loads(ty) if isinstance(ty, str) else (ty or [])
        out.append(d)
    return out


@router.get("/collections/{cid}")
async def get_collection(cid: str, conn=Depends(db), user=Depends(current_user)):
    """Defter: bilgiler, kaynaklar, notlar ve studyo durumu."""
    col = await conn.fetchrow("SELECT * FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    docs = await conn.fetch(
        """SELECT d.id, d.title, d.status, d.page_count, d.short_summary, d.category, d.tags,
                  d.is_favorite, d.difficulty_level, d.created_at, l.added_at,
                  d.processing_stage, d.progress_done, d.progress_total, d.error_message,
                  d.source_type, d.source_url, d.media,
                  COALESCE((SELECT array_agg(l2.collection_id::text ORDER BY l2.added_at, l2.collection_id)
                            FROM document_collections l2 WHERE l2.document_id = d.id), ARRAY[]::text[]) AS collection_ids
           FROM documents d JOIN document_collections l ON l.document_id = d.id
           WHERE d.user_id=$1 AND l.collection_id=$2
           ORDER BY l.added_at DESC, d.created_at DESC""",
        user["id"], cid)
    docs = [dict(d) for d in docs]
    for d in docs:
        d["collection_ids"] = list(d.get("collection_ids") or [])
        d["other_collections"] = max(0, len(d["collection_ids"]) - 1)   # "· 2 defterde" rozeti icin
    ids = [str(d["id"]) for d in docs]
    chat_count = await conn.fetchval(
        "SELECT COUNT(*) FROM collection_chats WHERE collection_id=$1 AND user_id=$2", cid, user["id"]) or 0
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
            "chat_count": int(chat_count),
        },
    }


class CollectionPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    draft: str | None = None
    # Taslak kaydinda istemcinin bildigi surum. Verilirse yalniz sunucudaki surum hala buysa yazilir;
    # degilse (okuyucudan blok eklendi, baska sekme kaydetti) yazmaz, guncel taslagi dondurur.
    draft_rev: int | None = None


@router.patch("/collections/{cid}")
async def update_collection(cid: str, body: CollectionPatch, conn=Depends(db), user=Depends(current_user)):
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    if body.title is not None:
        await conn.execute("UPDATE collections SET title=$1 WHERE id=$2 AND user_id=$3",
                           body.title, cid, user["id"])
    if body.description is not None:
        await conn.execute("UPDATE collections SET description=$1 WHERE id=$2 AND user_id=$3",
                           body.description, cid, user["id"])
    if body.draft is not None:
        if body.draft_rev is None:
            # eski istemci: kosulsuz yazar (geriye uyum)
            rev = await conn.fetchval(
                "UPDATE collections SET draft=$1, draft_at=now(), draft_rev=COALESCE(draft_rev,0)+1 "
                "WHERE id=$2 AND user_id=$3 RETURNING draft_rev", body.draft, cid, user["id"])
            return {"ok": True, "draft_rev": int(rev or 0)}
        rev = await conn.fetchval(
            "UPDATE collections SET draft=$1, draft_at=now(), draft_rev=COALESCE(draft_rev,0)+1 "
            "WHERE id=$2 AND user_id=$3 AND COALESCE(draft_rev,0)=$4 RETURNING draft_rev",
            body.draft, cid, user["id"], int(body.draft_rev))
        if rev is None:
            cur = await conn.fetchrow("SELECT draft, COALESCE(draft_rev,0) AS draft_rev FROM collections WHERE id=$1 AND user_id=$2",
                                      cid, user["id"])
            return {"ok": False, "conflict": True, "draft": cur["draft"] if cur else None,
                    "draft_rev": int(cur["draft_rev"]) if cur else 0}
        return {"ok": True, "draft_rev": int(rev)}
    return {"ok": True}


async def _source_split(conn, cid: str, user) -> tuple[list, list]:
    """Defterin kaynaklari: (yalniz bu defterde olanlar, baska defterlerde de olanlar)."""
    rows = await conn.fetch(
        """SELECT d.id, d.file_path,
                  EXISTS (SELECT 1 FROM document_collections o
                          WHERE o.document_id = d.id AND o.collection_id <> $1) AS shared
           FROM documents d JOIN document_collections l ON l.document_id = d.id
           WHERE l.collection_id=$1 AND d.user_id=$2""", cid, user["id"])
    return [r for r in rows if not r["shared"]], [r for r in rows if r["shared"]]


@router.get("/collections/{cid}/delete-preview")
async def delete_preview(cid: str, conn=Depends(db), user=Depends(current_user)):
    """Silme onayi icin: kac kaynak yalniz bu defterde (with_sources=1 ile silinir),
    kac kaynak baska defterlerde de var (silinmez, yalniz bagi kalkar)."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    only, shared = await _source_split(conn, cid, user)
    chats = await conn.fetchval("SELECT COUNT(*) FROM collection_chats WHERE collection_id=$1", cid) or 0
    return {"sources": len(only) + len(shared), "exclusive": len(only), "shared": len(shared), "chats": int(chats)}


@router.delete("/collections/{cid}")
async def delete_collection(cid: str, with_sources: bool = False, conn=Depends(db), user=Depends(current_user)):
    """Defteri siler. Varsayilan: kaynaklar Kutuphane'de kalir (yalniz baglar kalkar).
    with_sources=1: YALNIZ BASKA DEFTERE BAGLI OLMAYAN kaynaklar (dosyalari ve turetilmis verileriyle)
    kalici silinir; baska defterlerde de olanlar korunur."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    only, shared = await _source_split(conn, cid, user)
    deleted = 0
    if with_sources and only:
        from app.storage.object_store import delete_object
        for r in only:
            for k in (r["file_path"], r["file_path"] + ".pages.json", r["file_path"] + ".ocr.json",
                      r["file_path"] + ".transcript.json"):
                try:
                    await asyncio.to_thread(delete_object, k)
                except Exception:  # noqa
                    pass
        await conn.execute("DELETE FROM documents WHERE id = ANY($1::uuid[]) AND user_id=$2",
                           [str(r["id"]) for r in only], user["id"])
        deleted = len(only)
    all_ids = [str(r["id"]) for r in only + shared]
    async with conn.transaction():
        await conn.execute("DELETE FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])  # baglar CASCADE
        # geriye uyum sutunu: kalan ilk bag ya da NULL
        await membership._sync_legacy(conn, all_ids)
    return {"ok": True, "deleted_sources": deleted,
            "kept_sources": len(all_ids) - deleted, "kept_shared": len(shared)}


class LinkIn(BaseModel):
    document_ids: list[str]


@router.post("/collections/{cid}/documents")
async def add_documents(cid: str, body: LinkIn, conn=Depends(db), user=Depends(current_user)):
    """Kutuphanedeki kaynaklari deftere EKLER (baska defterlerden cikarmaz)."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    ids = []
    for x in body.document_ids or []:
        try:
            ids.append(str(uuid.UUID(str(x))))
        except Exception:  # noqa
            continue
    if not ids:
        return {"added": 0, "already": 0}
    own = [str(r["id"]) for r in await conn.fetch(
        "SELECT id FROM documents WHERE user_id=$1 AND id = ANY($2::uuid[])", user["id"], ids)]
    added = await membership.link(conn, own, cid)
    return {"added": added, "already": len(own) - added, "not_found": len(ids) - len(own)}


@router.delete("/collections/{cid}/documents/{doc_id}")
async def remove_document(cid: str, doc_id: str, conn=Depends(db), user=Depends(current_user)):
    """Kaynagi defterden cikarir: yalniz bag silinir, kaynak Kutuphane'de (ve diger defterlerde) kalir."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    try:
        doc_id = str(uuid.UUID(doc_id))
    except Exception:  # noqa
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
    own = await conn.fetchval("SELECT 1 FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not own:
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
    removed = await membership.unlink(conn, doc_id, cid)
    return {"ok": True, "removed": removed}


class AskIn(BaseModel):
    question: str
    fresh: bool = False          # True: kayitli cevabi yok say, yeniden uret
    chat_id: str | None = None   # sohbet gecmisi: bu sohbete yaz (yoksa yeni sohbet acilir)

ANSWER_SIM = 0.95                # "ayni soru" sayilacak anlam benzerligi


@router.post("/collections/{cid}/ask")
async def ask_collection(cid: str, body: AskIn, conn=Depends(db), user=Depends(current_user)):
    """Defterdeki TUM kaynaklara soru sorar ve soru-cevabi sohbet gecmisine yazar."""
    out = await _ask_core(cid, body, conn, user)
    try:
        chat_id = body.chat_id
        if chat_id:
            ok = await conn.fetchval("SELECT 1 FROM collection_chats WHERE id=$1 AND user_id=$2 AND collection_id=$3",
                                     chat_id, user["id"], cid)
            if not ok:
                chat_id = None
        if not chat_id:
            chat_id = str(uuid.uuid4())
            title = (body.question or "").strip()[:80]
            await conn.execute("INSERT INTO collection_chats (id, collection_id, user_id, title) VALUES ($1,$2,$3,$4)",
                               chat_id, cid, user["id"], title)
        await conn.execute("INSERT INTO collection_messages (chat_id, question, payload) VALUES ($1,$2,$3)",
                           chat_id, body.question.strip(), out)
        await conn.execute("UPDATE collection_chats SET updated_at=now() WHERE id=$1", chat_id)
        out = {**out, "chat_id": chat_id}
    except Exception:  # noqa - gecmis yazilamasa da cevap doner
        pass
    return out


@router.get("/collections/{cid}/chats")
async def list_chats(cid: str, conn=Depends(db), user=Depends(current_user)):
    rows = await conn.fetch(
        """SELECT c.id, c.title, c.created_at, c.updated_at,
                  (SELECT count(*) FROM collection_messages m WHERE m.chat_id=c.id) AS n
           FROM collection_chats c WHERE c.collection_id=$1 AND c.user_id=$2
           ORDER BY c.updated_at DESC LIMIT 100""", cid, user["id"])
    return [dict(r) for r in rows]


@router.get("/collections/{cid}/chats/{chat_id}")
async def get_chat(cid: str, chat_id: str, conn=Depends(db), user=Depends(current_user)):
    ok = await conn.fetchrow("SELECT id, title FROM collection_chats WHERE id=$1 AND user_id=$2 AND collection_id=$3",
                             chat_id, user["id"], cid)
    if not ok:
        raise NotFound("Sohbet bulunamadı.")
    rows = await conn.fetch("SELECT question, payload, created_at FROM collection_messages WHERE chat_id=$1 ORDER BY id",
                            chat_id)
    return {"id": chat_id, "title": ok["title"],
            "messages": [{"q": r["question"], **(r["payload"] or {}), "at": r["created_at"]} for r in rows]}


class ChatPatch(BaseModel):
    title: str


@router.patch("/collections/{cid}/chats/{chat_id}")
async def rename_chat(cid: str, chat_id: str, body: ChatPatch, conn=Depends(db), user=Depends(current_user)):
    await conn.execute("UPDATE collection_chats SET title=$1 WHERE id=$2 AND user_id=$3 AND collection_id=$4",
                       body.title.strip()[:120], chat_id, user["id"], cid)
    return {"ok": True}


@router.delete("/collections/{cid}/chats/{chat_id}")
async def delete_chat(cid: str, chat_id: str, conn=Depends(db), user=Depends(current_user)):
    await conn.execute("DELETE FROM collection_chats WHERE id=$1 AND user_id=$2 AND collection_id=$3",
                       chat_id, user["id"], cid)
    return {"ok": True}


async def _ask_core(cid: str, body: AskIn, conn, user):
    """Defterdeki TUM hazir kaynaklara birden soru sorar."""
    col = await conn.fetchrow("SELECT id, title FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    q = (body.question or "").strip()
    if len(q) < 3:
        raise AppError("Soru çok kısa; en az birkaç kelime yaz.")
    rows = await conn.fetch(
        "SELECT id FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'",
        user["id"], cid)
    ids = [str(r["id"]) for r in rows]
    if not ids:
        raise AppError(NO_READY)
    # Cevap onbellegi: ayni kaynak kumesinde ayni/cok benzer soru -> kayitli cevap (0 kota)
    import hashlib
    docs_hash = hashlib.sha1(",".join(sorted(ids)).encode()).hexdigest()[:16]
    qn = rag_service.norm_q(q)
    if not body.fresh:
        hit = await conn.fetchrow(
            "SELECT id, payload, question FROM answer_cache WHERE collection_id=$1 AND docs_hash=$2 AND qnorm=$3",
            cid, docs_hash, qn)
        if hit:
            await conn.execute("UPDATE answer_cache SET hits=hits+1, used_at=now() WHERE id=$1", hit["id"])
            return {**(hit["payload"] or {}), "cached": True, "cached_question": hit["question"]}
    q_emb = await rag_service.embed_query(conn, get_embeddings(), q)
    if not body.fresh:
        hit = await conn.fetchrow(
            """SELECT id, payload, question, 1 - (qvec <=> $3) AS sim FROM answer_cache
               WHERE collection_id=$1 AND docs_hash=$2 ORDER BY qvec <=> $3 LIMIT 1""",
            cid, docs_hash, q_emb)
        if hit and float(hit["sim"]) >= ANSWER_SIM:
            await conn.execute("UPDATE answer_cache SET hits=hits+1, used_at=now() WHERE id=$1", hit["id"])
            return {**(hit["payload"] or {}), "cached": True, "cached_question": hit["question"]}
    chunks = await rag_service.retrieve_many(conn, ids, q, get_embeddings(), q_emb=q_emb)
    if not chunks:
        return {"answer": "Bu soruya defterdeki kaynaklarda karşılık bulamadım. Soruyu farklı kelimelerle sor "
                          "ya da yeni kaynak ekle.",
                "sources": []}
    ctx = rag_service.build_context(chunks)
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen bir çalışma asistanısın. SADECE verilen kaynaklara dayanarak Türkçe cevap ver. "
            "Kaynakta olmayan bir şey uydurma. Cevabında hangi kaynağa dayandığını [K1], [K2] "
            "biçiminde belirt. Sade ve öğretici anlat.\n\n"
            "Cevabın EN SONUNA ayrı bir satırda '### Devam soruları' başlığı koy ve altına, kullanıcının "
            "bu konuda bir adım daha derine inmesini sağlayacak 3 kısa soru yaz (her biri '- ' ile başlasın, "
            "en fazla 15 kelime). Sorular kaynaklarda cevabı bulunabilecek türden olsun; tekrar etme."},
        {"role": "user", "content": f"Kaynaklar:\n\n{ctx}\n\nSoru: {q}"},
    ]
    raw = await asyncio.to_thread(llm.complete, messages, model=settings.active_llm_model)
    answer, followups = _split_followups(raw)
    sources = [{"document_id": str(c["document_id"]), "title": c.get("doc_title"),
                "page": c["page_number"], "score": round(float(c["score"]), 3),
                "snippet": re.sub(r"\s+", " ", (c.get("content") or ""))[:320]} for c in chunks]
    await annotate_media(conn, sources)
    payload = {"answer": answer, "sources": sources, "followups": followups}
    try:
        await conn.execute(
            """INSERT INTO answer_cache (collection_id, docs_hash, qnorm, question, qvec, payload)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (collection_id, docs_hash, qnorm)
               DO UPDATE SET payload=EXCLUDED.payload, question=EXCLUDED.question, used_at=now()""",
            cid, docs_hash, qn, q, q_emb, payload)
    except Exception:  # noqa - onbellek yazilamazsa cevap yine doner
        pass
    return payload


async def annotate_media(conn, sources: list[dict]):
    """Kaynak turune gore konum etiketi: videoda zaman, Word'de bolum, sunumda slayt, tabloda blok."""
    ids = list({s["document_id"] for s in sources if s.get("document_id")})
    if not ids:
        return sources
    rows = await conn.fetch(
        "SELECT id, source_type, media FROM documents WHERE id = ANY($1::uuid[]) AND COALESCE(source_type,'pdf') <> 'pdf'",
        ids)
    if not rows:
        return sources
    from app.services.youtube_service import fmt
    from app.sources.extract import UNIT
    info = {str(r["id"]): r for r in rows}
    for s in sources:
        r = info.get(s.get("document_id"))
        if not r:
            continue
        s["kind"] = r["source_type"]
        if r["source_type"] in ("youtube", "audio"):
            secs = {int(x["page"]): x["start"] for x in ((r["media"] or {}).get("sections") or [])}
            st = secs.get(int(s.get("page") or 0))
            if st is not None:
                s["start"] = st
                s["time"] = fmt(st)
        else:
            s["unit"] = UNIT.get(r["source_type"], "böl.")
    return sources


def _split_followups(text: str) -> tuple[str, list[str]]:
    """Cevabin sonundaki '### Devam sorulari' bolumunu ayirir (ek istek harcamadan gelen oneriler)."""
    m = re.search(r"\n[\s#*_]*devam\s+soru(?:lar[ıi])?[\s*_:]*\n", text or "", flags=re.I)
    if not m:
        return (text or "").strip(), []
    body, tail = text[:m.start()].rstrip(), text[m.end():]
    qs = []
    for line in tail.splitlines():
        s = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip().strip("*").strip()
        s = re.sub(r"\s*\[K\s*\d+(?:\s*[,;]\s*K?\s*\d+)*\]", "", s).strip()     # atif etiketi soruda olmasin
        if len(s) >= 8 and s not in qs:
            qs.append(s)
        if len(qs) >= 3:
            break
    return body, qs


def _suggest_digest(docs, max_chars: int = 14000) -> tuple[str, list[str]]:
    """Kaynak ozetlerinden kisa bir 'defter ozeti' (PDF'lerin tamami okunmaz)."""
    parts, concepts = [], []
    per = max(400, max_chars // max(1, len(docs)))
    for i, d in enumerate(docs, 1):
        kc = _jload(d["key_concepts"]) or []
        terms = [k.get("term") for k in kc if isinstance(k, dict) and k.get("term")][:8]
        concepts += terms
        diff = _jload(d["difficult_concepts"]) or []
        s = f"[{i}] {d['title']}\n"
        if d["purpose"]:
            s += f"Amaç: {d['purpose']}\n"
        if d["short_summary"]:
            s += f"Özet: {d['short_summary']}\n"
        if terms:
            s += "Kavramlar: " + ", ".join(terms) + "\n"
        if diff:
            s += "Zor noktalar: " + ", ".join(str(x) for x in diff[:4]) + "\n"
        parts.append(s[:per])
    # en sik gecen kavramlar one
    from collections import Counter
    freq = [t for t, _ in Counter(c.strip() for c in concepts if c).most_common(12)]
    return "\n".join(parts)[:max_chars], freq


@router.get("/collections/{cid}/suggestions")
async def suggestions(cid: str, refresh: bool = False, conn=Depends(db), user=Depends(current_user)):
    """Sohbet icin yonlendirici soru onerileri.
    Kaynak ozetlerinden TEK istekte uretilir; kaynak kumesi degismedikce onbellekten gelir (0 kota).
    Kota yoksa sablon sorulara duser."""
    col = await conn.fetchrow(
        "SELECT id, title, suggestions, suggestions_hash, suggestions_at FROM collections WHERE id=$1 AND user_id=$2",
        cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    docs = await conn.fetch(
        """SELECT id, title, short_summary, purpose, key_concepts, difficult_concepts
           FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready' ORDER BY created_at""",
        user["id"], cid)
    if not docs:
        return {"theme": "", "groups": [], "source": "bos", "documents": 0}
    h = _ctx_hash("|".join(sorted(str(d["id"]) for d in docs)))
    cached = _jload(col["suggestions"])
    if not refresh and cached and col["suggestions_hash"] == h and cached.get("groups"):
        return {**cached, "source": cached.get("source", "ai"), "cached": True, "documents": len(docs),
                "generated_at": col["suggestions_at"].isoformat() if col["suggestions_at"] else None}

    digest, freq = _suggest_digest(docs)
    try:
        data = await asyncio.to_thread(notebook_suggestions, digest, col["title"])
        if not data.get("groups"):
            raise ValueError("bos")
        data["source"] = "ai"
    except Exception as e:  # noqa - kullanim/yogunluk: sablona dus, onbellege YAZMA (sonra tekrar denensin)
        data = template_suggestions(freq, [d["title"] for d in docs])
        # reason: USAGE_LIMIT (kisinin hakki bitti) | AI_BUSY (servis yogun) | ... -> web dogru metni secer
        return {**data, "source": "sablon", "reason": getattr(e, "code", None) or "AI_UNAVAILABLE",
                "cached": False, "documents": len(docs), "generated_at": None}
    now = datetime.now(timezone.utc)
    await conn.execute(
        "UPDATE collections SET suggestions=$1, suggestions_hash=$2, suggestions_at=$3 WHERE id=$4",
        data, h, now, cid)
    return {**data, "cached": False, "documents": len(docs), "generated_at": now.isoformat()}


class FeynmanIn(BaseModel):
    concept: str
    explanation: str


@router.post("/collections/{cid}/feynman")
async def feynman(cid: str, body: FeynmanIn, conn=Depends(db), user=Depends(current_user)):
    """Anlat Bakalim: kullanicinin anlatimini kaynakla karsilastirir."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    concept = (body.concept or "").strip()
    expl = (body.explanation or "").strip()
    if len(concept) < 2:
        raise AppError("Hangi kavramı anlattığını yaz.")
    if len(expl) < 20:
        raise AppError("Biraz daha uzun anlat; en az birkaç cümle olsun.")
    rows = await conn.fetch(
        "SELECT id FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'",
        user["id"], cid)
    ids = [str(r["id"]) for r in rows]
    if not ids:
        raise AppError(NO_READY)
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
        raise NotFound(COL_MISSING)
    if not refresh and (col["lecture"] or "").strip():
        n = await conn.fetchval(
            "SELECT count(*) FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'",
            user["id"], cid)
        return {"script": col["lecture"], "title": col["title"], "documents": n,
                "cached": True, "at": col["lecture_at"].isoformat() if col["lecture_at"] else None}
    docs = await conn.fetch(
        "SELECT id, title, short_summary FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'",
        user["id"], cid)
    if not docs:
        raise AppError(NO_READY)
    ids = [str(d["id"]) for d in docs]
    rows = await conn.fetch(
        """SELECT content FROM document_chunks WHERE document_id = ANY($1::uuid[])
           ORDER BY document_id, chunk_index LIMIT 40""", ids)
    parts = [f"{d['title']}: {d['short_summary']}" for d in docs if d["short_summary"]]
    context = "\n".join(parts) + "\n\n" + "\n\n".join(r["content"] for r in rows)
    if len(context) < 200:
        raise AppError("Sesli özet için yeterli içerik yok; deftere biraz daha kaynak ekle.")
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
        raise NotFound(COL_MISSING)
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


def _raise_if_empty(err, produced: int):
    """Hic kaynak islenemediyse ve sebep yapay zeka ise (kisisel limit / servis yogun) hatayi ilet;
    boylece bos sonuc sessizce kaydedilmez ve web `code` ile dogru mesaji gosterir."""
    from app.core.errors import AiUnavailable
    if produced == 0 and isinstance(err, AiUnavailable):
        raise err


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
        raise NotFound(COL_MISSING)
    docs = await conn.fetch(
        "SELECT id FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'", user["id"], cid)
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
        raise NotFound(COL_MISSING)
    docs = await conn.fetch(
        "SELECT id, title FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready' ORDER BY created_at",
        user["id"], cid)
    if not docs:
        raise AppError(NO_READY)

    merged: dict[str, dict] = {}
    cached_n = fresh_n = 0
    last_err = None
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
        except Exception as e:  # noqa - bu kaynak atlanir; yapay zeka hatasi sonda bildirilir
            last_err = e
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

    _raise_if_empty(last_err, cached_n + fresh_n)
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
        raise NotFound(COL_MISSING)
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
        raise NotFound(COL_MISSING)
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
        raise AppError("Sözlük boş; önce deftere kaynak ekle ve işlenmesini bekle.")
    terms = [it["term"] for it in items]
    nodes = [{"id": it["term"], "kind": it["kind"], "definition": it["definition"], "mentions": it["mentions"]}
             for it in items]

    docs = await conn.fetch(
        "SELECT id, title FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready' ORDER BY created_at",
        user["id"], cid)
    edges: list[dict] = []
    seen: set[tuple] = set()
    last_err = None
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
        except Exception as e:  # noqa - bu kaynak atlanir; yapay zeka hatasi sonda bildirilir
            last_err = e
            continue
        for r in rels:
            key = (r["source"], r["target"], r["label"].lower())
            if key in seen:
                continue
            seen.add(key)
            r["document_id"] = str(d["id"]); r["document_title"] = d["title"]
            edges.append(r)
    _raise_if_empty(last_err, cached_n + fresh_n)
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
        raise NotFound(COL_MISSING)
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
        raise NotFound(COL_MISSING)
    docs = await conn.fetch(
        "SELECT id, title FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready' ORDER BY created_at",
        user["id"], cid)
    if not docs:
        raise AppError(NO_READY)
    events: list[dict] = []
    seen: set[tuple] = set()
    cached_n = fresh_n = 0
    last_err = None
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
        except Exception as e:  # noqa - bu kaynak atlanir; yapay zeka hatasi sonda bildirilir
            last_err = e
            continue
        for ev in evs:
            key = (ev["year"], ev["month"], _norm_term(ev["title"])[:40])
            if key in seen:
                continue
            seen.add(key)
            ev["document_id"] = str(d["id"]); ev["document_title"] = d["title"]
            events.append(ev)
    _raise_if_empty(last_err, cached_n + fresh_n)
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
        raise NotFound(COL_MISSING)
    text = (body.text or "").strip()
    if len(text) < 8:
        raise AppError("Metin çok kısa; en az birkaç kelime yaz.")
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
               JOIN document_collections l ON l.document_id = d.id AND l.collection_id = $2
               WHERE n.user_id=$1 AND n.selected_text IS NOT NULL AND length(n.selected_text) > 20""",
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
        raise AppError("Bu işlem yapılamadı; sayfayı yenileyip tekrar dene.")
    out = await asyncio.to_thread(llm.complete, [{"role": "system", "content": sysm}, {"role": "user", "content": usr}], model=settings.active_llm_model)
    return {"action": body.action, "text": (out or "").strip()}


class ColStudyIn(BaseModel):
    type: str = "flashcard"
    count: int = 10


@router.post("/collections/{cid}/study/generate")
async def collection_study(cid: str, body: ColStudyIn, conn=Depends(db), user=Depends(current_user)):
    """Defterdeki tum kaynaklardan karisik kart/quiz uretir."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    docs = await conn.fetch(
        "SELECT id FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'",
        user["id"], cid)
    ids = [str(d["id"]) for d in docs]
    if not ids:
        raise AppError(NO_READY)
    per = max(3, min(12, (body.count or 10)))
    rows = await conn.fetch(
        """SELECT content, document_id FROM document_chunks
           WHERE document_id = ANY($1::uuid[]) ORDER BY random() LIMIT 30""", ids)
    context = "\n\n".join(r["content"] for r in rows)
    if len(context) < 100:
        raise AppError("Kaynaklarda bunun için yeterli içerik bulunamadı; deftere biraz daha kaynak ekle.")
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
    emb = await rag_service.embed_query(conn, get_embeddings(), body.query)
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
        raise NotFound(COL_MISSING)
    docs = await conn.fetch(
        "SELECT id, title FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2 AND status='ready'",
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
            emb = await rag_service.embed_query(conn, get_embeddings(), q)
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
            "document_id": did, "title": titles.get(did, "Kaynak"),
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
        raise NotFound("Kaynak bulunamadı; silinmiş olabilir.")
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


class DiscoverIn(BaseModel):
    topic: str | None = None


@router.post("/collections/{cid}/discover")
async def discover_sources(cid: str, body: DiscoverIn, conn=Depends(db), user=Depends(current_user)):
    """Web'de bu defterin konusuna uygun kaynaklar bulur (Google aramasi destekli, 1 istek).
    Dondurulen linkler arama sonuclarindan gelir; model uydurmaz."""
    from app.sources.discover import discover
    col = await conn.fetchrow("SELECT id, title, suggestions FROM collections WHERE id=$1 AND user_id=$2",
                              cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    docs = await conn.fetch(
        "SELECT title, short_summary, source_url FROM documents d JOIN document_collections l ON l.document_id = d.id WHERE d.user_id=$1 AND l.collection_id=$2",
        user["id"], cid)
    theme = ""
    try:
        sg = col["suggestions"]
        sg = json.loads(sg) if isinstance(sg, str) else sg
        theme = (sg or {}).get("theme") or ""
    except Exception:  # noqa
        pass
    topic = (body.topic or "").strip() or theme or col["title"]
    context = " ".join(filter(None, [theme] + [f"{d['title']}: {d['short_summary'] or ''}" for d in docs[:8]]))
    exclude = {d["source_url"] for d in docs if d["source_url"]}
    return await asyncio.to_thread(discover, topic, context, exclude)
