"""Yapay zeka kota sayaci ve model havuzu durumu.

- Her basarili istek (model, tur) bazinda sayilir; token da tutulur.
- 429 gelirse model "dakikalik dolu" (kisa sure) ya da "gunluk doldu"
  (Pasifik gece yarisina kadar) olarak isaretlenir; havuz o modeli atlar.
- Sayaclar bellekte tutulur, dakikada bir veritabanina yazilir (ai_usage).
Google'in gunluk kotalari Pasifik saatiyle gece yarisi sifirlanir.
"""
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")
_LOCK = threading.Lock()
# (gun, model, tur) -> [istek, token]
_COUNTS: dict[tuple[str, str, str], list[int]] = {}
_DIRTY: set[tuple[str, str, str]] = set()
# model -> unix zamani (bu ana kadar kullanma)
_BLOCKED: dict[str, float] = {}
_DAILY: dict[str, str] = {}           # model -> gunluk dolan gun (PT)
_DEAD: set[str] = set()               # 404: bu anahtarda yok / emekli


def today() -> str:
    return datetime.now(PT).strftime("%Y-%m-%d")


def next_reset() -> datetime:
    now = datetime.now(PT)
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=5, microsecond=0)


def record(model: str, kind: str, tokens: int = 0, n: int = 1):
    key = (today(), model, kind)
    with _LOCK:
        c = _COUNTS.setdefault(key, [0, 0])
        c[0] += n
        c[1] += int(tokens or 0)
        _DIRTY.add(key)
    try:
        record_user(kind, n)
    except Exception:  # noqa
        pass


def mark_limited(model: str, daily: bool, retry_after: float | None = None):
    with _LOCK:
        if daily:
            _DAILY[model] = today()
            _BLOCKED[model] = next_reset().timestamp()
        else:
            _BLOCKED[model] = max(_BLOCKED.get(model, 0), time.time() + (retry_after or 30))


def mark_dead(model: str):
    with _LOCK:
        _DEAD.add(model)


def available(model: str) -> bool:
    with _LOCK:
        if model in _DEAD:
            return False
        return _BLOCKED.get(model, 0) <= time.time()


def status(model: str) -> str:
    with _LOCK:
        if model in _DEAD:
            return "yok"
        if _DAILY.get(model) == today() and _BLOCKED.get(model, 0) > time.time():
            return "gunluk_doldu"
        if _BLOCKED.get(model, 0) > time.time():
            return "dakikalik_dolu"
    return "aktif"


def blocked_until(model: str) -> float | None:
    """Modelin yeniden kullanilabilecegi unix zamani; simdi kullanilabiliyorsa None."""
    with _LOCK:
        if model in _DEAD:
            return None
        t = _BLOCKED.get(model, 0)
    return t if t > time.time() else None


