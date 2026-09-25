"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { exportMarkdown, Annotation, HIGHLIGHT_COLORS } from "@/lib/reader";
import { stageInfo } from "@/lib/docstage";
import { useAnnotations } from "@/hooks/useAnnotations";
import { usePoll } from "@/hooks/usePoll";
import ReaderToolbar, { ReaderMoreMenu, ReaderBottomBar, Theme, Tool } from "@/components/reader/ReaderToolbar";
import ReaderHeader, { useNotebookContext, notebookHref } from "@/components/reader/ReaderHeader";
import { useAddToDraft } from "@/components/reader/useAddToDraft";
import NotesPanel from "@/components/reader/NotesPanel";
import ExplainPanel from "@/components/reader/ExplainPanel";
import ConnectionsPanel from "@/components/reader/ConnectionsPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import Modal from "@/components/Modal";
import { useRouter } from "next/navigation";
import { X, Sparkles, StickyNote, Volume2, Link2 } from "lucide-react";

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
const LG = "(min-width: 1024px)";

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
  const [tool, setTool] = useState<Tool>("none");

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

  const ctx = useNotebookContext(doc);
  const { addToDraft, picker: draftPicker } = useAddToDraft(doc, ctx);
  const { annotations, add, patch, remove } = useAnnotations(id);
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
    if (pg) { setPage(pg); if (!isLg) setLeftOpen(false); } else say("Bu başlığın sayfası bulunamadı");
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
  async function applyUndo(op: HistOp): Promise<HistOp> {
    if (op.kind === "add") { await remove(op.ann.id); return { kind: "add", ann: op.ann }; }
    if (op.kind === "remove") { const c = await recreate(op.ann); return { kind: "remove", ann: c || op.ann }; }
    const out: HistOp[] = [];
    for (const o of [...op.ops].reverse()) out.unshift(await applyUndo(o));
    return { kind: "group", ops: out };
  }
  async function applyRedo(op: HistOp): Promise<HistOp> {
    if (op.kind === "add") { const c = await recreate(op.ann); return { kind: "add", ann: c || op.ann }; }
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

  // kalici okuyucu tercihleri
  useEffect(() => {
    try {
      const t = localStorage.getItem("reader.theme") as Theme | null;
      if (t === "light" || t === "sepia" || t === "dark") setTheme(t);
      const sp = localStorage.getItem("reader.spread");
      if (sp) setSpread(sp === "1");
      const rw = parseInt(localStorage.getItem("reader.rightW") || "", 10); if (!isNaN(rw)) setRightW(Math.min(760, Math.max(320, rw)));
      const lw = parseInt(localStorage.getItem("reader.leftW") || "", 10); if (!isNaN(lw)) setLeftW(Math.min(460, Math.max(220, lw)));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("reader.theme", theme); } catch {} }, [theme]);
  useEffect(() => { try { localStorage.setItem("reader.spread", spread ? "1" : "0"); } catch {} }, [spread]);
  useEffect(() => { try { localStorage.setItem("reader.rightW", String(rightW)); } catch {} }, [rightW]);
  useEffect(() => { try { localStorage.setItem("reader.leftW", String(leftW)); } catch {} }, [leftW]);

  // ekran genisligi: >=1024 yan paneller, altinda alttan acilan tabaka
  useEffect(() => {
    const mq = window.matchMedia(LG);
    const apply = () => {
      const lg = mq.matches;
      setIsLg(lg);
      if (lg) {
        let saved: { l?: boolean; r?: boolean } | null = null;
        try { saved = JSON.parse(localStorage.getItem("reader.panels") || "null"); } catch {}
        if (saved && typeof saved === "object") { setLeftOpen(!!saved.l); setRightOpen(!!saved.r); }
        else {
          // ilk kez: PDF'e en az ~480 px kalmiyorsa sag panel kapali baslasin
          let lw = 288, rw = 420;
          try {
            lw = parseInt(localStorage.getItem("reader.leftW") || "288", 10) || 288;
            rw = parseInt(localStorage.getItem("reader.rightW") || "420", 10) || 420;
          } catch {}
          setLeftOpen(true);
          setRightOpen(window.innerWidth - lw - rw >= 480);
        }
      } else {
        setLeftOpen(false); setRightOpen(false); setFocus(false);
      }
      setPanelsReady(true);
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  // panel tercihini yalniz genis ekranda sakla
  useEffect(() => {
    if (!panelsReady || !isLg) return;
    try { localStorage.setItem("reader.panels", JSON.stringify({ l: leftOpen, r: rightOpen })); } catch {}
  }, [leftOpen, rightOpen, isLg, panelsReady]);

  // dar ekranda ayni anda tek tabaka
  function openLeft(v: boolean) { setLeftOpen(v); if (v && !isLg) setRightOpen(false); }
  function openRight(v: boolean) { setRightOpen(v); if (v && !isLg) setLeftOpen(false); }
  function showNotes() { setRightTab("notes"); if (isLg) setRightOpen(true); }

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
      if (t?.closest?.('aside, [role="dialog"], [role="menu"], [role="tablist"], [role="separator"]')) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); setPage((p) => Math.min(numPages || p, p + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setPage((p) => Math.max(1, p - 1)); }
      else if (e.key === "f" && isLg) setFocus((f) => !f);
      else if (e.key === "Escape") { setFocus(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, annotations, isLg]);

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

  async function onCreateHighlight(h: { page: number; rects: any[]; text: string; color: string; openNote?: boolean }) {
    const olds = annotations.filter((a) => a.page_number === h.page && a.anchor?.type === "highlight" && !a.note_content
                                            && coveredBy(a.anchor.rects || [], h.rects) >= 0.6);
    for (const o of olds) await remove(o.id);
    const created = await add({ page_number: h.page, selected_text: h.text, note_content: "", highlight_color: h.color, anchor: { type: "highlight", rects: h.rects } });
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

  function startResize(side: "left" | "right", e: React.MouseEvent) {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      if (side === "right") setRightW(Math.min(760, Math.max(320, window.innerWidth - ev.clientX)));
      else setLeftW(Math.min(460, Math.max(220, ev.clientX)));
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.userSelect = ""; };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  function keyResize(side: "left" | "right", e: React.KeyboardEvent) {
    const d = e.key === "ArrowLeft" ? -24 : e.key === "ArrowRight" ? 24 : 0;
    if (!d) return;
    e.preventDefault();
    if (side === "left") setLeftW((w) => Math.min(460, Math.max(220, w + d)));
    else setRightW((w) => Math.min(760, Math.max(320, w - d)));
  }

  const tb = {
    page, numPages, setPage, scale, setScale, spread, setSpread, tool, setTool, theme, setTheme,
    focus, setFocus, leftOpen, setLeftOpen: openLeft, rightOpen, setRightOpen: openRight, onExport,
    onUndo: undo, onRedo: redo,
    canUndo: histTick >= 0 && undoRef.current.length > 0, canRedo: histTick >= 0 && redoRef.current.length > 0,
  };
  const st = stageInfo(doc);

  const leftContent = (
    <>
      {isLg && <h2 className="mb-1 font-heading text-lg leading-tight">{doc.title}</h2>}
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
                {toArr(doc.key_concepts).map((k, i) => (
                  <span key={i} title={k?.definition || ""} className="rounded-full bg-accent-amber/15 px-2.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">
                    {typeof k === "string" ? k : (k?.term || "")}
                  </span>
                ))}
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
                   onGoPage={(pg) => { setPage(Math.max(1, Math.min(numPages || pg, pg))); if (!isLg) setRightOpen(false); }} />
      ) : rightTab === "explain" ? (
        <ExplainPanel documentId={id} page={page} getPageText={getPageText} />
      ) : rightTab === "links" ? (
        <ConnectionsPanel documentId={id} page={page}
                          onOpen={(docId, pg) => router.push(`/documents/${docId}${pg ? `?page=${pg}` : ""}`)} />
      ) : (
        <NotesPanel docTitle={doc?.title} annotations={annotations}
                    onJump={(a) => { setPage(a.page_number); if (!isLg) setRightOpen(false); }}
                    onDelete={removeTracked}
                    onEditNote={(a) => setEditing(a)} />
      )}
    </div>
  );

  return (
    <div className="reader-root flex h-dvh flex-col" data-theme={theme}>
      <ReaderHeader doc={doc} ctx={ctx}>
        {isLg ? <ReaderToolbar {...tb} /> : <ReaderMoreMenu {...tb} variant="narrow" />}
      </ReaderHeader>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* odak modu: kenar tutamaklari (uzerine gelince / tiklayinca panel belirir) */}
        {isLg && focus && leftOpen && !showLeft && (
          <button type="button" onMouseEnter={() => setPeek("left")} onClick={() => setPeek("left")}
                  aria-label="Sol paneli göster"
                  className="absolute left-0 top-1/2 z-20 h-32 w-4 -translate-y-1/2 rounded-r-full bg-accent-purple/25 transition hover:bg-accent-purple/60" />
        )}
        {isLg && focus && rightOpen && !showRight && (
          <button type="button" onMouseEnter={() => setPeek("right")} onClick={() => setPeek("right")}
                  aria-label="Sağ paneli göster"
                  className="absolute right-0 top-1/2 z-20 h-32 w-4 -translate-y-1/2 rounded-l-full bg-accent-purple/25 transition hover:bg-accent-purple/60" />
        )}
        {/* SOL panel (genis ekran) */}
        {isLg && showLeft && (
          <aside style={{ width: leftW }} aria-label="İçindekiler ve özet"
                 className={`shrink-0 overflow-auto border-r bg-surface p-4 ${focus ? "absolute left-0 top-0 z-30 h-full shadow-2xl" : ""}`}>
            {leftContent}
          </aside>
        )}
        {isLg && showLeft && !focus && (
          <div onMouseDown={(e) => startResize("left", e)} onKeyDown={(e) => keyResize("left", e)} tabIndex={0}
               className="w-1.5 shrink-0 cursor-col-resize bg-transparent transition hover:bg-accent-purple/40 focus-visible:bg-accent-purple/40"
               role="separator" aria-orientation="vertical" aria-valuenow={leftW} aria-valuemin={220} aria-valuemax={460}
               aria-label="Sol paneli yeniden boyutlandır (ok tuşları)" title="Sürükleyerek boyutlandır" />
        )}

        {/* ORTA: PDF */}
        <section aria-label="PDF" className="relative min-w-0 flex-1 overflow-hidden"
              onPointerDown={() => { if (focus && peek) setPeek(null); }}>
          {fileUrl ? (
            <PdfReader
              fileUrl={fileUrl} page={page} scale={scale} spread={isLg && spread} tool={tool}
              annotations={annotations}
              onNumPages={setNumPages} onVisiblePage={setPage}
              onCreateHighlight={onCreateHighlight} onCreateSticky={onCreateSticky}
              onSelectAnnotation={(a) => { setEditing(a); showNotes(); }}
              onAsk={onAsk}
              onAddToDraft={(text, pg) => addToDraft(text, pg)}
            />
          ) : (
            <div className="reader-surround flex h-full items-center justify-center p-6 text-center text-sm" style={{ color: "var(--r-ink-2)" }} role="status">
              {doc.status === "failed" ? "Bu PDF açılamadı." : "PDF hazırlanıyor…"}
            </div>
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
          <div onMouseDown={(e) => startResize("right", e)} onKeyDown={(e) => keyResize("right", e)} tabIndex={0}
               className="w-1.5 shrink-0 cursor-col-resize bg-transparent transition hover:bg-accent-purple/40 focus-visible:bg-accent-purple/40"
               role="separator" aria-orientation="vertical" aria-valuenow={rightW} aria-valuemin={320} aria-valuemax={760}
               aria-label="Sağ paneli yeniden boyutlandır (ok tuşları)" title="Sürükleyerek boyutlandır" />
        )}
        {isLg && showRight && (
          <aside style={{ width: rightW }} aria-label="Sohbet, anlatım ve notlar"
                 className={`flex shrink-0 flex-col border-l bg-surface ${focus ? "absolute right-0 top-0 z-30 h-full shadow-2xl" : ""}`}>
            <div className="flex border-b">{rightTabs}</div>
            {rightBody}
          </aside>
        )}
      </div>

      {/* DAR EKRAN: alt cubuk + alttan acilan tabakalar */}
      {!isLg && (
        <ReaderBottomBar page={page} numPages={numPages} setPage={setPage}
                         leftOpen={leftOpen} rightOpen={rightOpen}
                         onLeft={() => openLeft(!leftOpen)} onRight={() => openRight(!rightOpen)} />
      )}
      {!isLg && (
        <Modal open={leftOpen} onClose={() => setLeftOpen(false)} title={doc.title || "İçindekiler ve özet"} size="lg">
          {leftContent}
        </Modal>
      )}
      {!isLg && (
        <Modal open={rightOpen} onClose={() => setRightOpen(false)} ariaLabel="Sohbet, anlatım ve notlar" size="lg"
               className="h-[85dvh] p-0">
          <div className="flex shrink-0 items-stretch border-b">
            {rightTabs}
            <button type="button" onClick={() => setRightOpen(false)} aria-label="Paneli kapat"
                    className="flex w-12 shrink-0 items-center justify-center text-text-secondary hover:bg-surface-muted">
              <X size={20} aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{rightBody}</div>
        </Modal>
      )}

      {draftPicker}
      {editing && (
        <NoteEditor ann={editing} onClose={() => setEditing(null)}
                    onSave={(content, color) => { patch(editing.id, { note_content: content, ...(color ? { highlight_color: color } : {}) }); setEditing(null); }}
                    onDelete={() => { removeTracked(editing.id); setEditing(null); }} />
      )}
    </div>
  );
}

function NoteEditor({ ann, onClose, onSave, onDelete }: {
  ann: Annotation; onClose: () => void; onSave: (content: string, color?: string) => void; onDelete: () => void;
}) {
  const [text, setText] = useState(ann.note_content || "");
  const [color, setColor] = useState(ann.highlight_color || HIGHLIGHT_COLORS[0].value);
  const sticky = ann.anchor.type === "sticky";
  const save = () => onSave(text, !sticky ? color : undefined);
  return (
    <Modal open onClose={onClose} title={`${sticky ? "Kenar notu" : "Vurgu notu"} · s.${ann.page_number}`} size="md">
      {ann.selected_text && (
        <p className="mb-3 rounded-md px-2 py-1 text-sm text-[#1F1D1A]" style={{ background: ann.highlight_color || "#FFE78A" }}>{ann.selected_text}</p>
      )}
      {!sticky && (
        <div className="mb-3 flex items-center gap-0.5" role="group" aria-label="Vurgu rengi">
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c.key} type="button" aria-label={c.label} aria-pressed={color === c.value} onClick={() => setColor(c.value)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-muted">
              <span className={`h-6 w-6 rounded-full border ${color === c.value ? "ring-2 ring-accent-purple ring-offset-1" : "border-black/10"}`}
                    style={{ background: c.value }} />
            </button>
          ))}
        </div>
      )}
      <label htmlFor="note-editor-text" className="sr-only">Not metni</label>
      <textarea id="note-editor-text" data-autofocus value={text} onChange={(e) => setText(e.target.value)} rows={4}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
                placeholder="Notunu yaz…" className="w-full rounded-lg border bg-surface-muted p-3 text-sm outline-none focus:border-accent-purple" />
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onDelete} className="min-h-[44px] rounded-lg px-2 text-sm text-danger hover:bg-surface-muted">
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
