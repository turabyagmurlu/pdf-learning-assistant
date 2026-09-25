"""Kimlik dogrulama: kayit, giris, oturum yenileme, e-postayla sifre sifirlama, hesap silme.

Guvenlik ozeti (UX raporu B7 / G1-G6):
- Ortak "kurtarma kodu" yolu KALDIRILDI. Sifirlama: kullaniciya ozel, tek kullanimlik, 30 dk'lik
  e-posta baglantisi; DB'de yalniz sha256 ozeti tutulur.
- JWT'de `ver` (users.token_version). Sifre degisince artar; eski oturumlar 401 alir.
- Hesap varligini sizdirmayan mesajlar; e-posta her yerde trim + kucuk harf.
- Bellek ici deneme sinirlayici (IP + e-posta) -> 429 RATE_LIMIT.
"""
import asyncio
import hashlib
import hmac
import logging
import re
import secrets
import time
from collections import deque

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel

from app.config import settings
from app.core.errors import AppError, Unauthorized
from app.core.security import (MIN_PASSWORD_LEN, burn_password_check, create_token,
                               hash_password, normalize_email, verify_password)
from app.db.auth_migrations import ensure_auth_schema
from app.deps import current_user, db

log = logging.getLogger("auth")

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------- hatalar
class RateLimited(AppError):
    code, status = "RATE_LIMIT", 429
    user_message = "Çok fazla deneme yaptın. Birkaç dakika sonra tekrar dene."


class MailNotConfigured(AppError):
    code, status = "MAIL_NOT_CONFIGURED", 503
    user_message = ("Şifre sıfırlama e-postası henüz etkin değil. "
                    "Yardım için turab7123@gmail.com adresine yaz.")


class ResetInvalid(AppError):
    code, status = "RESET_INVALID", 400
    user_message = "Bu bağlantı geçersiz ya da süresi dolmuş. Yeni bir sıfırlama bağlantısı iste."


class WeakPassword(AppError):
    code, status = "WEAK_PASSWORD", 400
    user_message = f"Şifre en az {MIN_PASSWORD_LEN} karakter olmalı."


class BadEmail(AppError):
    code, status = "BAD_EMAIL", 400
    user_message = "E-posta adresi geçerli görünmüyor; kontrol edip tekrar dene."


class RegisterFailed(AppError):
    code, status = "REGISTER_FAILED", 400
    user_message = "Bu e-posta ile hesap açılamadı; giriş yapmayı ya da şifre sıfırlamayı dene."


class BadPassword(AppError):
    code, status = "BAD_PASSWORD", 400
    user_message = "Şifre yanlış; hesabın silinmedi."


class OwnerAccount(AppError):
    code, status = "OWNER_ACCOUNT", 400
    user_message = "Uygulama sahibinin hesabı buradan silinemez."


# ---------------------------------------------------------------- deneme sinirlayici
WINDOW = 10 * 60          # sn
_hits: dict[str, deque] = {}
_last_sweep = 0.0

# eylem -> (IP+e-posta, yalniz e-posta, yalniz IP) basina 10 dk'daki en fazla deneme
LIMITS = {
    "login": (8, 20, 40),
    "register": (8, 10, 20),
    "forgot": (3, 5, 20),
    "reset": (8, 20, 30),
    "delete": (5, 10, 20),
}


def _client_ip(request: Request) -> str:
    h = request.headers
    ip = (h.get("cf-connecting-ip") or h.get("true-client-ip") or "").strip()
    if not ip:
        xff = h.get("x-forwarded-for") or ""
        ip = xff.split(",")[0].strip() if xff else ""
    if not ip and request.client:
        ip = request.client.host or ""
    return ip or "?"


def _sweep(now: float) -> None:
    global _last_sweep
    if now - _last_sweep < 60:
        return
    _last_sweep = now
    for k in [k for k, q in _hits.items() if not q or now - q[-1] > WINDOW]:
        _hits.pop(k, None)


def _check(key: str, limit: int, now: float) -> int:
    """Pencere icindeki deneme sayisini dondurur; limit asilmissa kalan bekleme (sn)."""
    q = _hits.get(key)
    if not q:
        return 0
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= limit:
        return int(WINDOW - (now - q[0])) + 1
    return 0


