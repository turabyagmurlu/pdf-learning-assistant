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
    errs = []
    for m in pool_models():
        if not usage.available(m):
            continue
        try:
            r = httpx.post(f"{BASE}/models/{m}:generateContent?key={key}", json=body, timeout=90)
        except httpx.HTTPError as e:
            errs.append(f"{m}: bağlantı"); continue
        if r.status_code == 200:
            j = r.json()
            usage.record(m, "arama", (j.get("usageMetadata") or {}).get("totalTokenCount", 0))
            return j
        try:
            msg = ((r.json().get("error") or {}).get("message") or "")[:140]
        except Exception:  # noqa
            msg = r.text[:140]
        errs.append(f"{m}: {r.status_code} {msg}")
        if r.status_code == 404:
            usage.mark_dead(m)
        # 429 burada isaretlenmez: arama kotasi dolmus olabilir ama model metin icin hala kullanilabilir
    if any(" 429 " in e for e in errs):
        raise AiUnavailable("Web araması kotası şu an dolu; birkaç dakika sonra tekrar dene.", detail="; ".join(errs))
    raise AiUnavailable("Web araması şu an yapılamıyor. (" + (errs[0] if errs else "model yok") + ")",
                        detail="; ".join(errs))


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


def _en_query(topic: str) -> str:
    """OpenAlex Ingilizce aramada daha iyi: Turkce konuyu kisa Ingilizce anahtar kelimelere cevirir (1 kucuk istek).
    Kota yoksa konu oldugu gibi kullanilir."""
    if not re.search(r"[çğıöşüÇĞİÖŞÜ]", topic):
        return topic
    try:
        from app.ai.factory import get_llm
        out = get_llm().complete([{"role": "user", "content":
            "Translate this research topic into a concise English academic search query (max 8 words). "
            f"Reply with the query only.\n\n{topic}"}])
        out = (out or "").strip().strip('"').splitlines()[0]
        return out[:120] or topic
    except Exception:  # noqa
        return topic


def _openalex(query: str, n: int = 8) -> list[dict]:
    """OpenAlex: 250M+ akademik yayin, ucretsiz, anahtarsiz. Yalniz acik erisimli olanlar (eklenebilsin diye)."""
    try:
        r = httpx.get("https://api.openalex.org/works", timeout=15, headers=UA, params={
            "search": query, "per_page": n, "filter": "is_oa:true,type:article|review|book-chapter",
            "sort": "relevance_score:desc", "mailto": "typdf@example.com",
            "select": "id,display_name,doi,publication_year,open_access,primary_location,cited_by_count,"
                      "abstract_inverted_index,authorships"})
        if r.status_code != 200:
            return []
        out = []
        for w in r.json().get("results", []):
            url = ((w.get("open_access") or {}).get("oa_url")) or (w.get("doi") or "")
            if not url:
                continue
            inv = w.get("abstract_inverted_index") or {}
            words = sorted(((i, k) for k, idx in inv.items() for i in idx))
            abstract = " ".join(k for _, k in words)[:300]
            src = ((w.get("primary_location") or {}).get("source") or {}).get("display_name")
            auth = ", ".join(a["author"]["display_name"] for a in (w.get("authorships") or [])[:2] if a.get("author"))
            meta = " · ".join(filter(None, [auth, src, str(w.get("publication_year") or ""),
                                            f"{w.get('cited_by_count', 0)} atıf" if w.get("cited_by_count") else ""]))
            out.append({"url": url, "title": w.get("display_name") or url, "description": abstract,
                        "site": meta or "OpenAlex", "kind": "pdf" if url.lower().endswith(".pdf") else "web",
                        "academic": True, "words": 4000, "origin": "openalex"})
        return out
    except Exception:  # noqa
        return []


def _wikipedia(query: str, lang: str, n: int = 2) -> list[dict]:
    try:
        r = httpx.get(f"https://{lang}.wikipedia.org/w/api.php", timeout=10, headers=UA, params={
            "action": "query", "list": "search", "srsearch": query, "srlimit": n, "format": "json"})
        out = []
        for h in r.json().get("query", {}).get("search", []):
            title = h["title"]
            snippet = re.sub(r"<[^>]+>", "", h.get("snippet") or "")
            out.append({"url": f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}", "title": title,
                        "description": snippet, "site": f"Vikipedi ({lang})", "kind": "web", "academic": False,
                        "words": int(h.get("wordcount") or 0), "origin": "wikipedia"})
        return out
    except Exception:  # noqa
        return []


def discover(topic: str, context: str = "", exclude: set[str] | None = None) -> dict:
    topic = (topic or "").strip()
    if len(topic) < 3:
        raise AppError("Aramak istediğin konuyu yaz.")
    seen = set(exclude or ())
    # 1) Google aramasi destekli model (kota varsa)
    overview, queries, web_results, web_err = "", [], [], None
    try:
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
        urls = []
        for u in resolved:
            if u and u.split("#")[0] not in seen:
                seen.add(u.split("#")[0]); urls.append(u.split("#")[0])
        with ThreadPoolExecutor(max_workers=8) as ex:
            web_results = [p for p in ex.map(_preview, urls) if p]
        for p in web_results:
            p["origin"] = "google"
    except (AiUnavailable, AppError) as e:
        web_err = getattr(e, "user_message", str(e))
    # 2) acik kaynaklar: akademik (OpenAlex) + ansiklopedi (Vikipedi) - kota harcamaz
    q_en = _en_query(topic)
    with ThreadPoolExecutor(max_workers=3) as ex:
        fa = ex.submit(_openalex, q_en)
        fw = ex.submit(_wikipedia, topic, "tr")
        fe = ex.submit(_wikipedia, q_en, "en")
        open_results = fa.result() + fw.result() + fe.result()
    open_results = [r for r in open_results if r["url"] not in seen and not seen.add(r["url"])]
    web_results.sort(key=lambda p: (not p.get("academic"), p.get("kind") != "pdf", -(p.get("words") or 0)))
    results = web_results[:8] + open_results[:10]
    if not results:
        raise AppError(web_err or "Uygun kaynak bulunamadı; konuyu biraz daha açık yazmayı dene.")
    note = None
    if web_err:
        note = "Google araması şu an kullanılamadı; akademik yayın ve ansiklopedi kaynakları gösteriliyor."
    return {"topic": topic, "overview": overview[:1500], "queries": queries, "results": results, "note": note}
