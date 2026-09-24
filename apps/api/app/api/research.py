"""Arastirma araclari:
- /verify  : taslaktaki her iddia cumlesini defterin kaynaklariyla karsilastirir
             (destekleniyor / kismen / kaynakta yok / celisiyor) + kanit.
- /compare : bir konuda her kaynagin ne dedigini yan yana koyar; uyusma ve celiskileri bulur.
Ikisi de sonuclari saklar: ayni metin/konu tekrar sorulursa kota harcanmaz.
"""
import asyncio
import hashlib
import json
import re
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.deps import db, current_user
from app.services import rag_service
from app.ai.factory import get_embeddings, get_llm
from app.core.errors import NotFound, AppError
from app.config import settings

router = APIRouter(tags=["research"])

VERDICTS = {"destek": "Destekleniyor", "kismi": "Kısmen", "yok": "Kaynakta yok", "celiski": "Çelişiyor"}

VERIFY_SCHEMA = {"name": "verify", "schema": {"type": "object", "properties": {"items": {"type": "array", "items": {
    "type": "object", "properties": {
        "i": {"type": "integer"}, "verdict": {"type": "string", "enum": list(VERDICTS)},
        "evidence": {"type": "integer"}, "note": {"type": "string"}},
    "required": ["i", "verdict", "evidence", "note"]}}}, "required": ["items"]}}

COMPARE_SCHEMA = {"name": "compare", "schema": {"type": "object", "properties": {
    "summary": {"type": "string"},
    "positions": {"type": "array", "items": {"type": "object", "properties": {
        "source": {"type": "integer"}, "stance": {"type": "string", "enum": ["destekliyor", "karsi", "karma", "notr"]},
        "claim": {"type": "string"}, "evidence": {"type": "integer"}},
        "required": ["source", "stance", "claim", "evidence"]}},
    "conflicts": {"type": "array", "items": {"type": "object", "properties": {
        "about": {"type": "string"}, "explanation": {"type": "string"},
        "sides": {"type": "array", "items": {"type": "object", "properties": {
            "source": {"type": "integer"}, "claim": {"type": "string"}}, "required": ["source", "claim"]}}},
        "required": ["about", "sides", "explanation"]}},
    "agreements": {"type": "array", "items": {"type": "string"}},
    "gaps": {"type": "array", "items": {"type": "string"}}},
    "required": ["summary", "positions", "conflicts", "agreements", "gaps"]}}


async def _ready_docs(conn, cid, user):
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Defter bulunamadı.")
    rows = await conn.fetch(
        "SELECT id, title FROM documents WHERE user_id=$1 AND collection_id=$2 AND status='ready'", user["id"], cid)
    if not rows:
        raise AppError("Bu defterde hazır kaynak yok.")
    ids = [str(r["id"]) for r in rows]
    return ids, {str(r["id"]): r["title"] for r in rows}, hashlib.sha1(",".join(sorted(ids)).encode()).hexdigest()[:16]


async def _cache_get(conn, cid, docs_hash, key):
    row = await conn.fetchrow("SELECT payload FROM answer_cache WHERE collection_id=$1 AND docs_hash=$2 AND qnorm=$3",
                              cid, docs_hash, key)
    return row["payload"] if row else None


async def _cache_put(conn, cid, docs_hash, key, question, payload):
    try:
        await conn.execute(
            """INSERT INTO answer_cache (collection_id, docs_hash, qnorm, question, payload) VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (collection_id, docs_hash, qnorm) DO UPDATE SET payload=EXCLUDED.payload, used_at=now()""",
            cid, docs_hash, key, question[:500], payload)
    except Exception:  # noqa
        pass


async def _evidence(conn, ids, vec, k=3, per_doc=None):
    rows = await conn.fetch(
        """SELECT dc.document_id, dc.page_number, dc.section_title, dc.content, d.title AS doc_title,
                  1 - (dc.embedding <=> $1) AS score
           FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
           WHERE dc.document_id = ANY($2::uuid[]) AND dc.embedding IS NOT NULL
           ORDER BY dc.embedding <=> $1 LIMIT $3""", vec, ids, 40 if per_doc else k)
    rows = [dict(r) for r in rows]
    if per_doc:
        seen, out = {}, []
        for r in rows:
            d = str(r["document_id"])
            if seen.get(d, 0) < per_doc:
                seen[d] = seen.get(d, 0) + 1
                out.append(r)
        return out
    return rows


