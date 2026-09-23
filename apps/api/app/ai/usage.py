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
