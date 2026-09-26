"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import {
  exportMarkdown, Annotation, HIGHLIGHT_COLORS, HighlightStyle, PenPrefs, loadPenPrefs, savePenPrefs,
  OPACITY_STEPS, DEFAULT_OPACITY,
} from "@/lib/reader";
import { stageInfo } from "@/lib/docstage";
import { useAnnotations } from "@/hooks/useAnnotations";
import { usePoll } from "@/hooks/usePoll";
import ReaderToolbar, { ReaderMoreMenu, ReaderBottomBar, Theme, Tool, isPenTool } from "@/components/reader/ReaderToolbar";
import PenPalette from "@/components/reader/PenPalette";
import ReaderHeader, { useNotebookContext, notebookHref, useMedia } from "@/components/reader/ReaderHeader";
import { useAddToDraft } from "@/components/reader/useAddToDraft";
import NotesPanel from "@/components/reader/NotesPanel";
import ExplainPanel from "@/components/reader/ExplainPanel";
import ConnectionsPanel from "@/components/reader/ConnectionsPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import Modal from "@/components/Modal";
import { toast as notify } from "@/components/Toast";
import { useRouter } from "next/navigation";
import { X, Sparkles, StickyNote, Volume2, Link2, Pin, PinOff, AlignLeft, FileText } from "lucide-react";
// Telefon paketi (Ajan T): klavye/gorunur alan degiskenleri (--vvh, --kb), pinch/cift dokunus, metin gorunumu
import { useVisualViewport } from "@/hooks/useVisualViewport";
import PinchZoom from "@/components/reader/PinchZoom";
import TextView from "@/components/reader/TextView";
// Okuma paketi (Ajan TO): okuma konumunu sunucuya yazar, baska cihazdaki konumu dondurur
import { useReadingSync } from "@/hooks/useReadingSync";

// react-pdf yalniz istemcide (SSR yok); PDF disi okuyucular da ayri parca olarak yuklenir
const PdfReader = dynamic(() => import("@/components/reader/PdfReader"), { ssr: false });
const VideoReader = dynamic(() => import("@/components/reader/VideoReader"), { ssr: false });
const TextReader = dynamic(() => import("@/components/reader/TextReader"), { ssr: false });

type RightTab = "ai" | "notes" | "explain" | "links";
const RIGHT_TABS: { key: RightTab; label: string; hint: string; Icon: typeof Sparkles }[] = [
  { key: "ai", label: "Sohbet", hint: "Bu kaynağa sor: cevaplar yalnız bu kaynaktan gelir", Icon: Sparkles },
  { key: "explain", label: "Anlat", hint: "Açık sayfayı sade dille anlat ve sesli oku", Icon: Volume2 },
  { key: "links", label: "Bağlantılar", hint: "Bu sayfayla bağlantılı diğer kaynaklar", Icon: Link2 },
  { key: "notes", label: "Notlar", hint: "Notlar ve vurgular", Icon: StickyNote },
];
/**
 * Okuyucu duzeni (TB-2):
 *  - < 768        telefon: paneller alttan acilan tabaka (Modal), alt cubuk.
 *  - 768-1023     dikey tablet: sohbet sagdan acilan KARARTMASIZ 380 px yan tabaka (PDF kaydirilabilir kalir),
 *                 "Sabitle" ile akisa girer; Icindekiler ustten tabaka; alt cubuk.
 *  - >= 1024      yan paneller. Dokunmatik tablette (yatay iPad) ilk acilista sol kapali, sohbet 368 px acik;
 *                 Icindekiler ustten tabaka (sol panel yerine).
 */
const LG = "(min-width: 1024px)";
const MD = "(min-width: 768px)";
const TOUCH = "(hover: none) and (pointer: coarse)";
const SIDE_W = 380;          // dikey tablette yan tabaka genisligi
const TOUCH_RIGHT_W = 368;   // yatay dokunmatik tablette sohbetin ilk genisligi (360-380)
type ViewMode = "page" | "text";

function toArr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