def _sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text or "").strip()
    parts = re.split(r"(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ0-9\"“(])", text)
    return [p.strip() for p in parts if len(p.split()) >= 6]


# ------------------------------------------------------------------ dogrulayici
class VerifyItem(BaseModel):
    block_id: str
    text: str


class VerifyIn(BaseModel):
    items: list[VerifyItem]


@router.post("/collections/{cid}/verify")
async def verify(cid: str, body: VerifyIn, conn=Depends(db), user=Depends(current_user)):
    """Taslak paragraflarindaki iddialari kaynaklarla karsilastirir. Degismeyen cumleler kota harcamaz."""
    from app.api.collections import annotate_media
    ids, titles, docs_hash = await _ready_docs(conn, cid, user)
    sents = []
    for it in body.items:
        for s in _sentences(it.text):
            sents.append({"block_id": it.block_id, "sentence": s})
    if not sents:
        raise AppError("Doğrulanacak iddia cümlesi bulunamadı (en az 6 kelimelik cümleler kontrol edilir).")
    sents = sents[:40]
    keys = ["vf:" + hashlib.sha1(rag_service.norm_q(s["sentence"]).encode()).hexdigest() for s in sents]
    results: list[dict | None] = []
    for k in keys:
        results.append(await _cache_get(conn, cid, docs_hash, k))
    todo = [i for i, r in enumerate(results) if r is None]
    if todo:
        vecs = await asyncio.to_thread(get_embeddings().embed, [sents[i]["sentence"] for i in todo])
        evid = {}
        for i, v in zip(todo, vecs):
            evid[i] = await _evidence(conn, ids, v, k=3)
        llm = get_llm()
        for start in range(0, len(todo), 10):
            batch = todo[start:start + 10]
            blocks = []
            for n, i in enumerate(batch):
                ev = "\n".join(f"  E{j + 1} [{e['doc_title']}, s.{e['page_number']}]: {e['content'][:600]}"
                               for j, e in enumerate(evid[i]))
                blocks.append(f"İDDİA {n}: {sents[i]['sentence']}\nKANITLAR:\n{ev or '  (yok)'}")
            messages = [
                {"role": "system", "content":
                    "Sen titiz bir akademik doğrulayıcısın. Her İDDİA'yı YALNIZCA altındaki KANITLAR'a göre değerlendir, "
                    "genel bilgini kullanma.\n"
                    "verdict: destek (kanıt iddiayı açıkça doğruluyor), kismi (kısmen ya da daha zayıf/koşullu doğruluyor), "
                    "yok (kanıtlarda bu konuda bilgi yok), celiski (kanıt iddianın tersini söylüyor).\n"
                    "evidence: en ilgili kanıtın numarası (1-3), yoksa 0.\n"
                    "note: Türkçe, en fazla 20 kelime; neden bu karar, varsa düzeltme önerisi. 'E1/E2' gibi "
                    "numara ya da 'kanıt' kelimesi yazma; doğrudan içeriği söyle (örn. 'Kaynak 2-3 dakika diyor').\n"
                    "i: İDDİA numarası."},
                {"role": "user", "content": "\n\n".join(blocks)},
            ]
            try:
                raw = await asyncio.to_thread(llm.structured, messages, VERIFY_SCHEMA, settings.active_llm_model)
                items = {int(x.get("i", -1)): x for x in (json.loads(raw).get("items") or [])}
            except AppError:
                raise
            except Exception:  # noqa
                items = {}
            for n, i in enumerate(batch):
                x = items.get(n) or {}
                v = x.get("verdict") if x.get("verdict") in VERDICTS else "yok"
                ei = int(x.get("evidence") or 0)
                e = evid[i][ei - 1] if 1 <= ei <= len(evid[i]) else (evid[i][0] if evid[i] and v != "yok" else None)
                res = {"verdict": v, "note": (x.get("note") or "").strip()[:200],
                       "evidence": ({"document_id": str(e["document_id"]), "title": e["doc_title"],
                                     "page": e["page_number"], "text": e["content"][:400]} if e else None)}
                if x:                                    # yalniz gercek cevaplari sakla
                    await _cache_put(conn, cid, docs_hash, keys[i], sents[i]["sentence"], res)
                results[i] = res
    out = []
    for s, r in zip(sents, results):
        out.append({**s, **(r or {"verdict": "yok", "note": "", "evidence": None})})
    evs = [o["evidence"] for o in out if o.get("evidence")]
    await annotate_media(conn, evs)
    counts = {k: sum(1 for o in out if o["verdict"] == k) for k in VERDICTS}
    return {"results": out, "counts": counts, "checked": len(out), "from_cache": len(sents) - len(todo)}


