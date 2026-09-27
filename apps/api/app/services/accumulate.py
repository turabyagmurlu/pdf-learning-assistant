"""Kendiliginden biriktirme (TY PDF 2.0 "Biriktir").

Her vurgu / alt cizgi / kenar notu, kaydedildigi anda:
  - o belgenin taslagina (documents.draft) ve
  - o belgeyi iceren her defterin taslagina (collections.draft, document_collections uzerinden)
SONA bir alinti blogu olarak eklenir. Ayni note_id bir taslakta zaten varsa tekrar eklenmez.

Blok bicimi (web DraftEditor Block "quote"):
  {id, type:"quote", text, note?, color, source, page, document_id, note_id, style, auto:true, at}
  El yazisi notu (anchor.type "ink"): style "ink", text "", ink:{strokes, box} (drafts.clean_ink sinirlari).

Kurallar:
  - Her hedef taslak kendi islemi (transaction) + satir kilidi (FOR UPDATE) ile yazilir;
    yazilan her taslakta draft_rev +1, draft_at = now().
  - Defterden belge cikarilinca bloklara DOKUNULMAZ (kullanicinin taslagidir).
  - Cagiranlar (notes.py, documents.py) hatayi yutar: not kaydi her durumda basarili doner.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Callable

from app.api.drafts import parse_draft, serialize_draft, _uid, _is_empty_p, clean_ink

log = logging.getLogger("accumulate")

# Web vurgu olustururken note_content'e "" yazar; eski/diger istemciler tur adini yazabilir.
# Bu yer tutucular "yorum" sayilmaz (blokta note alani olusmaz).
PLACEHOLDER_NOTES = {"", "vurgu", "altı çizili", "alti cizili", "altını çiz", "altini ciz",
                     "not", "kenar notu", "yeni not"}

_TABLES = ("documents", "collections")


# ---------------------------------------------------------------- saf yardimcilar (DB'siz)
def _anchor(a: Any) -> dict:
    if isinstance(a, dict):
        return a
    if isinstance(a, str) and a.strip():
        try:
            j = json.loads(a)
            return j if isinstance(j, dict) else {}
        except Exception:  # noqa
            return {}
    return {}


def note_comment(content: Any) -> str | None:
    """Vurgunun yorumu; bos ya da varsayilan yer tutucuysa None."""
    t = " ".join(str(content or "").split())
    if t.lower() in PLACEHOLDER_NOTES:
        return None
    return t[:2000]


def note_style(anchor: Any) -> str:
    a = _anchor(anchor)
    if a.get("type") == "sticky":
        return "sticky"
    if a.get("type") == "ink":
        return "ink"
    st = a.get("style")
    return st if st in ("highlight", "underline") else "highlight"


def _iso(v: Any) -> str | None:
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v) if v else None


def build_quote_block(note: dict, title: str | None, *, auto: bool = True) -> dict | None:
    """Not satirindan alinti blogu. Metni de yorumu da bossa (ornek: bos kenar notu) None."""
    text = " ".join(str(note.get("selected_text") or "").split())[:4000]
    comment = note_comment(note.get("note_content"))
    anchor = _anchor(note.get("anchor"))
    ink = clean_ink(anchor) if anchor.get("type") == "ink" else None
    if not text and not comment and not ink:
        return None
    page = note.get("page_number")
    try:
        page = int(page) if page is not None else None
    except Exception:  # noqa
        page = None
    b: dict = {"id": _uid(), "type": "quote", "text": text,
               "color": (str(note.get("highlight_color") or "")[:20] or None),
               "source": (title or "Kaynak")[:300], "page": page,
               "document_id": str(note.get("document_id") or ""),
               "note_id": str(note.get("id")),
               "style": note_style(note.get("anchor")),
               "at": _iso(note.get("created_at")) or datetime.utcnow().isoformat() + "Z"}
    if ink:
        # el yazisi: metin yok, darbeler blokta tasinir (taslak / Atolye onizlemesi)
        b.update({"style": "ink", "text": "", "note": comment or "", "ink": ink})
    elif comment:
        b["note"] = comment
    if auto:
        b["auto"] = True
    return b


def append_unique(blocks: list[dict], new: list[dict]) -> tuple[list[dict], int]:
    """Yeni bloklari sona ekler (note_id zaten varsa atlar). Sondaki bos paragraflar
    alinmaz, en sona yazmak icin tek bos paragraf birakilir. (bloklar, eklenen sayi)."""
    have = {str(b.get("note_id")) for b in blocks if b.get("note_id")}
    add = []
    for b in new:
        nid = b.get("note_id")
        if nid and str(nid) in have:
            continue
        if nid:
            have.add(str(nid))
        add.append({**b, "id": b.get("id") or _uid()})
    if not add:
        return blocks, 0
    out = list(blocks)
    while out and _is_empty_p(out[-1]):
        out.pop()
    out.extend(add)
    out.append({"id": _uid(), "type": "p", "text": ""})
    return out, len(add)


def patch_note_blocks(blocks: list[dict], note_id: str, fresh: dict | None) -> tuple[list[dict], int]:
    """note_id'li bloklarin renk/yorum/stilini gunceller; fresh None ise bloklari kaldirir.
    Blok metnine dokunulmaz (kullanici duzeltmis olabilir). (bloklar, degisen sayi)."""
    nid = str(note_id)
    if fresh is None:
        return remove_note(blocks, nid)
    changed = 0
    out = []
    for b in blocks:
        if b.get("type") == "quote" and str(b.get("note_id") or "") == nid:
            nb = dict(b)
            nb["color"] = fresh.get("color")
            nb["style"] = fresh.get("style")
            if fresh.get("note"):
                nb["note"] = fresh["note"]
            else:
                nb.pop("note", None)
            if not (nb.get("text") or "").strip() and fresh.get("text"):
                nb["text"] = fresh["text"]
            if fresh.get("ink"):
                nb["ink"] = fresh["ink"]   # el yazisinda son cizgi geri alininca
            if nb != b:
                changed += 1
            out.append(nb)
        else:
            out.append(b)
    return out, changed


def remove_note(blocks: list[dict], note_id: str) -> tuple[list[dict], int]:
    nid = str(note_id)
    out = [b for b in blocks if not (b.get("type") == "quote" and str(b.get("note_id") or "") == nid)]
    return out, len(blocks) - len(out)


# ---------------------------------------------------------------- taslak yazimi (kilitli)
async def mutate_draft(conn, table: str, target_id: str, user_id,
                       fn: Callable[[list[dict]], tuple[list[dict], int]]) -> tuple[int | None, int]:
    """Taslagi satir kilidiyle okur, fn(bloklar) -> (yeni bloklar, n) uygular; n>0 ise yazar.
    Donus: (yeni draft_rev ya da yazilmadiysa None, n). Kayit yok/silinmisse (None, -1)."""
    if table not in _TABLES:
        raise ValueError(table)
    async with conn.transaction():
        row = await conn.fetchrow(
            f"SELECT draft FROM {table} WHERE id=$1::uuid AND user_id=$2 AND deleted_at IS NULL FOR UPDATE",
            str(target_id), user_id)
        if not row:
            return None, -1
        blocks, n = fn(parse_draft(row["draft"]))
        if n <= 0:
            return None, 0
        rev = await conn.fetchval(
            f"UPDATE {table} SET draft=$1, draft_at=now(), draft_rev=COALESCE(draft_rev,0)+1 "
            f"WHERE id=$2::uuid AND user_id=$3 RETURNING draft_rev",
            serialize_draft(blocks), str(target_id), user_id)
    return int(rev), n


async def _load_note(conn, user_id, note_id: str, *, alive: bool = True):
    q = ("SELECT n.id, n.document_id, n.page_number, n.selected_text, n.note_content, n.highlight_color,"
         " n.anchor, n.created_at, n.deleted_at, d.title, d.deleted_at AS doc_deleted"
         " FROM notes n JOIN documents d ON d.id = n.document_id"
         " WHERE n.id=$1::uuid AND n.user_id=$2")
    if alive:
        q += " AND n.deleted_at IS NULL AND d.deleted_at IS NULL"
    return await conn.fetchrow(q, str(note_id), user_id)


async def _linked_collections(conn, user_id, doc_id: str) -> list[str]:
    rows = await conn.fetch(
        """SELECT c.id FROM document_collections l JOIN collections c ON c.id = l.collection_id
           WHERE l.document_id=$1::uuid AND c.user_id=$2 AND c.deleted_at IS NULL
           ORDER BY c.id""", str(doc_id), user_id)
    return [str(r["id"]) for r in rows]


async def _collections_holding(conn, user_id, note_id: str) -> list[str]:
    """note_id'yi iceren defter taslaklari (belge defterden cikarilmis olsa da)."""
    rows = await conn.fetch(
        "SELECT id FROM collections WHERE user_id=$1 AND deleted_at IS NULL AND draft IS NOT NULL"
        " AND strpos(draft, $2) > 0 ORDER BY id", user_id, str(note_id))
    return [str(r["id"]) for r in rows]


