import logging
import uuid as _uuid

import asyncpg
from fastapi import Depends, Header
from app.core.security import decode_payload
from app.core.errors import Unauthorized
from app.db.session import get_pool
from app.db.auth_migrations import ensure_auth_schema

_log = logging.getLogger("auth")


async def db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


async def _user_row_from_token(conn, token: str):
    """JWT imzasi/suresi + token_version (ver) kontrolu. Gecersizse None."""
    if not token:
        return None
    p = decode_payload(token)
    if not p or not p.get("sub"):
        return None
    try:
        sub = str(_uuid.UUID(str(p["sub"])))
    except Exception:  # noqa - bozuk sub (uuid degil)
        return None
    try:
        await ensure_auth_schema(conn)
    except Exception as e:  # noqa - sema hatasi herkesi oturumdan dusurmesin
        _log.warning("ensure_auth_schema basarisiz: %r", e)
    # DB/baglanti hatalari YUTULMAZ (500 doner): 401'e cevirmek web'de oturumu siler.
    try:
        row = await conn.fetchrow(
            "SELECT id, name, email, token_version FROM users WHERE id=$1::uuid", sub)
    except asyncpg.exceptions.UndefinedColumnError:
        # token_version henuz eklenemediyse eski davranis: surum 0
        row = await conn.fetchrow(
            "SELECT id, name, email, 0 AS token_version FROM users WHERE id=$1::uuid", sub)
    if not row:
        return None
    # `ver` olmayan eski belirtecler 0 sayilir: sifre hic degismediyse gecerli kalir.
    if int(p.get("ver") or 0) != int(row["token_version"] or 0):
        return None
    return row


async def user_id_from_token(conn, token: str) -> str | None:
    """SSE gibi Authorization basligi gonderilemeyen uclar icin (?token=...).
    Imza, sure ve oturum iptali (ver) denetlenir."""
    row = await _user_row_from_token(conn, token)
    return str(row["id"]) if row else None


async def current_user(authorization: str | None = Header(default=None),
                       conn=Depends(db)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized()
    token = authorization.split(" ", 1)[1].strip()
    row = await _user_row_from_token(conn, token)
    if not row:
        raise Unauthorized()
    u = dict(row)
    u["is_owner"] = await is_owner(conn, str(row["id"]))
    try:
        from app.ai import usage
        usage.set_user(str(row["id"]), u["is_owner"])
    except Exception:  # noqa
        pass
    return u


_OWNERS: set[str] | None = None


async def is_owner(conn, uid: str) -> bool:
    """Uygulamanin sahibi: OWNER_USER_IDS ayari, yoksa ilk kayit olan hesap. Sahibin gunluk siniri yok."""
    global _OWNERS
    if _OWNERS is None:
        from app.config import settings
        ids = {x.strip() for x in (settings.owner_user_ids or "").split(",") if x.strip()}
        if not ids:
            try:
                r = await conn.fetchrow("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
                if r:
                    ids = {str(r["id"])}
            except Exception:  # noqa
                return False
        if not ids:
            return False          # henuz hesap yok: onbellege bos kume yazma (ilk kayit sahip olsun)
        _OWNERS = ids
    return uid in _OWNERS