# ------------------------------------------------------------------ karsilastirma
class CompareIn(BaseModel):
    topic: str
    fresh: bool = False


@router.post("/collections/{cid}/compare")
async def compare(cid: str, body: CompareIn, conn=Depends(db), user=Depends(current_user)):
    """Bir konu hakkinda her kaynagin tutumunu, uyusmalari ve celiskileri cikarir (1 istek, sonuc saklanir)."""
    from app.api.collections import annotate_media
    topic = (body.topic or "").strip()
    if len(topic) < 3:
        raise AppError("Karşılaştırılacak konuyu yaz.")
    ids, titles, docs_hash = await _ready_docs(conn, cid, user)
    key = "cmp:" + rag_service.norm_q(topic)
    if not body.fresh:
        hit = await _cache_get(conn, cid, docs_hash, key)
        if hit:
            return {**hit, "cached": True}
    vec = await rag_service.embed_query(conn, get_embeddings(), topic)
    chunks = [c for c in await _evidence(conn, ids, vec, per_doc=2) if float(c["score"]) >= 0.25][:16]
    if not chunks:
        raise AppError("Bu konu kaynaklarda geçmiyor gibi görünüyor.")
    docs = []
    for c in chunks:
        d = str(c["document_id"])
        if d not in docs:
            docs.append(d)
    if len(docs) < 2:
        raise AppError("Bu konu yalnızca tek bir kaynakta geçiyor; karşılaştırma için en az iki kaynak gerekli.")
    lines = []
    for si, d in enumerate(docs, 1):
        lines.append(f"KAYNAK {si}: {titles.get(d, 'Kaynak')}")
        for ci, c in enumerate([c for c in chunks if str(c["document_id"]) == d], 1):
            lines.append(f"  P{si}.{ci} (s.{c['page_number']}): {c['content'][:900]}")
    llm = get_llm()
    messages = [
        {"role": "system", "content":
            "Sen bir literatür analistisin. Verilen konu hakkında her KAYNAK'ın ne dediğini YALNIZCA verilen pasajlara "
            "dayanarak çıkar. Türkçe yaz.\n"
            "summary: 2-3 cümlelik genel tablo (kaynaklar genel olarak ne diyor, nerede ayrışıyor).\n"
            "positions: her kaynak için bir kayıt; source=KAYNAK numarası; stance konuya/ana iddiaya göre "
            "destekliyor|karsi|karma|notr; claim: kaynağın söylediği en fazla 30 kelime; evidence: o kaynağın "
            "pasaj sıra numarası (P2.1 için 1).\n"
            "conflicts: kaynakların gerçekten birbirine ters düştüğü noktalar (yoksa boş liste); explanation: "
            "farkın olası nedeni (yöntem, örneklem, doz, dönem vb.) en fazla 30 kelime.\n"
            "agreements: kaynakların ortaklaştığı bulgular (en fazla 5).\n"
            "gaps: kaynakların cevaplamadığı önemli sorular (en fazla 3). Uydurma yapma."},
        {"role": "user", "content": f"KONU: {topic}\n\n" + "\n".join(lines)},
    ]
    raw = await asyncio.to_thread(llm.structured, messages, COMPARE_SCHEMA, settings.active_llm_model)
    try:
        data = json.loads(raw)
    except Exception:  # noqa
        raise AppError("Karşılaştırma üretilemedi; tekrar dene.")

    def src(i):
        try:
            d = docs[int(i) - 1]
        except Exception:  # noqa
            return None
        return {"document_id": d, "title": titles.get(d, "Kaynak")}

    positions = []
    for p in data.get("positions") or []:
        s = src(p.get("source"))
        if not s:
            continue
        own = [c for c in chunks if str(c["document_id"]) == s["document_id"]]
        ei = int(p.get("evidence") or 1)
        e = own[ei - 1] if 1 <= ei <= len(own) else (own[0] if own else None)
        positions.append({**s, "stance": p.get("stance") or "notr", "claim": (p.get("claim") or "").strip(),
                          "page": e["page_number"] if e else None, "quote": (e["content"][:300] if e else "")})
    conflicts = []
    for c in data.get("conflicts") or []:
        sides = [{**src(x.get("source")), "claim": x.get("claim", "")} for x in c.get("sides") or [] if src(x.get("source"))]
        if len(sides) >= 2:
            conflicts.append({"about": c.get("about", ""), "explanation": c.get("explanation", ""), "sides": sides})
    await annotate_media(conn, positions)
    out = {"topic": topic, "summary": data.get("summary", ""), "positions": positions, "conflicts": conflicts,
           "agreements": [a for a in data.get("agreements") or [] if a][:5],
           "gaps": [g for g in data.get("gaps") or [] if g][:3], "sources_used": len(docs)}
    await _cache_put(conn, cid, docs_hash, key, topic, out)
    return out


