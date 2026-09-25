"""Sahip icin sifre kurtarma (TK-2).

E-posta ile sifirlama kapaliyken sifre unutulursa tek yol budur. Render'in "Shell"
sekmesinde (ya da yerelde DATABASE_URL tanimliyken) su komut calistirilir:

    python -m app.scripts.set_owner_password --email sen@ornek.com --password YeniSifre123

Ne yapar:
- e-postayi kucuk harfe cevirip kullaniciyi bulur (yoksa hata verir, hesap acmaz),
- yeni sifreyi hash'leyip yazar,
- users.token_version'i 1 artirir → butun eski oturumlar (telefon, tablet) dusurulur.

Sifre en az 8 karakter olmali. Komut sifreyi ekrana yazmaz.
"""
import argparse
import asyncio
import sys

from app.core.security import hash_password, normalize_email
from app.db.session import get_pool, close_pool


async def _run(email: str, password: str) -> int:
    email = normalize_email(email)
    if len(password) < 8:
        print("Hata: sifre en az 8 karakter olmali.", file=sys.stderr)
        return 2
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, name FROM users WHERE lower(trim(email)) = $1", email)
            if not row:
                print(f"Hata: '{email}' adresli bir hesap yok. Bu komut yeni hesap acmaz.", file=sys.stderr)
                return 1
            await conn.execute(
                """UPDATE users
                   SET password_hash = $2,
                       token_version = COALESCE(token_version, 0) + 1
                   WHERE id = $1""",
                row["id"], hash_password(password))
        print(f"Tamam: {row['name']} ({email}) icin sifre guncellendi. Eski oturumlar kapatildi;"
              " yeni sifreyle tekrar giris yap.")
        return 0
    finally:
        await close_pool()


def main() -> None:
    p = argparse.ArgumentParser(description="Sahip sifresini sifirla (e-posta kapaliyken kurtarma).")
    p.add_argument("--email", required=True, help="Hesabin e-posta adresi")
    p.add_argument("--password", required=True, help="Yeni sifre (en az 8 karakter)")
    a = p.parse_args()
    sys.exit(asyncio.run(_run(a.email, a.password)))


if __name__ == "__main__":
    main()
