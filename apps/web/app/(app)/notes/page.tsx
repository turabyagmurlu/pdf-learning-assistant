"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Highlighter, Search, Trash2, Pencil, Check, GraduationCap, FileText, StickyNote, ExternalLink, Quote, Download } from "lucide-react";

type Note = {
  id: string; document_id: string; document_title: string; page_number: number | null;
  selected_text: string | null; note_content: string | null; highlight_color: string | null;
  anchor: any; created_at: string;
};
const cx = (...a: any[]) => a.filter(Boolean).join(" ");

export default function NotesPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [q, setQ] = useState("");
  const [doc, setDoc] = useState("");
  const [onlyCommented, setOnlyCommented] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");

  async function load() { try { setNotes(await api("/notes")); } catch { setNotes([]); } }
  useEffect(() => { load(); }, []);

  const docs = useMemo(() => {
    const m = new Map<string, { id: string; title: string; n: number }>();
    for (const n of notes || []) {
      const e = m.get(n.document_id) || { id: n.document_id, title: n.document_title, n: 0 };
      e.n++; m.set(n.document_id, e);
    }
    return [...m.values()].sort((a, b) => a.title.localeCompare(b.title, "tr"));
  }, [notes]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (notes || [])
      .filter((n) => !doc || n.document_id === doc)
      .filter((n) => !onlyCommented || (n.note_content || "").trim())
      .filter((n) => !s || (n.selected_text || "").toLowerCase().includes(s) || (n.note_content || "").toLowerCase().includes(s));
  }, [notes, q, doc, onlyCommented]);

  const grouped = useMemo(() => {
    const g: Record<string, Note[]> = {};
    for (const n of list) (g[n.document_id] ||= []).push(n);
    return g;
  }, [list]);

  async function save(id: string) {
    const t = draft.trim();
    setNotes((ns) => (ns || []).map((n) => (n.id === id ? { ...n, note_content: t } : n)));
    setEditing(null);
    try { await api("/notes/" + id, { method: "PATCH", body: JSON.stringify({ note_content: t }) }); } catch { load(); }
  }
  async function remove(id: string) {
    if (!window.confirm("Bu vurguyu silmek istiyor musun?")) return;
    setNotes((ns) => (ns || []).filter((n) => n.id !== id));
    try { await api("/notes/" + id, { method: "DELETE" }); } catch { load(); }
  }
  async function toCard(n: Note) {
    const answer = (n.selected_text || "").trim();
    const comment = (n.note_content || "").trim();
    if (!answer && !comment) return;
    // yorum varsa soru = yorum, cevap = pasaj; yoksa pasajı açıklatan kart
    const question = comment ? comment : "Bu pasaj neyi anlatıyor? (s." + (n.page_number || "?") + ")";
    const ans = answer || comment;
    try {
      await api("/study/items", { method: "POST", body: JSON.stringify({
        document_id: n.document_id, question, answer: ans, source_page: n.page_number,
      }) });
      setMsg("Kart eklendi → Öğrenme sayfasında."); setTimeout(() => setMsg(""), 2500);
    } catch (e: any) { setMsg(e?.message || "Kart eklenemedi."); }
  }
  function open(n: Note) {
    router.push("/documents/" + n.document_id + (n.page_number ? "?page=" + n.page_number : ""));
  }
  function citation(n: Note) {
    const pg = n.page_number ? `, s. ${n.page_number}` : "";
    return `"${(n.selected_text || "").trim()}" (${n.document_title}${pg})`;
  }
  async function copyQuote(n: Note) {
    try { await navigator.clipboard.writeText(citation(n)); setMsg("Alıntı kopyalandı (kaynak ve sayfa ile)."); }
    catch { setMsg("Kopyalanamadı."); }
    setTimeout(() => setMsg(""), 2000);
  }
  function exportMarkdown() {
    const groups: Record<string, Note[]> = {};
    for (const n of list) (groups[n.document_id] ||= []).push(n);
    const lines: string[] = [`# Vurgular — ${new Date().toLocaleDateString("tr-TR")}`, ""];
    for (const items of Object.values(groups)) {
      lines.push(`## ${items[0].document_title}`, "");
      for (const n of items) {
        const pg = n.page_number ? ` — s. ${n.page_number}` : "";
        if (n.selected_text) lines.push(`> ${n.selected_text.trim().replace(/\n+/g, " ")}${pg}`);
        if (n.note_content) lines.push(`>`, `> **Not:** ${n.note_content.trim()}`);
        lines.push("");
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "vurgular.md"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const total = notes?.length || 0;
  const commented = (notes || []).filter((n) => (n.note_content || "").trim()).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 md:px-6 md:py-8">
      <PageHeader eyebrow="Okurken" title="Vurgular"
                  subtitle="İşaretlediğin pasajlar ve notların, tek yerde. Tıkla → PDF o sayfada açılır." />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Vurgu" value={total} />
        <Stat label="Yorumlu" value={commented} />
        <Stat label="Belge" value={docs.length} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border bg-surface px-3">
          <Search size={15} className="text-text-secondary" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pasajda ya da notta ara…"
                 className="w-full bg-transparent py-2 text-sm outline-none" />
        </div>
        <select value={doc} onChange={(e) => setDoc(e.target.value)} className="rounded-xl border bg-surface px-3 py-2 text-sm">
          <option value="">Tüm belgeler</option>
          {docs.map((d) => <option key={d.id} value={d.id}>{d.title} ({d.n})</option>)}
        </select>
        <button onClick={() => setOnlyCommented((v) => !v)} aria-pressed={onlyCommented}
                className={cx("rounded-xl border px-3 py-2 text-sm", onlyCommented ? "border-accent-purple text-accent-purple" : "bg-surface text-text-secondary")}>
          Sadece yorumlu
        </button>
        <button onClick={exportMarkdown} disabled={list.length === 0} title="Görünen vurguları Markdown dosyası olarak indir"
                className="flex items-center gap-1.5 rounded-xl border bg-surface px-3 py-2 text-sm text-text-secondary hover:border-accent-purple/50 disabled:opacity-50">
          <Download size={15} /> Dışa aktar
        </button>
      </div>
      {msg && <p className="mt-3 text-sm text-accent-purple">{msg}</p>}

      {notes === null ? (
        <p className="mt-8 text-sm text-text-secondary">Yükleniyor…</p>
      ) : list.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed p-10 text-center">
          <Highlighter size={26} className="mx-auto text-accent-purple" />
          <p className="mt-3 text-sm text-text-secondary">
            {total === 0
              ? "Henüz vurgu yok. Bir PDF aç, metni seç, renk ver; istersen yorum yaz — hepsi burada toplanır."
              : "Filtreyle eşleşen vurgu yok."}
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-7">
          {Object.entries(grouped).map(([docId, items]) => (
            <section key={docId}>
              <div className="mb-2 flex items-center justify-between">
                <button onClick={() => router.push("/documents/" + docId)}
                        className="flex items-center gap-2 font-medium hover:text-accent-purple">
                  <FileText size={16} className="text-accent-purple" /> {items[0].document_title}
                  <span className="text-xs text-text-secondary">· {items.length}</span>
                </button>
              </div>
              <div className="space-y-2">
                {items.map((n) => {
                  const sticky = n.anchor?.type === "sticky";
                  return (
                    <div key={n.id} className="group rounded-xl border bg-surface p-3">
                      <div className="flex items-start gap-3">
                        <button onClick={() => open(n)} title={"s." + (n.page_number || "?") + " — aç"}
                                className="mt-0.5 shrink-0 rounded-md bg-surface-muted px-2 py-1 text-xs text-text-secondary hover:bg-accent-purple/10 hover:text-accent-purple">
                          s.{n.page_number ?? "?"}
                        </button>
                        <div className="min-w-0 flex-1">
                          {sticky ? (
                            <div className="flex items-center gap-1.5 text-xs text-text-secondary"><StickyNote size={13} /> yapışkan not</div>
                          ) : n.selected_text ? (
                            <p onClick={() => open(n)} className="cursor-pointer rounded-md px-2 py-1 text-sm leading-relaxed text-[#1b1a17]"
                               style={{ background: n.highlight_color || "#FFE78A" }}>{n.selected_text}</p>
                          ) : null}
                          {editing === n.id ? (
                            <div className="mt-2 flex items-start gap-2">
                              <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                                        onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(n.id); }}
                                        placeholder="Yorumun…" className="w-full rounded-lg border bg-surface-muted px-3 py-2 text-sm outline-none focus:border-accent-purple" />
                              <button onClick={() => save(n.id)} aria-label="Kaydet" className="rounded-lg bg-accent-purple p-2 text-white"><Check size={14} /></button>
                            </div>
                          ) : n.note_content ? (
                            <p onClick={() => { setEditing(n.id); setDraft(n.note_content || ""); }}
                               className="mt-1.5 cursor-text text-sm text-text-primary">{n.note_content}</p>
                          ) : (
                            <button onClick={() => { setEditing(n.id); setDraft(""); }}
                                    className="mt-1.5 text-xs text-text-secondary hover:text-accent-purple">+ yorum ekle</button>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                          {n.selected_text && (
                            <button onClick={() => copyQuote(n)} title="Alıntıyı kopyala (kaynak + sayfa)" aria-label="Alıntıyı kopyala"
                                    className="rounded-md p-1.5 text-text-secondary hover:bg-surface-muted hover:text-accent-purple"><Quote size={15} /></button>
                          )}
                          <button onClick={() => toCard(n)} title="Karta çevir" aria-label="Karta çevir"
                                  className="rounded-md p-1.5 text-text-secondary hover:bg-surface-muted hover:text-accent-purple"><GraduationCap size={15} /></button>
                          <button onClick={() => { setEditing(n.id); setDraft(n.note_content || ""); }} title="Yorumu düzenle" aria-label="Düzenle"
                                  className="rounded-md p-1.5 text-text-secondary hover:bg-surface-muted"><Pencil size={15} /></button>
                          <button onClick={() => open(n)} title="PDF'te aç" aria-label="PDF'te aç"
                                  className="rounded-md p-1.5 text-text-secondary hover:bg-surface-muted"><ExternalLink size={15} /></button>
                          <button onClick={() => remove(n.id)} title="Sil" aria-label="Sil"
                                  className="rounded-md p-1.5 text-text-secondary hover:bg-surface-muted hover:text-danger"><Trash2 size={15} /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border bg-surface p-4">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
