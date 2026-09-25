"""Taslak (defter duzeyi) yardimci uclari:

- GET  /collections/{cid}/draft            -> {draft, draft_rev}   (acik taslak sayfasi tazelemesi icin, hafif)
- POST /collections/{cid}/draft/blocks     -> mevcut taslagin SONUNA atomik blok ekler (okuyucudan "Taslaga ekle")
- POST /collections/{cid}/similarity       -> yapay zeka KULLANMADAN benzerlik (intihal) uyarisi

Taslak bicimi (web DraftEditor.parseDraft ile ayni):
  JSON {"v":1, "blocks":[{id,type:"p"|"h"|"quote"|"answer",...}]}; eski duz metin taslak
  bos satirla ayrilmis paragraflar olarak okunur.
Eszamanlilik: collections.draft_rev her yazimda 1 artar. PATCH /collections/{cid} `draft_rev`
gonderirse yalniz o surum hala gecerliyse yazar (bkz. collections.update_collection).
"""
import json
import re
import unicodedata
import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.errors import AppError, NotFound
from app.deps import current_user, db

router = APIRouter(tags=["drafts"])

COL_MISSING = "Defter bulunamadı; silinmiş olabilir. Defterler sayfasına dön."


# ---------------------------------------------------------------- taslak okuma / yazma
def _uid() -> str:
    return uuid.uuid4().hex[:8]


def parse_draft(raw: str | None) -> list[dict]:
    """DraftEditor.parseDraft ile ayni mantik (bos taslak -> bos liste)."""
    if not raw or not raw.strip():
        return []
    try:
        j = json.loads(raw)
        if isinstance(j, dict) and isinstance(j.get("blocks"), list):
            return [b for b in j["blocks"] if isinstance(b, dict)]
    except Exception:  # noqa
        pass
    # eski duz metin taslak -> paragraflar
    out = []
    for t in re.split(r"\n{2,}", raw):
        t = t.strip()
        if t:
            out.append({"id": _uid(), "type": "p", "text": t})
    return out


def serialize_draft(blocks: list[dict]) -> str:
    return json.dumps({"v": 1, "blocks": blocks}, ensure_ascii=False)


def _is_empty_p(b: dict) -> bool:
    return b.get("type") == "p" and not (b.get("text") or "").strip()


@router.get("/collections/{cid}/draft")
async def get_draft(cid: str, conn=Depends(db), user=Depends(current_user)):
    row = await conn.fetchrow("SELECT draft, COALESCE(draft_rev,0) AS draft_rev, draft_at FROM collections WHERE id=$1 AND user_id=$2",
                              cid, user["id"])
    if not row:
        raise NotFound(COL_MISSING)
    return {"draft": row["draft"], "draft_rev": int(row["draft_rev"]),
            "draft_at": row["draft_at"].isoformat() if row["draft_at"] else None}


class BlocksIn(BaseModel):
    blocks: list[dict[str, Any]]


def _clean(s: Any, n: int) -> str:
    return re.sub(r"[ \t]+", " ", str(s or "")).strip()[:n]


@router.post("/collections/{cid}/draft/blocks")
async def append_blocks(cid: str, body: BlocksIn, conn=Depends(db), user=Depends(current_user)):
    """Bloklari taslagin sonuna ekler. Satir kilidi (FOR UPDATE) ile: ayni anda gelen iki ekleme
    ya da taslak kaydi birbirini ezmez. Taslak sayfasi acikken eklenen bloklar DraftEditor'da
    draft_rev karsilastirmasiyla korunur."""
    if not body.blocks:
        raise AppError("Eklenecek bir şey yok; önce metin seç.")
    if len(body.blocks) > 20:
        raise AppError("Tek seferde en fazla 20 parça eklenebilir.")
    # alinti bloklarinin kaynagi kullanicinin olmali; baslik sunucudan dogrulanir
    doc_ids = list({str(b.get("document_id")) for b in body.blocks if b.get("document_id")})
    titles: dict[str, str] = {}
    if doc_ids:
        try:
            rows = await conn.fetch("SELECT id, title FROM documents WHERE id = ANY($1::uuid[]) AND user_id=$2",
                                    doc_ids, user["id"])
        except Exception:  # gecersiz uuid
            rows = []
        titles = {str(r["id"]): r["title"] for r in rows}
    clean: list[dict] = []
    for b in body.blocks:
        t = b.get("type")
        if t == "quote":
            text = _clean(re.sub(r"\s+", " ", str(b.get("text") or "")), 4000)
            did = str(b.get("document_id") or "")
            if not text or did not in titles:
                continue
            page = b.get("page")
            try:
                page = int(page) if page is not None else None
            except Exception:  # noqa
                page = None
            q = {"id": _uid(), "type": "quote", "text": text, "source": _clean(b.get("source") or titles[did], 300) or titles[did],
                 "page": page, "document_id": did, "color": _clean(b.get("color"), 20) or None}
            note = _clean(b.get("note"), 2000)
            if note:
                q["note"] = note
            clean.append(q)
        elif t in ("p", "h"):
            text = str(b.get("text") or "").strip()[:8000]
            if text:
                clean.append({"id": _uid(), "type": t, "text": text})
    if not clean:
        raise AppError("Bu metin taslağa eklenemedi; kaynağı yenileyip tekrar dene.")
    async with conn.transaction():
        row = await conn.fetchrow(
            "SELECT draft, COALESCE(draft_rev,0) AS draft_rev FROM collections WHERE id=$1 AND user_id=$2 FOR UPDATE",
            cid, user["id"])
        if not row:
            raise NotFound(COL_MISSING)
        blocks = parse_draft(row["draft"])
        while blocks and _is_empty_p(blocks[-1]):     # sondaki bos paragraflar yeni kartin altina
            blocks.pop()
        blocks.extend(clean)
        blocks.append({"id": _uid(), "type": "p", "text": ""})   # kartin altina yazmak icin
        rev = await conn.fetchval(
            "UPDATE collections SET draft=$1, draft_at=now(), draft_rev=COALESCE(draft_rev,0)+1 "
            "WHERE id=$2 AND user_id=$3 RETURNING draft_rev",
            serialize_draft(blocks), cid, user["id"])
    return {"ok": True, "added": len(clean), "block_ids": [b["id"] for b in clean], "draft_rev": int(rev)}