# ---------------------------------------------------------------- genel uclar
async def accumulate_note(conn, user_id, note_id: str) -> dict:
    """Notu belge taslagina + belgeyi iceren her defter taslagina ekler (varsa atlar)."""
    note = await _load_note(conn, user_id, note_id)
    if not note:
        return {"document": 0, "collections": 0}
    block = build_quote_block(dict(note), note["title"], auto=True)
    if not block:
        return {"document": 0, "collections": 0}
    doc_id = str(note["document_id"])
    _, n_doc = await mutate_draft(conn, "documents", doc_id, user_id, lambda bl: append_unique(bl, [block]))
    n_col = 0
    for cid in await _linked_collections(conn, user_id, doc_id):
        _, n = await mutate_draft(conn, "collections", cid, user_id, lambda bl: append_unique(bl, [block]))
        n_col += max(0, n)
    return {"document": max(0, n_doc), "collections": n_col}


async def update_note_blocks(conn, user_id, note_id: str) -> dict:
    """Renk / yorum / stil degisince o note_id'li bloklari gunceller.
    Hic blogu olmayan (bos olusturulmus) kenar notu ilk kez yazi alinca biriktirilir."""
    note = await _load_note(conn, user_id, note_id)
    if not note:
        return {"updated": 0}
    fresh = build_quote_block(dict(note), note["title"], auto=True)
    doc_id = str(note["document_id"])
    total = 0
    found = False
    targets = [("documents", doc_id)] + [("collections", c) for c in await _collections_holding(conn, user_id, note_id)]
    for table, tid in targets:
        state = {"hit": False}

        def fn(bl, _s=state):
            _s["hit"] = any(str(b.get("note_id") or "") == str(note_id) for b in bl)
            return patch_note_blocks(bl, str(note_id), fresh)
        _, n = await mutate_draft(conn, table, tid, user_id, fn)
        found = found or state["hit"]
        total += max(0, n)
    if not found and fresh is not None and fresh.get("style") == "sticky":
        r = await accumulate_note(conn, user_id, note_id)
        total += r["document"] + r["collections"]
    return {"updated": total}