def rate_limit(action: str, request: Request, email: str = "", record: bool = True) -> None:
    """Asilmissa 429 RATE_LIMIT firlatir. record=True ise bu denemeyi sayar."""
    now = time.monotonic()
    _sweep(now)
    ip = _client_ip(request)
    a, b, c = LIMITS[action]
    keys = [(f"{action}|ip|{ip}", c)]
    if email:
        keys += [(f"{action}|ie|{ip}|{email}", a), (f"{action}|e|{email}", b)]
    wait = max(_check(k, lim, now) for k, lim in keys)
    if wait:
        mins = max(1, (wait + 59) // 60)
        raise RateLimited(f"Çok fazla deneme yaptın. {mins} dakika sonra tekrar dene.")
    if record:
        for k, _ in keys:
            _hits.setdefault(k, deque()).append(now)


def record_attempt(action: str, request: Request, email: str = "") -> None:
    now = time.monotonic()
    ip = _client_ip(request)
    keys = [f"{action}|ip|{ip}"]
    if email:
        keys += [f"{action}|ie|{ip}|{email}", f"{action}|e|{email}"]
    for k in keys:
        _hits.setdefault(k, deque()).append(now)


# ---------------------------------------------------------------- yardimcilar
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def _email(raw: str) -> str:
    e = normalize_email(raw)
    if len(e) > 254 or not _EMAIL_RE.match(e):
        raise BadEmail()
    return e


def _check_password(pw: str) -> None:
    if len(pw or "") < MIN_PASSWORD_LEN:
        raise WeakPassword()
    if len(pw) > 256:
        raise AppError("Şifre çok uzun; en fazla 256 karakter olabilir.")


async def _find_users(conn, email: str):
    """Buyuk/kucuk harf duyarsiz. Eski veride ayni adresin farkli yazimli birden cok kaydi olabilir."""
    return await conn.fetch(
        "SELECT id, name, email, password_hash, token_version FROM users "
        "WHERE lower(trim(email))=$1 ORDER BY created_at ASC", email)


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _user_out(row) -> dict:
    return {"id": str(row["id"]), "name": row["name"], "email": row["email"]}


# ---------------------------------------------------------------- modeller
class RegisterIn(BaseModel):
    name: str
    email: str
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


class ForgotIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    token: str
    password: str


class DeleteMeIn(BaseModel):
    password: str


# ---------------------------------------------------------------- uclar
@router.get("/config")
async def auth_config():
    """Giris ekrani icin: yeni kayit acik mi?"""
    from app.config import settings as _s
    return {"registration_open": bool(_s.allow_registration)}


@router.post("/register")
async def register(body: RegisterIn, request: Request, conn=Depends(db)):
    from app.config import settings as _s
    if not _s.allow_registration:
        err = AppError("Yeni kayıtlar şu an kapalı. Hesabın varsa giriş yapabilirsin.")
        err.code, err.status = "REGISTRATION_CLOSED", 403
        raise err
    email = _email(body.email)
    rate_limit("register", request, email)
    name = (body.name or "").strip()[:80]
    if not name:
        raise AppError("Adını yaz; defterlerinde bu adla görüneceksin.")
    _check_password(body.password)
    await ensure_auth_schema(conn)
    rows = await _find_users(conn, email)
    if rows:
        # Ayni kisi (ornegin yaniti kaybolan ilk istegin tekrari): sifre dogruysa dogrudan giris yap.
        for r in rows:
            if verify_password(body.password, r["password_hash"]):
                return {"token": create_token(str(r["id"]), r["token_version"] or 0), "user": _user_out(r)}
        raise RegisterFailed()
    burn_password_check(body.password)     # iki dalda benzer sure
    try:
        row = await conn.fetchrow(
            "INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) "
            "RETURNING id, name, email, token_version",
            name, email, hash_password(body.password),
        )
    except Exception:  # noqa - es zamanli ayni e-posta (UNIQUE)
        raise RegisterFailed()
    return {"token": create_token(str(row["id"]), row["token_version"] or 0), "user": _user_out(row)}


@router.post("/login")
async def login(body: LoginIn, request: Request, conn=Depends(db)):
    email = normalize_email(body.email)
    # Yalniz basarisiz denemeler sayilir; once sinir asilmis mi bak.
    rate_limit("login", request, email, record=False)
    await ensure_auth_schema(conn)
    rows = await _find_users(conn, email) if email else []
    if not rows:
        burn_password_check(body.password)
    for r in rows:
        if verify_password(body.password, r["password_hash"]):
            return {"token": create_token(str(r["id"]), r["token_version"] or 0), "user": _user_out(r)}
    record_attempt("login", request, email)
    raise Unauthorized("E-posta ya da şifre hatalı. Şifreni unuttuysan \"Şifremi unuttum\" ile yenileyebilirsin.")


@router.get("/me")
async def me(user=Depends(current_user)):
    return {"user": {"id": str(user["id"]), "name": user["name"], "email": user["email"]}}


@router.post("/refresh")
async def refresh(user=Depends(current_user)):
    """Oturumu sessizce uzatir. current_user `ver` denetledigi icin iptal edilmis
    (sifresi degismis) bir oturum kendini yenileyemez."""
    return {"token": create_token(str(user["id"]), user.get("token_version") or 0)}


@router.post("/forgot")
async def forgot(body: ForgotIn, request: Request, background: BackgroundTasks, conn=Depends(db)):
    """Hesap var ya da yok, cevap ayni: {ok: true}. Varsa 30 dk'lik tek kullanimlik baglanti gonderilir."""
    from app.services.mailer import mail_configured, send_password_reset
    if not mail_configured():
        raise MailNotConfigured()
    email = normalize_email(body.email)
    if not email or not _EMAIL_RE.match(email):
        raise BadEmail()
    rate_limit("forgot", request, email)
    await ensure_auth_schema(conn)
    rows = await _find_users(conn, email)
    if rows:
        r = rows[0]
        token = secrets.token_urlsafe(32)
        minutes = max(5, int(settings.reset_token_minutes or 30))
        async with conn.transaction():
            # onceki kullanilmamis baglantilar gecersiz olsun (yalniz en son gonderilen calisir)
            await conn.execute(
                "UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", r["id"])
            await conn.execute(
                "INSERT INTO password_resets (user_id, token_hash, expires_at) "
                "VALUES ($1, $2, now() + make_interval(mins => $3))",
                r["id"], _sha(token), minutes)
        # Gonderim arka planda: cevap suresi hesabin varligini ele vermesin.
        background.add_task(send_password_reset, r["email"], r["name"], token, minutes)
    return {"ok": True}


@router.post("/reset")
async def reset(body: ResetIn, request: Request, conn=Depends(db)):
    token = (body.token or "").strip()
    rate_limit("reset", request, _sha(token)[:16] if token else "")
    _check_password(body.password)
    if not token or len(token) > 200:
        raise ResetInvalid()
    await ensure_auth_schema(conn)
    h = _sha(token)
    async with conn.transaction():
        # Tek kullanim: ayni anda iki istek gelse de yalniz biri used_at'i doldurabilir.
        row = await conn.fetchrow(
            "UPDATE password_resets SET used_at=now() "
            "WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() "
            "RETURNING user_id, token_hash", h)
        if not row or not hmac.compare_digest(row["token_hash"], h):
            raise ResetInvalid()
        await conn.execute(
            "UPDATE users SET password_hash=$1, token_version=COALESCE(token_version,0)+1 WHERE id=$2",
            hash_password(body.password), row["user_id"])
        await conn.execute(
            "UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", row["user_id"])
    return {"ok": True}


# ---------------------------------------------------------------- hesap silme
async def _table_info(conn) -> tuple[set[str], set[str]]:
    rows = await conn.fetch(
        "SELECT c.table_name, c.column_name FROM information_schema.columns c "
        "JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
        "WHERE c.table_schema='public' AND t.table_type='BASE TABLE'")  # gorunumlerden (view) DELETE yapilmasin
    tables = {r["table_name"] for r in rows}
    with_user = {r["table_name"] for r in rows if r["column_name"] == "user_id"}
    return tables, with_user


async def delete_user_data(conn, uid: str) -> list[str]:
    """Kullanicinin tum satirlarini siler (tek islem). Silinecek depolama anahtarlarini dondurur.
    FK cascade'lere guvenmeden, cocuk tablolardan baslayarak acikca siler; tablo yoksa atlar."""
    tables, with_user = await _table_info(conn)
    docs = await conn.fetch("SELECT id, file_path FROM documents WHERE user_id=$1", uid)
    keys: list[str] = []
    for d in docs:
        fp = d["file_path"]
        if fp:
            keys += [fp, fp + ".pages.json", fp + ".ocr.json", fp + ".transcript.json"]

    my_docs = "(SELECT id FROM documents WHERE user_id=$1)"
    my_cols = "(SELECT id FROM collections WHERE user_id=$1)"
    my_cchats = f"(SELECT id FROM collection_chats WHERE user_id=$1 OR collection_id IN {my_cols})"
    steps = [
        ("collection_messages", f"DELETE FROM collection_messages WHERE chat_id IN {my_cchats}"),
        ("collection_chats", f"DELETE FROM collection_chats WHERE user_id=$1 OR collection_id IN {my_cols}"),
        ("answer_cache", f"DELETE FROM answer_cache WHERE collection_id IN {my_cols}"),
        ("chat_messages", "DELETE FROM chat_messages WHERE session_id IN "
                          f"(SELECT id FROM chat_sessions WHERE user_id=$1 OR document_id IN {my_docs} "
                          f"OR collection_id IN {my_cols})"),
        ("chat_sessions", f"DELETE FROM chat_sessions WHERE user_id=$1 OR document_id IN {my_docs} "
                          f"OR collection_id IN {my_cols}"),
        ("concept_edges", "DELETE FROM concept_edges WHERE source_id IN (SELECT id FROM concepts WHERE user_id=$1) "
                          "OR target_id IN (SELECT id FROM concepts WHERE user_id=$1)"),
        ("concepts", "DELETE FROM concepts WHERE user_id=$1"),
        ("study_items", "DELETE FROM study_items WHERE user_id=$1"),
        ("notes", f"DELETE FROM notes WHERE user_id=$1 OR document_id IN {my_docs}"),
        ("doc_answer_cache", f"DELETE FROM doc_answer_cache WHERE document_id IN {my_docs}"),
        ("doc_extracts", f"DELETE FROM doc_extracts WHERE document_id IN {my_docs}"),
        ("document_chunks", f"DELETE FROM document_chunks WHERE document_id IN {my_docs}"),
        ("document_collections", f"DELETE FROM document_collections WHERE document_id IN {my_docs} "
                                 f"OR collection_id IN {my_cols}"),
        ("documents", "DELETE FROM documents WHERE user_id=$1"),
        ("collections", "DELETE FROM collections WHERE user_id=$1"),
        ("ai_user_usage", "DELETE FROM ai_user_usage WHERE user_id=$1"),
        ("password_resets", "DELETE FROM password_resets WHERE user_id=$1"),
    ]
    async with conn.transaction():
        # sirayla ve kosulsuz: tablo yoksa atla (ör. document_collections henuz olusmamis olabilir)
        for t, sql in steps:
            if t in tables:
                await conn.execute(sql, uid)
        # ileride eklenen, user_id sutunlu baska tablolar da kalmasin
        done = {t for t, _ in steps}
        for t in sorted(with_user - done - {"users"}):
            await conn.execute(f'DELETE FROM "{t}" WHERE user_id::text=$1::text', uid)
        await conn.execute("DELETE FROM users WHERE id=$1", uid)
    return keys


async def _delete_objects(keys: list[str]) -> None:
    from app.storage.object_store import delete_object
    failed = 0
    for k in keys:
        try:
            await asyncio.to_thread(delete_object, k)
        except Exception:  # noqa - turetilmis anahtar olmayabilir
            failed += 1
    if failed:
        log.info("hesap silme: %d depolama anahtari silinemedi/yoktu", failed)


@router.delete("/me")
async def delete_me(body: DeleteMeIn, request: Request, background: BackgroundTasks,
                    user=Depends(current_user), conn=Depends(db)):
    """Hesabi ve tum verisini kalici olarak siler (sifre dogrulamali)."""
    uid = str(user["id"])
    rate_limit("delete", request, uid)
    row = await conn.fetchrow("SELECT password_hash FROM users WHERE id=$1", user["id"])
    if not row or not verify_password(body.password or "", row["password_hash"]):
        raise BadPassword()
    if user.get("is_owner"):
        raise OwnerAccount()
    keys = await delete_user_data(conn, uid)
    background.add_task(_delete_objects, keys)
    try:
        from app.ai import usage
        forget = getattr(usage, "forget_user", None)
        if callable(forget):
            forget(uid)
    except Exception:  # noqa
        pass
    return {"ok": True}