# ---------------------------------------------------------------- benzerlik (yapay zekasiz)
_FOLD = str.maketrans({"ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "â": "a", "î": "i", "û": "u"})
_WORD = re.compile(r"\w+", re.UNICODE)
SHINGLE = 5

# Arama sorgusundan cikarilan cok sik kelimeler (katlanmis bicim)
_STOP = set("""
ve veya ile ama fakat ancak ki de da bu su o bir iki uc icin gibi kadar daha en cok az her hic ne
mi mu mı mü olan olarak olan olup oldu olur olmak olmasi olarak ise ya yani hem diye sonra once
gore karsi ayni kendi bunu bunun buna sunu onun ona onu bunlar onlar biz siz ben sen var yok
the and of to in a is that for on with as by are be this from or an at it its
""".split())


def _norm_word(w: str) -> str:
    """Turkceye uygun kucuk harf + aksan katlama (I->ı->i, İ->i, ş->s ...)."""
    w = w.replace("I", "ı").replace("İ", "i").lower()
    w = unicodedata.normalize("NFKD", w)
    w = "".join(ch for ch in w if not unicodedata.combining(ch))
    return w.translate(_FOLD)


def _tokens(text: str) -> list[tuple[str, int, int]]:
    """(normal kelime, baslangic, bitis) — ozgun metinde kesit gostermek icin konumlar korunur."""
    out = []
    for m in _WORD.finditer(text):
        w = m.group(0)
        if w.isdigit() and len(w) > 6:
            continue
        out.append((_norm_word(w), m.start(), m.end()))
    return out


def _shingles(words: list[str]) -> set[tuple[str, ...]]:
    return {tuple(words[i:i + SHINGLE]) for i in range(len(words) - SHINGLE + 1)}


def _longest_common_run(a: list[str], b: list[str]) -> tuple[int, int]:
    """En uzun ortak ardışık kelime dizisi: (uzunluk, b'deki bitis indeksi). O(eslesen cift)."""
    pos: dict[str, list[int]] = {}
    for j, w in enumerate(b):
        pos.setdefault(w, []).append(j)
    best, best_end = 0, -1
    prev: dict[int, int] = {}
    for w in a:
        cur: dict[int, int] = {}
        for j in pos.get(w, ()):
            v = prev.get(j - 1, 0) + 1
            cur[j] = v
            if v > best:
                best, best_end = v, j
        prev = cur
    return best, best_end


def _dehyphen(text: str) -> str:
    # PDF satir sonu tirelemesi: "geliş-\n tirme" -> "geliştirme"
    return re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text or "")


_QUOTE_CHARS = "\"“”«»„‘’'"
_CITE = re.compile(r"\((?:[^()]{0,80}?\d{4}[a-z]?|s\.?\s*\d+|p\.?\s*\d+)[^()]{0,40}\)|\[K?\d+\]|—\s*\S+|s\.\s*\d+", re.IGNORECASE)


def _is_marked_quote(text: str) -> bool:
    """Tirnak icinde ve atif tasiyan paragraf: alinti olarak isaretli sayilir, uyari verilmez."""
    t = text.strip()
    inside = re.findall(r"[\"“«„](.+?)[\"”»“]", t, flags=re.S)
    quoted_len = sum(len(x) for x in inside)
    return quoted_len >= 0.6 * max(1, len(t)) and bool(_CITE.search(t))


def _query_terms(words: list[str], raw_tokens: list[str]) -> str:
    """Anlamli kelimelerden OR sorgusu (en uzun 18 farkli kelime). Aramada ozgun (katlanmamis)
    kucuk harf kullanilir; tsvector('simple') aksanlari korur."""
    seen: set[str] = set()
    pick: list[tuple[int, str]] = []
    for norm, raw in zip(words, raw_tokens):
        if len(norm) < 4 or norm in _STOP or norm.isdigit():
            continue
        low = raw.replace("I", "ı").replace("İ", "i").lower()
        low = re.sub(r"[^\w]", "", low)
        if not low or low in seen:
            continue
        seen.add(low)
        pick.append((len(norm), low))
    pick.sort(key=lambda x: -x[0])
    return " or ".join(w for _, w in pick[:18])


class SimPara(BaseModel):
    id: str
    text: str


class SimilarityIn(BaseModel):
    paragraphs: list[SimPara]


@router.post("/collections/{cid}/similarity")
async def similarity(cid: str, body: SimilarityIn, conn=Depends(db), user=Depends(current_user)):
    """Taslak paragraflarini defterin kaynak metinleriyle karsilastirir (yapay zekasiz, ucretsiz).
    kapsama = paragrafin 5 kelimelik parcalarinin kaynakta gecme orani; ayrica en uzun ortak dizi.
    yuksek: kapsama >= 0.35 ya da >= 12 kelimelik ortak dizi; orta: 0.20-0.35."""
    col = await conn.fetchrow("SELECT id FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not col:
        raise NotFound(COL_MISSING)
    docs = await conn.fetch(
        """SELECT d.id, d.title, COALESCE(d.source_type,'pdf') AS source_type
           FROM documents d JOIN document_collections l ON l.document_id = d.id
           WHERE d.user_id=$1 AND l.collection_id=$2 AND d.status='ready'""", user["id"], cid)
    paras = [p for p in body.paragraphs if len((p.text or "").split()) >= 12][:60]
    checked = len(paras)
    if not docs:
        return {"results": [], "quoted": [], "checked": checked, "counts": {"yuksek": 0, "orta": 0},
                "note": "Bu defterde henüz hazır kaynak yok; karşılaştıracak metin bulunamadı."}
    ids = [str(d["id"]) for d in docs]
    meta = {str(d["id"]): d for d in docs}

    results: list[dict] = []
    quoted: list[str] = []
    for p in paras:
        text = (p.text or "")[:6000]
        if _is_marked_quote(text):
            quoted.append(p.id)
            continue
        ptoks = _tokens(text)
        pwords = [t[0] for t in ptoks][:500]
        pshing = _shingles(pwords)
        if not pshing:
            continue
        q = _query_terms(pwords, [text[s:e] for _, s, e in ptoks][:500])
        if not q:
            continue
        try:
            rows = await conn.fetch(
                """SELECT dc.document_id, dc.page_number, dc.content,
                          ts_rank_cd(dc.content_tsv, websearch_to_tsquery('simple', $1)) AS r
                   FROM document_chunks dc
                   WHERE dc.document_id = ANY($2::uuid[])
                     AND dc.content_tsv @@ websearch_to_tsquery('simple', $1)
                   ORDER BY r DESC LIMIT 8""", q, ids)
        except Exception:  # noqa  (bozuk sorgu metni vb.)
            rows = []
        best = None
        for r in rows:
            src = _dehyphen(r["content"] or "")
            stoks = _tokens(src)[:6000]
            swords = [t[0] for t in stoks]
            if len(swords) < SHINGLE:
                continue
            common = pshing & _shingles(swords)
            cov = len(common) / len(pshing)
            run, run_end = _longest_common_run(pwords, swords)
            key = (cov, run)
            if best is None or key > best["key"]:
                best = {"key": key, "cov": cov, "run": run, "run_end": run_end, "row": r, "stoks": stoks, "src": src}
        if not best:
            continue
        cov, run = best["cov"], best["run"]
        if cov >= 0.35 or run >= 12:
            level = "yuksek"
        elif cov >= 0.20:
            level = "orta"
        else:
            continue
        # kaynakta eslesen kisa kesit: en uzun ortak dizinin cevresi (en fazla ~320 karakter)
        stoks, src = best["stoks"], best["src"]
        match = ""
        if best["run_end"] >= 0 and run > 0:
            i0 = max(0, best["run_end"] - run + 1)
            i1 = best["run_end"]
            a, b = stoks[i0][1], stoks[i1][2]
            if b - a > 320:
                b = a + 320
            pre = max(0, a - 60)
            match = ("…" if pre > 0 else "") + re.sub(r"\s+", " ", src[pre:b]).strip() + ("…" if b < len(src) else "")
        r = best["row"]
        d = meta.get(str(r["document_id"]))
        results.append({
            "id": p.id, "level": level, "score": round(cov, 3), "longest": int(run),
            "source": {"document_id": str(r["document_id"]), "title": d["title"] if d else "Kaynak",
                       "page": r["page_number"], "source_type": d["source_type"] if d else "pdf"},
            "match": match,
        })
    counts = {"yuksek": sum(1 for x in results if x["level"] == "yuksek"),
              "orta": sum(1 for x in results if x["level"] == "orta")}
    return {"results": results, "quoted": quoted, "checked": checked, "counts": counts}
