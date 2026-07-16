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
    return dict(row)
