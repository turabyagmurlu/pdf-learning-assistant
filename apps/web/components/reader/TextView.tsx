"use client";
/**
 * PDF "Metin görünümü" (T-5, 1. asama): pdf.js `getTextContent()` ile sayfa metnini
 * istemcide cikarir, satirlari birlestirip paragraflara boler ve yeniden akisli
 * (telefonda 16-22 px) gosterir. API gerekmez, kota harcamaz.
 *
 *   <TextView fileUrl={fileUrl} page={page} onPageChange={setPage}
 *             onAsk={onAsk} onAddToDraft={addToDraft} theme={theme}
 *             docId={id} onShowOriginal={(pg) => { setMode("page"); setPage(pg); }} />
 *
 * - Sayfa numaralari birebir korunur ("— s. 12 —" ayraclari, data-page); Sor / Taslaga ekle
 *   secimin bulundugu sayfayi verir; alt cubuktaki sayfa sayaci calismaya devam eder.
 * - Gorunen sayfa +-3 tembel yuklenir; cikarilan metin bellek onbelleginde tutulur
 *   (ayni dosya adresi icin en fazla 3 belge).
 * - Yazi boyutu A- / A+ (15-22 px; localStorage "reader.textSize"), acik / sepya / koyu tema.
 * - Taranmis (metinsiz) PDF: `docId` verilmisse GET /documents/{id}/content (OCR metni,
 *   2. asama: tasks.py .pages.json) denenir; yoksa sayfa gorunumune yonlendirir.
 * - Sinir: tablo, formul ve iki sutunlu duzen bozulabilir; her sayfada "Aslını gör" var.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pdfjs } from "react-pdf";
import { MessageSquare, PenLine, Copy, Minus, Plus, FileText } from "lucide-react";
import { api } from "@/lib/api";

// Worker: PdfReader ile ayni adres (biri once yuklenmisse dokunma).
if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

export type TextViewTheme = "light" | "sepia" | "dark";
export interface TextViewProps {
  fileUrl: string;
  page: number;
  onPageChange: (n: number) => void;
  onAsk?: (text: string, page: number) => void;
  onAddToDraft?: (text: string, page: number) => void;
  theme: TextViewTheme;
  /** Taranmis PDF icin OCR metni (GET /documents/{id}/content) */
  docId?: string;
  /** "Aslını gör": sayfa gorunumune gec */
  onShowOriginal?: (page: number) => void;
  /** Toplam sayfa sayisi ogrenilince */
  onNumPages?: (n: number) => void;
}

type Para = { kind: "p" | "h" | "li"; text: string };
type PageState = Para[] | "loading" | "empty";

const SIZE_KEY = "reader.textSize";
const SIZE_MIN = 15, SIZE_MAX = 22, SIZE_DEF = 17;
const NEAR = 3;                       // gorunen sayfanin +-3 komsusu yuklenir
const CACHE_MAX = 3;

const THEME = {
  light: { bg: "#FFFDF8", ink: "#1F1D1A", ink2: "#6F6A61", rule: "rgba(31,29,26,0.12)", bar: "rgba(255,253,248,0.92)" },
  sepia: { bg: "#FBF3E3", ink: "#3B3320", ink2: "#6B5F45", rule: "rgba(59,51,32,0.14)", bar: "rgba(251,243,227,0.92)" },
  dark: { bg: "#14161C", ink: "#E9E7E2", ink2: "#A6A29A", rule: "rgba(255,255,255,0.12)", bar: "rgba(20,22,28,0.92)" },
} as const;

/* ---------------- metin cikarma ---------------- */

type TItem = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };
type Line = { text: string; y: number; h: number; x0: number; x1: number };

const ENDS_SENTENCE = /[.!?:;"”»)\]]$/;
const BULLET = /^([•·▪◦‣\-–—*]|\(?\d{1,3}[.)]|[a-zA-Z][.)]|[ivxIVX]{1,5}[.)])\s+/;
const ONLY_NUMBER = /^[\d\s.|–-]{1,6}$/;

