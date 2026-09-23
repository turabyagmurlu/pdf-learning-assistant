"use client";
/**
 * PDF ve video disi kaynaklar icin okuyucu (Word, Excel/CSV, sunum, Markdown,
 * web sayfasi, yapistirilan metin, e-kitap). Solda bolum listesi, ortada metin
 * ya da tablo, sagda kaynakli sohbet. Atif "sayfa"si = bolum / slayt / tablo blogu.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ChatPanel } from "@/components/chat/ChatPanel";
import SourceIcon from "@/components/SourceIcon";
import { KIND_LABEL } from "@/lib/sources";
import { stageInfo } from "@/lib/docstage";
import { ExternalLink, Loader2, Search } from "lucide-react";

type Page = { page_number: number; title?: string | null; text: string;
  table?: { header: string[]; rows: string[][]; first_row: number } };

const UNIT: Record<string, string> = { pptx: "Slayt", xlsx: "Tablo", csv: "Tablo" };

function Para({ text, needle }: { text: string; needle: string }) {
  const lines = text.split("\n");
  const mark = (s: string) => {
    if (!needle) return s;
    const i = s.toLowerCase().indexOf(needle);
    if (i < 0) return s;
    return <>{s.slice(0, i)}<mark className="rounded bg-amber-300/60 px-0.5">{s.slice(i, i + needle.length)}</mark>{s.slice(i + needle.length)}</>;
  };
  return (
    <div className="space-y-2 text-[15px] leading-relaxed">
      {lines.map((l, i) => {
        const t = l.trim();
        if (!t) return null;
        if (/^[-*•]\s+/.test(t)) return <p key={i} className="pl-4 before:-ml-3 before:mr-1.5 before:content-['•']">{mark(t.replace(/^[-*•]\s+/, ""))}</p>;
        if (t.startsWith("[Konuşmacı notu]")) return <p key={i} className="rounded-lg bg-surface-muted px-3 py-2 text-sm italic text-text-secondary">{mark(t)}</p>;
        if (t.includes(" | ")) return <p key={i} className="font-mono text-[13px] text-text-secondary">{mark(t)}</p>;
        return <p key={i}>{mark(t)}</p>;
      })}
    </div>
  );
}

export default function TextReader({ id, doc }: { id: string; doc: any }) {
  const kind: string = doc.source_type;
  const media = (typeof doc.media === "string" ? JSON.parse(doc.media) : doc.media) || {};
  const [pages, setPages] = useState<Page[] | null>(null);
  const [active, setActive] = useState(1);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const unit = UNIT[kind] || "Bölüm";

  useEffect(() => {
    let alive = true, t: any;
    async function load() {
      try {
        const r = await api(`/documents/${id}/content`);
        if (!alive) return;
        if (r.ready) setPages(r.pages || []);
        else t = setTimeout(load, 4000);
      } catch { if (alive) t = setTimeout(load, 8000); }
    }
    load();
    return () => { alive = false; clearTimeout(t); };
  }, [id, doc.status]);

  function go(n: number, smooth = true) {
    setActive(n);
    const el = box.current?.querySelector(`[data-page="${n}"]`) as HTMLElement | null;
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - 8, behavior: smooth ? "smooth" : "auto" });
  }
  // ?page=N (atif / arama tiklamasi)
  useEffect(() => {
    if (!pages?.length) return;
    const n = parseInt(new URLSearchParams(window.location.search).get("page") || "", 10);
    if (!isNaN(n) && n >= 1) setTimeout(() => go(n, false), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);
  // kaydirdikca aktif bolum
  function onScroll() {
    const b = box.current; if (!b || !pages) return;
    const items = Array.from(b.querySelectorAll("[data-page]")) as HTMLElement[];
    let cur = active;
    for (const it of items) { if (it.offsetTop - b.scrollTop < 120) cur = parseInt(it.dataset.page || "1", 10); }
    if (cur !== active) setActive(cur);
  }

  const needle = q.trim().toLowerCase();
  const view = (pages || []).filter((p) => !needle || p.text.toLowerCase().includes(needle));
  const st = stageInfo(doc);

  return (
    <div className="flex h-screen flex-col lg:flex-row">
      {/* sol: bolumler */}
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-surface xl:flex">
        <div className="border-b p-4">
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <SourceIcon kind={kind} size={14} /> {KIND_LABEL[kind] || "Kaynak"}
            {media.site && <span className="truncate">· {media.site}</span>}
          </div>
          <h2 className="mt-1 font-heading text-lg leading-tight">{doc.title}</h2>
          {(media.author || media.date) && (
            <p className="mt-1 text-xs text-text-secondary">{[media.author, media.date?.slice(0, 10)].filter(Boolean).join(" · ")}</p>
          )}
          {doc.source_url && (
            <a href={doc.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-accent-purple hover:underline">
              Orijinal sayfayı aç <ExternalLink size={12} />
            </a>
          )}
          {doc.short_summary && <p className="mt-3 text-sm leading-relaxed text-text-secondary">{doc.short_summary}</p>}
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          {(pages || []).map((p) => (
            <button key={p.page_number} onClick={() => go(p.page_number)}
                    className={"flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm " +
                      (p.page_number === active ? "bg-accent-purple/10 text-accent-purple" : "text-text-secondary hover:bg-surface-muted")}>
              <span className="w-6 shrink-0 text-right text-[11px] opacity-70">{p.page_number}</span>
              <span className="line-clamp-2">{p.title || p.text.slice(0, 60)}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* orta: icerik */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <SourceIcon kind={kind} size={16} className="xl:hidden" />
          <h3 className="truncate text-sm font-medium xl:hidden">{doc.title}</h3>
          <div className="ml-auto flex items-center gap-1.5 rounded-lg border bg-surface px-2 py-1">
            <Search size={14} className="text-text-secondary" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bu kaynakta ara…"
                   className="w-40 bg-transparent text-sm outline-none" />
          </div>
        </div>
        <div ref={box} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-5 py-6">
            {pages === null ? (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                {doc.status === "failed" ? <span className="text-red-600">⚠️ {doc.error_message}</span>
                  : <><Loader2 size={16} className="animate-spin" /> Hazırlanıyor · {st.label}</>}
              </div>
            ) : !view.length ? (
              <p className="text-sm text-text-secondary">{needle ? "Eşleşme yok." : "İçerik boş."}</p>
            ) : view.map((p) => (
              <section key={p.page_number} data-page={p.page_number}
                       className={"mb-6 scroll-mt-4 rounded-2xl border p-5 transition " +
                         (p.page_number === active ? "border-accent-purple/40 bg-accent-purple/[0.03]" : "bg-surface")}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  {unit} {p.page_number}{p.title ? " · " : ""}<span className="normal-case">{p.title}</span>
                </p>
                {p.table ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border-b px-2 py-1.5 text-left text-[11px] font-medium text-text-secondary">#</th>
                          {p.table.header.map((h, i) => <th key={i} className="border-b px-2 py-1.5 text-left font-medium">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {p.table.rows.filter((r) => !needle || r.join(" ").toLowerCase().includes(needle)).map((r, i) => (
                          <tr key={i} className="odd:bg-surface-muted/40">
                            <td className="px-2 py-1 text-[11px] text-text-secondary">{p.table!.first_row + p.table!.rows.indexOf(r)}</td>
                            {r.map((c, j) => <td key={j} className="px-2 py-1 align-top">{c}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Para text={p.title && p.text.startsWith(p.title) ? p.text.slice(p.title.length) : p.text} needle={needle} />
                )}
              </section>
            ))}
          </div>
        </div>
      </main>

      {/* sag: sohbet */}
      <aside className="flex h-[45vh] shrink-0 flex-col border-t bg-surface lg:h-auto lg:w-[400px] lg:border-l lg:border-t-0">
        <div className="min-h-0 flex-1">
          <ChatPanel documentId={id} onGoPage={(n) => go(n)} />
        </div>
      </aside>
    </div>
  );
}