def service_state() -> dict:
    """Saglayici (Gemini) ozeti, model adi vermeden: {"state": aktif|yogun|doldu, "retry_min": int|None}.

    - aktif: havuzda en az bir model hemen kullanilabilir (retry_min None).
    - yogun: hepsi gecici olarak (dakikalik 429 / 5xx) bekliyor; retry_min = en erken acilana kadar dk.
    - doldu: hepsi gunluk kotasini doldurmus ya da bu anahtarda yok; retry_min = Pasifik gece yarisina kadar dk.
    Import dongusu olmasin diye gemini_provider fonksiyon icinde yuklenir.
    """
    from app.ai.gemini_provider import pool_models
    models = pool_models()
    sts = [status(m) for m in models]
    if any(s == "aktif" for s in sts):
        return {"state": "aktif", "retry_min": None}
    now = time.time()
    if all(s in ("gunluk_doldu", "yok") for s in sts):
        state = "doldu"
        until = next_reset().timestamp()
    else:
        state = "yogun"
        waits = [t for t in (blocked_until(m) for m, s in zip(models, sts) if s == "dakikalik_dolu") if t]
        until = min(waits) if waits else now + 60
    retry_min = max(1, int((until - now + 59) // 60))
    return {"state": state, "retry_min": retry_min}


def _pool_state(models: list[str]) -> dict:
    """Verilen model havuzunun ozeti: {"state": aktif|yogun|doldu, "retry_min": int|None}."""
    sts = [status(m) for m in models]
    if any(s == "aktif" for s in sts):
        return {"state": "aktif", "retry_min": None}
    now = time.time()
    if not sts or all(s in ("gunluk_doldu", "yok") for s in sts):
        state = "doldu"
        until = next_reset().timestamp()
    else:
        state = "yogun"
        waits = [t for t in (blocked_until(m) for m, s in zip(models, sts) if s == "dakikalik_dolu") if t]
        until = min(waits) if waits else now + 60
    return {"state": state, "retry_min": max(1, int((until - now + 59) // 60))}


def tts_state() -> dict:
    """Seslendirme (Gemini TTS) havuzunun ozeti, model adi vermeden.

    service_state() metin havuzuna bakar; ses modellerinin kotasi ayridir. "Sesli oku"
    dugmesi bu bilgiyle dolu iken kullanici bosuna tiklamasin, dogrudan cihaz sesine gecsin.
    Import dongusu olmasin diye tts_service fonksiyon icinde yuklenir.
    """
    try:
        from app.services.tts_service import _tts_models
        return _pool_state(_tts_models())
    except Exception:  # noqa - bilinmiyorsa aktif varsay
        return {"state": "aktif", "retry_min": None}


def snapshot() -> dict:
    d = today()
    with _LOCK:
        rows = [{"model": m, "kind": k, "requests": v[0], "tokens": v[1]}
                for (day, m, k), v in _COUNTS.items() if day == d]
    return {"day": d, "rows": rows}


def load_rows(rows):
    """Acilista bugunun sayaclarini veritabanindan geri yukler."""
    with _LOCK:
        for r in rows:
            key = (str(r["day"]), r["model"], r["kind"])
            cur = _COUNTS.setdefault(key, [0, 0])
            cur[0] = max(cur[0], int(r["requests"] or 0))
            cur[1] = max(cur[1], int(r["tokens"] or 0))


def pop_dirty():
    with _LOCK:
        out = [(k, list(_COUNTS[k])) for k in _DIRTY if k in _COUNTS]
        _DIRTY.clear()
    return out


# ------------------------------------------------------------------ kisi basi gunluk hak
# Uygulama paylasildiginda herkes ayni Gemini anahtarini kullanir. Sahibi (ilk kayit olan
# hesap) sinirsizdir; digerlerinin her birinin gunluk metin istegi sinirlidir.
import contextvars

CURRENT_USER: contextvars.ContextVar = contextvars.ContextVar("ai_user", default=None)  # (uid, is_owner)
USER_KINDS = {"metin", "arama", "ses"}
_USER: dict[tuple[str, str], int] = {}
_UDIRTY: set[tuple[str, str]] = set()


def set_user(uid: str | None, is_owner: bool = False):
    CURRENT_USER.set((str(uid), bool(is_owner)) if uid else None)


def user_used(uid: str) -> int:
    with _LOCK:
        return _USER.get((today(), str(uid)), 0)


def user_limit() -> int:
    from app.config import settings
    return int(getattr(settings, "user_daily_ai_limit", 60) or 0)


LOCAL_TZ = ZoneInfo("Europe/Istanbul")


def reset_local() -> str:
    """Gunluk sayacin sifirlanma ani, Turkiye saatiyle 'HH:MM'."""
    return next_reset().astimezone(LOCAL_TZ).strftime("%H:%M")


_DIGIT_SFX = {0: "da", 1: "de", 2: "de", 3: "te", 4: "te", 5: "te", 6: "da", 7: "de", 8: "de", 9: "da"}
_TENS_SFX = {1: "da", 2: "de", 3: "da", 4: "ta", 5: "de"}


def at_time(hhmm: str) -> str:
    """'10:00' -> "10:00'da", '13:00' -> "13:00'te", '10:05' -> "10:05'te" (Turkce bulunma eki)."""
    try:
        h, m = (int(x) for x in hhmm.split(":"))
    except Exception:  # noqa
        return hhmm
    n = m if m else h
    if n == 0:
        sfx = "da"                                   # sifir
    elif n % 10:
        sfx = _DIGIT_SFX[n % 10]
    else:
        sfx = _TENS_SFX.get(n // 10, "da")
    return f"{hhmm}'{sfx}"


def limit_message(lim: int | None = None) -> str:
    lim = user_limit() if lim is None else lim
    return (f"Bugünkü {lim} kullanımın doldu; saat {at_time(reset_local())} yenilenir. "
            "Kayıtlı cevaplar, arama ve okuma çalışmaya devam ediyor.")


def check_user():
    """Istek atmadan once: kisinin bugunku hakki doldu mu? (429 USAGE_LIMIT)"""
    u = CURRENT_USER.get()
    if not u or u[1]:
        return
    lim = user_limit()
    if lim and user_used(u[0]) >= lim:
        from app.core.errors import UsageLimit
        raise UsageLimit(limit_message(lim))


def record_user(kind: str, n: int = 1):
    u = CURRENT_USER.get()
    if not u or kind not in USER_KINDS:
        return
    key = (today(), u[0])
    with _LOCK:
        _USER[key] = _USER.get(key, 0) + n
        _UDIRTY.add(key)


def load_user_rows(rows):
    with _LOCK:
        for r in rows:
            key = (str(r["day"]), str(r["user_id"]))
            _USER[key] = max(_USER.get(key, 0), int(r["requests"] or 0))


def pop_user_dirty():
    with _LOCK:
        out = [(k, _USER[k]) for k in _UDIRTY if k in _USER]
        _UDIRTY.clear()
    return out
