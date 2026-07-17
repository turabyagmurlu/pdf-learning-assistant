"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "@/styles/reader.css";
import { Annotation, Rect, HIGHLIGHT_COLORS } from "@/lib/reader";
import { StickyNote } from "lucide-react";

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
}

const PAGE_MAX = 820; // px baseline page width before scale

export default function PdfReader(props: Props) {
  const { fileUrl, page, scale, spread, tool, annotations } = props;
  const [numPages, setNumPages] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ page: number; rects: Rect[]; text: string; top: number; left: number } | null>(null);

  const onLoad = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    props.onNumPages(pdf.numPages);
  }, [props]);

  // scroll active page into view when `page` changes externally
  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-page="${page}"]`) as HTMLElement | null;
    if (el && scrollRef.current) {
      const c = scrollRef.current;
      const top = el.offsetTop - 24;
      if (Math.abs(c.scrollTop - top) > 12) c.scrollTo({ top, behavior: "smooth" });
    }
  }, [page, scale, spread]);

  // track which page is most visible
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const onScroll = () => {
      const pages = Array.from(c.querySelectorAll("[data-page]")) as HTMLElement[];
      let best = 1, bestDist = Infinity;
      const mid = c.scrollTop + c.clientHeight / 2;
      for (const p of pages) {
        const center = p.offsetTop + p.offsetHeight / 2;
        const d = Math.abs(center - mid);
        if (d < bestDist) { bestDist = d; best = Number(p.dataset.page); }
      }
      props.onVisiblePage(best);
    };
    c.addEventListener("scroll", onScroll, { passive: true });
    return () => c.removeEventListener("scroll", onScroll);
  }, [numPages, props]);

  // text selection → relative rects
  const handleMouseUp = useCallback(() => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) { setSel(null); return; }
    const range = s.getRangeAt(0);
    const node = range.startContainer.parentElement;
    const pageEl = node?.closest("[data-page]") as HTMLElement | null;
    if (!pageEl || !scrollRef.current) { setSel(null); return; }
    const pageNum = Number(pageEl.dataset.page);
    const pr = pageEl.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 3);
    if (!clientRects.length) { setSel(null); return; }
    const rects: Rect[] = clientRects.map((r) => ({
      x: (r.left - pr.left) / pr.width,
      y: (r.top - pr.top) / pr.height,
      w: r.width / pr.width,
      h: r.height / pr.height,
    }));
    const cRect = scrollRef.current.getBoundingClientRect();
    const first = clientRects[0];
    setSel({
      page: pageNum, rects, text: s.toString(),
      top: first.top - cRect.top + scrollRef.current.scrollTop - 46,
      left: first.left - cRect.left + Math.min(first.width, 120),
    });
  }, []);

  const commitHighlight = (color: string, openNote = false) => {
    if (!sel) return;
    props.onCreateHighlight({ page: sel.page, rects: sel.rects, text: sel.text, color, openNote });
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  const pages = useMemo(() => {
    const list: number[] = [];
    for (let i = 1; i <= numPages; i++) list.push(i);
    return list;
  }, [numPages]);

  const width = Math.round(PAGE_MAX * scale) / (spread ? 2 : 1);

  const onPageClick = (pageNum: number, e: React.MouseEvent) => {
    if (tool !== "note") return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    props.onCreateSticky({ page: pageNum, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <div ref={scrollRef} className="reader-surround h-full w-full overflow-auto"
         onMouseUp={handleMouseUp}
         style={{ cursor: tool === "note" ? "crosshair" : "auto" }}>
      <Document
        file={fileUrl}
        onLoadSuccess={onLoad}
        loading={<Centered>Sayfa hazırlanıyor…</Centered>}
        error={<Centered>PDF yüklenemedi. Sunucu uyanıyor olabilir; birkaç saniye sonra yenile.</Centered>}
        className="flex flex-col items-center gap-8 py-8"
      >
        {spread
          ? chunk(pages, 2).map((pair, i) => (
              <div key={i} className="flex gap-3">
                {pair.map((n) => (
                  <PageBlock key={n} n={n} width={width} annotations={annotations}
                             onClick={onPageClick} onSelectAnnotation={props.onSelectAnnotation} />
                ))}
              </div>
            ))
          : pages.map((n) => (
              <PageBlock key={n} n={n} width={width} annotations={annotations}
                         onClick={onPageClick} onSelectAnnotation={props.onSelectAnnotation} />
            ))}
      </Document>

      {sel && (
        <div className="absolute z-30 flex items-center gap-1 rounded-xl border bg-white/95 px-2 py-1 shadow-lg"
             style={{ top: sel.top, left: sel.left }} onMouseDown={(e) => e.preventDefault()}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c.key} title={c.label} aria-label={`${c.label} highlight`}
                    onClick={() => commitHighlight(c.value)}
                    className="h-5 w-5 rounded-full border border-black/10"
                    style={{ background: c.value }} />
          ))}
          <button onClick={() => commitHighlight(HIGHLIGHT_COLORS[0].value, true)}
                  className="ml-1 rounded-md px-2 py-0.5 text-xs text-[#1F1D1A] hover:bg-black/5"
                  aria-label="Not ekle">+ Not</button>
        </div>
      )}
    </div>
  );
}

function PageBlock({ n, width, annotations, onClick, onSelectAnnotation }: {
  n: number; width: number; annotations: Annotation[];
  onClick: (n: number, e: React.MouseEvent) => void;
  onSelectAnnotation: (a: Annotation) => void;
}) {
  const anns = annotations.filter((a) => a.page_number === n);
  return (
    <div className="paper-page reader-page" data-page={n} style={{ width }} onClick={(e) => onClick(n, e)}>
      <Page pageNumber={n} width={width} renderAnnotationLayer={false} renderTextLayer
            loading={<div style={{ height: width * 1.3 }} />} />
      <div className="hl-layer">
        {anns.map((a) =>
          a.anchor.type === "sticky" ? (
            <button key={a.id} className="hl-note-dot" aria-label="Not"
                    style={{ left: `${(a.anchor.x ?? 0.95) * 100}%`, top: `${(a.anchor.y ?? 0.04) * 100}%` }}
                    onClick={(e) => { e.stopPropagation(); onSelectAnnotation(a); }}>
              <StickyNote size={11} />
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
  return <div className="flex h-full items-center justify-center p-10 text-sm" style={{ color: "var(--r-ink-2)" }}>{children}</div>;
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
