"use client";
/**
 * Otomatik kaynakça: defterdeki kaynakların künyesi (bir kez çıkarılır, saklanır) +
 * APA 7 / MLA 9 / Chicago biçimleri, düzenleme, kopyalama, .txt / .bib indirme.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Copy, Check, Download, Pencil, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";
import SourceIcon from "@/components/SourceIcon";
import { toast } from "@/components/Toast";

type Meta = { type: string; authors: string[]; year: string; title: string; container: string; publisher: string;
  volume: string; issue: string; pages: string; doi: string };
type Item = { document_id: string; file_title: string; kind: string; url?: string | null; accessed?: string | null; edited: boolean; meta: Meta };
type Seg = { t: string; i?: boolean };
type Style = "apa" | "mla" | "chicago";

const STYLES: [Style, string][] = [["apa", "APA 7"], ["mla", "MLA 9"], ["chicago", "Chicago"]];
const TYPES: [string, string][] = [["article", "Makale"], ["book", "Kitap"], ["chapter", "Kitap bölümü"], ["thesis", "Tez"],
  ["report", "Rapor"], ["web", "Web sayfası"], ["video", "Video"], ["other", "Diğer"]];

function dateTr(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}
function joinAuthors(a: string[], style: Style) {
  if (!a.length) return "";
  if (style === "apa") {
    if (a.length === 1) return a[0];
    if (a.length <= 20) return a.slice(0, -1).join(", ") + ", & " + a[a.length - 1];
    return a.slice(0, 19).join(", ") + ", … " + a[a.length - 1];
  }
  if (style === "mla") return a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} ve ${a[1]}` : `${a[0]} vd.`;
  return a.length === 1 ? a[0] : a.slice(0, -1).join(", ") + " ve " + a[a.length - 1];
}
const end = (s: string) => (/[.?!]$/.test(s.trim()) ? s.trim() : s.trim() + ".");

export function formatCite(it: Item, style: Style): Seg[] {
  const m = it.meta;
  const au = joinAuthors(m.authors || [], style);
  const doi = m.doi ? `https://doi.org/${m.doi}` : "";
  const link = doi || (it.kind === "youtube" || it.kind === "web" || it.kind === "html" ? it.url || "" : "");
  const isPart = ["article", "chapter"].includes(m.type) || (!!m.container && !["book", "thesis", "report"].includes(m.type) && it.kind !== "youtube");
  const out: Seg[] = [];
  const push = (t: string, i = false) => { if (t) out.push({ t, i }); };
  if (style === "apa") {
    const who = au || (it.kind === "web" ? m.container : "");
    const yr = `(${m.year || "t.y."}). `;
    if (who) push(end(who) + " " + yr); else push(yr);
    if (isPart) {
      push(end(m.title) + " ");
      if (m.container) { push(m.container, true); push(m.volume || m.issue || m.pages ? ", " : ""); }
      if (m.volume) push(m.volume, true);
      if (m.issue) push(`(${m.issue})`);
      if (m.pages) push(`${m.volume || m.issue ? ", " : ""}${m.pages}`);
      if (m.container || m.volume) push(". ");
    } else {
      push(m.title.replace(/\.$/, ""), true);
      push(it.kind === "youtube" ? " [Video]. " : m.type === "thesis" ? " [Tez]. " : ". ");
      if (it.kind === "youtube") push("YouTube. ");
      else if (m.publisher || m.container) push(end(m.publisher || m.container) + " ");
    }
    push(link);
  } else if (style === "mla") {
    if (au) push(end(au) + " ");
    if (isPart) { push(`"${end(m.title)}" `); if (m.container) push(m.container, true); push(", "); }
    else { push(m.title.replace(/\.$/, ""), true); push(". "); }
    const tail = [
      it.kind === "youtube" ? "YouTube" : (!isPart ? m.publisher || m.container : ""),
      m.volume ? `c. ${m.volume}` : "", m.issue ? `sy. ${m.issue}` : "", m.year, m.pages ? `ss. ${m.pages}` : "",
    ].filter(Boolean).join(", ");
    if (tail) push(end(tail) + " ");
    if (link) push(end(link.replace(/^https?:\/\//, "")) + " ");
    if (it.kind === "web" || it.kind === "youtube") push(`Erişim: ${dateTr(it.accessed)}.`);
  } else {
    if (au) push(end(au) + " ");
    push(`${m.year || "t.y."}. `);
    if (isPart) {
      push(`"${end(m.title)}" `);
      if (m.container) push(m.container, true);
      if (m.volume) push(` ${m.volume}`);
      if (m.issue) push(` (${m.issue})`);
      if (m.pages) push(`: ${m.pages}`);
      push(". ");
    } else {
      push(m.title.replace(/\.$/, ""), true); push(". ");
      if (m.publisher || m.container) push(end(m.publisher || m.container) + " ");
    }
    push(link);
  }
  return out;
}
const plain = (s: Seg[]) => s.map((x) => x.t).join("").replace(/\s+/g, " ").trim();
const sortKey = (it: Item) => ((it.meta.authors?.[0] || it.meta.title || "").toLocaleLowerCase("tr"));

function bibtex(items: Item[]) {
  return items.map((it, n) => {
    const m = it.meta;
    const key = ((m.authors?.[0] || "kaynak").split(/[ ,]/)[0].replace(/[^\p{L}]/gu, "") || "kaynak") + (m.year || "") + (n + 1);
    const t = m.type === "article" ? "article" : m.type === "book" ? "book" : m.type === "thesis" ? "phdthesis"
      : m.type === "chapter" ? "incollection" : m.type === "report" ? "techreport" : "misc";
    const f: [string, string][] = [["author", (m.authors || []).join(" and ")], ["title", m.title], ["year", m.year],
      [t === "article" ? "journal" : t === "incollection" ? "booktitle" : "howpublished", m.container], ["publisher", m.publisher],
      ["volume", m.volume], ["number", m.issue], ["pages", m.pages], ["doi", m.doi], ["url", it.url || ""]];
    return `@${t}{${key},\n` + f.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n") + "\n}";
  }).join("\n\n");
}

export default function Bibliography({ notebookId }: { notebookId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [style, setStyle] = useState<Style>("apa");
  const [edit, setEdit] = useState<Item | null>(null);
  const [copied, setCopied] = useState(false);

  async function load(refresh = false) {
    setBusy(true); setErr("");
    try { const r = await api(`/collections/${notebookId}/bibliography${refresh ? "?refresh=1" : ""}`, {}, 1); setItems(r.items || []); }
    catch (e: any) { setErr(e?.message || "Kaynakça hazırlanamadı."); if (!items) setItems([]); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    try { const s = localStorage.getItem("bib.style"); if (s === "apa" || s === "mla" || s === "chicago") setStyle(s); } catch {}
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);
  useEffect(() => { try { localStorage.setItem("bib.style", style); } catch {} }, [style]);

  const sorted = useMemo(() => [...(items || [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b), "tr")), [items]);
  const text = useMemo(() => sorted.map((it) => plain(formatCite(it, style))).join("\n\n"), [sorted, style]);

  function dl(name: string, body: string, type: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  async function saveEdit(m: Meta) {
    if (!edit) return;
    try {
      const r = await api(`/documents/${edit.document_id}/cite`, { method: "PUT", body: JSON.stringify({ meta: m }) });
      setItems((l) => (l || []).map((x) => x.document_id === edit.document_id ? { ...x, meta: r.meta, edited: true } : x));
      setEdit(null); toast("Künye kaydedildi");
    } catch (e: any) { toast.error(e?.message || "Kaydedilemedi"); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-full bg-surface-muted p-0.5">
          {STYLES.map(([k, l]) => (
            <button key={k} onClick={() => setStyle(k)}
                    className={"rounded-full px-3 py-1 text-sm " + (style === k ? "bg-surface font-medium shadow-soft" : "text-text-secondary")}>{l}</button>
          ))}
        </div>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}
                  disabled={!sorted.length}
                  className="flex items-center gap-1.5 rounded-lg border bg-surface px-3 py-1.5 text-sm hover:border-accent-purple/50 disabled:opacity-50">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Kopyalandı" : "Tümünü kopyala"}
          </button>
          <button onClick={() => dl("kaynakca.txt", text, "text/plain")} disabled={!sorted.length}
                  className="flex items-center gap-1.5 rounded-lg border bg-surface px-3 py-1.5 text-sm hover:border-accent-purple/50 disabled:opacity-50">
            <Download size={14} /> .txt
          </button>
          <button onClick={() => dl("kaynakca.bib", bibtex(sorted), "application/x-bibtex")} disabled={!sorted.length}
                  className="flex items-center gap-1.5 rounded-lg border bg-surface px-3 py-1.5 text-sm hover:border-accent-purple/50 disabled:opacity-50">
            <Download size={14} /> BibTeX
          </button>
          <button onClick={() => load(true)} disabled={busy} title="Düzenlemediğin künyeleri yeniden çıkar (kota harcar)"
                  className="flex items-center gap-1.5 rounded-lg border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-accent-purple/50 disabled:opacity-50">
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Yenile
          </button>
        </span>
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        Künyeler kaynakların ilk sayfasından bir kez çıkarılır ve saklanır; eksik ya da yanlış olanı kalemle düzelt. Yazar adına göre sıralı.
      </p>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      {items === null || (busy && !items.length) ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" /> Künyeler hazırlanıyor… (ilk seferde birkaç saniye)</p>
      ) : !sorted.length ? (
        <p className="mt-6 text-sm text-text-secondary">Hazır kaynak yok.</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {sorted.map((it) => {
            const segs = formatCite(it, style);
            const missing = !it.meta.authors?.length || !it.meta.year;
            return (
              <li key={it.document_id} className="group flex items-start gap-3 rounded-xl border bg-surface px-4 py-3">
                <SourceIcon kind={it.kind} size={16} className="mt-1" />
                <p className="min-w-0 flex-1 font-heading text-[15px] leading-7 [overflow-wrap:anywhere]" style={{ paddingLeft: "1.5em", textIndent: "-1.5em" }}>
                  {segs.map((s, i) => s.i ? <i key={i}>{s.t}</i> : <span key={i}>{s.t}</span>)}
                  {missing && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle font-body text-[10px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">eksik bilgi</span>}
                </p>
                <button onClick={() => setEdit(it)} aria-label="Künyeyi düzenle" title="Künyeyi düzenle"
                        className="shrink-0 rounded-md p-1.5 text-text-secondary hover:bg-surface-muted hover:text-accent-purple">
                  <Pencil size={14} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {edit && <CiteEditor item={edit} onClose={() => setEdit(null)} onSave={saveEdit} />}
    </div>
  );
}

function CiteEditor({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (m: Meta) => void }) {
  const [m, setM] = useState<Meta>({ ...item.meta, authors: [...(item.meta.authors || [])] });
  const [au, setAu] = useState((item.meta.authors || []).join("; "));
  const f = (k: keyof Meta, label: string, ph = "", cls = "") => (
    <label className={"block text-xs text-text-secondary " + cls}>{label}
      <input value={(m[k] as string) || ""} placeholder={ph} onChange={(e) => setM({ ...m, [k]: e.target.value })}
             className="mt-1 w-full rounded-lg border bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent-purple" />
    </label>
  );
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Künyeyi düzenle"
           className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-surface p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-lg">Künyeyi düzenle</h3>
          <button onClick={onClose} aria-label="Kapat" className="rounded-md p-1 hover:bg-surface-muted"><X size={18} /></button>
        </div>
        <p className="mb-3 truncate text-xs text-text-secondary">Dosya: {item.file_title}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-xs text-text-secondary">Tür
            <select value={m.type} onChange={(e) => setM({ ...m, type: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-surface px-2.5 py-1.5 text-sm text-text-primary">
              {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="col-span-2 block text-xs text-text-secondary">Yazarlar (noktalı virgülle ayır)
            <input value={au} onChange={(e) => setAu(e.target.value)} placeholder="Yılmaz, A.; Demir, B. C."
                   className="mt-1 w-full rounded-lg border bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent-purple" />
          </label>
          {f("title", "Başlık", "", "col-span-2")}
          {f("container", "Dergi / kitap / site", "", "col-span-2")}
          {f("year", "Yıl", "2024")}
          {f("publisher", "Yayınevi / kurum")}
          {f("volume", "Cilt")}
          {f("issue", "Sayı")}
          {f("pages", "Sayfalar", "12-34")}
          {f("doi", "DOI", "10.1000/xyz")}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-surface-muted">Vazgeç</button>
          <button onClick={() => onSave({ ...m, authors: au.split(";").map((x) => x.trim()).filter(Boolean) })}
                  className="rounded-lg bg-accent-purple px-4 py-2 text-sm text-white">Kaydet</button>
        </div>
      </div>
    </div>
  );
}
