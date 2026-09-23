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
                    "note: Türkçe, en fazla 20 kelime; neden bu karar, varsa düzeltme önerisi.\n"
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
