"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "@/styles/reader.css";
import { Annotation, Rect, HIGHLIGHT_COLORS } from "@/lib/reader";
import { StickyNote, MessageSquare } from "lucide-react";

// Worker unpkg'den gelir; service worker (public/sw.js) bu dosyayi onbellege alir,
// ikinci acilista ag gerekmez.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type NewHighlight = { page: number; rects: Rect[]; text: string; color: string; openNote?: boolean };
type NewSticky = { page: number; x: number; y: number };

interface Props {
  fileUrl: string;
  page: number;
  scale: number;
  spread: boolean;
  tool: "none" | "highlight" | "note";
  annotations: Annotation[];
  onNumPages: (n: number) => void;
  onVisiblePage: (n: number) => void;
  onCreateHighlight: (h: NewHighlight) => void;
  onCreateSticky: (s: NewSticky) => void;
  onSelectAnnotation: (a: Annotation) => void;
  /** Secili metni sag paneldeki sohbete soru olarak hazirla */
  onAsk?: (text: string, page: number) => void;
}

const PAGE_MAX = 820;   // genis ekranda sayfa genisligi (px, olcek 1)
const SIDE_PAD = 24;    // dar ekranda sayfa ile kenar arasi toplam bosluk
const WINDOW = 2;       // gorunen sayfanin +-2 komsusu cizilir; digerleri yer tutucu

type Sel = { page: number; rects: Rect[]; text: string; top: number; left: number };

