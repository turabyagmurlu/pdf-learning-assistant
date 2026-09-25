"""Kaynak <-> defter uyeligi (coka-cok, document_collections tablosu).

Dogruluk kaynagi document_collections'tir. documents.collection_id sutunu yalniz geriye
uyum icin "ilk bag" olarak guncel tutulur (eski istemciler / eski sorgular bozulmasin).
Sorgularda bag tablosunun takma adi `l`dir (document_chunks icin kullanilan `dc` ile karismasin).
"""


async def _sync_legacy(conn, doc_ids: list[str]):
    """documents.collection_id = en eski bag (yoksa NULL)."""
    if not doc_ids:
        return
    await conn.execute(
        """UPDATE documents d SET collection_id = (
               SELECT l.collection_id FROM document_collections l
               WHERE l.document_id = d.id ORDER BY l.added_at, l.collection_id LIMIT 1)
           WHERE d.id = ANY($1::uuid[])""", [str(x) for x in doc_ids])


async def link(conn, doc_ids: list[str], cid: str) -> int:
    """Kaynaklari deftere baglar (zaten bagliysa dokunmaz). Eklenen bag sayisini dondurur.
    Cagiran, kaynaklarin ve defterin ayni kullaniciya ait oldugunu dogrulamis olmali."""
    ids = [str(x) for x in dict.fromkeys(doc_ids) if x]
    if not ids:
        return 0
    rows = await conn.fetch(
        """INSERT INTO document_collections (document_id, collection_id)
           SELECT x, $2::uuid FROM unnest($1::uuid[]) AS x
           ON CONFLICT (document_id, collection_id) DO NOTHING
           RETURNING document_id""", ids, cid)
    await _sync_legacy(conn, ids)
    return len(rows)


async def unlink(conn, doc_id: str, cid: str) -> bool:
    """Yalniz bagi koparir; kaynak Kutuphane'de kalir."""
    r = await conn.execute(
        "DELETE FROM document_collections WHERE document_id=$1::uuid AND collection_id=$2::uuid", doc_id, cid)
    await _sync_legacy(conn, [doc_id])
    return r.endswith(" 1")


async def unlink_all(conn, doc_id: str) -> int:
    r = await conn.execute("DELETE FROM document_collections WHERE document_id=$1::uuid", doc_id)
    await conn.execute("UPDATE documents SET collection_id=NULL WHERE id=$1::uuid", doc_id)
    try:
        return int(r.split()[-1])
    except Exception:  # noqa
        return 0


async def set_links(conn, doc_id: str, cids: list[str]) -> None:
    """Kaynagin defterlerini tam olarak bu listeye esitler."""
    cids = [str(c) for c in dict.fromkeys(cids) if c]
    await conn.execute(
        "DELETE FROM document_collections WHERE document_id=$1::uuid AND NOT (collection_id = ANY($2::uuid[]))",
        doc_id, cids)
    if cids:
        await conn.execute(
            """INSERT INTO document_collections (document_id, collection_id)
               SELECT $1::uuid, x FROM unnest($2::uuid[]) AS x
               ON CONFLICT (document_id, collection_id) DO NOTHING""", doc_id, cids)
    await _sync_legacy(conn, [doc_id])


async def is_linked(conn, doc_id: str, cid: str) -> bool:
    return bool(await conn.fetchval(
        "SELECT 1 FROM document_collections WHERE document_id=$1::uuid AND collection_id=$2::uuid", doc_id, cid))


async def collection_ids(conn, doc_ids: list[str]) -> dict[str, list[str]]:
    """{document_id: [collection_id, ...]} (eklenme sirasina gore)."""
    out: dict[str, list[str]] = {str(d): [] for d in doc_ids}
    if not doc_ids:
        return out
    rows = await conn.fetch(
        """SELECT document_id, collection_id FROM document_collections
           WHERE document_id = ANY($1::uuid[]) ORDER BY added_at, collection_id""", [str(d) for d in doc_ids])
    for r in rows:
        out.setdefault(str(r["document_id"]), []).append(str(r["collection_id"]))
    return out


async def owned_collections(conn, user_id, cids: list[str]) -> list[str]:
    """Kullaniciya ait olan defter kimliklerini dondurur (gecersiz uuid'ler elenir)."""
    import uuid as _uuid
    ok = []
    for c in cids:
        try:
            ok.append(str(_uuid.UUID(str(c))))
        except Exception:  # noqa
            continue
    if not ok:
        return []
    rows = await conn.fetch("SELECT id FROM collections WHERE user_id=$1 AND id = ANY($2::uuid[])", user_id, ok)
    return [str(r["id"]) for r in rows]


async def ready_doc_ids(conn, user_id, cid: str) -> list[str]:
    rows = await conn.fetch(
        """SELECT d.id FROM documents d JOIN document_collections l ON l.document_id = d.id
           WHERE d.user_id=$1 AND l.collection_id=$2::uuid AND d.status='ready'""", user_id, cid)
    return [str(r["id"]) for r in rows]
