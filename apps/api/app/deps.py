from fastapi import Depends, Header
from app.core.security import decode_token
from app.core.errors import Unauthorized
from app.db.session import get_pool


async def db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


async def current_user(authorization: str | None = Header(default=None),
                       conn=Depends(db)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized()
    token = authorization.split(" ", 1)[1]
    uid = decode_token(token)
    if not uid:
        raise Unauthorized()
    row = await conn.fetchrow("SELECT id, name, email FROM users WHERE id=$1", uid)
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
        _OWNERS = ids
    return uid in _OWNERS
