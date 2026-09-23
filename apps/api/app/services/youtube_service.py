"""YouTube videosunu kaynaga cevirir.

Yol: 1) videonun altyazisi (ucretsiz, kota yok, hizli)
     2) altyazi yoksa/erisilemezse Gemini videoyu izleyip dokum cikarir
Sonuc: zaman damgali parcalar -> ~2 dakikalik bolumler. Her bolum PDF'teki
"sayfa" gibi davranir; boylece arama, sohbet atiflari, sozluk vb. aynen calisir.
"""
import re
import time
import json
import httpx
from app.config import settings
from app.core.errors import AppError

_ID_RE = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/|/v/)([A-Za-z0-9_-]{11})")
SECTION_SEC = 120          # bir "sayfa" = 2 dakika
CLIP_SEC = 15 * 60         # Gemini'ye tek seferde verilen video dilimi
_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
       "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8"}


def video_id(url: str) -> str | None:
    url = (url or "").strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url):
        return url
    m = _ID_RE.search(url)
    return m.group(1) if m else None


def fmt(sec: float) -> str:
    s = int(sec or 0)
    h, m, s = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def meta(vid: str) -> dict:
    """Baslik/kanal (oEmbed) + sure (izleme sayfasi). Hata olursa bos doner."""
    out = {"title": None, "channel": None, "duration": None}
    watch = f"https://www.youtube.com/watch?v={vid}"
    try:
        r = httpx.get("https://www.youtube.com/oembed", params={"url": watch, "format": "json"},
                      timeout=8, headers=_UA)
        if r.status_code == 200:
            j = r.json()
            out["title"], out["channel"] = j.get("title"), j.get("author_name")
        elif r.status_code in (401, 403, 404):
            out["unavailable"] = True
    except Exception:  # noqa
        pass
    try:
        r = httpx.get(watch, timeout=10, headers=_UA, cookies={"CONSENT": "YES+1"}, follow_redirects=True)
        m = re.search(r'"lengthSeconds":"(\d+)"', r.text)
        if m:
            out["duration"] = int(m.group(1))
        if not out["title"]:
            t = re.search(r"<title>(.*?)</title>", r.text, re.S)
            if t:
                out["title"] = re.sub(r"\s*-\s*YouTube\s*$", "", t.group(1)).strip() or None
    except Exception:  # noqa
        pass
    return out


# ---------------------------------------------------------------- 1) altyazi
def _captions(vid: str) -> list[dict] | None:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except Exception:  # noqa
        return None
    langs = ["tr", "en", "de", "fr", "es", "ar", "ru"]
    try:
        api = YouTubeTranscriptApi()
        try:
            data = api.fetch(vid, languages=langs)
        except Exception:  # noqa - istenen dillerde yoksa listedeki ilkini al
            tl = api.list(vid)
            data = next(iter(tl)).fetch()
        segs = [{"start": float(s.start), "text": s.text} for s in data]
    except Exception:  # noqa - bulut IP'leri cogu zaman engelleniyor; Gemini'ye dus
        return None
    segs = [s for s in segs if (s["text"] or "").strip()]
    return segs if len(" ".join(s["text"] for s in segs)) > 80 else None


# ---------------------------------------------------------- 2) Gemini dokumu
_PROMPT = (
    "Bu YouTube videosunun konuşmalarının TAM dökümünü çıkar (özet DEĞİL, söylenenleri eksiksiz yaz). "
    "Konuşma hangi dildeyse o dilde yaz. Her 15-40 saniyede bir yeni satıra geç ve satırın başına "
    "[dd:ss] biçiminde, VERİLEN VİDEO BÖLÜMÜNÜN BAŞINDAN itibaren zaman damgası koy. "
    "Ekranda önemli yazı, slayt, formül, tablo ya da grafik varsa ilgili yere kısa bir "
    "[Ekran: ...] notu ekle. Konuşma yoksa görüntüde olanları anlat. Başka hiçbir açıklama yazma."
)
_TS_RE = re.compile(r"^\s*[\[(]?\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[\])]?\s*[-–:]?\s*(.*)$")


def _parse_ts(text: str, offset: int, clip_end: int | None) -> list[dict]:
    rows = []
    for line in (text or "").splitlines():
        m = _TS_RE.match(line)
        if m:
            h, mi, s, rest = m.groups()
            t = int(h or 0) * 3600 + int(mi) * 60 + int(s)
            rows.append({"start": float(t), "text": rest.strip()})
        elif line.strip() and rows:
            rows[-1]["text"] += " " + line.strip()
        elif line.strip():
            rows.append({"start": 0.0, "text": line.strip()})
    rows = [r for r in rows if r["text"]]
    if offset and rows:
        # Model bazen videonun basindan itibaren (mutlak) zaman verir; ona gore kaydir.
        absolute = rows[0]["start"] >= offset - 10 and (clip_end is None or rows[-1]["start"] <= clip_end + 30)
        if not absolute:
            for r in rows:
                r["start"] += offset
    return rows


