"""Kimlik dogrulama sema degisiklikleri (idempotent).

- users.token_version: sifre degisince artar; JWT'deki `ver` ile karsilastirilir.
- password_resets: e-postayla gonderilen tek kullanimlik, sureli sifirlama baglantilari
  (baglantinin kendisi degil, sha256 ozeti saklanir).
- lower(email) indeksi: e-posta aramalari buyuk/kucuk harfe duyarsiz.

ensure_auth_schema() hem acilista hem ilk auth isleminde cagrilabilir; surec basina bir kez calisir.
"""
import asyncio

_done = False
_lock = asyncio.Lock()


async def ensure_auth_schema(conn) -> None:
    global _done
    if _done:
        return
    async with _lock:
        if _done:
            return
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0")
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS password_resets ("
            " id bigserial PRIMARY KEY,"
            " user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
            " token_hash text NOT NULL UNIQUE,"
            " expires_at timestamptz NOT NULL,"
            " used_at timestamptz,"
            " created_at timestamptz NOT NULL DEFAULT now())")
        await conn.execute("CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id)")
        try:
            await conn.execute("CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(trim(email)))")
        except Exception:  # noqa - indeks olmasa da sorgular calisir
            pass
        # suresi cok gecmis kayitlari temizle
        try:
            await conn.execute("DELETE FROM password_resets WHERE expires_at < now() - interval '7 days'")
        except Exception:  # noqa
            pass
        _done = True