export default function PdfReader(props: Props) {
  const { fileUrl, page, scale, spread, tool, annotations } = props;
  const [numPages, setNumPages] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bubbleDownAt = useRef(0);
  const [sel, setSel] = useState<Sel | null>(null);
  const [cw, setCw] = useState(0);                       // kabin genisligi (ResizeObserver)
  const [visible, setVisible] = useState(1);             // en gorunur sayfa (sanallastirma icin)
  const [ratio, setRatio] = useState(1.294);             // varsayilan sayfa en-boy (A4 ~ 1.414, Letter ~ 1.294)
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const coarse = useRef(false);

  useEffect(() => { coarse.current = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches; }, []);

  // kabin genisligini izle: sayfa ekrana sigsin (fit-width), yatay kaydirma olmasin
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setCw(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onLoad = useCallback((pdf: any) => {
    setNumPages(pdf.numPages);
    props.onNumPages(pdf.numPages);
    // ilk sayfanin oranini al: yer tutucular dogru yukseklikte olsun (kaydirma ziplamasin)
    try {
      pdf.getPage(1).then((pg: any) => {
        const vp = pg.getViewport({ scale: 1 });
        if (vp?.width) setRatio(vp.height / vp.width);
      }).catch(() => {});
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onNumPages]);

  const fitBase = cw > 0 ? Math.min(PAGE_MAX, Math.max(200, cw - SIDE_PAD)) : PAGE_MAX;
  const width = Math.max(120, Math.round((fitBase * scale) / (spread ? 2 : 1) - (spread ? 6 : 0)));

  // disaridan sayfa degisince (dugme, icindekiler, atif) o sayfaya kaydir
  useEffect(() => {
    const c = scrollRef.current;
    const el = c?.querySelector(`[data-page="${page}"]`) as HTMLElement | null;
    if (!el || !c) return;
    const top = el.offsetTop - 16;
    if (Math.abs(c.scrollTop - top) <= 12) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const far = Math.abs(page - visible) > 3;          // uzak atlamada ara sayfalar cizilmesin
    c.scrollTo({ top, behavior: reduce || far ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, width, spread, ratio]);

  // en gorunur sayfayi izle (rAF ile seyreltilmis)
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const pages = Array.from(c.querySelectorAll("[data-page]")) as HTMLElement[];
      let best = 1, bestDist = Infinity;
      const mid = c.scrollTop + c.clientHeight / 2;
      for (const p of pages) {
        const center = p.offsetTop + p.offsetHeight / 2;
        const d = Math.abs(center - mid);
        if (d < bestDist) { bestDist = d; best = Number(p.dataset.page); }
      }
      setVisible(best);
      props.onVisiblePage(best);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    c.addEventListener("scroll", onScroll, { passive: true });
    return () => { c.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, props.onVisiblePage]);

  // metin secimi -> sayfaya gore oransal dikdortgenler (fare, dokunmatik ve klavye)
  const readSelection = useCallback(() => {
    const c = scrollRef.current;
    const s = window.getSelection();
    if (!c || !s || s.isCollapsed || !s.rangeCount) {
      // balona dokunurken secim kapanabilir (mobil): balonu hemen silme
      if (Date.now() - bubbleDownAt.current < 900) return;
      setSel(null); return;
    }
    const range = s.getRangeAt(0);
    if (!c.contains(range.commonAncestorContainer)) { setSel(null); return; }
    const node = range.startContainer.nodeType === 1 ? (range.startContainer as HTMLElement) : range.startContainer.parentElement;
    const pageEl = node?.closest("[data-page]") as HTMLElement | null;
    if (!pageEl) { setSel(null); return; }
    const pageNum = Number(pageEl.dataset.page);
    const pr = pageEl.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 3);
    if (!clientRects.length) { setSel(null); return; }
    const rects: Rect[] = clientRects.map((r) => ({
      x: (r.left - pr.left) / pr.width,
      y: (r.top - pr.top) / pr.height,
      w: r.width / pr.width,
      h: r.height / pr.height,
    })).filter((rc) => rc.y >= -0.05 && rc.y + rc.h <= 1.05);
    if (!rects.length) { setSel(null); return; }
    const cRect = c.getBoundingClientRect();
    const first = clientRects[0];
    const last = clientRects[clientRects.length - 1];
    const BW = props.onAsk ? 340 : 290;                   // balon yaklasik genisligi
    // dokunmatikte sistem menusu secimin ustunde acilir: balonu secimin altina koy
    const top = coarse.current
      ? last.bottom - cRect.top + c.scrollTop + 12
      : first.top - cRect.top + c.scrollTop - 54;
    const rawLeft = first.left - cRect.left + Math.min(first.width, 120) - 40;
    const left = Math.max(8, Math.min(rawLeft, c.clientWidth - BW - 8));
    setSel({ page: pageNum, rects, text: s.toString(), top: Math.max(c.scrollTop + 4, top), left });
  }, [props.onAsk]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => { if (t) clearTimeout(t); t = setTimeout(readSelection, 250); };
    document.addEventListener("selectionchange", onChange);
    return () => { document.removeEventListener("selectionchange", onChange); if (t) clearTimeout(t); };
  }, [readSelection]);

  const clearSel = () => { window.getSelection()?.removeAllRanges(); setSel(null); };
  const commitHighlight = (color: string, openNote = false) => {
    if (!sel) return;
    props.onCreateHighlight({ page: sel.page, rects: sel.rects, text: sel.text, color, openNote });
    clearSel();
  };
  const ask = () => {
    if (!sel || !props.onAsk) return;
    props.onAsk(sel.text, sel.page);
    clearSel();
  };

  const pages = useMemo(() => {
    const list: number[] = [];
    for (let i = 1; i <= numPages; i++) list.push(i);
    return list;
  }, [numPages]);

  // cizilecek sayfalar: gorunen +-2 ve hedef sayfa +-1 (atlama aninda bos gorunmesin)
  const isLive = (n: number) => Math.abs(n - visible) <= WINDOW || Math.abs(n - page) <= 1;

  const onPageClick = (pageNum: number, e: React.MouseEvent) => {
    if (tool !== "note") return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    props.onCreateSticky({ page: pageNum, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };
  const onRatio = useCallback((n: number, r: number) => {
    setRatios((m) => (Math.abs((m[n] || 0) - r) < 0.001 ? m : { ...m, [n]: r }));
  }, []);

  const block = (n: number) => (
    <PageBlock key={n} n={n} width={width} live={isLive(n)} ratio={ratios[n] || ratio} onRatio={onRatio}
               annotations={annotations} onClick={onPageClick} onSelectAnnotation={props.onSelectAnnotation} />
  );

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <div ref={scrollRef} className="reader-surround h-full w-full overflow-auto overscroll-contain"
         onPointerUp={readSelection} onKeyUp={(e) => { if (e.shiftKey) readSelection(); }}
         style={{ cursor: tool === "note" ? "crosshair" : "auto" }}>
      <Document
        file={fileUrl}
        onLoadSuccess={onLoad}
        loading={<Centered>Sayfa hazırlanıyor…</Centered>}
        error={
          <Centered>
            <span className="block max-w-xs text-center">
              {offline ? "İnternet bağlantın yok. Bağlanınca sayfayı yenile."
                       : "PDF açılamadı. Birkaç saniye sonra tekrar dene."}
            </span>
            <button type="button" onClick={() => window.location.reload()}
                    className="mt-3 min-h-[44px] rounded-lg border px-4 text-sm" style={{ color: "var(--r-ink)" }}>
              Tekrar dene
            </button>
          </Centered>
        }
        className="flex flex-col items-center gap-7 px-3 py-4 lg:gap-8 lg:py-8"
      >
        {spread
          ? chunk(pages, 2).map((pair, i) => (
              <div key={i} className="flex gap-3">{pair.map(block)}</div>
            ))
          : pages.map(block)}
      </Document>

      {sel && (
        <div role="toolbar" aria-label="Seçili metin"
             className="absolute z-30 flex items-center gap-0.5 rounded-xl border bg-white/95 px-1 py-0.5 shadow-lg"
             style={{ top: sel.top, left: sel.left, color: "#1F1D1A" }}
             onPointerDown={() => { bubbleDownAt.current = Date.now(); }}
             onMouseDown={(e) => e.preventDefault()}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c.key} type="button" title={`${c.label} ile vurgula`} aria-label={`${c.label} ile vurgula`}
                    onClick={() => commitHighlight(c.value)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-black/5">
              <span className="h-6 w-6 rounded-full border border-black/15" style={{ background: c.value }} />
            </button>
          ))}
          <button type="button" onClick={() => commitHighlight(HIGHLIGHT_COLORS[0].value, true)}
                  className="h-10 rounded-lg px-2 text-sm hover:bg-black/5" aria-label="Vurgula ve not ekle">+ Not</button>
          {props.onAsk && (
            <button type="button" onClick={ask}
                    className="ml-0.5 flex h-10 items-center gap-1 rounded-lg bg-[#6D5DF6]/12 px-2.5 text-sm font-medium text-[#4A3BC4] hover:bg-[#6D5DF6]/20"
                    aria-label="Seçili metni sohbette sor" title="Seçili metni sağdaki sohbete soru olarak hazırlar">
              <MessageSquare size={15} aria-hidden /> Sor
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PageBlock({ n, width, live, ratio, onRatio, annotations, onClick, onSelectAnnotation }: {
  n: number; width: number; live: boolean; ratio: number; onRatio: (n: number, r: number) => void;
  annotations: Annotation[];
  onClick: (n: number, e: React.MouseEvent) => void;
  onSelectAnnotation: (a: Annotation) => void;
}) {
  const h = Math.round(width * ratio);
  if (!live) {
    // cizilmeyen sayfa: ayni boyutta yer tutucu (kaydirma cubugu ve konum korunur)
    return (
      <div className="paper-page reader-page" data-page={n} style={{ width, height: h }} aria-hidden>
        <div className="absolute -bottom-6 left-0 right-0 text-center text-xs" style={{ color: "var(--r-ink-2)" }}>{n}</div>
      </div>
    );
  }
  const anns = annotations.filter((a) => a.page_number === n);
  return (
    <div className="paper-page reader-page" data-page={n} style={{ width, minHeight: h }} onClick={(e) => onClick(n, e)}>
      <Page pageNumber={n} width={width} renderAnnotationLayer={false} renderTextLayer
            onLoadSuccess={(pg: any) => { if (pg?.originalWidth) onRatio(n, pg.originalHeight / pg.originalWidth); }}
            loading={<div style={{ height: h }} />} />
      <div className="hl-layer">
        {anns.map((a) =>
          a.anchor.type === "sticky" ? (
            <button key={a.id} type="button" className="hl-note-dot" aria-label={`Kenar notu, sayfa ${n}${a.note_content ? ": " + a.note_content.slice(0, 60) : ""}`}
                    style={{ left: `${(a.anchor.x ?? 0.95) * 100}%`, top: `${(a.anchor.y ?? 0.04) * 100}%` }}
                    onClick={(e) => { e.stopPropagation(); onSelectAnnotation(a); }}>
              <StickyNote size={13} />
            </button>
          ) : (
            (a.anchor.rects ?? []).map((r, i) => (
              <div key={a.id + i} className="hl-rect"
                   style={{
                     left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                     width: `${r.w * 100}%`, height: `${r.h * 100}%`,
                     background: a.highlight_color ?? "#FFE78A",
                     outline: a.note_content ? "1.5px solid rgba(109,93,246,0.55)" : "none",
                   }}
                   title={a.note_content || a.selected_text || ""}
                   onClick={(e) => { e.stopPropagation(); onSelectAnnotation(a); }} />
            ))
          )
        )}
      </div>
      <div className="absolute -bottom-6 left-0 right-0 text-center text-xs" style={{ color: "var(--r-ink-2)" }}>
        {n}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center p-10 text-sm" style={{ color: "var(--r-ink-2)" }}>{children}</div>;
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
