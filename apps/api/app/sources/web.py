"""Web sayfasini (ya da PDF linkini) guvenli bicimde indirir."""
import ipaddress
import socket
from urllib.parse import urlparse
import httpx
from app.core.errors import AppError

MAX_BYTES = 25 * 1024 * 1024
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8"}


def _safe_host(url: str):
    """Sunucunun kendi ic agina (localhost, 10.x, 192.168.x ...) istek atilmasini engeller."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise AppError("Geçerli bir web adresi değil (http/https ile başlamalı).")
    try:
        infos = socket.getaddrinfo(u.hostname, None)
    except socket.gaierror:
        raise AppError("Bu adrese ulaşılamadı (alan adı bulunamadı).")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise AppError("Bu adres güvenlik nedeniyle eklenemiyor; herkese açık bir web sayfası dene.")


def fetch(url: str) -> dict:
    """{kind: 'pdf'|'html', data: bytes, final_url, content_type}"""
    url = (url or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    _safe_host(url)
    try:
        with httpx.Client(timeout=httpx.Timeout(20, connect=8), follow_redirects=True, headers=UA,
                          max_redirects=6) as c:
            with c.stream("GET", url) as r:
                _safe_host(str(r.url))                     # yonlendirme sonrasi da kontrol
                if r.status_code in (401, 403):
                    raise AppError("Site bu sayfaya erişime izin vermiyor (giriş/abonelik gerekiyor olabilir).")
                if r.status_code == 404:
                    raise AppError("Sayfa bulunamadı; adresi kontrol et.")
                if r.status_code >= 400:
                    raise AppError("Sayfa şu an açılamadı; adresi kontrol et ya da biraz sonra tekrar dene.")
                buf = bytearray()
                for chunk in r.iter_bytes():
                    buf += chunk
                    if len(buf) > MAX_BYTES:
                        raise AppError("Sayfa çok büyük (25 MB sınırı).")
                ctype = (r.headers.get("content-type") or "").lower()
                final = str(r.url)
    except AppError:
        raise
    except httpx.HTTPError:
        raise AppError("Sayfaya bağlanılamadı; adres doğru mu?")
    data = bytes(buf)
    if "pdf" in ctype or data[:5] == b"%PDF-":
        return {"kind": "pdf", "data": data, "final_url": final, "content_type": ctype}
    if "html" in ctype or "xml" in ctype or data.lstrip()[:1] == b"<":
        return {"kind": "html", "data": data, "final_url": final, "content_type": ctype}
    if ctype.startswith("text/"):
        return {"kind": "txt", "data": data, "final_url": final, "content_type": ctype}
    raise AppError("Bu linkteki içerik türü desteklenmiyor. Dosyaysa indirip yükleyebilirsin.")
