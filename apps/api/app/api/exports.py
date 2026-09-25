"""Disa aktarim (TO-6): taslagi gercek .docx olarak verir (python-docx).

- POST /collections/{cid}/export/docx  body {title, blocks, sources?}  -> application/vnd.openxmlformats-officedocument.wordprocessingml.document

Blok bicimi DraftEditor.Block ile aynidir:
  {type:"p", text}  {type:"h", text}
  {type:"quote", text, source, page, note?, color?}
  {type:"answer", q, text, sources:[{title, page?, document_id}]}
Metinler icindeki kucuk markdown (basliklar #/##/###, madde - * +, numarali 1., alinti >, **kalin**,
*italik* / _italik_, `kod`) Word stillerine cevrilir. `[K1]` atiflari "(Kaynak adi, s. N)" olur:
answer blogunda kendi `sources` listesinden, paragraflarda govdedeki `sources` listesinden.
Yapay zeka ve kullanim harcamaz.
"""
import io
import re
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.errors import AppError, NotFound
from app.deps import current_user, db

router = APIRouter(tags=["exports"])

COL_MISSING = "Defter bulunamadı; silinmiş olabilir. Defterler sayfasına dön."


# ---------------------------------------------------------------- kucuk markdown ayristirici
CITE_RE = re.compile(r"\[(K\s*\d+(?:\s*[,;]\s*K?\s*\d+)*)\]")
_INLINE_RE = re.compile(
    r"(\*\*(?P<b>.+?)\*\*)"                 # **kalin**
    r"|(`(?P<c>[^`]+)`)"                     # `kod`
    r"|((?<![\w*])\*(?P<i1>[^*\n]+?)\*(?![\w*]))"   # *italik*
    r"|((?<!\w)_(?P<i2>[^_\n]+?)_(?!\w))"           # _italik_
    r"|(?P<k>\[K\s*\d+(?:\s*[,;]\s*K?\s*\d+)*\])"   # [K1] / [K1, K2]
)


def _cite_numbers(raw: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", raw)]


def cite_text(nums: list[int], sources: list[dict]) -> str:
    """[K1] -> "(Kaynak adı, s. 12)"; kaynak bilinmiyorsa "[K1]" oldugu gibi kalir."""
    parts = []
    for n in nums:
        s = sources[n - 1] if 0 < n <= len(sources) and isinstance(sources[n - 1], dict) else None
        if not s:
            parts.append(f"K{n}")
            continue
        t = str(s.get("title") or "Kaynak").strip()
        pg = s.get("page")
        parts.append(f"{t}, s. {pg}" if pg else t)
    if not any(0 < n <= len(sources) for n in nums):
        return "[" + ", ".join(parts) + "]"          # hicbiri bilinmiyor: [K1] oldugu gibi kalsin
    return "(" + "; ".join(parts) + ")"


def parse_inline(text: str, sources: list[dict]) -> list[tuple[str, dict]]:
    """Metni (parca, {bold, italic, code}) listesine boler. Atiflar duz metin olarak eklenir."""
    out: list[tuple[str, dict]] = []
    pos = 0
    for m in _INLINE_RE.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], {}))
        if m.group("b") is not None:
            for seg, st in parse_inline(m.group("b"), sources):
                out.append((seg, {**st, "bold": True}))
        elif m.group("c") is not None:
            out.append((m.group("c"), {"code": True}))
        elif m.group("i1") is not None or m.group("i2") is not None:
            inner = m.group("i1") if m.group("i1") is not None else m.group("i2")
            for seg, st in parse_inline(inner, sources):
                out.append((seg, {**st, "italic": True}))
        elif m.group("k") is not None:
            out.append((cite_text(_cite_numbers(m.group("k")), sources), {"cite": True}))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], {}))
    return out


_H_RE = re.compile(r"^(#{1,3})\s+(.*)$")
_UL_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
_OL_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_BQ_RE = re.compile(r"^\s*>\s?(.*)$")