# ------------------------------------------------------------------ konu gruplari (otomatik etiket)
TOPICS_SCHEMA = {"name": "topics", "schema": {"type": "object", "properties": {"groups": {"type": "array", "items": {
    "type": "object", "properties": {
        "label": {"type": "string"}, "description": {"type": "string"},
        "sources": {"type": "array", "items": {"type": "integer"}}},
    "required": ["label", "description", "sources"]}}}, "required": ["groups"]}}


def _concepts(v) -> str:
    try:
        v = json.loads(v) if isinstance(v, str) else v
        return ", ".join((x.get("term") if isinstance(x, dict) else str(x)) for x in (v or [])[:6])
    except Exception:  # noqa
        return ""


@router.get("/collections/{cid}/topics")
async def topics(cid: str, refresh: bool = False, conn=Depends(db), user=Depends(current_user)):
    """Defterdeki kaynaklari konulara gore gruplar (1 istek). Kaynak kumesi degismedikce kayitli
    sonuc doner. Her kaynagin konu etiketi Kutuphane etiketlerine de yazilir (filtrelenebilir)."""
    col = await conn.fetchrow("SELECT id, topics FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Defter bulunamadı.")
    rows = await conn.fetch(
        """SELECT id, title, short_summary, key_concepts, tags FROM documents
           WHERE user_id=$1 AND collection_id=$2 AND status='ready' ORDER BY created_at""", user["id"], cid)
    if len(rows) < 3:
        return {"groups": [], "reason": "Konu grupları en az 3 hazır kaynakla oluşur."}
    ids = [str(r["id"]) for r in rows]
    h = hashlib.sha1(",".join(sorted(ids)).encode()).hexdigest()[:16]
    old = col["topics"]
    old = json.loads(old) if isinstance(old, str) else old
    if old and old.get("hash") == h and not refresh:
        return {**old, "cached": True}
    lines = [f"KAYNAK {i}: {r['title']} — {(r['short_summary'] or '')[:260]} [{_concepts(r['key_concepts'])}]"
             for i, r in enumerate(rows, 1)]
    messages = [
        {"role": "system", "content":
            "Bir araştırma defterindeki kaynakları konularına göre gruplayacaksın. Türkçe yaz.\n"
            f"- 2 ile {min(7, max(2, len(rows) // 2))} arası grup oluştur; her kaynak TAM OLARAK bir gruba girsin.\n"
            "- label: en fazla 3 kelime, somut ve ayırt edici (ör. 'Kreatin güvenliği', 'Protein zamanlaması'); "
            "'Genel', 'Diğer', 'Çeşitli' gibi boş etiketler kullanma (gerçekten başka yere uymayan tek kaynak hariç).\n"
            "- description: grubun neyi kapsadığı, en fazla 12 kelime.\n"
            "- sources: gruptaki KAYNAK numaraları."},
        {"role": "user", "content": "\n".join(lines)},
    ]
    raw = await asyncio.to_thread(get_llm().structured, messages, TOPICS_SCHEMA, settings.active_llm_model)
    try:
        data = json.loads(raw)
    except Exception:  # noqa
        raise AppError("Konu grupları oluşturulamadı; tekrar dene.")
    seen, groups = set(), []
    for g in data.get("groups") or []:
        members = []
        for n in g.get("sources") or []:
            try:
                d = ids[int(n) - 1]
            except Exception:  # noqa
                continue
            if d not in seen:
                seen.add(d); members.append(d)
        label = (g.get("label") or "").strip()[:40]
        if members and label:
            groups.append({"label": label, "description": (g.get("description") or "").strip()[:120], "docs": members})
    rest = [d for d in ids if d not in seen]
    if rest:
        groups.append({"label": "Diğer", "description": "Belirgin bir gruba girmeyen kaynaklar", "docs": rest})
    # Kutuphane etiketleri: eski otomatik etiketleri kaldir, yenisini ekle (elle girilenlere dokunma)
    old_labels = {g["label"] for g in (old or {}).get("groups", [])}
    label_of = {d: g["label"] for g in groups for d in g["docs"]}
    for r in rows:
        cur = r["tags"]
        cur = json.loads(cur) if isinstance(cur, str) else (cur or [])
        cur = [t for t in cur if t not in old_labels]
        lab = label_of.get(str(r["id"]))
        if lab and lab != "Diğer" and lab not in cur:
            cur.append(lab)
        await conn.execute("UPDATE documents SET tags=$1 WHERE id=$2", cur, r["id"])
    out = {"hash": h, "groups": groups}
    await conn.execute("UPDATE collections SET topics=$1 WHERE id=$2", out, cid)
    return out


