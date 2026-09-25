/**
 * Küçük, bağımlılıksız markdown işleyici.
 * Yapay zekâ cevaplarındaki **kalın**, *italik*, `kod`, "- madde", "1. madde",
 * "### başlık" ve "> alıntı" işaretlerini blok/satır içi yapıya çevirir.
 * `[K1]`, `[K1, K3]` atıf işaretleri korunur (Markdown bileşeni rozete çevirir).
 *
 * Kullanım:
 *   parseMarkdown(text)  → Block[]      (React / Word / Markdown çıktıları için)
 *   mdToPlain(text)      → string       (Kopyala, kelime sayacı, benzerlik)
 *   mdToHtml(text)       → string       (Word .doc HTML; güvenli kaçışlı)
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "cite"; n: number[]; raw: string };

export type Block =
  | { type: "p"; inline: Inline[] }
  | { type: "h1" | "h2" | "h3"; inline: Inline[] }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; items: Inline[][]; start: number }
  | { type: "blockquote"; inline: Inline[] };

/** Atıf işareti: [K1], [K1, K3], [K1; K4], [K 2] */
export const CITE_RE = /\[(K\s*\d+(?:\s*[,;]\s*K?\s*\d+)*)\]/g;

function citeNums(inner: string): number[] {
  return Array.from(inner.matchAll(/\d+/g)).map((m) => parseInt(m[0], 10)).filter((n) => n > 0);
}

/* ---------------------------------------------------------------- satır içi */