def parse_markdown(text: str) -> list[dict]:
    """Satirlari bloklara ayirir: {kind: p|h1|h2|h3|ul|ol|blockquote, text | items}."""
    lines = (text or "").replace("\r\n", "\n").split("\n")
    blocks: list[dict] = []
    para: list[str] = []
    lst: dict | None = None
    quote: list[str] = []

    def flush_para():
        nonlocal para
        if para:
            blocks.append({"kind": "p", "text": " ".join(s.strip() for s in para)})
            para = []

    def flush_list():
        nonlocal lst
        if lst:
            blocks.append(lst)
            lst = None

    def flush_quote():
        nonlocal quote
        if quote:
            blocks.append({"kind": "blockquote", "text": " ".join(s.strip() for s in quote if s.strip())})
            quote = []

    for ln in lines:
        if not ln.strip():
            flush_para(); flush_list(); flush_quote()
            continue
        m = _H_RE.match(ln)
        if m:
            flush_para(); flush_list(); flush_quote()
            blocks.append({"kind": f"h{len(m.group(1))}", "text": m.group(2).strip()})
            continue
        m = _BQ_RE.match(ln)
        if m:
            flush_para(); flush_list()
            quote.append(m.group(1))
            continue
        m = _UL_RE.match(ln)
        if m:
            flush_para(); flush_quote()
            if not lst or lst["kind"] != "ul":
                flush_list(); lst = {"kind": "ul", "items": []}
            lst["items"].append(m.group(1).strip())
            continue
        m = _OL_RE.match(ln)
        if m:
            flush_para(); flush_quote()
            if not lst or lst["kind"] != "ol":
                flush_list(); lst = {"kind": "ol", "items": []}
            lst["items"].append(m.group(1).strip())
            continue
        if lst and ln.startswith((" ", "\t")):
            lst["items"][-1] += " " + ln.strip()        # madde devam satiri
            continue
        flush_list(); flush_quote()
        para.append(ln)
    flush_para(); flush_list(); flush_quote()
    return blocks


# ---------------------------------------------------------------- docx uretimi
def _add_runs(par, text: str, sources: list[dict], base_italic: bool = False, size_pt: float | None = None):
    from docx.shared import Pt, RGBColor
    for seg, st in parse_inline(text, sources):
        if not seg:
            continue
        r = par.add_run(seg)
        if st.get("bold"):
            r.bold = True
        if st.get("italic") or base_italic:
            r.italic = True
        if st.get("code"):
            r.font.name = "Consolas"
        if st.get("cite"):
            r.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
        if size_pt:
            r.font.size = Pt(size_pt)


def _add_markdown(doc, text: str, sources: list[dict], italic: bool = False):
    from docx.shared import Pt
    for b in parse_markdown(text):
        k = b["kind"]
        if k in ("h1", "h2", "h3"):
            # taslak icindeki basliklar belge basliginin altinda: h1 -> Heading 2 ...
            p = doc.add_heading("", level=min(int(k[1]) + 1, 4))
            _add_runs(p, b["text"], sources)
        elif k == "ul":
            for it in b["items"]:
                p = doc.add_paragraph(style="List Bullet")
                _add_runs(p, it, sources, italic)
        elif k == "ol":
            for it in b["items"]:
                p = doc.add_paragraph(style="List Number")
                _add_runs(p, it, sources, italic)
        elif k == "blockquote":
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Pt(24)
            _add_runs(p, b["text"], sources, True)
        else:
            p = doc.add_paragraph()
            _add_runs(p, b["text"], sources, italic)


