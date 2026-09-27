"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "@/styles/reader.css";
import { Annotation, Rect, HIGHLIGHT_COLORS, PenTool, HighlightStyle, PaperTone, highlightStyle, darken, annotationMarks, pigmentOf, pigmentName } from "@/lib/reader";
import HighlightMap from "@/components/reader/HighlightMap";
import {
  type InkPoint, type InkStroke, type Span, type Pt, packStroke, strokePath, rectsFromStroke, strokeBoxRect, pathLength,
} from "@/lib/ink";
import { StickyNote, MessageSquare, PenLine, Underline } from "lucide-react";

// Worker paketten sunulur (TK-6): scripts/copy-worker.mjs pdfjs-dist worker'ini public/'e kopyalar
// (package.json postinstall). Service worker (public/sw.js) onbellege alir; ikinci acilista ag gerekmez.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type NewHighlight = {
  page: number; rects: Rect[]; text: string; color: string;
  style: HighlightStyle; opacity: number; openNote?: boolean;
};
type NewSticky = { page: number; x: number; y: number };
/** Kalem paletinin o anki secimi (renk + kademe); H-5: arac acikken balon acilmadan bununla vurgulanir. */
export type PenState = { color: string; opacity: number };
/** Kaydedilmeyi bekleyen el yazisi (1,2 sn yeni darbe gelmezse tek not olarak kaydedilir). */
export type InkDraft = { key: string; page: number; strokes: InkStroke[] };

const SVGNS = "http://www.w3.org/2000/svg";
const MIN_MARK_PX = 8;      // bundan kisa fosforlu darbe yok sayilir (dokunus = mevcut vurguyu ac)

/** Sayfanin metin katmanindaki yaprak span'ler; koordinatlar sayfa GENISLIGINE gore oran. */
function pageSpans(pageEl: HTMLElement, pr: DOMRect): Span[] {
  const out: Span[] = [];
  const els = pageEl.querySelectorAll(".react-pdf__Page__textContent span");
  els.forEach((el) => {
    if (el.querySelector("span")) return;
    const t = el.textContent || "";
    if (!t.trim()) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    out.push({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.width, w: r.width / pr.width, h: r.height / pr.width, text: t });
  });
  return out;
}
function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

interface Props {
  fileUrl: string;
  page: number;
  scale: number;
  spread: boolean;
  /** Kalem paleti araci: none | ink | highlight | underline | note | eraser */
  tool: PenTool;
  /** Paletteki secili renk ve kademe */
  pen: PenState;
  /** El yazisi rengi ve kalinligi (binde sayfa genisligi) */
  ink?: { color: string; width: number };
  /** Kaydedilmeyi bekleyen el yazisi darbeleri (sayfada gorunur) */
  inkDrafts?: InkDraft[];
  /** Kalem araci: bir darbe bitti (sayfa, darbe, sayfa yukseklik/genislik orani) */
  onInkStroke?: (page: number, stroke: InkStroke, ratio: number) => void;
  /** Kalem araci: yeni darbe basladi (kaydetme zamanlayicisi beklesin) */
  onInkStart?: () => void;
  /** Kalem araci: son darbeyi geri al (cift dokunusta yanlislikla konan nokta icin) */
  onInkUndo?: () => void;
  /** Arac kapaliyken kalem sayfaya degdi (ilk kez: palet + ipucu) */
  onPenIdle?: () => void;
  annotations: Annotation[];
  onNumPages: (n: number) => void;
  onVisiblePage: (n: number) => void;
  onCreateHighlight: (h: NewHighlight) => void;
  onCreateSticky: (s: NewSticky) => void;
  onSelectAnnotation: (a: Annotation) => void;
  /** Silgi: bir vurguya dokununca (geri al ile) */
  onErase: (a: Annotation) => void;
  /** Apple Pencil: hizli iki dokunus -> son iki arac arasinda gecis */
  onPenDoubleTap?: () => void;
  /** Secili metni sag paneldeki sohbete soru olarak hazirla */
  onAsk?: (text: string, page: number) => void;
  /** Secili metni kaynak + sayfa atifli alinti karti olarak defterin taslagina ekle (ucretsiz) */
  onAddToDraft?: (text: string, page: number) => void;
  /** Okuma kagidi tonu (yalniz sayfa yuzeyi): white | cream | night. Verilmezse okuyucu temasi. */
  paper?: PaperTone;
  /** Yeni biriken vurgu (2.0): bu kimlikli vurgu .ink-bloom ile belirir */
  bloomId?: string | null;
}

