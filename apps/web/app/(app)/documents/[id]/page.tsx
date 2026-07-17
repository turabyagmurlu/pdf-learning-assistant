"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { exportMarkdown, Annotation, HIGHLIGHT_COLORS } from "@/lib/reader";
import { useAnnotations } from "@/hooks/useAnnotations";
import ReaderToolbar from "@/components/reader/ReaderToolbar";
import NotesPanel from "@/components/reader/NotesPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { X, Sparkles, StickyNote } from "lucide-react";

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
  const [rightTab, setRightTab] = useState<"ai" | "notes">("ai");
  const [editing, setEditing] = useState<Annotation | null>(null);

  const { annotations, add, patch, remove } = useAnnotations(id);

  // persisted reader prefs
  useEffect(() => {
    try {
      const t = localStorage.getItem("reader.theme") as Theme | null;
      if (t) setTheme(t);
      const sp = localStorage.getItem("reader.spread");
      if (sp) setSpread(sp === "1");
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("reader.theme", theme); } catch {} }, [theme]);
  useEffect(() => { try { localStorage.setItem("reader.spread", spread ? "1" : "0"); } catch {} }, [spread]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const d = await api(`/documents/${id}`); if (alive) setDoc(d);
        try { const f = await api(`/documents/${id}/file`); if (alive) setFileUrl(f.url); } catch {}
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
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { setPage((p) => Math.min(numPages || p, p + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { setPage((p) => Math.max(1, p - 1)); }
      else if (e.key === "f") setFocus((f) => !f);
      else if (e.key === "Escape") { setFocus(false); setEditing(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [numPages]);

  const progress = numPages ? Math.round((page / numPages) * 100) : 0;

  async function onCreateHighlight(h: { page: number; rects: any[]; text: string; color: string; openNote?: boolean }) {
    const created = await add({ page_number: h.page, selected_text: h.text, note_content: "", highlight_color: h.color, anchor: { type: "highlight", rects: h.rects } });
    if (created && h.openNote) { setEditing(created); setRightOpen(true); setRightTab("notes"); }
  }
  async function onCreateSticky(s: { page: number; x: number; y: number }) {
    const created = await add({ page_number: s.page, selected_text: null, note_content: "", highlight_color: null, anchor: { type: "sticky", x: s.x, y: s.y } });
    if (created) { setEditing(created); setRightOpen(true); setRightTab("notes"); }
    setTool("none");
  }
  function onExport() {
    const md = exportMarkdown(doc?.title || "Belge", annotations);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${doc?.title || "notlar"}.md`; a.click();
  }

  if (!doc) return <div className="p-8 text-text-secondary">Yükleniyor…</div>;

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
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT study panel */}
        {!focus && leftOpen && (
          <aside className="w-72 shrink-0 overflow-auto border-r bg-surface p-4">
            <h2 className="font-heading text-lg mb-1 leading-tight">{doc.title}</h2>
            {doc.status !== "ready" ? (
              <p className="text-sm text-text-secondary">{doc.status === "failed" ? `⚠️ ${doc.error_message}` : `İşleniyor… ${doc.processing_stage || ""}`}</p>
            ) : (
              <>
                {doc.short_summary && <p className="mt-2 text-sm leading-relaxed text-text-secondary">{doc.short_summary}</p>}
                {toArr(doc.outline).length > 0 && (
                  <div className="mt-5">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">İçindekiler</p>
                    <ul className="space-y-1 text-sm">
                      {toArr(doc.outline).map((o, i) => <li key={i} className="text-text-secondary">{typeof o === "string" ? o : (o?.title || "")}</li>)}
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

        {/* CENTER reader */}
        <main className="relative flex-1 overflow-hidden">
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
        </main>

        {/* RIGHT learning/notes panel */}
        {!focus && rightOpen && (
          <aside className="flex w-[400px] shrink-0 flex-col border-l bg-surface">
            <div className="flex border-b">
              <button onClick={() => setRightTab("ai")}
                      className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm ${rightTab === "ai" ? "border-b-2 border-accent-purple text-accent-purple" : "text-text-secondary"}`}>
                <Sparkles size={15} /> AI Asistan
              </button>
              <button onClick={() => setRightTab("notes")}
                      className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm ${rightTab === "notes" ? "border-b-2 border-accent-purple text-accent-purple" : "text-text-secondary"}`}>
                <StickyNote size={15} /> Notlar {annotations.length > 0 && <span className="rounded-full bg-accent-purple/15 px-1.5 text-xs text-accent-purple">{annotations.length}</span>}
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {rightTab === "ai" ? (
                <ChatPanel documentId={id} />
              ) : (
                <NotesPanel annotations={annotations}
                            onJump={(a) => setPage(a.page_number)}
                            onDelete={remove}
                            onEditNote={(a) => setEditing(a)} />
              )}
            </div>
          </aside>
        )}
      </div>

      {editing && (
        <NoteEditor ann={editing} onClose={() => setEditing(null)}
                    onSave={(content, color) => { patch(editing.id, { note_content: content, ...(color ? { highlight_color: color } : {}) }); setEditing(null); }}
                    onDelete={() => { remove(editing.id); setEditing(null); }} />
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
      <div className="w-full max-w-md rounded-2xl border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
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