# ------------------------------------------------------------------ otomatik kaynakca
# Her kaynagin kunyesi (yazar, yil, baslik, dergi/yayinci, DOI...) bir kez cikarilir ve saklanir.
# Video/web icin yapay zeka gerekmez; PDF/Word icin ilk sayfadan 8'li gruplar halinde tek istek.
CITE_SCHEMA = {"name": "cite", "schema": {"type": "object", "properties": {"items": {"type": "array", "items": {
    "type": "object", "properties": {
        "i": {"type": "integer"}, "type": {"type": "string"},
        "authors": {"type": "array", "items": {"type": "string"}}, "year": {"type": "string"},
        "title": {"type": "string"}, "container": {"type": "string"}, "publisher": {"type": "string"},
        "volume": {"type": "string"}, "issue": {"type": "string"}, "pages": {"type": "string"},
        "doi": {"type": "string"}},
    "required": ["i", "type", "authors", "year", "title"]}}}, "required": ["items"]}}

CITE_FIELDS = ("type", "authors", "year", "title", "container", "publisher", "volume", "issue", "pages", "doi")


def _clean_meta(m: dict) -> dict:
    out = {}
    for k in CITE_FIELDS:
        v = (m or {}).get(k)
        if k == "authors":
            v = [str(a).strip() for a in (v or []) if str(a).strip()][:12]
        else:
            v = str(v).strip() if v not in (None, "") else ""
        out[k] = v
    out["doi"] = re.sub(r"^https?://(dx\.)?doi\.org/", "", out.get("doi") or "", flags=re.I)
    return out