const PAGE_MAX = 820;   // genis ekranda sayfa genisligi (px, olcek 1)
const SIDE_PAD = 24;    // dar ekranda sayfa ile kenar arasi toplam bosluk
const WINDOW = 2;       // gorunen sayfanin +-2 komsusu cizilir; digerleri yer tutucu

type Sel = { page: number; rects: Rect[]; text: string; top: number; left: number };

export default function PdfReader(props: Props) {
  const { fileUrl, page, scale, spread, tool, annotations, pen: penState, paper, bloomId } = props;
  const penHex = pigmentOf(penState.color);
  // vurgu haritasi isaretleri (sayfa + sayfa ici y + renk + ipucu)
  const marks = useMemo(() => annotationMarks(annotations), [annotations]);
  // secimle dogrudan vurgulayan araclar (H-5 otomatik vurgu bunlarda calisir)
  const selTool = tool === "highlight" || tool === "underline";
  // kalem / fare ile cizen araclar (parmak kaydirir: avuc ici reddi)
  const drawTool = selTool || tool === "ink";
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

  // H-4: yakinlastirinca okunan yer korunur — kaydirma, ekran ortasi sabit kalacak sekilde oransal ayarlanir
  // (sayfa basina atlamaz). Genislik degisimi sayfa yuksekligini de ayni oranda degistirir.
  const prevWidth = useRef(width);
  useLayoutEffect(() => {
    const c = scrollRef.current;
    const old = prevWidth.current;
    prevWidth.current = width;
    if (!c || !old || old === width) return;
    const k = width / old;
    const cy = c.scrollTop + c.clientHeight / 2;
    const cx = c.scrollLeft + c.clientWidth / 2;
    c.scrollTop = Math.max(0, cy * k - c.clientHeight / 2);
    c.scrollLeft = Math.max(0, cx * k - c.clientWidth / 2);
  }, [width]);

  // disaridan sayfa degisince (dugme, icindekiler, atif) o sayfaya kaydir.
  // Kaydirmadan gelen sayfa degisimi (onVisiblePage → page) yeniden kaydirmaz.
  const visibleRef = useRef(1);
  useEffect(() => {
    const c = scrollRef.current;
    const el = c?.querySelector(`[data-page="${page}"]`) as HTMLElement | null;
    if (!el || !c) return;
    if (page === visibleRef.current && numPages > 0) return;
    const top = el.offsetTop - 16;
    if (Math.abs(c.scrollTop - top) <= 12) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const far = Math.abs(page - visible) > 3;          // uzak atlamada ara sayfalar cizilmesin
    c.scrollTo({ top, behavior: reduce || far ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, spread, ratio, numPages]);

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
      visibleRef.current = best;
      setVisible(best);
      props.onVisiblePage(best);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    c.addEventListener("scroll", onScroll, { passive: true });
    return () => { c.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, props.onVisiblePage]);

  // metin secimi -> sayfaya gore oransal dikdortgenler (fare, dokunmatik ve klavye).
  // autoCommit (H-5): vurgu araci acikken secim birakildigi anda balon acilmadan son renkle vurgula.
  const readSelection = useCallback((autoCommit = false) => {
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
    if (autoCommit && selTool) {
      props.onCreateHighlight({ page: pageNum, rects, text: s.toString(), color: penState.color,
                                style: tool === "underline" ? "underline" : "highlight", opacity: penState.opacity });
      s.removeAllRanges(); setSel(null);
      return;
    }
    const cRect = c.getBoundingClientRect();
    const first = clientRects[0];
    const last = clientRects[clientRects.length - 1];
    const BW = Math.min(c.clientWidth - 16, 290 + (props.onAsk ? 60 : 0) + (props.onAddToDraft ? 130 : 0));   // balon yaklasik genisligi
    // dokunmatikte sistem menusu secimin ustunde acilir: balonu secimin altina koy
    const top = coarse.current
      ? last.bottom - cRect.top + c.scrollTop + 12
      : first.top - cRect.top + c.scrollTop - 54;
    const rawLeft = first.left - cRect.left + Math.min(first.width, 120) - 40;
    const left = Math.max(8, Math.min(rawLeft, c.clientWidth - BW - 8));
    setSel({ page: pageNum, rects, text: s.toString(), top: Math.max(c.scrollTop + 4, top), left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onAsk, props.onAddToDraft, props.onCreateHighlight, tool, selTool, penState.color, penState.opacity]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    // Arac acikken secim degisimi balon acmaz (birakinca dogrudan vurgulanir)
    const onChange = () => { if (selTool) return; if (t) clearTimeout(t); t = setTimeout(() => readSelection(false), 250); };
    document.addEventListener("selectionchange", onChange);
    return () => { document.removeEventListener("selectionchange", onChange); if (t) clearTimeout(t); };
  }, [readSelection, selTool]);

  // Kalem / fare ile cizim (Ajan K). Vurgu / Altini ciz / Kalem araci acikken KALEM (pointerType "pen") ve FARE
  // surukleyince yerel metin secimi KULLANILMAZ (iOS'ta secim tasip butun sayfayi boyuyordu):
  //  - pointerdown'da preventDefault, kapta user-select:none + touch-action:none (yalniz cizerken; .pen-drawing),
  //    kalem dokunuslarinda (touchType "stylus") touchstart/touchmove da engellenir.
  //  - Vurgu: gecilen noktalar toplanir; birakinca metin katmanindaki span'lerden satir satir kirpilir (lib/ink
  //    rectsFromStroke). Taranmis sayfada (span yok) darbenin kendi kutusu. Cizerken yari saydam serit onizlemesi.
  //  - Kalem: basinca gore kalinlasan puruzsuz darbe (lib/ink strokePath), rAF ile canli.
  //  - Tek dokunus (< 8 px) = altindaki vurguyu/notu acar. Parmak (touch) her zaman kaydirir; parmakla secim
  //    balonu eskisi gibi calisir.
  // Silgi aracinda kalemle surukleme: altindan gecilen vurgular / el yazilari silinir.
  // Hizli iki dokunus (kalem, < 350 ms, < 14 px): son iki arac arasinda gecis (onPenDoubleTap).
  type Stroke = {
    id: number; kind: "ink" | "mark"; pageEl: HTMLElement; pageNum: number; pr: DOMRect;
    pts: InkPoint[]; px: Pt[]; spans: Span[]; lineH: number;
    svg: SVGSVGElement; path: SVGPathElement; raf: number; ptype: string;
  };
  const stroke = useRef<Stroke | null>(null);
  const penErase = useRef<{ id: number; done: Set<string> } | null>(null);
  const lastPenTap = useRef<{ t: number; x: number; y: number; dot: boolean } | null>(null);
  const drawRef = useRef(false);
  drawRef.current = drawTool || tool === "eraser";
  const eraseAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as Element | null;
    const id = el?.closest?.("[data-ann]")?.getAttribute("data-ann");
    if (!id || penErase.current?.done.has(id)) return;
    penErase.current?.done.add(id);
    const a = annotations.find((z) => z.id === id);
    if (a) props.onErase(a);
  };

  // iOS: kalem dokunusu tarayicinin secimini / kaydirmasini baslatmasin (parmak serbest)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const guard = (e: TouchEvent) => {
      if (!drawRef.current || !e.cancelable) return;
      const touches = Array.from(e.changedTouches) as (Touch & { touchType?: string })[];
      if (touches.some((t) => t.touchType === "stylus") || (e.type === "touchmove" && stroke.current)) e.preventDefault();
    };
    el.addEventListener("touchstart", guard, { passive: false });
    el.addEventListener("touchmove", guard, { passive: false });
    return () => { el.removeEventListener("touchstart", guard); el.removeEventListener("touchmove", guard); };
  }, []);
  // cizim surerken olusan secimi hemen temizle (bazi tarayicilarda preventDefault yetmez)
  useEffect(() => {
    const onSel = () => { if (stroke.current) { try { window.getSelection()?.removeAllRanges(); } catch {} } };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);
  // birakinca "oturan" vurgu onizlemesi: gercek vurgu listeye gelince kaldirilir
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const t = setTimeout(() => c.querySelectorAll(".ink-live[data-settled]").forEach((n) => n.remove()), 60);
    return () => clearTimeout(t);
  }, [annotations]);

  const setDrawing = (on: boolean) => {
    const c = scrollRef.current;
    if (!c) return;
    c.classList.toggle("pen-drawing", on);
    c.style.touchAction = on ? "none" : "";
  };

  const makeLive = (pageEl: HTMLElement, pr: DOMRect, kind: "ink" | "mark") => {
    const svg = document.createElementNS(SVGNS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", `0 0 1000 ${Math.round((1000 * pr.height) / pr.width)}`);
    svg.setAttribute("class", kind === "ink" ? "ink-layer ink-live" : "ink-live ink-live-mark");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVGNS, "path") as SVGPathElement;
    svg.appendChild(path);
    pageEl.appendChild(svg);
    return { svg, path };
  };

  const redraw = () => {
    const st = stroke.current;
    if (!st) return;
    st.raf = 0;
    if (st.kind === "ink") {
      st.path.setAttribute("d", strokePath(st.pts, props.ink?.width || 3.6));
    } else {
      // fosforlu onizleme: noktalar arasi kalin, yari saydam serit
      const d = st.pts.map((q, i) => `${i ? "L" : "M"}${(q[0] * 1000).toFixed(1)},${(q[1] * 1000).toFixed(1)}`).join("");
      st.path.setAttribute("d", st.pts.length === 1 ? d + "l0.1,0" : d);
    }
  };

  const pointOf = (st: Stroke, ev: { clientX: number; clientY: number; pressure: number }, ptype: string): InkPoint => {
    const x = (ev.clientX - st.pr.left) / st.pr.width, y = (ev.clientY - st.pr.top) / st.pr.width;
    const maxY = st.pr.height / st.pr.width;
    const p = ptype === "pen" ? (ev.pressure > 0 ? ev.pressure : 0.5) : 0.5;
    return [Math.min(1, Math.max(0, x)), Math.min(maxY, Math.max(0, y)), p];
  };

  const onPenDown = (e: React.PointerEvent) => {
    const isPen = e.pointerType === "pen";
    const isMouse = e.pointerType === "mouse";
    if (!isPen && !isMouse) return;                 // parmak: kaydirma / secim (avuc ici reddi)
    if (isMouse && e.button !== 0) return;
    if ((e.target as HTMLElement).closest?.('[role="toolbar"], button, a, input, textarea')) return;
    if (isPen) {
      const now = Date.now();
      const lt = lastPenTap.current;
      lastPenTap.current = { t: now, x: e.clientX, y: e.clientY, dot: false };
      if (lt && now - lt.t < 350 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 14 && props.onPenDoubleTap) {
        lastPenTap.current = null;
        if (lt.dot) props.onInkUndo?.();          // ilk dokunusun biraktigi noktayi geri al
        props.onPenDoubleTap();
        e.preventDefault();
        return;
      }
    }
    if (tool === "eraser") {
      if (!isPen) return;                           // fare: tiklama ile silinir (vurgunun onClick'i)
      setDrawing(true);
      penErase.current = { id: e.pointerId, done: new Set() };
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
      eraseAt(e.clientX, e.clientY);
      e.preventDefault();
      return;
    }
    if (!drawTool) {
      if (isPen && tool === "none") props.onPenIdle?.();
      return;
    }
    const pageEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest?.("[data-page]") as HTMLElement | null;
    if (!pageEl || !pageEl.classList.contains("is-live")) return;
    e.preventDefault();
    try { window.getSelection()?.removeAllRanges(); } catch {}
    setSel(null);
    const pr = pageEl.getBoundingClientRect();
    const kind = tool === "ink" ? "ink" : "mark";
    const spans = kind === "mark" ? pageSpans(pageEl, pr) : [];
    const lineH = median(spans.map((q) => q.h)) || 0.02;
    const { svg, path } = makeLive(pageEl, pr, kind);
    if (kind === "ink") {
      path.setAttribute("fill", props.ink?.color || "#1B2233");
    } else {
      const under = tool === "underline";
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", under ? darken(penHex) : penHex);
      path.setAttribute("stroke-width", String(Math.max(2, under ? 3 : lineH * 1000 * 0.95)));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("opacity", under ? "0.9" : String(Math.min(0.55, penState.opacity * 0.5)));
    }
    stroke.current = { id: e.pointerId, kind, pageEl, pageNum: Number(pageEl.dataset.page), pr, pts: [], px: [],
                       spans, lineH, svg, path, raf: 0, ptype: e.pointerType };
    stroke.current.pts.push(pointOf(stroke.current, e, e.pointerType));
    stroke.current.px.push({ x: e.clientX, y: e.clientY });
    setDrawing(true);
    if (kind === "ink") props.onInkStart?.();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    redraw();
  };

  const onPenMove = (e: React.PointerEvent) => {
    if (penErase.current && e.pointerId === penErase.current.id) { e.preventDefault(); eraseAt(e.clientX, e.clientY); return; }
    const st = stroke.current;
    if (!st || e.pointerId !== st.id) return;
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent;
    const evs = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const list = evs.length ? evs : [native];
    for (const ev of list) {
      const last = st.px[st.px.length - 1];
      if (last && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 1.2) continue;   // seyrelt
      st.pts.push(pointOf(st, ev, st.ptype));
      st.px.push({ x: ev.clientX, y: ev.clientY });
    }
    if (!st.raf) st.raf = requestAnimationFrame(redraw);
  };

  const finishStroke = (e: React.PointerEvent, cancelled: boolean) => {
    const st = stroke.current;
    if (!st) return;
    stroke.current = null;
    if (st.raf) cancelAnimationFrame(st.raf);
    setDrawing(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    const len = pathLength(st.px);
    const ratio = st.pr.height / st.pr.width;
    if (st.kind === "ink") {
      if (cancelled || !st.pts.length) { st.svg.remove(); return; }
      if (len < 3 && lastPenTap.current) lastPenTap.current.dot = true;
      props.onInkStroke?.(st.pageNum, packStroke(st.pts, props.ink?.color || "#1B2233", props.ink?.width || 3.6), ratio);
      // bekleyen taslak React ile cizilince canli katman kalkar (titreme olmasin diye iki kare sonra)
      requestAnimationFrame(() => requestAnimationFrame(() => st.svg.remove()));
      return;
    }
    // fosforlu kalem
    if (cancelled || len < MIN_MARK_PX) {
      st.svg.remove();
      if (!cancelled) {
        // tek dokunus: altindaki vurguyu / notu ac (yeni vurgu yok)
        const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
        const id = el?.closest?.("[data-ann]")?.getAttribute("data-ann");
        const a = id ? annotations.find((z) => z.id === id) : null;
        if (a) props.onSelectAnnotation(a);
      }
      return;
    }
    const pts: Pt[] = st.pts.map((q) => ({ x: q[0], y: q[1] }));
    let { rects, text } = rectsFromStroke(st.spans, pts);
    if (!rects.length && !st.spans.length) {
      const b = strokeBoxRect(pts, st.lineH);
      rects = b ? [b] : [];
      text = "";
    }
    if (!rects.length) { st.svg.remove(); return; }
    // sayfa yuzdesi (Anchor rect bicimi: x,w genislige; y,h yukseklige gore)
    const out: Rect[] = rects.map((r) => ({ x: +r.x.toFixed(4), y: +(r.y / ratio).toFixed(4), w: +r.w.toFixed(4), h: +(r.h / ratio).toFixed(4) }));
    // onizleme gercek satirlara "oturur": serit yerine satir dikdortgenleri
    const under = tool === "underline";
    st.path.remove();
    for (const r of rects) {
      const rc = document.createElementNS(SVGNS, "rect");
      const hh = under ? 3 : r.h * 1000;
      rc.setAttribute("x", (r.x * 1000).toFixed(1));
      rc.setAttribute("y", (under ? (r.y + r.h) * 1000 - hh : r.y * 1000).toFixed(1));
      rc.setAttribute("width", (r.w * 1000).toFixed(1));
      rc.setAttribute("height", hh.toFixed(1));
      rc.setAttribute("rx", "2");
      rc.setAttribute("fill", under ? darken(penHex) : penHex);
      rc.setAttribute("opacity", under ? "1" : String(penState.opacity));
      st.svg.appendChild(rc);
    }
    st.svg.setAttribute("data-settled", "1");
    setTimeout(() => st.svg.remove(), 4000);
    props.onCreateHighlight({ page: st.pageNum, rects: out, text, color: penState.color,
                              style: under ? "underline" : "highlight", opacity: penState.opacity });
  };

  const onPenUp = (e: React.PointerEvent) => {
    const c = scrollRef.current;
    if (penErase.current && e.pointerId === penErase.current.id) {
      penErase.current = null;
      setDrawing(false);
      if (c) c.style.touchAction = "";
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      return;
    }
    if (stroke.current && e.pointerId === stroke.current.id) {
      finishStroke(e, e.type === "pointercancel");
      return;
    }
    // parmakla secim (vurgu araci acikken birakinca dogrudan vurgulanir)
    if (e.pointerType === "touch" || !drawTool) readSelection(selTool);
  };

  const clearSel = () => { window.getSelection()?.removeAllRanges(); setSel(null); };
  const commitHighlight = (color: string, openNote = false, style: HighlightStyle = "highlight") => {
    if (!sel) return;
    props.onCreateHighlight({ page: sel.page, rects: sel.rects, text: sel.text, color, style, opacity: penState.opacity, openNote });
    clearSel();
  };
  const ask = () => {
    if (!sel || !props.onAsk) return;
    props.onAsk(sel.text, sel.page);
    clearSel();
  };
  const toDraft = () => {
    if (!sel || !props.onAddToDraft) return;
    props.onAddToDraft(sel.text, sel.page);
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
    // balondan / vurgudan gelen tiklama degil, sayfanin kendisi
    if ((e.target as HTMLElement).closest?.("[data-ann], [role=toolbar]")) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    props.onCreateSticky({ page: pageNum, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };
  const onRatio = useCallback((n: number, r: number) => {
    setRatios((m) => (Math.abs((m[n] || 0) - r) < 0.001 ? m : { ...m, [n]: r }));
  }, []);

  const inkDrafts = props.inkDrafts;
  const block = (n: number) => (
    <PageBlock key={n} n={n} width={width} live={isLive(n)} ratio={ratios[n] || ratio} onRatio={onRatio}
               annotations={annotations} onClick={onPageClick} eraser={tool === "eraser"} paper={paper} bloomId={bloomId}
               drafts={inkDrafts?.filter((d) => d.page === n)}
               onSelectAnnotation={props.onSelectAnnotation} onErase={props.onErase} />
  );

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <div className="relative h-full w-full" data-paper={paper}>
    <div ref={scrollRef} className="reader-surround h-full w-full overflow-auto overscroll-contain"
         onPointerDown={onPenDown} onPointerMove={onPenMove} onPointerUp={onPenUp} onPointerCancel={onPenUp}
         onKeyUp={(e) => { if (e.shiftKey) readSelection(selTool); }}
         data-tool={tool} data-paper={paper}
         style={{ cursor: tool === "note" || drawTool ? "crosshair" : tool === "eraser" ? "cell" : "auto" }}>
      {/* H-4: Document "w-max min-w-full" — sayfa kaptan genisleyince kap da genisler, sol kenar kaydirilabilir */}
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
                    className="mt-3 min-h-[44px] rounded-lg border px-4 text-sm" style={{ color: "var(--paper-surround-ink, var(--r-ink))" }}>
              Tekrar dene
            </button>
          </Centered>
        }
        className="flex w-max min-w-full flex-col items-center gap-7 px-3 py-4 lg:gap-8 lg:py-8"
      >
        {spread
          ? chunk(pages, 2).map((pair, i) => (
              <div key={i} className="flex gap-3">{pair.map(block)}</div>
            ))
          : pages.map(block)}
      </Document>

      {sel && (
        <div role="toolbar" aria-label="Seçili metin"
             className="absolute z-30 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-0.5 rounded-xl border bg-surface px-1 py-0.5 text-text-primary shadow-lg"
             style={{ top: sel.top, left: sel.left }}
             onPointerDown={() => { bubbleDownAt.current = Date.now(); }}
             onMouseDown={(e) => e.preventDefault()}>
          {HIGHLIGHT_COLORS.map((c) => {
            const hex = pigmentOf(c.value);
            const name = pigmentName(c.value);
            return (
              <button key={c.key} type="button" title={`${name} ile vurgula`} aria-label={`${name} ile vurgula`}
                      onClick={() => commitHighlight(c.value)}
                      className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-hover">
                <span className={`h-6 w-6 rounded-full border ${hex === penHex ? "border-accent-purple ring-2 ring-accent-purple/40" : "border-black/15"}`}
                      style={{ background: hex }} />
              </button>
            );
          })}
          <button type="button" onClick={() => commitHighlight(penState.color, false, "underline")}
                  className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-hover"
                  aria-label={`Altını çiz (${pigmentName(penState.color)})`} title="Altını çiz (seçili renkle)">
            <Underline size={17} aria-hidden style={{ color: darken(penHex) }} />
          </button>
          <button type="button" onClick={() => commitHighlight(penState.color, true)}
                  className="h-10 rounded-lg px-2 text-sm hover:bg-surface-hover" aria-label="Vurgula ve not ekle">+ Not</button>
          {props.onAsk && (
            <button type="button" onClick={ask}
                    className="ml-0.5 flex h-10 items-center gap-1 rounded-lg bg-accent-purple/10 px-2.5 text-sm font-medium text-accent-purple hover:bg-accent-purple/20"
                    aria-label="Seçili metni sohbette sor" title="Seçili metni sağdaki sohbete soru olarak hazırlar">
              <MessageSquare size={15} aria-hidden /> Sor
            </button>
          )}
          {props.onAddToDraft && (
            <button type="button" onClick={toDraft}
                    className="ml-0.5 flex h-10 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium hover:bg-surface-hover"
                    aria-label="Taslağa ekle" title="Seçili metni kaynak ve sayfa numarasıyla defterin taslağına alıntı olarak ekler (ücretsiz)">
              <PenLine size={15} aria-hidden /> Taslağa ekle
            </button>
          )}
        </div>
      )}
    </div>
    {/* Vurgu haritasi: kaydirma cubugunun yaninda (kaydirilan kabin disinda, sabit durur) */}
    <HighlightMap scrollRef={scrollRef} numPages={numPages} marks={marks} layoutKey={`${width}-${spread ? 2 : 1}`} />
    </div>
  );
}

