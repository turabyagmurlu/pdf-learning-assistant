"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { exportMarkdown, Annotation, HIGHLIGHT_COLORS } from "@/lib/reader";
import { useAnnotations } from "@/hooks/useAnnotations";
import ReaderToolbar from "@/components/reader/ReaderToolbar";
import NotesPanel from "@/components/reader/NotesPanel";
import ExplainPanel from "@/components/reader/ExplainPanel";
import ConnectionsPanel from "@/components/reader/ConnectionsPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import VideoReader from "@/components/reader/VideoReader";
import TextReader from "@/components/reader/TextReader";
import { X, Sparkles, StickyNote, Volume2, Link2 } from "lucide-react";

// react-pdf must be client-only (no SSR)
const PdfReader = dynamic(() => import("@/components/reader/PdfReader"), { ssr: false });

type Theme = "light" | "sepia" | "dark";
function toArr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

export default function DocumentPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [doc, setDoc] = useState<any>(null);
  const [fileUrl, setFileUrl] = useState<string>("");

  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [spread, setSpread] = useState(false);
  const [tool, setTool] = useState<"none" | "highlight" | "note">("none");

  const [theme, setTheme] = useState<Theme>("light");
  const [focus, setFocus] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<"ai" | "notes" | "explain" | "links">("ai");
  const [peek, setPeek] = useState<"left" | "right" | null>(null);
  const [restored, setRestored] = useState(false);
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [rightW, setRightW] = useState(420);
  const [leftW, setLeftW] = useState(288);

  const { annotations, add, patch, remove } = useAnnotations(id);
  // icindekiler: tiklaninca maddenin gectigi sayfayi bul (0 kota), sonucu hatirla
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
    if (pg) setPage(pg); else say("Bu başlığın sayfası bulunamadı");
  }

  // geri al / yinele (vurgu ve not ekleme-silme; ustune vurgulamada degistirme tek adim)
  type HistOp = { kind: "add"; ann: Annotation } | { kind: "remove"; ann: Annotation } | { kind: "group"; ops: HistOp[] };
  const undoRef = useRef<HistOp[]>([]);
  const redoRef = useRef<HistOp[]>([]);
  const [histTick, setHistTick] = useState(0);
  const [toast, setToast] = useState("");
  function say(m: string) { setToast(m); setTimeout(() => setToast(""), 1600); }
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
  async function removeTracked(id: string) {
    const a = annotations.find((x) => x.id === id);
    await remove(id);
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

  // persisted reader prefs
  useEffect(() => {
    try {
      const t = localStorage.getItem("reader.theme") as Theme | null;
      if (t) setTheme(t);
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

  useEffect(() => {
    let alive = true;
    let fileLoaded = false;
    async function load() {
      try {
        const d = await api(`/documents/${id}`); if (alive) setDoc(d);
        if (!fileLoaded) try { const f = await api(`/documents/${id}/file`); if (alive) { setFileUrl(f.url); fileLoaded = true; } } catch {}
      } catch {}
    }
    load();
    const t = setInterval(async () => {
      try { const s = await api(`/documents/${id}/status`); if (s.status === "ready" || s.status === "failed") { clearInterval(t); load(); } } catch {}
    }, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [id]);

  // keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y")) { e.preventDefault(); redo(); return; }
      if (mod) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { setPage((p) => Math.min(numPages || p, p + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { setPage((p) => Math.max(1, p - 1)); }
      else if (e.key === "f") setFocus((f) => !f);
      else if (e.key === "Escape") { setFocus(false); setEditing(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [numPages, annotations]);

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

  // kitap modunda: ekran kenarina gelince paneli gecici goster
  useEffect(() => {
    if (!focus) { setPeek(null); return; }
    const onMove = (e: MouseEvent) => {
      const w = document.documentElement.clientWidth || window.innerWidth;
      if (e.clientX <= 32) setPeek("left");
      else if (e.clientX >= w - 32) setPeek("right");
      else if (e.clientX > leftW + 40 && e.clientX < w - rightW - 40) setPeek(null);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [focus, leftW, rightW]);

  // acik sayfanin metnini DOM'dan al (pdf.js text layer)
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
    }
    if (created && h.openNote) { setEditing(created); setRightOpen(true); setRightTab("notes"); }
  }
  async function onCreateSticky(s: { page: number; x: number; y: number }) {
    const created = await add({ page_number: s.page, selected_text: null, note_content: "", highlight_color: null, anchor: { type: "sticky", x: s.x, y: s.y } });
    if (created) { pushHist({ kind: "add", ann: created }); setEditing(created); setRightOpen(true); setRightTab("notes"); }
    setTool("none");
  }
  function onExport() {
    const md = exportMarkdown(doc?.title || "Belge", annotations);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${doc?.title || "notlar"}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  if (!doc) return <div className="p-8 text-text-secondary">Yükleniyor…</div>;
  if (doc.source_type === "youtube" || doc.source_type === "audio") return <VideoReader id={id} doc={doc} />;
  if (doc.source_type && doc.source_type !== "pdf") return <TextReader id={id} doc={doc} />;

  function startResize(side: "left" | "right", e: any) {
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

  return (
    <div className="reader-root flex h-screen flex-col" data-theme={theme}>
      {/* top toolbar */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2">
        <ReaderToolbar
          page={page} numPages={numPages} setPage={setPage}
          scale={scale} setScale={setScale} spread={spread} setSpread={setSpread}
          tool={tool} setTool={setTool} theme={theme} setTheme={setTheme}
          focus={focus} setFocus={setFocus}
          leftOpen={leftOpen} setLeftOpen={setLeftOpen} rightOpen={rightOpen} setRightOpen={setRightOpen}
          onExport={onExport}
          onUndo={undo} onRedo={redo}
          canUndo={histTick >= 0 && undoRef.current.length > 0} canRedo={histTick >= 0 && redoRef.current.length > 0}
        />
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {/* kitap modu: kenar tutamaklari (uzerine gelince panel belirir) */}
        {focus && leftOpen && !showLeft && (
          <button onMouseEnter={() => setPeek("left")} onClick={() => setPeek("left")}
                  aria-label="Sol paneli göster"
                  className="absolute left-0 top-1/2 z-20 h-32 w-4 -translate-y-1/2 rounded-r-full bg-accent-purple/25 transition hover:w-3 hover:bg-accent-purple/60" />
        )}
        {focus && rightOpen && !showRight && (
          <button onMouseEnter={() => setPeek("right")} onClick={() => setPeek("right")}
                  aria-label="Sağ paneli göster"
                  className="absolute right-0 top-1/2 z-20 h-32 w-4 -translate-y-1/2 rounded-l-full bg-accent-purple/25 transition hover:w-3 hover:bg-accent-purple/60" />
        )}
        {/* LEFT study panel */}
        {showLeft && (
          <aside style={{ width: leftW }}
                 className={`shrink-0 overflow-auto border-r bg-surface p-4 ${focus ? "absolute left-0 top-0 z-30 h-full shadow-2xl" : ""}`}>
            <h2 className="font-heading text-lg mb-1 leading-tight">{doc.title}</h2>
            {doc.status !== "ready" ? (
              <p className="text-sm text-text-secondary">{doc.status === "failed" ? `⚠️ ${doc.error_message}` : `İşleniyor… ${doc.processing_stage || ""}`}</p>
            ) : (
              <>
                {doc.short_summary && <p className="mt-2 text-sm leading-relaxed text-text-secondary">{doc.short_summary}</p>}
                {toArr(doc.outline).length > 0 && (
                  <div className="mt-5">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">İçindekiler</p>
                    <ul className="space-y-0.5 text-sm">
                      {(() => {
                        const items = toArr(doc.outline).map((o) => (typeof o === "string" ? o : (o?.title || "")));
                        // su an okunan bolum: bulunmus sayfalar icinde page'e en yakin olan (<= page)
                        let cur = -1, best = 0;
                        items.forEach((_, i) => { const pg = tocPages[i]; if (pg && pg <= page && pg >= best) { best = pg; cur = i; } });
                        return items.map((t, i) => (
                          <li key={i}>
                            <button onClick={() => jumpToc(i, t)}
                                    className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-muted ${i === cur ? "bg-accent-purple/10 text-accent-purple" : "text-text-secondary"}`}>
                              <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${i === cur ? "bg-accent-purple" : "bg-border"}`} />
                              <span className="min-w-0 flex-1">{t}</span>
                              {tocPages[i] ? <span className="shrink-0 text-[11px] opacity-70">s.{tocPages[i]}</span>
                                : tocPages[i] === 0 ? <span className="shrink-0 text-[11px] opacity-50">—</span> : null}
                            </button>
                          </li>
                        ));
                      })()}
                    </ul>
                  </div>
                )}
                {toArr(doc.key_concepts).length > 0 && (
                  <div className="mt-5">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">Anahtar kavramlar</p>
                    <div className="flex flex-wrap gap-1.5">
                      {toArr(doc.key_concepts).map((k, i) => (
                        <span key={i} title={k?.definition || ""} className="rounded-full bg-accent-amber/15 px-2.5 py-0.5 text-xs text-accent-amber">
                          {typeof k === "string" ? k : (k?.term || "")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </aside>
        )}
        {showLeft && !focus && (
          <div onMouseDown={(e) => startResize("left", e)} className="w-1.5 shrink-0 cursor-col-resize bg-transparent transition hover:bg-accent-purple/40" role="separator" aria-label="Sol paneli yeniden boyutlandır" title="Sürükleyerek boyutlandır" />
        )}

        {/* CENTER reader */}
        <main className="relative flex-1 overflow-hidden"
              onPointerDown={() => { if (focus && peek) setPeek(null); }}>
          {fileUrl ? (
          <PdfReader
            fileUrl={fileUrl} page={page} scale={scale} spread={spread} tool={tool}
            annotations={annotations}
            onNumPages={setNumPages} onVisiblePage={setPage}
            onCreateHighlight={onCreateHighlight} onCreateSticky={onCreateSticky}
            onSelectAnnotation={(a) => { setEditing(a); setRightOpen(true); setRightTab("notes"); }}
          />
          ) : (
            <div className="reader-surround flex h-full items-center justify-center text-sm" style={{ color: "var(--r-ink-2)" }}>PDF hazırlanıyor…</div>
          )}
          {/* reading progress */}
          <div className="pointer-events-none absolute bottom-0 left-0 h-1 bg-accent-purple/70 transition-all" style={{ width: `${progress}%` }} />
          {numPages > 0 && (
            <div className="pointer-events-none absolute bottom-3 right-4 rounded-full bg-black/55 px-2.5 py-1 text-xs text-white">
              s.{page} / {numPages} · %{progress}
            </div>
          )}
          {toast && (
            <div className="fade-in absolute bottom-10 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-text-primary px-4 py-2 text-sm text-background shadow-lg">
              {toast}
            </div>
          )}
        </main>

        {/* RIGHT learning/notes panel */}
        {showRight && !focus && (
          <div onMouseDown={(e) => startResize("right", e)} className="w-1.5 shrink-0 cursor-col-resize bg-transparent transition hover:bg-accent-purple/40" role="separator" aria-label="Sohbet panelini yeniden boyutlandır" title="Sürükleyerek boyutlandır" />
        )}
        {showRight && (
          <aside style={{ width: rightW }}
                 className={`flex shrink-0 flex-col border-l bg-surface ${focus ? "absolute right-0 top-0 z-30 h-full shadow-2xl" : ""}`}>
            <div className="flex border-b">
              <button onClick={() => setRightTab("ai")} title="AI Asistan"
                      className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm ${rightTab === "ai" ? "border-b-2 border-accent-purple text-accent-purple" : "text-text-secondary"}`}>
                <Sparkles size={15} /> Sohbet
              </button>
              <button onClick={() => setRightTab("explain")} title="Bu sayfayı anlat ve sesli oku"
                      className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm ${rightTab === "explain" ? "border-b-2 border-accent-purple text-accent-purple" : "text-text-secondary"}`}>
                <Volume2 size={15} /> Anlat
              </button>
              <button onClick={() => setRightTab("links")} title="Bu sayfayla bağlantılı diğer belgeler"
                      className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm ${rightTab === "links" ? "border-b-2 border-accent-purple text-accent-purple" : "text-text-secondary"}`}>
                <Link2 size={15} /> Bağlantı
              </button>
              <button onClick={() => setRightTab("notes")} title="Notlar"
                      className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm ${rightTab === "notes" ? "border-b-2 border-accent-purple text-accent-purple" : "text-text-secondary"}`}>
                <StickyNote size={15} /> Notlar {annotations.length > 0 && <span className="rounded-full bg-accent-purple/15 px-1.5 text-xs text-accent-purple">{annotations.length}</span>}
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {rightTab === "ai" ? (
                <ChatPanel documentId={id} onGoPage={(pg) => setPage(Math.max(1, Math.min(numPages || pg, pg)))} />
              ) : rightTab === "explain" ? (
                <ExplainPanel documentId={id} page={page} getPageText={getPageText} />
              ) : rightTab === "links" ? (
                <ConnectionsPanel documentId={id} page={page}
                                  onOpen={(docId) => { window.location.href = "/documents/" + docId; }} />
              ) : (
                <NotesPanel docTitle={doc?.title} annotations={annotations}
                            onJump={(a) => setPage(a.page_number)}
                            onDelete={removeTracked}
                            onEditNote={(a) => setEditing(a)} />
              )}
            </div>
          </aside>
        )}
      </div>

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
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Not düzenleyici" className="w-full max-w-md rounded-2xl border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-heading text-lg">{ann.anchor.type === "sticky" ? "Kenar notu" : "Highlight notu"} · s.{ann.page_number}</h3>
          <button onClick={onClose} aria-label="Kapat" className="rounded-md p-1 hover:bg-black/5"><X size={16} /></button>
        </div>
        {ann.selected_text && (
          <p className="mb-3 rounded-md px-2 py-1 text-sm" style={{ background: ann.highlight_color || "#FFE78A" }}>{ann.selected_text}</p>
        )}
        {ann.anchor.type !== "sticky" && (
          <div className="mb-3 flex items-center gap-1.5">
            {HIGHLIGHT_COLORS.map((c) => (
              <button key={c.key} aria-label={c.label} onClick={() => setColor(c.value)}
                      className={`h-6 w-6 rounded-full border ${color === c.value ? "ring-2 ring-accent-purple ring-offset-1" : "border-black/10"}`}
                      style={{ background: c.value }} />
            ))}
          </div>
        )}
        <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={4}
                  placeholder="Notunu yaz…" className="w-full rounded-lg border bg-surface-muted p-3 text-sm outline-none focus:border-accent-purple" />
        <div className="mt-3 flex items-center justify-between">
          <button onClick={onDelete} className="text-sm text-danger">Sil</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-black/5">Vazgeç</button>
            <button onClick={() => onSave(text, ann.anchor.type !== "sticky" ? color : undefined)}
                    className="rounded-lg bg-accent-purple px-4 py-1.5 text-sm text-white">Kaydet</button>
          </div>
        </div>
      </div>
    </div>
  );
}
