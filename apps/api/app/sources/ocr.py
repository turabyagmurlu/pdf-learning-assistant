"""Taranmis PDF / fotograf -> metin (OCR). Yapay zeka sayfa goruntulerini okur.

PDF 8'er sayfalik parcalar halinde gonderilir; her parcada sayfalar '=== SAYFA k ===' ile
isaretlenir. Sonuc depoya yazilir, yeniden islemede kota harcanmaz.
"""
import base64
import re
import time
import httpx
from app.config import settings
from app.core.errors import AppError
from app.ai import usage

BASE = "https://generativelanguage.googleapis.com/v1beta"
CHUNK_PAGES = 8
MAX_INLINE = 14 * 1024 * 1024

_PROMPT = (
    "Bu PDF parçasında {n} sayfa var (taranmış ya da fotoğraf). Her sayfadaki TÜM yazıyı olduğu gibi, "
    "özetlemeden ve çevirmeden çıkar. Her sayfanın başına ayrı bir satıra '=== SAYFA k ===' yaz (k = 1..{n}). "
    "Paragraf düzenini koru; tablo varsa her satırı hücreleri ' | ' ile ayırarak yaz; başlıkları kendi satırına yaz. "
    "El yazısını da oku; okunamayan yere [okunamadı] yaz. Sayfa boşsa yalnız işaret satırını yaz. Başka açıklama ekleme."
)


def image_to_pdf(data: bytes, ext: str) -> bytes:
    import fitz
    try:
        img = fitz.open(stream=data, filetype=ext)
        pdf = img.convert_to_pdf()
        img.close()
        return pdf
    except Exception:  # noqa
        raise AppError("Görsel açılamadı; JPG, PNG ya da WEBP dene.")


def _split(pdf_bytes: bytes) -> list[tuple[int, int, bytes]]:
    """[(ilk_sayfa, sayfa_sayisi, parca_pdf)] - boyut siniri asilirsa parca kucultulur."""
    import fitz
    src = fitz.open(stream=pdf_bytes, filetype="pdf")
    out, i, n = [], 0, src.page_count
    step = CHUNK_PAGES
    while i < n:
        k = min(step, n - i)
        while True:
            part = fitz.open()
            part.insert_pdf(src, from_page=i, to_page=i + k - 1)
            b = part.tobytes(garbage=3, deflate=True)
            part.close()
            if len(b) <= MAX_INLINE or k == 1:
                break
            k = max(1, k // 2)
        out.append((i + 1, k, b))
        i += k
    src.close()
    return out


def _call(pdf_part: bytes, n: int) -> str:
    from app.ai.gemini_provider import pool_models
    key = settings.gemini_api_key.strip()
    body = {"contents": [{"role": "user", "parts": [
        {"inline_data": {"mime_type": "application/pdf", "data": base64.b64encode(pdf_part).decode()}},
        {"text": _PROMPT.format(n=n)}]}],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 32000}}
    models = ["gemini-flash-latest"] + pool_models()
    last = ""
    for attempt in range(3):
        for m in dict.fromkeys(models):
            if not usage.available(m):
                continue
            try:
                r = httpx.post(f"{BASE}/models/{m}:generateContent?key={key}", json=body, timeout=240)
            except httpx.HTTPError as e:
                last = str(e); continue
            if r.status_code == 200:
                j = r.json()
                usage.record(m, "ocr", (j.get("usageMetadata") or {}).get("totalTokenCount", 0))
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
        raise AppError("Yapay zekâ bugünlük kapasitesini doldurdu; taranmış sayfalar yarın 'Yeniden işle' ile okunabilir.")
    raise AppError("Taranmış sayfalar şu an okunamadı; yapay zekâ yoğun. Biraz sonra 'Yeniden işle' ile tekrar dene.",
                   detail=last[:200])


def _parse(text: str, first: int, n: int) -> dict[int, str]:
    pages: dict[int, str] = {}
    parts = re.split(r"^\s*=+\s*SAYFA\s+(\d+)\s*=+\s*$", text or "", flags=re.M | re.I)
    if len(parts) < 3:                         # isaret yoksa tek blok -> ilk sayfaya
        if (text or "").strip():
            pages[first] = text.strip()
        return pages
    for j in range(1, len(parts) - 1, 2):
        try:
            k = int(parts[j])
        except ValueError:
            continue
        if 1 <= k <= n:
            pages[first + k - 1] = (pages.get(first + k - 1, "") + "\n" + parts[j + 1]).strip()
    return pages


def ocr_pdf(pdf_bytes: bytes, progress=None) -> list[dict]:
    chunks = _split(pdf_bytes)
    total_pages = sum(k for _, k, _ in chunks)
    got: dict[int, str] = {}
    done = 0
    for first, k, part in chunks:
        if progress:
            progress(done, total_pages)
        got.update(_parse(_call(part, k), first, k))
        done += k
        if done < total_pages:
            time.sleep(4)                      # dakikalik token sinirina nefes
    if progress:
        progress(total_pages, total_pages)
    pages = [{"page_number": p, "text": got.get(p, "")} for p in range(1, total_pages + 1)]
    if sum(len(p["text"].strip()) for p in pages) < 30:
        raise AppError("Görüntülerde okunabilir yazı bulunamadı.")
    return pages
