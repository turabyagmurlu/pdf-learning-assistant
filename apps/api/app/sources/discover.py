"""Web'den kaynak bulma: Google aramasi destekli model konuyu arastirir,
bulunan GERCEK linkler (modelin uydurdugu degil, arama sonucundaki) cozulur
ve her biri icin baslik / aciklama onizlemesi cikarilir."""
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
import httpx
from app.config import settings
from app.core.errors import AppError, AiUnavailable
from app.ai import usage
from app.sources.web import UA, _safe_host

BASE = "https://generativelanguage.googleapis.com/v1beta"


def _prompt(topic: str, context: str) -> str:
    return (
        f"Konu: {topic}\n"
        + (f"Araştırmanın bağlamı (mevcut kaynakların özeti): {context[:1500]}\n" if context else "")
        + "Bu konuyu derinlemesine çalışmak isteyen bir araştırmacı için web'de GÜVENİLİR ve dolu içerikli "
          "kaynaklar ara: akademik makaleler, üniversite/kurum sayfaları, ansiklopedik maddeler, resmi raporlar, "
          "nitelikli uzun yazılar. Türkçe ve İngilizce kaynakları birlikte değerlendir. Forum, reklam, "
          "sosyal medya ve kısa haberleri tercih etme. Sonra 3-4 cümlelik Türkçe bir genel bakış yaz: "
          "konunun ana başlıkları ve kaynaklarda nelere bakılmalı."
    )


def _call(topic: str, context: str) -> dict:
    from app.ai.gemini_provider import pool_models
    body = {"contents": [{"role": "user", "parts": [{"text": _prompt(topic, context)}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"temperature": 0.3}}
    key = settings.gemini_api_key.strip()
    last = ""
    for m in pool_models():
        if not usage.available(m):
            continue
        try:
            r = httpx.post(f"{BASE}/models/{m}:generateContent?key={key}", json=body, timeout=90)
        except httpx.HTTPError as e:
            last = str(e); continue
        if r.status_code == 200:
            j = r.json()
            usage.record(m, "arama", (j.get("usageMetadata") or {}).get("totalTokenCount", 0))
            return j
        last = r.text[:200]
        if r.status_code == 404:
            usage.mark_dead(m)
        elif r.status_code == 429:
            usage.mark_limited(m, "PerDay" in r.text)
        elif r.status_code == 400:
            continue                      # bu model arama aracini desteklemiyor olabilir
    raise AiUnavailable("Web araması şu an yapılamıyor (kota dolu olabilir); biraz sonra tekrar dene.", detail=last)


def _resolve(uri: str) -> str | None:
    """Arama yonlendirme linkini asil adrese cevirir."""
    try:
        if "vertexaisearch" not in uri and "grounding-api-redirect" not in uri:
            return uri
        with httpx.Client(timeout=10, follow_redirects=False, headers=UA) as c:
            r = c.get(uri)
            loc = r.headers.get("location")
            if loc:
                return loc
            r = httpx.get(uri, timeout=12, follow_redirects=True, headers=UA)
            return str(r.url)
    except Exception:  # noqa
        return None


def _preview(url: str) -> dict | None:
    """Sayfanin basligini, aciklamasini ve turunu cikarir (ilk ~300 KB)."""
    try:
        _safe_host(url)
        with httpx.Client(timeout=httpx.Timeout(10, connect=6), follow_redirects=True, headers=UA) as c:
            with c.stream("GET", url) as r:
                if r.status_code >= 400:
                    return None
                ctype = (r.headers.get("content-type") or "").lower()
                final = str(r.url)
                if "pdf" in ctype:
                    name = final.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
                    return {"url": final, "title": name or urlparse(final).hostname, "kind": "pdf",
                            "description": "PDF belgesi", "site": urlparse(final).hostname}
                buf = bytearray()
                for ch in r.iter_bytes():
                    buf += ch
                    if len(buf) > 300_000:
                        break
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(bytes(buf).decode("utf-8", "ignore"), "lxml")

        def meta(*names):
            for n in names:
                el = soup.select_one(f'meta[property="{n}"]') or soup.select_one(f'meta[name="{n}"]')
                if el and el.get("content"):
                    return el["content"].strip()
            return None
        title = meta("og:title", "citation_title", "dc.title") or (soup.title.string.strip() if soup.title and soup.title.string else None)
        desc = meta("og:description", "description", "citation_abstract")
        if not desc:
            p = next((p.get_text(" ", strip=True) for p in soup.find_all("p") if len(p.get_text(strip=True)) > 80), "")
            desc = p[:260]
        site = meta("og:site_name") or urlparse(final).hostname
        words = len(soup.get_text(" ", strip=True).split())
        return {"url": final, "title": (title or site or final)[:200], "description": (desc or "")[:300],
                "site": site, "kind": "web", "academic": bool(meta("citation_title", "citation_doi")),
                "words": words}
    except Exception:  # noqa
        return None


def discover(topic: str, context: str = "", exclude: set[str] | None = None) -> dict:
    topic = (topic or "").strip()
    if len(topic) < 3:
        raise AppError("Aramak istediğin konuyu yaz.")
    j = _call(topic, context)
    cand = (j.get("candidates") or [{}])[0]
    overview = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []))
    overview = re.sub(r"\[\d+(,\s*\d+)*\]", "", overview).strip()
    gm = cand.get("groundingMetadata") or {}
    chunks = [c.get("web") for c in gm.get("groundingChunks") or [] if c.get("web")]
    queries = gm.get("webSearchQueries") or []
    uris = []
    for c in chunks:
        if c.get("uri") and c["uri"] not in uris:
            uris.append(c["uri"])
    with ThreadPoolExecutor(max_workers=8) as ex:
        resolved = list(ex.map(_resolve, uris[:14]))
    seen, urls = set(exclude or ()), []
    for u in resolved:
        if not u:
            continue
        norm = u.split("#")[0]
        if norm in seen:
            continue
        seen.add(norm); urls.append(norm)
    with ThreadPoolExecutor(max_workers=8) as ex:
        previews = [p for p in ex.map(_preview, urls) if p]
    # akademik ve uzun icerikler once
    previews.sort(key=lambda p: (not p.get("academic"), p.get("kind") != "pdf", -(p.get("words") or 0)))
    return {"topic": topic, "overview": overview[:1500], "queries": queries, "results": previews[:10]}
