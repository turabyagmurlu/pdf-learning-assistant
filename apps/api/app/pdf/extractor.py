import fitz  # PyMuPDF
from app.core.errors import PdfUnreadable, PdfNoText


def extract_pages(pdf_bytes: bytes) -> list[dict]:
    """Her sayfa için {page_number, text}. Metin yoksa PdfNoText fırlatır."""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:  # noqa
        raise PdfUnreadable(detail=str(e))

    pages = []
    total_chars = 0
    for i, page in enumerate(doc):
        text = page.get_text("text") or ""
        total_chars += len(text.strip())
        pages.append({"page_number": i + 1, "text": text})
    doc.close()

    if total_chars < 40:  # neredeyse hiç metin yok -> taranmış PDF
        raise PdfNoText()
    return pages


def page_count(pdf_bytes: bytes) -> int:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    n = doc.page_count
    doc.close()
    return n
