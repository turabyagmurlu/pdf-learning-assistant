"""Veritabani yedegi.

- Haftada bir otomatik: kullanici verisi (hesaplar, defterler, kaynak bilgileri,
  notlar, sohbetler, taslaklar) JSON.gz olarak depoya (backups/) yazilir, son 8 tutulur.
  Dosyalarin kendisi (PDF vb.) zaten depoda; gommeler/onbellekler yeniden uretilebildigi
  icin yedege alinmaz (yedek kucuk kalir).
- Kullanici kendi verisini istedigi an indirebilir (export_user).
"""
import gzip
import json
from datetime import datetime, timezone, timedelta
from app.storage.object_store import put_object, list_keys, delete_object

PREFIX = "backups/"
KEEP = 8
EVERY = timedelta(days=7)
# yedeklenecek tablolar (varsa)
TABLES = ["users", "collections", "documents", "notes", "chat_sessions", "chat_messages",
          "collection_chats", "collection_messages", "doc_extracts", "study_items"]


def _default(o):
    if isinstance(o, (bytes, bytearray, memoryview)):
        return None
    return str(o)


async def _dump(conn, where_user: str | None = None) -> dict:
    exists = {r["table_name"] for r in await conn.fetch(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'")}
    out = {"created_at": datetime.now(timezone.utc).isoformat(), "tables": {}}
    for t in TABLES:
        if t not in exists:
            continue
        cols = [r["column_name"] for r in await conn.fetch(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", t)
            if r["column_name"] not in ("embedding", "qvec")]
        sel = ", ".join(f'"{c}"' for c in cols)
        if where_user is None:
            rows = await conn.fetch(f'SELECT {sel} FROM "{t}"')
        else:
            if t == "users":
                q = f'SELECT {sel} FROM users WHERE id=$1'
            elif "user_id" in cols:
                q = f'SELECT {sel} FROM "{t}" WHERE user_id=$1'
            elif t == "chat_messages":
                q = f'SELECT {sel} FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id=$1)'
            elif t == "collection_messages":
                q = f'SELECT {sel} FROM collection_messages WHERE chat_id IN (SELECT id FROM collection_chats WHERE user_id=$1)'
            elif t == "doc_extracts":
                q = f'SELECT {sel} FROM doc_extracts WHERE document_id IN (SELECT id FROM documents WHERE user_id=$1)'
            else:
                continue
            rows = await conn.fetch(q, where_user)
        data = [dict(r) for r in rows]
        if t == "users":
            for d in data:
                if where_user is not None:
                    d.pop("password_hash", None)     # kisisel indirmede sifre ozeti olmasin
        out["tables"][t] = data
    return out


async def run_backup(conn) -> dict:
    snap = await _dump(conn)
    raw = gzip.compress(json.dumps(snap, ensure_ascii=False, default=_default).encode("utf-8"))
    key = PREFIX + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ") + ".json.gz"
    import asyncio
    await asyncio.to_thread(put_object, key, raw, "application/gzip")
    keys = [o for o in await asyncio.to_thread(list_keys, PREFIX) if o["key"].endswith(".json.gz")]
    for o in keys[:-KEEP]:
        try:
            await asyncio.to_thread(delete_object, o["key"])
        except Exception:  # noqa
            pass
    return {"key": key, "bytes": len(raw), "tables": {k: len(v) for k, v in snap["tables"].items()}}


def last_backup_time():
    keys = [o for o in list_keys(PREFIX) if o["key"].endswith(".json.gz")]
    return keys[-1]["modified"] if keys else None


async def backup_if_due(conn) -> dict | None:
    import asyncio
    last = await asyncio.to_thread(last_backup_time)
    if last and datetime.now(timezone.utc) - last < EVERY:
        return None
    return await run_backup(conn)


async def export_user(conn, user_id: str) -> bytes:
    snap = await _dump(conn, where_user=user_id)
    return json.dumps(snap, ensure_ascii=False, default=_default, indent=1).encode("utf-8")