/** Metni satır içi düğümlere ayırır (kod, kalın, italik, atıf). */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    // Kaçış: \* \_ \` \[
    if (ch === "\\" && i + 1 < n && "*_`[]\\#>".includes(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    // Satır içi kod
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) { flush(); out.push({ t: "code", v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    // Atıf
    if (ch === "[") {
      CITE_RE.lastIndex = 0;
      const rest = src.slice(i);
      const m = /^\[(K\s*\d+(?:\s*[,;]\s*K?\s*\d+)*)\]/.exec(rest);
      if (m) { flush(); out.push({ t: "cite", n: citeNums(m[1]), raw: m[0] }); i += m[0].length; continue; }
    }
    // Kalın: ** ... ** ya da __ ... __
    if ((ch === "*" || ch === "_") && src[i + 1] === ch) {
      const close = findClose(src, i + 2, ch + ch);
      if (close > i + 2) {
        flush();
        out.push({ t: "bold", c: parseInline(src.slice(i + 2, close)) });
        i = close + 2; continue;
      }
    }
    // İtalik: * ... * ya da _ ... _ (kelime içi alt çizgi hariç)
    if (ch === "*" || (ch === "_" && (i === 0 || /[\s(["'“‘]/.test(src[i - 1])))) {
      const next = src[i + 1];
      if (next && !/\s/.test(next)) {
        const close = findClose(src, i + 1, ch);
        if (close > i + 1 && !/\s/.test(src[close - 1]) && (ch === "*" || close + 1 >= n || /[\s.,;:!?)\]"'”’]/.test(src[close + 1]))) {
          flush();
          out.push({ t: "italic", c: parseInline(src.slice(i + 1, close)) });
          i = close + 1; continue;
        }
      }
    }
    buf += ch; i++;
  }
  flush();
  return out;
}

/** `marker` için kapanış konumunu bulur; satır içi kod ve kaçışları atlar. */
function findClose(src: string, from: number, marker: string): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === "`") { const e = src.indexOf("`", i + 1); if (e > 0) { i = e + 1; continue; } }
    if (src.startsWith(marker, i)) return i;
    i++;
  }
  return -1;
}

/* ---------------------------------------------------------------- blok */

const H_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL_RE = /^\s{0,3}[-*•·]\s+(.*)$/;
const OL_RE = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const BQ_RE = /^\s{0,3}>\s?(.*)$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/** Metni bloklara ayırır. Bilinmeyen her şey paragraf olur; hiçbir işaret kaybolmaz. */
export function parseMarkdown(text: string): Block[] {
  const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const joined = para.join("\n").trim();
    if (joined) blocks.push({ type: "p", inline: parseInline(joined) });
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); i++; continue; }

    // Çitli kod bloğu: içeriği düz paragraf olarak ver (HTML üretmiyoruz)
    if (/^\s*```/.test(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      if (body.length) blocks.push({ type: "p", inline: [{ t: "code", v: body.join("\n") }] });
      continue;
    }
    if (HR_RE.test(line)) { flushPara(); i++; continue; }

    const h = H_RE.exec(line);
    if (h) {
      flushPara();
      const lvl = Math.min(3, h[1].length) as 1 | 2 | 3;
      blocks.push({ type: ("h" + lvl) as "h1" | "h2" | "h3", inline: parseInline(h[2]) });
      i++; continue;
    }

    if (UL_RE.test(line)) {
      flushPara();
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = UL_RE.exec(lines[i]);
        if (!m) break;
        let item = m[1];
        i++;
        // Devam satırları (girintili, liste işareti olmayan)
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i])) {
          item += " " + lines[i].trim(); i++;
        }
        items.push(parseInline(item));
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    const o = OL_RE.exec(line);
    if (o) {
      flushPara();
      const items: Inline[][] = [];
      const start = parseInt(o[1], 10) || 1;
      while (i < lines.length) {
        const m = OL_RE.exec(lines[i]);
        if (!m) break;
        let item = m[2];
        i++;
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i])) {
          item += " " + lines[i].trim(); i++;
        }
        items.push(parseInline(item));
      }
      blocks.push({ type: "ol", items, start });
      continue;
    }

    if (BQ_RE.test(line)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length) {
        const m = BQ_RE.exec(lines[i]);
        if (!m) break;
        q.push(m[1]); i++;
      }
      blocks.push({ type: "blockquote", inline: parseInline(q.join(" ").trim()) });
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

/* ---------------------------------------------------------------- çıktılar */

/** Satır içi düğümleri düz metne çevirir. `cite` verilirse atıf yerine onun çıktısı yazılır. */
export function inlineToPlain(inl: Inline[], cite?: (n: number[], raw: string) => string): string {
  let s = "";
  for (const x of inl) {
    if (x.t === "text" || x.t === "code") s += x.v;
    else if (x.t === "bold" || x.t === "italic") s += inlineToPlain(x.c, cite);
    else s += cite ? cite(x.n, x.raw) : x.raw;
  }
  return s;
}

/** Markdown → düz metin (işaretler temizlenir, [K#] korunur ya da `cite` ile dönüştürülür). */
export function mdToPlain(text: string, cite?: (n: number[], raw: string) => string): string {
  const parts: string[] = [];
  for (const b of parseMarkdown(text)) {
    if (b.type === "ul") parts.push(b.items.map((it) => "• " + inlineToPlain(it, cite)).join("\n"));
    else if (b.type === "ol") parts.push(b.items.map((it, k) => (b.start + k) + ". " + inlineToPlain(it, cite)).join("\n"));
    else parts.push(inlineToPlain(b.inline, cite));
  }
  return parts.join("\n\n");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function inlineToHtml(inl: Inline[], cite?: (n: number[], raw: string) => string): string {
  let s = "";
  for (const x of inl) {
    if (x.t === "text") s += escapeHtml(x.v);
    else if (x.t === "code") s += "<code>" + escapeHtml(x.v) + "</code>";
    else if (x.t === "bold") s += "<b>" + inlineToHtml(x.c, cite) + "</b>";
    else if (x.t === "italic") s += "<i>" + inlineToHtml(x.c, cite) + "</i>";
    else s += "<sup>" + escapeHtml(cite ? cite(x.n, x.raw) : x.raw) + "</sup>";
  }
  return s;
}

/** Markdown → HTML parçası (Word .doc çıktısı için; kaçışlı, dış etiket yok). */
export function mdToHtml(text: string, cite?: (n: number[], raw: string) => string): string {
  const out: string[] = [];
  for (const b of parseMarkdown(text)) {
    if (b.type === "ul") out.push("<ul>" + b.items.map((it) => "<li>" + inlineToHtml(it, cite) + "</li>").join("") + "</ul>");
    else if (b.type === "ol") out.push("<ol" + (b.start !== 1 ? ` start="${b.start}"` : "") + ">" + b.items.map((it) => "<li>" + inlineToHtml(it, cite) + "</li>").join("") + "</ol>");
    else if (b.type === "blockquote") out.push("<blockquote>" + inlineToHtml(b.inline, cite) + "</blockquote>");
    else if (b.type === "p") out.push("<p>" + inlineToHtml(b.inline, cite).replace(/\n/g, "<br>") + "</p>");
    else out.push("<" + b.type + ">" + inlineToHtml(b.inline, cite) + "</" + b.type + ">");
  }
  return out.join("\n");
}

/** Markdown'ı yeniden, tutarlı markdown olarak yazar (Markdown dışa aktarımı için normalize). */
export function mdNormalize(text: string): string {
  const inl = (x: Inline[]): string => x.map((i) => {
    if (i.t === "text") return i.v;
    if (i.t === "code") return "`" + i.v + "`";
    if (i.t === "bold") return "**" + inl(i.c) + "**";
    if (i.t === "italic") return "*" + inl(i.c) + "*";
    return i.raw;
  }).join("");
  const out: string[] = [];
  for (const b of parseMarkdown(text)) {
    if (b.type === "ul") out.push(b.items.map((it) => "- " + inl(it)).join("\n"));
    else if (b.type === "ol") out.push(b.items.map((it, k) => (b.start + k) + ". " + inl(it)).join("\n"));
    else if (b.type === "blockquote") out.push("> " + inl(b.inline));
    else if (b.type === "p") out.push(inl(b.inline));
    else out.push("#".repeat(parseInt(b.type[1], 10)) + " " + inl(b.inline));
  }
  return out.join("\n\n");
}

/** Metinde markdown işareti var mı? (Hızlı yol: yoksa düz paragraf olarak göster.) */
export function hasMarkdown(text: string): boolean {
  return /(\*\*|__|`|^\s{0,3}(#{1,6}\s|[-*•]\s|\d{1,3}[.)]\s|>\s?)|(^|\s)[*_]\S)/m.test(text || "");
}