function PageBlock({ n, width, live, ratio, onRatio, annotations, onClick, onSelectAnnotation, onErase, eraser, paper, bloomId, drafts }: {
  n: number; width: number; live: boolean; ratio: number; onRatio: (n: number, r: number) => void;
  annotations: Annotation[];
  onClick: (n: number, e: React.MouseEvent) => void;
  onSelectAnnotation: (a: Annotation) => void;
  onErase: (a: Annotation) => void;
  /** Silgi araci acik: vurguya dokununca silinir (secilmez) */
  eraser: boolean;
  /** Kagit tonu: Gece'de vurgular ters cevrilmis sayfada okunur kalacak sekilde cizilir */
  paper?: PaperTone;
  /** Yeni biriken vurgu: .ink-bloom (soldan saga murekkep yayilmasi) */
  bloomId?: string | null;
  /** Bu sayfada kaydedilmeyi bekleyen el yazisi */
  drafts?: InkDraft[];
}) {
  const h = Math.round(width * ratio);
  if (!live) {
    // cizilmeyen sayfa: ayni boyutta yer tutucu (kaydirma cubugu ve konum korunur)
    return (
      <div className="paper-page reader-page" data-page={n} style={{ width, height: h }} aria-hidden>
        <div className="page-num absolute -bottom-6 left-0 right-0 text-center text-xs" style={{ color: "var(--r-ink-2)" }}>{n}</div>
      </div>
    );
  }
  const anns = annotations.filter((a) => a.page_number === n && a.anchor.type !== "ink");
  const inks = annotations.filter((a) => a.page_number === n && a.anchor.type === "ink");
  return (
    <div className="paper-page reader-page is-live" data-page={n} style={{ width, minHeight: h }} onClick={(e) => onClick(n, e)}>
      <Page pageNumber={n} width={width} renderAnnotationLayer={false} renderTextLayer
            onLoadSuccess={(pg: any) => { if (pg?.originalWidth) onRatio(n, pg.originalHeight / pg.originalWidth); }}
            loading={<div style={{ height: h }} />} />
      <div className="hl-layer">
        {anns.map((a) =>
          a.anchor.type === "sticky" ? (
            <button key={a.id} type="button" className={`hl-note-dot ${eraser ? "hl-erasable" : ""}`} data-ann={a.id}
                    aria-label={`Kenar notu, sayfa ${n}${a.note_content ? ": " + a.note_content.slice(0, 60) : ""}${eraser ? " (silmek için dokun)" : ""}`}
                    style={{ left: `${(a.anchor.x ?? 0.95) * 100}%`, top: `${(a.anchor.y ?? 0.04) * 100}%` }}
                    onClick={(e) => { e.stopPropagation(); if (eraser) onErase(a); else onSelectAnnotation(a); }}>
              <StickyNote size={13} />
            </button>
          ) : (
            (a.anchor.rects ?? []).map((r, i) => {
              // pigment: eski kayitli hex'ler de yeni pigmentle cizilir
              const hs = highlightStyle({ ...a, highlight_color: pigmentOf(a.highlight_color || HIGHLIGHT_COLORS[0].value) }, paper);
              return (
                <div key={a.id + i} className={`hl-rect ${hs.underline ? "hl-underline" : ""} ${eraser ? "hl-erasable" : ""} ${a.id === bloomId ? "ink-bloom" : ""}`}
                     data-ann={a.id}
                     style={{
                       left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                       width: `${r.w * 100}%`, height: `${r.h * 100}%`,
                       background: hs.background, opacity: hs.opacity, borderBottom: hs.borderBottom,
                       outline: a.note_content ? "1.5px solid var(--r-accent)" : "none",
                     }}
                     title={eraser ? "Sil" : (a.note_content || a.selected_text || "")}
                     onClick={(e) => { e.stopPropagation(); if (eraser) onErase(a); else onSelectAnnotation(a); }} />
              );
            })
          )
        )}
      </div>
      {(inks.length > 0 || (drafts && drafts.length > 0)) && (
        <svg className="ink-layer" viewBox={`0 0 1000 ${Math.round(1000 * ratio)}`} aria-hidden={inks.length === 0 ? true : undefined}>
          {inks.map((a) => (
            <InkShape key={a.id} id={a.id} strokes={a.anchor.strokes || []}
                      label={`El yazısı notu, sayfa ${n}${eraser ? " (silmek için dokun)" : ""}`}
                      onPick={() => { if (eraser) onErase(a); else onSelectAnnotation(a); }} />
          ))}
          {drafts?.map((d) => <InkShape key={d.key} strokes={d.strokes} />)}
        </svg>
      )}
      <div className="page-num absolute -bottom-6 left-0 right-0 text-center text-xs" style={{ color: "var(--r-ink-2)" }}>
        {n}
      </div>
    </div>
  );
}