async def remove_note_blocks(conn, user_id, note_id: str) -> dict:
    """Not cope gidince o note_id'li bloklari belge ve defter taslaklarindan kaldirir."""
    note = await _load_note(conn, user_id, note_id, alive=False)
    targets: list[tuple[str, str]] = []
    if note:
        targets.append(("documents", str(note["document_id"])))
    targets += [("collections", c) for c in await _collections_holding(conn, user_id, note_id)]
    total = 0
    for table, tid in targets:
        _, n = await mutate_draft(conn, table, tid, user_id, lambda bl: remove_note(bl, str(note_id)))
        total += max(0, n)
    return {"removed": total}


async def import_highlights(conn, user_id, table: str, target_id: str, doc_ids: list[str]) -> tuple[int | None, int]:
    """Verilen belgelerin (sirayla) taslakta olmayan butun notlarini sayfa sirasiyla ekler.
    Donus: (draft_rev ya da degismediyse None, eklenen). Hedef yoksa (None, -1)."""
    ids = [str(d) for d in dict.fromkeys(doc_ids) if d]
    blocks_new: list[dict] = []
    if ids:
        rows = await conn.fetch(
            """SELECT n.id, n.document_id, n.page_number, n.selected_text, n.note_content, n.highlight_color,
                      n.anchor, n.created_at, d.title
               FROM notes n JOIN documents d ON d.id = n.document_id
               WHERE n.user_id=$1 AND n.document_id = ANY($2::uuid[])
                 AND n.deleted_at IS NULL AND d.deleted_at IS NULL
               ORDER BY array_position($2::uuid[], n.document_id), n.page_number NULLS LAST, n.created_at""",
            user_id, ids)
        for r in rows:
            b = build_quote_block(dict(r), r["title"], auto=False)
            if b:
                blocks_new.append(b)
    return await mutate_draft(conn, table, target_id, user_id, lambda bl: append_unique(bl, blocks_new))


async def safe(coro_fn, *args) -> None:
    """Kancalar icin: hata not islemini bozmasin, yalniz log."""
    try:
        await coro_fn(*args)
    except Exception as e:  # noqa
        log.warning("biriktirme basarisiz (%s): %r", getattr(coro_fn, "__name__", "?"), e)