def _jd(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:  # noqa
            return None
    return v


@router.get("/collections/{cid}/bibliography")
async def bibliography(cid: str, refresh: bool = False, conn=Depends(db), user=Depends(current_user)):
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound("Defter bulunamadı.")
    rows = await conn.fetch(
        """SELECT id, title, source_type, source_url, media, created_at FROM documents
           WHERE user_id=$1 AND collection_id=$2 AND status='ready' ORDER BY title""", user["id"], cid)
    metas: dict[str, dict] = {}
    edited: set[str] = set()
    for r in await conn.fetch("SELECT document_id, payload FROM doc_extracts WHERE kind='cite' AND document_id = ANY($1::uuid[])",
                              [r["id"] for r in rows]):
        p = _jd(r["payload"]) or {}
        metas[str(r["document_id"])] = p
        if p.get("edited"):
            edited.add(str(r["document_id"]))

    todo = []
    for r in rows:
        did = str(r["id"])
        if did in edited or (did in metas and not refresh):
            continue
        kind = r["source_type"] or "pdf"
        media = _jd(r["media"]) or {}
        if kind in ("youtube", "web", "html"):
            m = _clean_meta({
                "type": "video" if kind == "youtube" else "web",
                "authors": [media.get("channel") or media.get("author")] if (media.get("channel") or media.get("author")) else [],
                "year": "", "title": r["title"], "container": "YouTube" if kind == "youtube" else (media.get("site") or ""),
            })
            metas[did] = m
            await _save_cite(conn, did, m)
        else:
            todo.append(r)

    for i in range(0, len(todo), 8):
        part = todo[i:i + 8]
        blocks = []
        for n, r in enumerate(part, 1):
            txt = await conn.fetchval(
                """SELECT string_agg(content, ' ') FROM (SELECT content FROM document_chunks WHERE document_id=$1
                   ORDER BY chunk_index LIMIT 2) t""", r["id"]) or ""
            flat = re.sub(r"\s+", " ", txt)[:1600]
            blocks.append(f"KAYNAK {n} (dosya adı: {r['title']}):\n{flat}")
        messages = [
            {"role": "system", "content":
                "Aşağıdaki her kaynağın ilk sayfa metninden kaynakça künyesini çıkar. Yalnız metinde GÖRDÜĞÜN bilgiyi yaz; "
                "emin olmadığın alanı boş bırak, uydurma. type: article | book | thesis | report | chapter | other. "
                "authors: 'Soyad, A. B.' biçiminde (Türkçe karakterleri koru). year: 4 haneli yıl. title: eserin gerçek başlığı "
                "(dosya adı değil; yoksa dosya adını düzgün yaz). container: dergi / kitap / kurum adı. publisher: yayınevi ya da "
                "üniversite. doi: yalnız 10. ile başlayan kısım."},
            {"role": "user", "content": "\n\n".join(blocks)},
        ]
        try:
            raw = await asyncio.to_thread(get_llm().structured, messages, CITE_SCHEMA, settings.active_llm_model)
            items = (json.loads(raw) or {}).get("items") or []
        except Exception:  # noqa - kota vb.: bu grup dosya adiyla kalir
            items = []
        got = {int(x.get("i", 0)): x for x in items if isinstance(x, dict)}
        for n, r in enumerate(part, 1):
            m = _clean_meta(got.get(n) or {"type": "other", "authors": [], "year": "", "title": r["title"]})
            if not m["title"]:
                m["title"] = r["title"]
            did = str(r["id"])
            metas[did] = m
            if got.get(n):
                await _save_cite(conn, did, m)

    out = []
    for r in rows:
        did = str(r["id"])
        m = _clean_meta(metas.get(did) or {"type": "other", "title": r["title"]})
        out.append({"document_id": did, "file_title": r["title"], "kind": r["source_type"] or "pdf",
                    "url": r["source_url"], "accessed": r["created_at"].date().isoformat() if r["created_at"] else None,
                    "edited": did in edited, "meta": m})
    return {"items": out}


async def _save_cite(conn, did: str, m: dict, edited: bool = False):
    p = {**m, **({"edited": True} if edited else {})}
    await conn.execute(
        """INSERT INTO doc_extracts (document_id, kind, input_hash, payload, created_at)
           VALUES ($1,'cite','v1',$2,now())
           ON CONFLICT (document_id, kind) DO UPDATE SET payload=EXCLUDED.payload, created_at=now()""",
        did, p)


class CiteIn(BaseModel):
    meta: dict


@router.put("/documents/{doc_id}/cite")
async def save_cite(doc_id: str, body: CiteIn, conn=Depends(db), user=Depends(current_user)):
    ok = await conn.fetchval("SELECT 1 FROM documents WHERE id=$1 AND user_id=$2", doc_id, user["id"])
    if not ok:
        raise NotFound("Belge bulunamadı.")
    m = _clean_meta(body.meta)
    await _save_cite(conn, doc_id, m, edited=True)
    return {"meta": m, "edited": True}