function itemsToLines(items: TItem[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let lastX = 0;
  for (const it of items) {
    const str = it.str ?? "";
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const h = Math.abs(tr[3]) || it.height || 10;
    const x = tr[4], y = tr[5];
    if (!str.trim()) {
      if (it.hasEOL && cur) { lines.push(cur); cur = null; }
      else if (str && cur) { cur.text += " "; }
      continue;
    }
    if (cur && Math.abs(cur.y - y) <= Math.max(2, cur.h * 0.45)) {
      const gap = x - lastX;
      if (gap > cur.h * 0.22 && !cur.text.endsWith(" ") && !str.startsWith(" ")) cur.text += " ";
      else if (gap < -cur.h * 2) { lines.push(cur); cur = null; }     // ayni yukseklikte cok geriye atlama: yeni sutun/satir
      if (cur) { cur.text += str; cur.x1 = Math.max(cur.x1, x + (it.width || 0)); cur.h = Math.max(cur.h, h); }
    }
    if (!cur) cur = { text: str, y, h, x0: x, x1: x + (it.width || 0) };
    lastX = x + (it.width || 0);
    if (it.hasEOL) { lines.push(cur); cur = null; }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text);
}

function median(a: number[]) {
  if (!a.length) return 10;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

export function linesToParagraphs(lines: Line[]): Para[] {
  if (!lines.length) return [];
  const medH = median(lines.map((l) => l.h));
  const minX = Math.min(...lines.map((l) => l.x0));
  const maxW = Math.max(...lines.map((l) => l.x1 - l.x0));
  const out: Para[] = [];
  let buf: Line[] = [];
  const flush = () => {
    if (!buf.length) return;
    let text = "";
    for (const l of buf) {
      if (!text) { text = l.text; continue; }
      if (/[A-Za-zÇĞİÖŞÜçğıöşü]-$/.test(text) && /^[a-zçğıöşü]/.test(l.text)) text = text.slice(0, -1) + l.text;   // tireli satir sonu
      else text += " " + l.text;
    }
    const big = buf.every((l) => l.h > medH * 1.18);
    // buyuk punto -> baslik ("1. Giriş" gibi numarali basliklar numarasini korur); degilse madde / paragraf
    const kind: Para["kind"] = big && buf.length <= 3 && text.length < 160 ? "h" : BULLET.test(buf[0].text) ? "li" : "p";
    out.push({ kind, text: kind === "li" ? text.replace(BULLET, "") : text });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (ONLY_NUMBER.test(l.text) && (i === 0 || i === lines.length - 1)) continue;   // sayfa numarasi
    const prev = buf[buf.length - 1];
    if (prev) {
      const gap = prev.y - l.y;
      const sizeJump = Math.abs(l.h - prev.h) > Math.max(1.2, medH * 0.2);
      const shortPrev = (prev.x1 - prev.x0) < maxW * 0.6 && ENDS_SENTENCE.test(prev.text);
      const indented = l.x0 - minX > medH * 1.2 && prev.x0 - minX < medH * 0.6 && ENDS_SENTENCE.test(prev.text);
      const bullet = BULLET.test(l.text);
      const bigGap = gap > medH * 1.75 || gap < -medH * 0.5;     // bos satir ya da sutun sicramasi
      if (bigGap || sizeJump || shortPrev || indented || bullet) flush();
    }
    buf.push(l);
  }
  flush();
  return out;
}

/** OCR ya da duz metin: bos satirlara gore paragraf */
function plainToParagraphs(text: string): Para[] {
  return (text || "").split(/\n\s*\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)
    .map((t) => ({ kind: BULLET.test(t) ? "li" : "p", text: t.replace(BULLET, "") }));
}

/* ---------------- bellek onbellegi ---------------- */

type Entry = { doc: Promise<any>; pages: Map<number, Para[]>; numPages: number };
const CACHE = new Map<string, Entry>();
function entryFor(url: string): Entry {
  const hit = CACHE.get(url);
  if (hit) { CACHE.delete(url); CACHE.set(url, hit); return hit; }     // LRU: sona al
  const doc = pdfjs.getDocument({ url, withCredentials: false }).promise;
  const e: Entry = { doc, pages: new Map(), numPages: 0 };
  doc.then((d: any) => { e.numPages = d.numPages; }).catch(() => {});
  CACHE.set(url, e);
  while (CACHE.size > CACHE_MAX) {
    const k = CACHE.keys().next().value as string;
    const old = CACHE.get(k);
    CACHE.delete(k);
    old?.doc.then((d: any) => d?.destroy?.()).catch(() => {});
  }
  return e;
}
async function extractPage(e: Entry, n: number): Promise<Para[]> {
  const cached = e.pages.get(n);
  if (cached) return cached;
  const d = await e.doc;
  const pg = await d.getPage(n);
  const tc = await pg.getTextContent();
  const items = (tc.items as unknown as TItem[]).filter((it) => it && typeof it.str === "string");
  const paras = linesToParagraphs(itemsToLines(items));
  e.pages.set(n, paras);
  return paras;
}

/* ---------------- bilesen ---------------- */

type Sel = { page: number; text: string; top: number; left: number };

export default function TextView({ fileUrl, page, onPageChange, onAsk, onAddToDraft, theme, docId, onShowOriginal, onNumPages }: TextViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [err, setErr] = useState("");
  const [states, setStates] = useState<Record<number, PageState>>({});
  const [size, setSize] = useState(SIZE_DEF);
  const [scanned, setScanned] = useState<"unknown" | "ocr" | "none">("unknown");
  const [sel, setSel] = useState<Sel | null>(null);
  const [visible, setVisible] = useState(page);
  const reported = useRef(page);
  const bubbleDownAt = useRef(0);
  const coarse = useRef(false);
  const entry = useMemo(() => (fileUrl ? entryFor(fileUrl) : null), [fileUrl]);
  const c = THEME[theme] || THEME.light;

  useEffect(() => { coarse.current = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches; }, []);
  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(SIZE_KEY) || "", 10); if (v >= SIZE_MIN && v <= SIZE_MAX) setSize(v); } catch { /* yok say */ }
  }, []);
  const changeSize = (d: number) => setSize((s) => {
    const n = Math.min(SIZE_MAX, Math.max(SIZE_MIN, s + d));
    try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* yok say */ }
    return n;
  });

  // belge acilisi
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    setErr(""); setStates({}); setScanned("unknown");
    entry.doc.then((d: any) => {
      if (!alive) return;
      setNumPages(d.numPages);
      onNumPages?.(d.numPages);
    }).catch(() => {
      if (!alive) return;
      setErr(typeof navigator !== "undefined" && navigator.onLine === false
        ? "İnternet bağlantın yok. Bağlanınca sayfayı yenile."
        : "PDF açılamadı. Birkaç saniye sonra tekrar dene.");
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  // bir sayfanin metnini yukle (tembel; ayni sayfa iki kez istenmez)
  const requested = useRef<Set<number>>(new Set());
  const ocrDone = useRef(false);
  useEffect(() => { requested.current = new Set(); ocrDone.current = false; }, [entry]);
  const loadPage = useCallback((n: number) => {
    if (!entry || ocrDone.current || n < 1 || (numPages && n > numPages) || requested.current.has(n)) return;
    requested.current.add(n);
    setStates((s) => (s[n] ? s : { ...s, [n]: "loading" }));
    extractPage(entry, n)
      .then((paras) => { if (!ocrDone.current) setStates((s) => ({ ...s, [n]: paras.length ? paras : "empty" })); })
      .catch(() => { if (!ocrDone.current) setStates((s) => ({ ...s, [n]: "empty" })); });
  }, [entry, numPages]);

  // gorunen sayfa +-3 yukle
  useEffect(() => {
    if (!numPages) return;
    for (let n = Math.max(1, visible - NEAR); n <= Math.min(numPages, visible + NEAR); n++) loadPage(n);
  }, [visible, numPages, loadPage]);

  // taranmis PDF tespiti: ilk 3 sayfa bos ise OCR metnini dene
  useEffect(() => {
    if (!numPages || scanned !== "unknown") return;
    const probe = [1, 2, 3].filter((n) => n <= numPages);
    if (!probe.every((n) => states[n] && states[n] !== "loading")) return;
    if (probe.some((n) => states[n] !== "empty")) return;      // metin var
    let alive = true;
    (async () => {
      if (docId) {
        try {
          const r = await api(`/documents/${docId}/content`);
          const pages = Array.isArray(r?.pages) ? r.pages : [];
          if (alive && r?.ready && pages.length) {
            const next: Record<number, PageState> = {};
            for (const p of pages) {
              const n = Number(p.page ?? p.page_number);
              const paras = plainToParagraphs(String(p.text || ""));
              if (n >= 1) next[n] = paras.length ? paras : "empty";
            }
            ocrDone.current = true;
            setStates(next); setScanned("ocr");
            return;
          }
        } catch { /* asagida "metin yok" mesaji */ }
      }
      if (alive) setScanned("none");
    })();
    return () => { alive = false; };
  }, [numPages, states, scanned, docId]);

  // en ustteki sayfayi izle -> onPageChange
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const secs = Array.from(root.querySelectorAll<HTMLElement>("[data-page]"));
      const line = root.scrollTop + Math.min(120, root.clientHeight * 0.25);
      let best = 1;
      for (const s of secs) { if (s.offsetTop <= line) best = Number(s.dataset.page); else break; }
      setVisible(best);
      if (best !== reported.current) { reported.current = best; onPageChange(best); }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => { root.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [numPages, onPageChange]);

  // disaridan sayfa degisince oraya kaydir
  useEffect(() => {
    if (!numPages || page === reported.current) return;
    reported.current = page;
    setVisible(page);
    loadPage(page);
    const root = rootRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (root && el) root.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: "auto" });
  }, [page, numPages, loadPage]);

  // ilk acilista kayitli sayfaya git
  const initialDone = useRef(false);
  useEffect(() => {
    if (!numPages || initialDone.current) return;
    initialDone.current = true;
    const root = rootRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (root && el && page > 1) root.scrollTo({ top: Math.max(0, el.offsetTop - 8) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages]);

  // metin secimi -> balon
  const readSelection = useCallback(() => {
    const root = rootRef.current;
    const s = window.getSelection();
    if (!root || !s || s.isCollapsed || !s.rangeCount) {
      if (Date.now() - bubbleDownAt.current < 900) return;
      setSel(null); return;
    }
    const range = s.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) { setSel(null); return; }
    const node = range.startContainer.nodeType === 1 ? (range.startContainer as HTMLElement) : range.startContainer.parentElement;
    const sec = node?.closest("[data-page]") as HTMLElement | null;
    const text = s.toString().replace(/\s+/g, " ").trim();
    if (!sec || !text) { setSel(null); return; }
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 3);
    if (!rects.length) { setSel(null); return; }
    const rr = root.getBoundingClientRect();
    const first = rects[0], last = rects[rects.length - 1];
    const BW = Math.min(root.clientWidth - 16, 120 + (onAsk ? 70 : 0) + (onAddToDraft ? 140 : 0));
    const top = coarse.current ? last.bottom - rr.top + root.scrollTop + 12 : first.top - rr.top + root.scrollTop - 52;
    const left = Math.max(8, Math.min(first.left - rr.left, root.clientWidth - BW - 8));
    setSel({ page: Number(sec.dataset.page), text, top: Math.max(root.scrollTop + 4, top), left });
  }, [onAsk, onAddToDraft]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => { if (t) clearTimeout(t); t = setTimeout(readSelection, 250); };
    document.addEventListener("selectionchange", onChange);
    return () => { document.removeEventListener("selectionchange", onChange); if (t) clearTimeout(t); };
  }, [readSelection]);
  const clearSel = () => { window.getSelection()?.removeAllRanges(); setSel(null); };

  const pages = useMemo(() => Array.from({ length: numPages }, (_, i) => i + 1), [numPages]);
  const lineH = 1.62;

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-auto overscroll-contain"
         style={{ background: c.bg, color: c.ink }}
         onPointerUp={readSelection} onKeyUp={(e) => { if (e.shiftKey) readSelection(); }}
         aria-label="Metin görünümü">
      {/* ust cubuk: yazi boyutu */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b px-3 py-1 text-xs backdrop-blur"
           style={{ background: c.bar, borderColor: c.rule, color: c.ink2 }} role="toolbar" aria-label="Metin görünümü ayarları">
        <span className="truncate">
          Metin görünümü{numPages ? ` · s.${visible} / ${numPages}` : ""}
          {scanned === "ocr" ? " · taranmış sayfa metni" : ""}
        </span>
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Yazı boyutu">
          <button type="button" onClick={() => changeSize(-1)} disabled={size <= SIZE_MIN} aria-label="Yazıyı küçült"
                  className="flex h-10 w-10 items-center justify-center rounded-lg disabled:opacity-40" style={{ color: c.ink }}>
            <Minus size={16} aria-hidden /><span className="sr-only">A</span>
          </button>
          <span className="w-8 text-center tabular-nums" aria-live="polite" style={{ color: c.ink }}>{size}</span>
          <button type="button" onClick={() => changeSize(1)} disabled={size >= SIZE_MAX} aria-label="Yazıyı büyüt"
                  className="flex h-10 w-10 items-center justify-center rounded-lg disabled:opacity-40" style={{ color: c.ink }}>
            <Plus size={16} aria-hidden />
          </button>
        </div>
      </div>

      {err ? (
        <div className="flex flex-col items-center p-10 text-center text-sm" style={{ color: c.ink2 }}>
          <span className="max-w-xs">{err}</span>
          <button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-[44px] rounded-lg border px-4 text-sm" style={{ color: c.ink, borderColor: c.rule }}>Tekrar dene</button>
        </div>
      ) : !numPages ? (
        <div className="p-10 text-center text-sm" style={{ color: c.ink2 }} role="status">Metin hazırlanıyor…</div>
      ) : scanned === "none" ? (
        <div className="mx-auto max-w-md p-8 text-center text-sm" style={{ color: c.ink2 }} role="status">
          <p>Bu PDF taranmış görünüyor; seçilebilir metin yok. Sayfa görünümünde yakınlaştırarak oku.</p>
          {onShowOriginal && (
            <button type="button" onClick={() => onShowOriginal(page)} className="mt-3 min-h-[44px] rounded-lg border px-4 text-sm" style={{ color: c.ink, borderColor: c.rule }}>
              Sayfa görünümüne geç
            </button>
          )}
        </div>
      ) : (
        <div className="mx-auto w-full max-w-[70ch] px-4 pb-16 pt-2 sm:px-6"
             style={{ fontSize: size, lineHeight: lineH, paddingBottom: "calc(4rem + env(safe-area-inset-bottom))" }}>
          {pages.map((n) => {
            const st = states[n];
            return (
              <section key={n} data-page={n} aria-label={`Sayfa ${n}`} style={{ minHeight: Array.isArray(st) || st === "empty" ? undefined : "30vh" }}>
                <div className="my-5 flex items-center gap-3 text-xs" style={{ color: c.ink2 }}>
                  <span className="h-px flex-1" style={{ background: c.rule }} aria-hidden />
                  <span>— s. {n} —</span>
                  {onShowOriginal && (
                    <button type="button" onClick={() => onShowOriginal(n)} className="flex min-h-[32px] items-center gap-1 rounded-md px-1.5 hover:underline"
                            aria-label={`Sayfa ${n}: aslını sayfa görünümünde gör`}>
                      <FileText size={12} aria-hidden /> Aslını gör
                    </button>
                  )}
                  <span className="h-px flex-1" style={{ background: c.rule }} aria-hidden />
                </div>
                {st === "loading" || !st ? (
                  <p className="text-sm" style={{ color: c.ink2 }} aria-busy="true">Metin çıkarılıyor…</p>
                ) : st === "empty" ? (
                  <p className="text-sm italic" style={{ color: c.ink2 }}>Bu sayfada seçilebilir metin yok (görsel, tablo ya da taranmış sayfa olabilir).</p>
                ) : (
                  st.map((p, i) =>
                    p.kind === "h" ? (
                      <h3 key={i} className="mb-2 mt-5 font-heading font-semibold leading-snug" style={{ fontSize: Math.round(size * 1.2) }}>{p.text}</h3>
                    ) : p.kind === "li" ? (
                      <p key={i} className="mb-1.5 flex gap-2 pl-2"><span aria-hidden>•</span><span>{p.text}</span></p>
                    ) : (
                      <p key={i} className="mb-3.5">{p.text}</p>
                    ),
                  )
                )}
              </section>
            );
          })}
        </div>
      )}

      {sel && (
        <div role="toolbar" aria-label="Seçili metin"
             className="absolute z-30 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-0.5 rounded-xl border bg-white/95 px-1 py-0.5 shadow-lg"
             style={{ top: sel.top, left: sel.left, color: "#1F1D1A" }}
             onPointerDown={() => { bubbleDownAt.current = Date.now(); }}
             onMouseDown={(e) => e.preventDefault()}>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(sel.text).catch(() => {}); clearSel(); }}
                  className="flex h-10 items-center gap-1 rounded-lg px-2.5 text-sm hover:bg-black/5" aria-label="Seçili metni kopyala">
            <Copy size={15} aria-hidden /> Kopyala
          </button>
          {onAsk && (
            <button type="button" onClick={() => { onAsk(sel.text, sel.page); clearSel(); }}
                    className="flex h-10 items-center gap-1 rounded-lg bg-[#6D5DF6]/12 px-2.5 text-sm font-medium text-[#4A3BC4] hover:bg-[#6D5DF6]/20"
                    aria-label="Seçili metni sohbette sor">
              <MessageSquare size={15} aria-hidden /> Sor
            </button>
          )}
          {onAddToDraft && (
            <button type="button" onClick={() => { onAddToDraft(sel.text, sel.page); clearSel(); }}
                    className="flex h-10 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium hover:bg-black/5"
                    aria-label="Taslağa ekle">
              <PenLine size={15} aria-hidden /> Taslağa ekle
            </button>
          )}
        </div>
      )}
    </div>
  );
}
