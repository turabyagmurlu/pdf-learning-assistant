from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from app.config import settings

_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

MIN_PASSWORD_LEN = 8


def hash_password(pw: str) -> str:
    return _pwd.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _pwd.verify(pw, hashed)
    except Exception:  # noqa - bozuk/eski ozet: esnek degil, reddet
        return False


# Kullanici bulunamadiginda da ayni surede cevap vermek icin (hesap varligi zamanlamadan sizmasin)
_DUMMY_HASH = _pwd.hash("zaman-esitleme-icin-sahte-sifre")


def burn_password_check(pw: str) -> None:
    try:
        _pwd.verify(pw, _DUMMY_HASH)
    except Exception:  # noqa
        pass


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def create_token(user_id: str, ver: int = 0) -> str:
    """JWT: sub (kullanici), ver (token_version; sifre degisince artar, eski oturumlar duser), exp."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": user_id, "ver": int(ver or 0), "exp": exp}, settings.jwt_secret, algorithm="HS256")


def decode_payload(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError:
        return None


def decode_token(token: str) -> str | None:
    """Yalniz imza + sure kontrolu. Oturum iptalini (ver) de denetlemek icin
    app.deps.user_id_from_token kullanin."""
    p = decode_payload(token)
    return p.get("sub") if p else None
