import json
import asyncpg
from pgvector.asyncpg import register_vector
from app.config import settings

_pool: asyncpg.Pool | None = None


def _dsn() -> str:
    # asyncpg wants a plain postgres:// dsn (no +asyncpg / +psycopg suffix)
    return (
        settings.database_url
        .replace("postgresql+asyncpg://", "postgresql://")
        .replace("postgresql+psycopg://", "postgresql://")
    )


async def _init_conn(conn: asyncpg.Connection):
    await register_vector(conn)
    for t in ("jsonb", "json"):
        await conn.set_type_codec(t, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(_dsn(), init=_init_conn, min_size=1, max_size=10)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
