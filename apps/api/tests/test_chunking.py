from app.pdf.chunking import chunk_pages


def test_chunk_pages_basic():
    pages = [{"page_number": 1, "text": "Giriş\nBu bir test cümlesidir. İkinci cümle burada."},
             {"page_number": 2, "text": "Bölüm 2\nDaha fazla içerik var. Son cümle."}]
    chunks = chunk_pages(pages)
    assert len(chunks) >= 1
    assert all("content" in c and c["content"] for c in chunks)
    assert all(c["page_number"] in (1, 2) for c in chunks)
