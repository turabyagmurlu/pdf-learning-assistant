import re
import tiktoken

_enc = tiktoken.get_encoding("cl100k_base")

MAX_TOKENS = 700
OVERLAP_TOKENS = 100

_HEADING_RE = re.compile(r"^\s*(\d+(\.\d+)*\s+.+|[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ \-]{4,})\s*$")


def _tok_len(s: str) -> int:
    return len(_enc.encode(s))


def _split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    return re.split(r"(?<=[.!?])\s+", text) if text else []


def chunk_pages(pages: list[dict]) -> list[dict]:
    """Yapı-farkında, sayfa-korumalı chunk üretimi.
    Dönen: [{chunk_index, page_number, page_end, section_title, content, token_count}]"""
    chunks: list[dict] = []
    current: list[str] = []
    cur_tokens = 0
    start_page = pages[0]["page_number"] if pages else 1
    end_page = start_page
    section_title = None
    idx = 0

    def flush():
        nonlocal current, cur_tokens, idx, start_page, end_page, section_title
        if not current:
            return
        content = " ".join(current).strip()
        if content:
            chunks.append({
                "chunk_index": idx,
                "page_number": start_page,
                "page_end": end_page,
                "section_title": section_title,
                "content": content,
                "token_count": _tok_len(content),
            })
            idx += 1
        current = []
        cur_tokens = 0

    for page in pages:
        pno = page["page_number"]
        for raw_line in page["text"].splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if _HEADING_RE.match(line) and len(line) < 90:
                flush()
                section_title = line
                start_page = pno
                end_page = pno
                continue
            for sent in _split_sentences(line):
                st = _tok_len(sent)
                if cur_tokens + st > MAX_TOKENS and current:
                    end_page = pno
                    flush()
                    start_page = pno
                current.append(sent)
                cur_tokens += st
                end_page = pno
    flush()
    return chunks
