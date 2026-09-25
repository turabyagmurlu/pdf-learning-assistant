"""Ses kaydi (ders, toplanti, roportaj) -> zaman damgali dokum.

ffmpeg ile tek kanal 16 kHz'e indirilir ve 20 dakikalik parcalara bolunur (yuklemesi hizli,
uzun kayitlarda cikti kesilmez). Her parca Gemini Files API ile yuklenip dokumu alinir;
zaman damgalari parcanin baslangicina gore kaydirilir. Bolumleme video ile ayni (2 dk = 1 bolum).
"""
import json
import os
import re
import subprocess
import tempfile
import time
import httpx
from app.config import settings
from app.core.errors import AppError
from app.ai import usage

BASE = "https://generativelanguage.googleapis.com"
SEG_SEC = 20 * 60
EXTS = {"mp3", "m4a", "wav", "ogg", "oga", "opus", "webm", "aac", "flac", "mp4a", "amr", "3gp"}

_PROMPT = (
    "Bu ses kaydının konuşmalarının TAM dökümünü çıkar (özet DEĞİL). Konuşma hangi dildeyse o dilde yaz. "
    "Her 15-40 saniyede bir yeni satıra geç ve satır başına [dd:ss] biçiminde, KAYDIN BAŞINDAN itibaren "
    "zaman damgası koy. Konuşmacı değişince satırı 'Konuşmacı 1:', 'Konuşmacı 2:' gibi başlat (isimler "
    "anlaşılıyorsa ismi kullan). Anlaşılmayan yere [anlaşılmıyor] yaz. Başka hiçbir açıklama yazma."
)


def _run(cmd: list[str], timeout=600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def duration(path: str) -> float | None:
    try:
        r = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path], 60)
        return float(json.loads(r.stdout)["format"]["duration"])
    except Exception:  # noqa
        return None


def _segments(data: bytes, ext: str) -> tuple[list[tuple[int, bytes]], float | None]:
    """[(baslangic_sn, mp3_bayt)], toplam sure"""
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "in." + ext)
        with open(src, "wb") as f:
            f.write(data)
        dur = duration(src)
        pattern = os.path.join(d, "seg%03d.mp3")
        r = _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000",
                  "-b:a", "40k", "-f", "segment", "-segment_time", str(SEG_SEC), "-reset_timestamps", "1", pattern])
        files = sorted(fn for fn in os.listdir(d) if fn.startswith("seg"))
        if r.returncode != 0 or not files:
            raise AppError("Ses dosyası okunamadı (bozuk ya da desteklenmeyen biçim olabilir).")
        out = []
        for i, fn in enumerate(files):
            with open(os.path.join(d, fn), "rb") as f:
                out.append((i * SEG_SEC, f.read()))
        return out, dur


def _upload(data: bytes, mime: str, name: str) -> dict:
    key = settings.gemini_api_key.strip()
    r = httpx.post(f"{BASE}/upload/v1beta/files?key={key}", timeout=60, headers={
        "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": str(len(data)), "X-Goog-Upload-Header-Content-Type": mime,
        "Content-Type": "application/json"}, json={"file": {"display_name": name}})
    url = r.headers.get("x-goog-upload-url")
    if not url:
        raise AppError("Ses kaydı şu an işlenemedi; biraz sonra 'Yeniden işle' ile tekrar dene.")
    r = httpx.post(url, content=data, timeout=300, headers={
        "Content-Length": str(len(data)), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize"})
    f = (r.json() or {}).get("file") or {}
    for _ in range(30):                      # ACTIVE olana kadar bekle
        if f.get("state") in (None, "ACTIVE"):
            break
        time.sleep(2)
        f = httpx.get(f"{BASE}/v1beta/{f['name']}?key={key}", timeout=20).json()
    if f.get("state") == "FAILED":
        raise AppError("Ses kaydı şu an işlenemedi; biraz sonra 'Yeniden işle' ile tekrar dene.")
    return f


def _delete(f: dict):
    try:
        httpx.delete(f"{BASE}/v1beta/{f['name']}?key={settings.gemini_api_key.strip()}", timeout=20)
    except Exception:  # noqa
        pass


def _transcribe(seg: bytes, idx: int) -> str:
    from app.ai.gemini_provider import pool_models
    key = settings.gemini_api_key.strip()
    f = _upload(seg, "audio/mpeg", f"typdf-seg-{idx}")
    try:
        body = {"contents": [{"role": "user", "parts": [
            {"file_data": {"mime_type": "audio/mpeg", "file_uri": f["uri"]}}, {"text": _PROMPT}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 32000}}
        last = ""
        for attempt in range(3):
            for m in dict.fromkeys(["gemini-flash-latest"] + pool_models()):
                if not usage.available(m):
                    continue
                try:
                    r = httpx.post(f"{BASE}/v1beta/models/{m}:generateContent?key={key}", json=body, timeout=300)
                except httpx.HTTPError as e:
                    last = str(e); continue
                if r.status_code == 200:
                    j = r.json()
                    usage.record(m, "ses-dokum", (j.get("usageMetadata") or {}).get("totalTokenCount", 0))
                    try:
                        return "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"])
                    except Exception:  # noqa
                        return ""
                last = r.text[:200]
                if r.status_code == 404:
                    usage.mark_dead(m)
                elif r.status_code == 429:
                    usage.mark_limited(m, "PerDay" in r.text)
            time.sleep(15 * (attempt + 1))
        if "PerDay" in last:
            raise AppError("Yapay zekâ bugünlük kapasitesini doldurdu; kayıt yarın 'Yeniden işle' ile yazıya dökülebilir.")
        raise AppError("Kayıt şu an yazıya dökülemedi; yapay zekâ yoğun. Biraz sonra 'Yeniden işle' ile tekrar dene.",
                       detail=last[:200])
    finally:
        _delete(f)


def build_transcript(data: bytes, ext: str, progress=None) -> dict:
    from app.services.youtube_service import _parse_ts
    segs, dur = _segments(data, ext)
    rows: list[dict] = []
    for i, (start, seg) in enumerate(segs):
        if progress:
            progress(i, len(segs))
        end = start + SEG_SEC
        rows += _parse_ts(_transcribe(seg, i), start, end)
        if i < len(segs) - 1:
            time.sleep(5)
    if progress:
        progress(len(segs), len(segs))
    rows.sort(key=lambda s: s["start"])
    if not rows or len(" ".join(r["text"] for r in rows)) < 40:
        raise AppError("Kayıtta anlaşılır bir konuşma bulunamadı.")
    return {"method": "gemini-ses", "duration": dur, "segments": rows}