def _gemini_clip(vid: str, start: int | None, end: int | None) -> str:
    key = settings.gemini_api_key.strip()
    model = "gemini-2.5-flash"
    part = {"file_data": {"file_uri": f"https://www.youtube.com/watch?v={vid}"}}
    if start is not None:
        part["video_metadata"] = {"start_offset": f"{int(start)}s", "end_offset": f"{int(end)}s"}
    body = {
        "contents": [{"role": "user", "parts": [part, {"text": _PROMPT}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 32000,
                             "mediaResolution": "MEDIA_RESOLUTION_LOW",
                             "thinkingConfig": {"thinkingBudget": 0}},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    waits = (20, 45, 70)
    last = ""
    for attempt in range(len(waits) + 1):
        try:
            r = httpx.post(url, json=body, timeout=300)
        except httpx.HTTPError as e:
            last = str(e)
            if attempt < len(waits):
                time.sleep(waits[attempt]); continue
            raise AppError("Video işlenirken bağlantı koptu; 'Yeniden işle' ile tekrar dene.")
        if r.status_code == 200:
            j = r.json()
            try:
                return "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"])
            except Exception:  # noqa
                raise AppError("Video içeriği okunamadı (video gizli, yaş sınırlı ya da bölgeye kapalı olabilir).")
        last = r.text[:300]
        if r.status_code == 429 and "PerDay" in last:
            raise AppError("Günlük video işleme kotası doldu; yarın 'Yeniden işle' ile devam edebilirsin.")
        if r.status_code in (429, 500, 502, 503, 504) and attempt < len(waits):
            time.sleep(waits[attempt]); continue
        if r.status_code == 400:
            raise AppError("Bu video işlenemedi. Videonun herkese açık olduğundan emin ol.")
        raise AppError(f"Video işlenemedi ({r.status_code}); biraz sonra tekrar dene.")
    raise AppError("Video işlenemedi: " + last[:120])


def _gemini_transcript(vid: str, duration: int | None, progress=None) -> list[dict]:
    if not duration or duration <= CLIP_SEC + 120:
        return _parse_ts(_gemini_clip(vid, None, None), 0, None)
    segs: list[dict] = []
    starts = list(range(0, duration, CLIP_SEC))
    for i, st in enumerate(starts):
        en = min(st + CLIP_SEC, duration)
        if progress:
            progress(i, len(starts))
        segs += _parse_ts(_gemini_clip(vid, st, en), st, en)
        if i < len(starts) - 1:
            time.sleep(15)     # dakikalik token sinirina takilmamak icin nefes payi
    if progress:
        progress(len(starts), len(starts))
    return segs


# ---------------------------------------------------------------- birlestir
def build_transcript(vid: str, duration: int | None, progress=None) -> dict:
    segs = _captions(vid)
    method = "altyazi"
    if not segs:
        segs = _gemini_transcript(vid, duration, progress)
        method = "gemini"
    segs.sort(key=lambda s: s["start"])
    if not segs or len(" ".join(s["text"] for s in segs)) < 40:
        raise AppError("Videodan anlamlı bir döküm çıkarılamadı.")
    return {"video_id": vid, "method": method, "duration": duration, "segments": segs}


def sections(tr: dict) -> list[dict]:
    """Parcalari 2 dakikalik bolumlere toplar: [{page, start, end, text}]."""
    segs = tr.get("segments") or []
    out: list[dict] = []
    for s in segs:
        idx = int(s["start"] // SECTION_SEC)
        if not out or out[-1]["_idx"] != idx:
            out.append({"_idx": idx, "start": s["start"], "lines": []})
        out[-1]["lines"].append(s)
    dur = tr.get("duration")
    res = []
    for i, sec in enumerate(out):
        end = out[i + 1]["start"] if i + 1 < len(out) else (dur or sec["lines"][-1]["start"] + 30)
        body = " ".join(re.sub(r"\s+", " ", l["text"]).strip() for l in sec["lines"])
        res.append({"page": i + 1, "start": float(sec["start"]), "end": float(end),
                    "text": f"[{fmt(sec['start'])}–{fmt(end)}] {body}",
                    "lines": [{"t": l["start"], "x": l["text"]} for l in sec["lines"]]})
    return res


def dumps(tr: dict) -> bytes:
    return json.dumps(tr, ensure_ascii=False).encode("utf-8")