def _quote_card(doc, b: dict):
    from docx.shared import Pt, RGBColor
    text = re.sub(r"\s+", " ", str(b.get("text") or "")).strip()
    src = str(b.get("source") or "Kaynak").strip()
    pg = b.get("page")
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Pt(24)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(f"“{text}”")
    r.italic = True
    p2 = doc.add_paragraph()
    p2.paragraph_format.left_indent = Pt(24)
    r2 = p2.add_run(f"— {src}, s. {pg}" if pg else f"— {src}")
    r2.font.size = Pt(9)
    r2.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
    note = str(b.get("note") or "").strip()
    if note:
        _add_markdown(doc, note, [], italic=True)


def _answer_card(doc, b: dict):
    from docx.shared import Pt, RGBColor
    srcs = [s for s in (b.get("sources") or []) if isinstance(s, dict)]
    q = str(b.get("q") or "").strip()
    if q:
        p = doc.add_paragraph()
        r = p.add_run(q)
        r.bold = True
    _add_markdown(doc, str(b.get("text") or ""), srcs)
    if srcs:
        p = doc.add_paragraph()
        items = []
        for i, s in enumerate(srcs):
            t = str(s.get("title") or "Kaynak").strip()
            pg = s.get("page")
            items.append(f"[K{i + 1}] {t}{', s. ' + str(pg) if pg else ''}")
        r = p.add_run("Kaynaklar: " + "; ".join(items))
        r.italic = True
        r.font.size = Pt(9)
        r.font.color.rgb = RGBColor(0x66, 0x66, 0x66)


def build_docx(title: str, blocks: list[dict], sources: list[dict]) -> bytes:
    try:
        from docx import Document
        from docx.shared import Pt
    except Exception:  # noqa
        raise AppError("Word dışa aktarımı bu sunucuda kurulu değil (python-docx eksik).")
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = "Georgia"
    st.font.size = Pt(12)
    doc.add_heading(title or "Taslak", level=1)
    for b in blocks:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        if t == "h":
            p = doc.add_heading("", level=2)
            _add_runs(p, str(b.get("text") or "").strip(), sources)
        elif t == "p":
            if str(b.get("text") or "").strip():
                _add_markdown(doc, str(b.get("text") or ""), sources)
        elif t == "quote":
            _quote_card(doc, b)
        elif t == "answer":
            _answer_card(doc, b)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- uc
class DocxIn(BaseModel):
    title: str | None = None
    blocks: list[dict[str, Any]]
    # paragraflardaki [K1] atiflari icin (sira = K numarasi): [{title, page?, document_id?}]
    sources: list[dict[str, Any]] | None = None


def _safe_filename(title: str) -> str:
    t = re.sub(r"[\\/:*?\"<>|\r\n]+", " ", title or "").strip()
    t = re.sub(r"\s+", " ", t)[:80] or "Taslak"
    ascii_t = t.encode("ascii", "ignore").decode("ascii").strip() or "Taslak"
    return t, ascii_t


@router.post("/collections/{cid}/export/docx")
async def export_docx(cid: str, body: DocxIn, conn=Depends(db), user=Depends(current_user)):
    """Taslagi .docx dosyasi olarak indirir (Word uyarisiz acar). Yapay zeka yok."""
    import asyncio
    from urllib.parse import quote
    row = await conn.fetchrow("SELECT title FROM collections WHERE id=$1 AND user_id=$2", cid, user["id"])
    if not row:
        raise NotFound(COL_MISSING)
    if not body.blocks:
        raise AppError("Taslak boş; dışa aktarılacak bir şey yok.")
    if len(body.blocks) > 2000:
        raise AppError("Taslak çok uzun; parçalara bölerek dışa aktar.")
    title = (body.title or row["title"] or "Taslak").strip()
    data = await asyncio.to_thread(build_docx, title, body.blocks, body.sources or [])
    name, ascii_name = _safe_filename(title)
    fname = f"{name}-{date.today()}.docx"
    return Response(
        data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition":
                 f"attachment; filename=\"{ascii_name}-{date.today()}.docx\"; filename*=UTF-8''{quote(fname)}"})