/** El yazisi cizimi: her darbe basinca gore kalinlasan dolgulu yol; kayitli notta genis gorunmez dokunma yolu
 *  (silgi / secim icin, .ink-hit). Yollar yalniz darbeler degisince yeniden hesaplanir. */
const InkShape = memo(function InkShape({ id, strokes, label, onPick }: {
  id?: string; strokes: InkStroke[]; label?: string; onPick?: () => void;
}) {
  const paths = useMemo(() => strokes.map((st) => ({
    c: st.c, d: strokePath(st.p, st.w),
    hit: st.p.map((q, i) => `${i ? "L" : "M"}${(q[0] * 1000).toFixed(1)},${(q[1] * 1000).toFixed(1)}`).join("") + (st.p.length === 1 ? "l0.1,0" : ""),
  })), [strokes]);
  return (
    <g data-ann={id} role={id ? "img" : undefined} aria-label={label}>
      {paths.map((p, i) => <path key={i} d={p.d} fill={p.c} />)}
      {id && paths.map((p, i) => (
        <path key={"h" + i} d={p.hit} className="ink-hit" data-ann={id}
              onClick={(e) => { e.stopPropagation(); onPick?.(); }} />
      ))}
    </g>
  );
});

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center p-10 text-sm" style={{ color: "var(--paper-surround-ink, var(--r-ink-2))" }}>{children}</div>;
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