export default function DocumentPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const router = useRouter();
  const [doc, setDoc] = useState<any>(null);
  const [loadErr, setLoadErr] = useState("");
  const [fileUrl, setFileUrl] = useState<string>("");
  const fileLoaded = useRef(false);

  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [spread, setSpread] = useState(false);
  const [tool, setToolRaw] = useState<Tool>("none");
  // Kalem paleti (Ajan P): renk, kademe, konum, kucuk mu — cihazda saklanir. prevTool: kalemle cift dokunusta gecis.
  const [pen, setPen] = useState<PenPrefs>({ color: HIGHLIGHT_COLORS[0].value, opacity: DEFAULT_OPACITY, collapsed: false, pos: null });
  const penLoaded = useRef(false);
  const prevToolRef = useRef<Tool>("highlight");
  const toolRef = useRef<Tool>("none");
  function setTool(t: Tool) {
    if (t !== toolRef.current) { if (toolRef.current !== "none") prevToolRef.current = toolRef.current; toolRef.current = t; }
    setToolRaw(t);
    // araca gecince palet acik gelsin (kucultulmus degil)
    if (t !== "none") setPen((p) => (p.collapsed ? { ...p, collapsed: false } : p));
  }
  function penDoubleTap() {
    const cur = toolRef.current;
    const other = prevToolRef.current === cur || prevToolRef.current === "none" ? (cur === "eraser" ? "highlight" : "eraser") : prevToolRef.current;
    setTool(cur === "none" ? "highlight" : other);
  }

  const [theme, setTheme] = useState<Theme>("light");
  const [focus, setFocus] = useState(false);
  // Paneller kapali baslar; genis ekranda (>=1024) kayitli tercih uygulanir. Dar ekranda
  // paneller alttan acilan tabaka olur ve her acilista kapali gelir (PDF once gorunsun).
  const [isLg, setIsLg] = useState(false);
  const [panelsReady, setPanelsReady] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("ai");
  const [peek, setPeek] = useState<"left" | "right" | null>(null);
  const [restored, setRestored] = useState(false);
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [rightW, setRightW] = useState(420);
  const [leftW, setLeftW] = useState(288);
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  // dikey tablet (768-1023): sag yan tabaka sabitlenince akisa girer (PDF daralir)
  const [pinned, setPinned] = useState(false);
  // "Sayfa | Metin": telefonda kucuk kalan PDF metnini yeniden akisli gosterir (T-5)
  const [viewMode, setViewMode] = useState<ViewMode>("page");

  const isMd = useMedia(MD);
  const isTouch = useMedia(TOUCH);
  // dikey tablet: sag panel yan tabaka; Icindekiler ustten tabaka
  const sideSheet = isMd && !isLg;
  // yatay dokunmatik tablet: sol panel yerine Icindekiler ustten tabaka
  const leftAsSheet = isMd && (!isLg || isTouch);

  // klavye acilinca --vvh / --kb degiskenleri (sohbet tabakasi ve alt cubuk bunlara gore yerlesir)
  useVisualViewport();

  const ctx = useNotebookContext(doc);
  const { addToDraft, picker: draftPicker } = useAddToDraft(doc, ctx);
  const { annotations, add, patch, remove, restore } = useAnnotations(id);
  // okuma konumu cihazlar arasi: 3 sn gecikmeli yazma, baska cihazdaki konum basliktaki cipte
  const { serverPage, serverDevice } = useReadingSync(id, {
    page, numPages, pct: numPages ? Math.round((page / numPages) * 100) : 0,
  });
  // icindekiler: tiklaninca maddenin gectigi sayfayi bul (ucretsiz), sonucu hatirla
  const [tocPages, setTocPages] = useState<Record<number, number>>({});
  useEffect(() => { try { setTocPages(JSON.parse(localStorage.getItem("reader.toc." + id) || "{}")); } catch {} }, [id]);
  async function jumpToc(i: number, text: string) {
    let pg = tocPages[i];
    if (pg === undefined) {
      try { const r = await api(`/documents/${id}/locate?q=${encodeURIComponent(text)}`); pg = r?.page || 0; } catch { pg = 0; }
      const next = { ...tocPages, [i]: pg };
      setTocPages(next);
      try { localStorage.setItem("reader.toc." + id, JSON.stringify(next)); } catch {}
    }
    if (pg) { setPage(pg); if (!isLg || leftAsSheet) setLeftOpen(false); } else say("Bu başlığın sayfası bulunamadı");
  }

  // geri al / yinele (vurgu ve not ekleme-silme; ustune vurgulamada degistirme tek adim)
  type HistOp = { kind: "add"; ann: Annotation } | { kind: "remove"; ann: Annotation } | { kind: "group"; ops: HistOp[] };
  const undoRef = useRef<HistOp[]>([]);
  const redoRef = useRef<HistOp[]>([]);
  const [histTick, setHistTick] = useState(0);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function say(m: string, ms = 1800) {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  }
  function pushHist(op: HistOp) { undoRef.current.push(op); if (undoRef.current.length > 60) undoRef.current.shift(); redoRef.current = []; setHistTick((t) => t + 1); }
  async function recreate(a: Annotation) {
    return add({ page_number: a.page_number, selected_text: a.selected_text, note_content: a.note_content ?? "",
                 highlight_color: a.highlight_color, anchor: a.anchor });
  }
  // bir islemi geri alir, yinelemek icin gereken karsit islemi dondurur
  // silmeyi geri alma: cop kutusundan ayni kimlikle geri getir (olmazsa yeniden olustur)
  async function bringBack(a: Annotation): Promise<Annotation> {
    if (await restore(a)) return a;
    return (await recreate(a)) || a;
  }
  async function applyUndo(op: HistOp): Promise<HistOp> {
    if (op.kind === "add") { await remove(op.ann.id); return { kind: "add", ann: op.ann }; }
    if (op.kind === "remove") { const c = await bringBack(op.ann); return { kind: "remove", ann: c }; }
    const out: HistOp[] = [];
    for (const o of [...op.ops].reverse()) out.unshift(await applyUndo(o));
    return { kind: "group", ops: out };
  }
  async function applyRedo(op: HistOp): Promise<HistOp> {
    if (op.kind === "add") { const c = await bringBack(op.ann); return { kind: "add", ann: c }; }
    if (op.kind === "remove") { await remove(op.ann.id); return { kind: "remove", ann: op.ann }; }
    const out: HistOp[] = [];
    for (const o of op.ops) out.push(await applyRedo(o));
    return { kind: "group", ops: out };
  }
  async function undo() {
    const op = undoRef.current.pop(); if (!op) return;
    redoRef.current.push(await applyUndo(op));
    say(op.kind === "add" ? "Vurgu geri alındı" : op.kind === "remove" ? "Silme geri alındı" : "Geri alındı");
    setEditing(null); setHistTick((t) => t + 1);
  }
  async function redo() {
    const op = redoRef.current.pop(); if (!op) return;
    undoRef.current.push(await applyRedo(op));
    say("Yinelendi"); setEditing(null); setHistTick((t) => t + 1);
  }
  async function removeTracked(annId: string) {
    const a = annotations.find((x) => x.id === annId);
    await remove(annId);
    if (a) pushHist({ kind: "remove", ann: a });
  }
  // yeni vurgu, eski bir vurgunun >=%60'ini kapliyorsa eskiyi kaldirip yenisini koy (ust uste yigilma olmasin)
  function coveredBy(oldRects: any[], newRects: any[]) {
    let oldArea = 0, inter = 0;
    for (const o of oldRects) {
      const oa = (o.w || 0) * (o.h || 0); oldArea += oa;
      for (const n of newRects) {
        const x = Math.max(0, Math.min(o.x + o.w, n.x + n.w) - Math.max(o.x, n.x));
        const y = Math.max(0, Math.min(o.y + o.h, n.y + n.h) - Math.max(o.y, n.y));
        inter += x * y;
      }
    }
    return oldArea > 0 ? Math.min(1, inter / oldArea) : 0;
  }

  // kalem paleti tercihleri
  useEffect(() => { setPen(loadPenPrefs()); penLoaded.current = true; }, []);
  useEffect(() => { if (penLoaded.current) savePenPrefs(pen); }, [pen]);

  // kalici okuyucu tercihleri
  useEffect(() => {
    try {
      const t = localStorage.getItem("reader.theme") as Theme | null;
      if (t === "light" || t === "sepia" || t === "dark") setTheme(t);
      const sp = localStorage.getItem("reader.spread");
      if (sp) setSpread(sp === "1");
      const rw = parseInt(localStorage.getItem("reader.rightW") || "", 10); if (!isNaN(rw)) setRightW(Math.min(760, Math.max(320, rw)));
      const lw = parseInt(localStorage.getItem("reader.leftW") || "", 10); if (!isNaN(lw)) setLeftW(Math.min(460, Math.max(220, lw)));
      setPinned(localStorage.getItem("reader.pinRight") === "1");
      const vm = localStorage.getItem("reader.mode");
      if (vm === "page" || vm === "text") setViewMode(vm);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("reader.theme", theme); } catch {} }, [theme]);
  useEffect(() => { try { localStorage.setItem("reader.spread", spread ? "1" : "0"); } catch {} }, [spread]);
  useEffect(() => { try { localStorage.setItem("reader.rightW", String(rightW)); } catch {} }, [rightW]);
  useEffect(() => { try { localStorage.setItem("reader.leftW", String(leftW)); } catch {} }, [leftW]);
  useEffect(() => { try { localStorage.setItem("reader.pinRight", pinned ? "1" : "0"); } catch {} }, [pinned]);
  useEffect(() => { try { localStorage.setItem("reader.mode", viewMode); } catch {} }, [viewMode]);

  // ekran genisligi: >=1024 yan paneller, altinda tabaka (dikey tablette yan tabaka)
  useEffect(() => {
    const mq = window.matchMedia(LG);
    const apply = () => {
      const lg = mq.matches;
      const touch = window.matchMedia(TOUCH).matches;
      setIsLg(lg);
      if (lg) {
        let saved: { l?: boolean; r?: boolean } | null = null;
        try { saved = JSON.parse(localStorage.getItem("reader.panels") || "null"); } catch {}
        if (saved && typeof saved === "object") { setLeftOpen(!!saved.l); setRightOpen(!!saved.r); }
        else if (touch) {
          // yatay dokunmatik tablet (1024-1194): ilk acilista PDF + sohbet yan yana, Icindekiler tabaka
          let rwSaved = NaN;
          try { rwSaved = parseInt(localStorage.getItem("reader.rightW") || "", 10); } catch {}
          if (isNaN(rwSaved)) setRightW(TOUCH_RIGHT_W);
          setLeftOpen(false);
          setRightOpen(true);
        } else {
          // ilk kez (fare): PDF'e en az ~480 px kalmiyorsa sag panel kapali baslasin
          let lw = 288, rw = 420;
          try {
            lw = parseInt(localStorage.getItem("reader.leftW") || "288", 10) || 288;
            rw = parseInt(localStorage.getItem("reader.rightW") || "420", 10) || 420;
          } catch {}
          setLeftOpen(true);
          setRightOpen(window.innerWidth - lw - rw >= 480);
        }
      } else {
        // dikey tablette sabitlenmis sohbet acik gelir; diger dar ekranlarda PDF once gorunsun
        let pin = false;
        try { pin = window.matchMedia(MD).matches && localStorage.getItem("reader.pinRight") === "1"; } catch {}
        setLeftOpen(false); setRightOpen(pin); setFocus(false);
      }
      setPanelsReady(true);
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  // panel tercihini yalniz genis ekranda sakla (Icindekiler tabakaysa "acik" kaydedilmez)
  useEffect(() => {
    if (!panelsReady || !isLg) return;
    try { localStorage.setItem("reader.panels", JSON.stringify({ l: leftAsSheet ? false : leftOpen, r: rightOpen })); } catch {}
  }, [leftOpen, rightOpen, isLg, panelsReady, leftAsSheet]);

  // dar ekranda ayni anda tek tabaka (dikey tablette sabitlenmis sohbet acik kalabilir)
  function openLeft(v: boolean) { setLeftOpen(v); if (v && !isLg && !(sideSheet && pinned)) setRightOpen(false); }
  function openRight(v: boolean) { setRightOpen(v); if (v && !isLg) setLeftOpen(false); }
  function showNotes() { setRightTab("notes"); if (isLg || sideSheet) setRightOpen(true); }
  // tabakadan sayfaya atlayinca tabaka kapansin (yan panel ve sabitlenmis yan tabaka acik kalir)
  function closeAfterJump() { if (!isLg && !(sideSheet && pinned)) setRightOpen(false); }

  // belge + dosya adresi
  async function load() {
    try {
      const d = await api(`/documents/${id}`);
      setDoc(d); setLoadErr("");
      if (!fileLoaded.current && (!d.source_type || d.source_type === "pdf")) {
        try { const f = await api(`/documents/${id}/file`); setFileUrl(f.url); fileLoaded.current = true; } catch {}
      }
    } catch (e: any) {
      setLoadErr(e?.message || "Kaynak açılamadı.");
    }
  }
  useEffect(() => { fileLoaded.current = false; setDoc(null); setFileUrl(""); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // islenirken durum yoklamasi: sekme gizliyken / cevrimdisiyken durur, aralik 3 -> 15 sn
  const processing = !!doc && doc.status !== "ready" && doc.status !== "failed";
  const docRef = useRef<any>(null);
  docRef.current = doc;
  const { kick } = usePoll(async () => {
    const s = await api(`/documents/${id}/status`, {}, 1);
    if (s.status === "ready" || s.status === "failed") { await load(); return true; }
    const d = docRef.current;
    const changed = !!d && (d.processing_stage !== s.processing_stage || d.progress_done !== s.progress_done);
    setDoc((x: any) => (x ? { ...x, ...s } : x));
    if (changed) kick();              // ilerleme varsa sik bak (aralik basa doner)
  }, { active: processing, base: 3000, max: 15000 });

  // sekme basligi
  useEffect(() => { if (doc?.title) document.title = `${doc.title} · TY PDF`; }, [doc?.title]);

  // klavye: yazarken, menulerde, panellerde ve pencerelerde ok tuslari sayfa degistirmez
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y")) { e.preventDefault(); redo(); return; }
      if (mod || e.altKey) return;
      if (e.key === "Escape" && !t?.closest?.('[role="dialog"], [role="menu"]')) {
        // odak modundan cik; dikey tablette sabitlenmemis yan tabakayi kapat (odak icindeyken de)
        setFocus(false);
        if (sideSheet && !pinned) setRightOpen(false);
        return;
      }
      if (t?.closest?.('aside, [role="dialog"], [role="menu"], [role="tablist"], [role="separator"]')) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); setPage((p) => Math.min(numPages || p, p + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setPage((p) => Math.max(1, p - 1)); }
      else if (e.key === "f" && isLg) setFocus((f) => !f);
      // kalem paleti: 1-5 renk, H vurgu, U alt cizgi, E silgi (ayni tusa tekrar basinca arac kapanir)
      else if (/^[1-5]$/.test(e.key) && viewMode === "page") {
        const c = HIGHLIGHT_COLORS[Number(e.key) - 1];
        setPen((p) => ({ ...p, color: c.value }));
        if (toolRef.current === "none" || toolRef.current === "eraser") setTool("highlight");
        say(`Renk: ${c.label}`, 1200);
      }
      else if ((e.key === "h" || e.key === "H") && viewMode === "page") setTool(toolRef.current === "highlight" ? "none" : "highlight");
      else if ((e.key === "u" || e.key === "U") && viewMode === "page") setTool(toolRef.current === "underline" ? "none" : "underline");
      else if ((e.key === "e" || e.key === "E") && viewMode === "page") setTool(toolRef.current === "eraser" ? "none" : "eraser");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, annotations, isLg, sideSheet, pinned, viewMode]);

  // kaldigin yerden devam: PDF acilinca kayitli sayfaya don
  useEffect(() => {
    if (!numPages || restored) return;
    try {
      // URL'de ?page=N varsa (sozluk / baglanti / kaynak tiklamasi) o sayfaya git
      const want = parseInt(new URLSearchParams(window.location.search).get("page") || "", 10);
      if (!isNaN(want) && want >= 1 && want <= numPages) {
        setPage(want);
      } else {
        const saved = parseInt(localStorage.getItem(`reader.pos.${id}`) || "", 10);
        if (!isNaN(saved) && saved > 1 && saved <= numPages) setPage(saved);
      }
    } catch {}
    setRestored(true);
  }, [numPages, restored, id]);

  // okudugun yeri ve ilerlemeyi kaydet (kutuphane bunu okur)
  useEffect(() => {
    if (!restored || !numPages) return;
    try {
      localStorage.setItem(`reader.pos.${id}`, String(page));
      localStorage.setItem(`reader.prog.${id}`, JSON.stringify({
        page, numPages, pct: Math.round((page / numPages) * 100), at: Date.now(),
      }));
    } catch {}
  }, [page, numPages, restored, id]);

  // odak modunda (genis ekran): fare kenara gelince paneli gecici goster
  useEffect(() => {
    if (!focus || !isLg) { setPeek(null); return; }
    const onMove = (e: MouseEvent) => {
      const w = document.documentElement.clientWidth || window.innerWidth;
      if (e.clientX <= 32) setPeek("left");
      else if (e.clientX >= w - 32) setPeek("right");
      else if (e.clientX > leftW + 40 && e.clientX < w - rightW - 40) setPeek(null);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [focus, isLg, leftW, rightW]);

  // acik sayfanin metnini DOM'dan al (pdf.js metin katmani)
  function getPageText(n: number): string {
    try {
      const el = document.querySelector(`[data-page="${n}"] .react-pdf__Page__textContent`);
      return el ? (el.textContent || "") : "";
    } catch { return ""; }
  }

  const showLeft = leftOpen && (!focus || peek === "left");
  const showRight = rightOpen && (!focus || peek === "right");
  const progress = numPages ? Math.round((page / numPages) * 100) : 0;

  async function onCreateHighlight(h: { page: number; rects: any[]; text: string; color: string; style: HighlightStyle; opacity: number; openNote?: boolean }) {
    // secilen renk paletin son rengi olur (H-5: bir sonraki secim bu renkle vurgulanir)
    setPen((p) => (p.color === h.color ? p : { ...p, color: h.color }));
    const olds = annotations.filter((a) => a.page_number === h.page && a.anchor?.type === "highlight" && !a.note_content
                                            && coveredBy(a.anchor.rects || [], h.rects) >= 0.6);
    for (const o of olds) await remove(o.id);
    const created = await add({ page_number: h.page, selected_text: h.text, note_content: "", highlight_color: h.color,
                                anchor: { type: "highlight", rects: h.rects, style: h.style, opacity: h.opacity } });
    if (created) {
      const addOp: HistOp = { kind: "add", ann: created };
      pushHist(olds.length ? { kind: "group", ops: [...olds.map((o) => ({ kind: "remove", ann: o } as HistOp)), addOp] } : addOp);
      if (olds.length) say(olds.length === 1 ? "Önceki vurgunun yerine geçti" : `${olds.length} eski vurgunun yerine geçti`);
      else {
        // ilk vurguda bir kez: vurgularin taslakta alinti karti olarak hazir oldugunu soyle
        let seen = true;
        try { seen = localStorage.getItem("reader.hlTip") === "1"; if (!seen) localStorage.setItem("reader.hlTip", "1"); } catch {}
        if (!seen && ctx.id) say("Vurguların bu defterin Taslak bölümünde alıntı kartı olarak hazır.", 5000);
      }
    }
    if (created && h.openNote) { setEditing(created); showNotes(); }
  }
  function onErase(a: Annotation) {
    void removeTracked(a.id);
    say(`${a.anchor.type === "sticky" ? "Kenar notu" : a.anchor.style === "underline" ? "Alt çizgi" : "Vurgu"} silindi · Ctrl+Z ile geri al`, 2500);
  }
  async function onCreateSticky(s: { page: number; x: number; y: number }) {
    const created = await add({ page_number: s.page, selected_text: null, note_content: "", highlight_color: null, anchor: { type: "sticky", x: s.x, y: s.y } });
    if (created) { pushHist({ kind: "add", ann: created }); setEditing(created); showNotes(); }
    setTool("none");
  }
  function onAsk(text: string, pg: number) {
    const t = text.trim().replace(/\s+/g, " ");
    const snip = t.length > 600 ? t.slice(0, 600) + "…" : t;
    setPrefill({ text: `«${snip}» (s.${pg}) — bu kısmı açıklar mısın?`, key: Date.now() });
    setRightTab("ai");
    openRight(true);
  }
  function onExport() {
    const md = exportMarkdown(doc?.title || "Kaynak", annotations);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${doc?.title || "notlar"}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  if (!doc) {
    return (
      <div className="flex h-dvh flex-col">
        <ReaderHeader doc={null} ctx={ctx} />
        <div className="p-8 text-text-secondary" role="status">
          {loadErr ? (
            <>
              <p>{loadErr}</p>
              <button type="button" onClick={load} className="mt-3 min-h-[44px] rounded-lg border px-4 text-sm">Tekrar dene</button>
            </>
          ) : "Yükleniyor…"}
        </div>
      </div>
    );
  }
  if (doc.source_type === "youtube" || doc.source_type === "audio") return <VideoReader id={id} doc={doc} />;
  if (doc.source_type && doc.source_type !== "pdf") return <TextReader id={id} doc={doc} />;

  // Panel ayraci (TB-3): fare, parmak ve kalem ayni yoldan (pointer olaylari + setPointerCapture).
  // Gorunen cizgi 6 px; gorunmez dokunma alani ~22 px (before:); ortada tutamak cizgisi.
  function applyResize(side: "left" | "right", clientX: number) {
    if (side === "right") setRightW(Math.min(760, Math.max(320, window.innerWidth - clientX)));
    else setLeftW(Math.min(460, Math.max(220, clientX)));
  }
  function onSepPointerDown(side: "left" | "right", e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.drag = "1";
    document.body.style.userSelect = "none";
    applyResize(side, e.clientX);
  }
  function onSepPointerMove(side: "left" | "right", e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.dataset.drag !== "1") return;
    applyResize(side, e.clientX);
  }
  function onSepPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.dataset.drag !== "1") return;
    delete e.currentTarget.dataset.drag;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    document.body.style.userSelect = "";
  }
  function keyResize(side: "left" | "right", e: React.KeyboardEvent) {
    const d = e.key === "ArrowLeft" ? -24 : e.key === "ArrowRight" ? 24 : 0;
    if (!d) return;
    e.preventDefault();
    if (side === "left") setLeftW((w) => Math.min(460, Math.max(220, w + d)));
    else setRightW((w) => Math.min(760, Math.max(320, w - d)));
  }
  const sepClass = "group relative w-1.5 shrink-0 cursor-col-resize touch-none bg-transparent transition " +
    "before:absolute before:inset-y-0 before:-left-2 before:-right-2 before:content-[''] " +
    "hover:bg-accent-purple/40 focus-visible:bg-accent-purple/40 data-[drag=1]:bg-accent-purple/40";
  const sepHandle = (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong/70 group-hover:bg-accent-purple" />
  );

  const tb = {
    page, numPages, setPage, scale, setScale, spread, setSpread, tool, setTool, theme, setTheme,
    focus, setFocus, leftOpen, setLeftOpen: openLeft, rightOpen, setRightOpen: openRight, onExport,
    onUndo: undo, onRedo: redo,
    canUndo: histTick >= 0 && undoRef.current.length > 0, canRedo: histTick >= 0 && redoRef.current.length > 0,
  };
  const st = stageInfo(doc);

  const leftContent = (
    <>
      {isLg && !leftAsSheet && <h2 className="mb-1 font-heading text-lg leading-tight">{doc.title}</h2>}
      {doc.status !== "ready" ? (
        <p className="text-sm text-text-secondary" role="status">
          {doc.status === "failed" ? `⚠️ ${doc.error_message || "Bu kaynak işlenemedi."}` : `Hazırlanıyor · ${st.label}${st.pct !== null ? ` (%${st.pct})` : ""}`}
        </p>
      ) : (
        <>
          {doc.short_summary && <p className="mt-2 text-sm leading-relaxed text-text-secondary">{doc.short_summary}</p>}
          {toArr(doc.outline).length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">İçindekiler</h3>
              <ul className="space-y-0.5 text-sm">
                {(() => {
                  const items = toArr(doc.outline).map((o) => (typeof o === "string" ? o : (o?.title || "")));
                  // su an okunan bolum: bulunmus sayfalar icinde page'e en yakin olan (<= page)
                  let cur = -1, best = 0;
                  items.forEach((_, i) => { const pg = tocPages[i]; if (pg && pg <= page && pg >= best) { best = pg; cur = i; } });
                  return items.map((t, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => jumpToc(i, t)} aria-current={i === cur ? "location" : undefined}
                              className={`flex min-h-[40px] w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-muted ${i === cur ? "bg-accent-purple/10 text-text-primary font-medium" : "text-text-secondary"}`}>
                        <span aria-hidden className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${i === cur ? "bg-accent-purple" : "bg-border"}`} />
                        <span className="min-w-0 flex-1">{t}</span>
                        {tocPages[i] ? <span className="shrink-0 text-xs opacity-80">s.{tocPages[i]}</span>
                          : tocPages[i] === 0 ? <span className="shrink-0 text-xs opacity-60" aria-label="sayfa bulunamadı">—</span> : null}
                      </button>
                    </li>
                  ));
                })()}
              </ul>
            </div>
          )}
          {toArr(doc.key_concepts).length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">Anahtar kavramlar</h3>
              <div className="flex flex-wrap gap-1.5">
                {toArr(doc.key_concepts).map((k, i) => {
                  const term = typeof k === "string" ? k : (k?.term || "");
                  const def = typeof k === "string" ? "" : (k?.definition || "");
                  // aciklama yalniz hover'da (title) kalmasin: dokununca kisa bildirimde gosterilir (TB-4)
                  return def ? (
                    <button key={i} type="button" title={def} onClick={() => notify.info(`${term}: ${def}`)}
                            className="min-h-[32px] rounded-full bg-accent-amber/15 px-2.5 py-0.5 text-xs text-amber-800 hover:bg-accent-amber/25 dark:text-amber-300">
                      {term}
                    </button>
                  ) : (
                    <span key={i} className="rounded-full bg-accent-amber/15 px-2.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">{term}</span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );

  function onTabKey(e: React.KeyboardEvent) {
    const i = RIGHT_TABS.findIndex((t) => t.key === rightTab);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % RIGHT_TABS.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + RIGHT_TABS.length) % RIGHT_TABS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = RIGHT_TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setRightTab(RIGHT_TABS[n].key);
    setTimeout(() => document.getElementById(`rtab-${RIGHT_TABS[n].key}`)?.focus(), 0);
  }
  const rightTabs = (
    <div role="tablist" aria-label="Okuyucu paneli" className="flex min-w-0 flex-1" onKeyDown={onTabKey}>
      {RIGHT_TABS.map(({ key, label, hint, Icon }) => {
        const on = rightTab === key;
        return (
          <button key={key} id={`rtab-${key}`} type="button" role="tab" aria-selected={on} aria-controls="rpanel"
                  tabIndex={on ? 0 : -1} title={hint} onClick={() => setRightTab(key)}
                  className={`relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs ${on ? "font-semibold text-text-primary" : "text-text-secondary hover:text-text-primary"}`}>
            <Icon size={16} aria-hidden className={on ? "text-accent-purple" : ""} />
            <span className="flex items-center gap-1">
              {label}
              {key === "notes" && annotations.length > 0 && (
                <span className="rounded-full bg-accent-purple/15 px-1.5 text-xs text-text-primary">
                  {annotations.length}<span className="sr-only"> not ve vurgu</span>
                </span>
              )}
            </span>
            {on && <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-purple" />}
          </button>
        );
      })}
    </div>
  );
  const rightBody = (
    <div id="rpanel" role="tabpanel" aria-labelledby={`rtab-${rightTab}`} className="min-h-0 flex-1">
      {rightTab === "ai" ? (
        <ChatPanel documentId={id} prefill={prefill} notebookHref={ctx.id ? notebookHref(ctx) : null}
                   onGoPage={(pg) => { setPage(Math.max(1, Math.min(numPages || pg, pg))); closeAfterJump(); }} />
      ) : rightTab === "explain" ? (
        <ExplainPanel documentId={id} page={page} getPageText={getPageText} />
      ) : rightTab === "links" ? (
        <ConnectionsPanel documentId={id} page={page}
                          onOpen={(docId, pg) => router.push(`/documents/${docId}${pg ? `?page=${pg}` : ""}`)} />
      ) : (
        <NotesPanel docTitle={doc?.title} annotations={annotations}
                    onJump={(a) => { setPage(a.page_number); closeAfterJump(); }}
                    onDelete={removeTracked}
                    onEditNote={(a) => setEditing(a)} />
      )}
    </div>
  );

  // "Sayfa | Metin" anahtari: md ve ustunde iki etiketli dugme, telefonda tek ikon (44 px)
  const viewSwitch = (
    <>
      <div role="group" aria-label="Görünüm" className="hidden shrink-0 items-center rounded-lg border p-0.5 text-xs md:flex">
        {([["page", "Sayfa", FileText], ["text", "Metin", AlignLeft]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" aria-pressed={viewMode === k} onClick={() => setViewMode(k)}
                  className={`flex h-9 min-w-[60px] items-center justify-center gap-1 rounded-md px-2 ${viewMode === k ? "bg-accent-purple/10 font-medium text-accent-purple" : "text-text-secondary hover:bg-surface-muted"}`}>
            <Icon size={14} aria-hidden /> {label}
          </button>
        ))}
      </div>
      <button type="button" aria-pressed={viewMode === "text"} onClick={() => setViewMode(viewMode === "text" ? "page" : "text")}
              aria-label={viewMode === "text" ? "Metin görünümü açık. Sayfa görünümüne geç" : "Metin görünümüne geç"}
              title={viewMode === "text" ? "Sayfa görünümü" : "Metin görünümü"}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg md:hidden ${viewMode === "text" ? "bg-accent-purple/10 text-accent-purple" : "hover:bg-surface-muted"}`}>
        {viewMode === "text" ? <FileText size={19} aria-hidden /> : <AlignLeft size={19} aria-hidden />}
      </button>
    </>
  );

  // Dikey tablet: sag yan tabaka basligi (sekmeler + Sabitle + Kapat)
  const sheetHead = (
    <div className="flex shrink-0 items-stretch border-b">
      {rightTabs}
      <button type="button" onClick={() => setPinned((p) => !p)} aria-pressed={pinned}
              aria-label={pinned ? "Sabitlemeyi kaldır: panel PDF'in üstünde dursun" : "Sabitle: panel yanda kalsın, PDF daralsın"}
              title={pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
              className={`flex w-11 shrink-0 items-center justify-center ${pinned ? "text-accent-purple" : "text-text-secondary hover:bg-surface-muted"}`}>
        {pinned ? <PinOff size={18} aria-hidden /> : <Pin size={18} aria-hidden />}
      </button>
      <button type="button" onClick={() => setRightOpen(false)} aria-label="Paneli kapat"
              className="flex w-11 shrink-0 items-center justify-center text-text-secondary hover:bg-surface-muted">
        <X size={20} aria-hidden />
      </button>
    </div>
  );

  const pdfView = fileUrl ? (
    viewMode === "text" ? (
      <TextView fileUrl={fileUrl} page={page} onPageChange={setPage} onAsk={onAsk}
                onAddToDraft={(text: string, pg: number) => addToDraft(text, pg)} theme={theme} />
    ) : (
      <PinchZoom scale={scale} onScaleChange={(s: number) => setScale(() => s)} fitLabel="Sığdır">
        <PdfReader
          fileUrl={fileUrl} page={page} scale={scale} spread={isLg && spread} tool={tool}
          pen={{ color: pen.color, opacity: pen.opacity }}
          annotations={annotations}
          onNumPages={setNumPages} onVisiblePage={setPage}
          onCreateHighlight={onCreateHighlight} onCreateSticky={onCreateSticky}
          onErase={onErase} onPenDoubleTap={penDoubleTap}
          onSelectAnnotation={(a) => { setEditing(a); showNotes(); }}
          onAsk={onAsk}
          onAddToDraft={(text, pg) => addToDraft(text, pg)}
        />
      </PinchZoom>
    )
  ) : (
    <div className="reader-surround flex h-full items-center justify-center p-6 text-center text-sm" style={{ color: "var(--r-ink-2)" }} role="status">
      {doc.status === "failed" ? "Bu PDF açılamadı." : "PDF hazırlanıyor…"}
    </div>
  );

  return (
    <div className="reader-root flex h-dvh flex-col" data-theme={theme}>
      <ReaderHeader doc={doc} ctx={ctx} serverPage={serverPage} serverDevice={serverDevice} currentPage={page}
                    onGoServerPage={(n: number) => setPage(Math.max(1, Math.min(numPages || n, n)))}>
        {viewSwitch}
        {isLg ? <ReaderToolbar {...tb} /> : <ReaderMoreMenu {...tb} variant="narrow" />}
      </ReaderHeader>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* odak modu: kenar tutamaklari (uzerine gelince / tiklayinca panel belirir) */}
        {isLg && !leftAsSheet && focus && leftOpen && !showLeft && (
          <button type="button" onMouseEnter={() => setPeek("left")} onClick={() => setPeek("left")}
                  aria-label="Sol paneli göster"
                  className="absolute left-0 top-1/2 z-20 h-32 w-4 -translate-y-1/2 rounded-r-full bg-accent-purple/25 transition hover:bg-accent-purple/60" />
        )}
        {isLg && focus && rightOpen && !showRight && (
          <button type="button" onMouseEnter={() => setPeek("right")} onClick={() => setPeek("right")}
                  aria-label="Sağ paneli göster"
                  className="absolute right-0 top-1/2 z-20 h-32 w-4 -translate-y-1/2 rounded-l-full bg-accent-purple/25 transition hover:bg-accent-purple/60" />
        )}
        {/* SOL panel (genis ekran, fare) — dokunmatik tablette Icindekiler ustten tabaka (asagida) */}
        {isLg && !leftAsSheet && showLeft && (
          <aside style={{ width: leftW }} aria-label="İçindekiler ve özet"
                 className={`shrink-0 overflow-auto border-r bg-surface p-4 ${focus ? "absolute left-0 top-0 z-30 h-full shadow-2xl" : ""}`}>
            {leftContent}
          </aside>
        )}
        {isLg && !leftAsSheet && showLeft && !focus && (
          <div onPointerDown={(e) => onSepPointerDown("left", e)} onPointerMove={(e) => onSepPointerMove("left", e)}
               onPointerUp={onSepPointerUp} onPointerCancel={onSepPointerUp}
               onKeyDown={(e) => keyResize("left", e)} tabIndex={0}
               className={sepClass}
               role="separator" aria-orientation="vertical" aria-valuenow={leftW} aria-valuemin={220} aria-valuemax={460}
               aria-label="Sol paneli yeniden boyutlandır (ok tuşları)" title="Sürükleyerek boyutlandır">
            {sepHandle}
          </div>
        )}

        {/* ORTA: PDF */}
        <section aria-label="PDF" className="relative min-w-0 flex-1 overflow-hidden"
              onPointerDown={() => { if (focus && peek) setPeek(null); }}>
          {pdfView}
          {/* Kalem paleti: arac acikken; masaustunde ustte (arac cubugunun altinda), tablette/telefonda altta */}
          {tool !== "none" && viewMode === "page" && fileUrl && (
            <PenPalette tool={tool} setTool={setTool}
                        color={pen.color} setColor={(c) => setPen((p) => ({ ...p, color: c }))}
                        opacity={pen.opacity} setOpacity={(o) => setPen((p) => ({ ...p, opacity: o }))}
                        collapsed={pen.collapsed} setCollapsed={(b) => setPen((p) => ({ ...p, collapsed: b }))}
                        pos={pen.pos} setPos={(pos) => setPen((p) => ({ ...p, pos }))}
                        dock={isLg ? "top" : "bottom"} onClose={() => setTool("none")}
                        onUndo={undo} canUndo={histTick >= 0 && undoRef.current.length > 0} />
          )}
          {/* okuma ilerlemesi */}
          <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-1 bg-accent-purple/70 transition-all" style={{ width: `${progress}%` }} />
          {numPages > 0 && (
            <div aria-hidden className="pointer-events-none absolute bottom-3 right-4 hidden rounded-full bg-black/60 px-2.5 py-1 text-xs text-white lg:block">
              s.{page} / {numPages} · %{progress}
            </div>
          )}
          <div aria-live="polite" role="status" className="pointer-events-none absolute bottom-10 left-1/2 z-40 -translate-x-1/2">
            {toast && (
              <div className="fade-in max-w-[88vw] rounded-xl bg-text-primary px-4 py-2 text-center text-sm text-background shadow-lg">
                {toast}
              </div>
            )}
          </div>
        </section>

        {/* SAG panel (genis ekran) */}
        {isLg && showRight && !focus && (
          <div onPointerDown={(e) => onSepPointerDown("right", e)} onPointerMove={(e) => onSepPointerMove("right", e)}
               onPointerUp={onSepPointerUp} onPointerCancel={onSepPointerUp}
               onKeyDown={(e) => keyResize("right", e)} tabIndex={0}
               className={sepClass}
               role="separator" aria-orientation="vertical" aria-valuenow={rightW} aria-valuemin={320} aria-valuemax={760}
               aria-label="Sağ paneli yeniden boyutlandır (ok tuşları)" title="Sürükleyerek boyutlandır">
            {sepHandle}
          </div>
        )}
        {isLg && showRight && (
          <aside style={{ width: rightW }} aria-label="Sohbet, anlatım ve notlar"
                 className={`flex shrink-0 flex-col border-l bg-surface ${focus ? "absolute right-0 top-0 z-30 h-full shadow-2xl" : ""}`}>
            <div className="flex border-b">{rightTabs}</div>
            {rightBody}
          </aside>
        )}

        {/* DIKEY TABLET (768-1023): sagdan acilan karartmasiz yan tabaka; "Sabitle" ile akisa girer (TB-2) */}
        {sideSheet && rightOpen && (
          <aside aria-label="Sohbet, anlatım ve notlar"
                 style={{ width: SIDE_W, maxWidth: "85vw" }}
                 className={`flex shrink-0 flex-col border-l bg-surface ${pinned ? "" : "fade-in absolute inset-y-0 right-0 z-30 shadow-2xl"}`}>
            {sheetHead}
            {rightBody}
          </aside>
        )}
      </div>

      {/* DAR EKRAN: alt cubuk + tabakalar */}
      {!isLg && (
        <ReaderBottomBar page={page} numPages={numPages} setPage={setPage}
                         leftOpen={leftOpen} rightOpen={rightOpen}
                         onLeft={() => openLeft(!leftOpen)} onRight={() => openRight(!rightOpen)} />
      )}
      {/* Icindekiler: telefonda alttan, tablette (dikey ve dokunmatik yatay) ustten tabaka */}
      {(!isLg || leftAsSheet) && (
        <Modal open={leftOpen} onClose={() => setLeftOpen(false)} title={doc.title || "İçindekiler ve özet"} size="lg"
               align={leftAsSheet ? "top" : "center"}>
          {leftContent}
        </Modal>
      )}
      {/* Telefon: sohbet alttan acilan tabaka; klavye acilinca --vvh / --kb'ye gore kucultulur (T-2) */}
      {!isMd && (
        <Modal open={rightOpen} onClose={() => setRightOpen(false)} ariaLabel="Sohbet, anlatım ve notlar" size="lg"
               className="p-0">
          <div className="flex min-h-0 flex-col"
               style={{ height: "min(85dvh, calc(var(--vvh, 100dvh) - 12px))", marginBottom: "var(--kb, 0px)" }}>
            <div className="flex shrink-0 items-stretch border-b">
              {rightTabs}
              <button type="button" onClick={() => setRightOpen(false)} aria-label="Paneli kapat"
                      className="flex w-12 shrink-0 items-center justify-center text-text-secondary hover:bg-surface-muted">
                <X size={20} aria-hidden />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{rightBody}</div>
          </div>
        </Modal>
      )}

      {draftPicker}
      {editing && (
        <NoteEditor ann={editing} onClose={() => setEditing(null)}
                    onSave={(content, color, style, opacity) => {
                      const anchorPatch = editing.anchor.type === "sticky" ? {}
                        : { anchor: { ...editing.anchor, style: style || editing.anchor.style || "highlight", opacity: opacity ?? editing.anchor.opacity ?? DEFAULT_OPACITY } };
                      patch(editing.id, { note_content: content, ...(color ? { highlight_color: color } : {}), ...anchorPatch });
                      setEditing(null);
                    }}
                    onDelete={() => { removeTracked(editing.id); setEditing(null); say("Çöp kutusuna taşındı · Ctrl+Z ile geri al", 2500); }} />
      )}
    </div>
  );
}

function NoteEditor({ ann, onClose, onSave, onDelete }: {
  ann: Annotation; onClose: () => void;
  onSave: (content: string, color?: string, style?: HighlightStyle, opacity?: number) => void; onDelete: () => void;
}) {
  const [text, setText] = useState(ann.note_content || "");
  const [color, setColor] = useState(ann.highlight_color || HIGHLIGHT_COLORS[0].value);
  const [style, setStyle] = useState<HighlightStyle>(ann.anchor.style === "underline" ? "underline" : "highlight");
  const [opacity, setOpacity] = useState<number>(ann.anchor.opacity ?? DEFAULT_OPACITY);
  const sticky = ann.anchor.type === "sticky";
  const save = () => onSave(text, !sticky ? color : undefined, !sticky ? style : undefined, !sticky ? opacity : undefined);
  const preview: React.CSSProperties = style === "underline"
    ? { background: "transparent", borderBottom: `${(OPACITY_STEPS.find((s) => s.value === opacity) || OPACITY_STEPS[2]).underlinePx}px solid ${color}` }
    : { background: color, opacity: Math.max(0.5, opacity) };
  return (
    <Modal open onClose={onClose} title={`${sticky ? "Kenar notu" : style === "underline" ? "Alt çizgi notu" : "Vurgu notu"} · s.${ann.page_number}`} size="md">
      {ann.selected_text && (
        <p className="mb-3 rounded-md px-2 py-1 text-sm text-[#1F1D1A]" style={preview}>{ann.selected_text}</p>
      )}
      {!sticky && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5" role="group" aria-label="Vurgu rengi">
            {HIGHLIGHT_COLORS.map((c) => (
              <button key={c.key} type="button" aria-label={c.label} aria-pressed={color === c.value} onClick={() => setColor(c.value)}
                      className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-muted">
                <span className={`h-6 w-6 rounded-full border ${color === c.value ? "ring-2 ring-accent-purple ring-offset-1" : "border-black/10"}`}
                      style={{ background: c.value }} />
              </button>
            ))}
          </div>
          <div role="group" aria-label="Stil" className="flex items-center rounded-lg border p-0.5 text-xs">
            {([["highlight", "Vurgu"], ["underline", "Altı çizili"]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={style === k} onClick={() => setStyle(k)}
                      className={`h-9 rounded-md px-2.5 ${style === k ? "bg-accent-purple/10 font-medium text-accent-purple" : "text-text-secondary hover:bg-surface-muted"}`}>
                {label}
              </button>
            ))}
          </div>
          <div role="group" aria-label={style === "underline" ? "Çizgi kalınlığı" : "Koyuluk"} className="flex items-center rounded-lg border p-0.5 text-xs">
            {OPACITY_STEPS.map((st) => (
              <button key={st.key} type="button" aria-pressed={opacity === st.value} onClick={() => setOpacity(st.value)}
                      className={`h-9 rounded-md px-2.5 ${opacity === st.value ? "bg-accent-purple/10 font-medium text-accent-purple" : "text-text-secondary hover:bg-surface-muted"}`}>
                {st.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <label htmlFor="note-editor-text" className="sr-only">Not metni</label>
      <textarea id="note-editor-text" data-autofocus value={text} onChange={(e) => setText(e.target.value)} rows={4}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
                placeholder="Notunu yaz…" className="w-full rounded-lg border bg-surface-muted p-3 text-sm outline-none focus:border-accent-purple" />
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onDelete} className="min-h-[44px] rounded-lg px-2 text-sm text-danger hover:bg-surface-muted"
                title="Çöp kutusuna taşınır; 30 gün içinde geri alabilirsin">
          {sticky ? "Notu sil" : "Vurguyu sil"}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg px-3 text-sm text-text-secondary hover:bg-black/5">Vazgeç</button>
          <button type="button" onClick={save} className="min-h-[44px] rounded-lg bg-accent-purple px-4 text-sm text-white">Kaydet</button>
        </div>
      </div>
    </Modal>
  );
}
