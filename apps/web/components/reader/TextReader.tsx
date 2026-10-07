"use client";
/**
 * PDF ve video disi kaynaklar icin okuyucu (Word, Excel/CSV, sunum, Markdown,
 * web sayfasi, yapistirilan metin, e-kitap). Solda bolum listesi, ortada metin
 * ya da tablo, sagda kaynakli sohbet. Atif "sayfa"si = bolum / slayt / tablo blogu.
 */
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { api } from "@/lib/api";
import { usePoll } from "@/hooks/usePoll";
import { ChatPanel } from "@/components/chat/ChatPanel";
import ReaderHeader, { useNotebookContext, notebookHref, useMedia } from "@/components/reader/ReaderHeader";
import Modal from "@/components/Modal";
import SourceIcon from "@/components/SourceIcon";
import { KIND_LABEL } from "@/lib/sources";
import { stageInfo } from "@/lib/docstage";
import { PaperButton, usePaper } from "@/components/reader/ReaderToolbar";
import { DropCap } from "@/components/art";
import "@/styles/reader.css";
import { ExternalLink, Loader2, Search, ListTree, MessageSquare } from "lucide-react";

type Page = { page_number: number; title?: string | null; text: string;
  table?: { header: string[]; rows: string[][]; first_row: number } };

const UNIT: Record<string, string> = { pptx: "Slayt", xlsx: "Tablo", csv: "Tablo" };

/* ---------- Markdown (satir ici) ----------
 * .md ve web/yapistirilan metinlerde **kalin**, *italik*, `kod`, [baglanti](https://..) islenir.
 * Arama vurgusu (needle) yalniz duz metin parcalarina uygulanir. Lookbehind kullanilmaz (eski iOS Safari). */
const INLINE_RE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*(?!\s)[^*\n]+?\*)/g;

function inlineMd(s: string, mark: (x: string) => React.ReactNode, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0, k = 0;
  s.replace(INLINE_RE, (m: string, _g: string, idx: number) => {
    if (idx > last) out.push(<span key={keyBase + "t" + k++}>{mark(s.slice(last, idx))}</span>);
    if (m.startsWith("**") || m.startsWith("__")) out.push(<strong key={keyBase + "b" + k++} className="font-semibold">{mark(m.slice(2, -2))}</strong>);
    else if (m.startsWith("`")) out.push(<code key={keyBase + "c" + k++} className="rounded bg-surface-muted px-1 font-mono text-[0.9em]">{m.slice(1, -1)}</code>);
    else if (m.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(m);
      if (mm) out.push(<a key={keyBase + "a" + k++} href={mm[2]} target="_blank" rel="noopener noreferrer" className="text-accent-purple underline underline-offset-2">{mark(mm[1])}</a>);
      else out.push(<span key={keyBase + "t" + k++}>{mark(m)}</span>);
    } else out.push(<em key={keyBase + "i" + k++}>{mark(m.slice(1, -1))}</em>);
    last = idx + m.length;
    return m;
  });
  if (last < s.length) out.push(<span key={keyBase + "t" + k++}>{mark(s.slice(last))}</span>);
  return out;
}
const hasInline = (t: string) => /\*\*|__|`|\]\(http|\*\S/.test(t);

function Para({ text, needle, drop }: { text: string; needle: string; drop?: boolean }) {
  const lines = text.split("\n");
  const mark = (s: string): React.ReactNode => {
    if (!needle) return s;
    const i = s.toLowerCase().indexOf(needle);
    if (i < 0) return s;
    return <>{s.slice(0, i)}<mark className="rounded bg-warning-bg px-0.5 text-text-primary">{s.slice(i, i + needle.length)}</mark>{s.slice(i + needle.length)}</>;
  };
  // satirlari bloklara ayir: kod citi (```) icindekiler oldugu gibi kalir
  type Blk = { kind: "line"; t: string; i: number } | { kind: "code"; t: string; i: number } | { kind: "table"; rows: string[][]; head: boolean; i: number };
  const blocks: Blk[] = [];
  let inCode = false, buf: string[] = [], codeAt = 0;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) {
      if (inCode) { blocks.push({ kind: "code", t: buf.join("\n"), i: codeAt }); buf = []; inCode = false; }
      else { inCode = true; codeAt = i; }
      return;
    }
    if (inCode) { buf.push(l); return; }
    // Markdown tablosu: art arda "|" ile baslayan satirlar tek tabloda toplanir
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const prev = blocks[blocks.length - 1];
      const isSep = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
      const cells = l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (prev && prev.kind === "table" && prev.i + prev.rows.length + (prev.head ? 1 : 0) === i) {
        if (isSep) { if (prev.rows.length === 1) prev.head = true; }
        else prev.rows.push(cells);
        return;
      }
      if (!isSep) { blocks.push({ kind: "table", rows: [cells], head: false, i }); return; }
    }
    blocks.push({ kind: "line", t: l, i });
  });
  if (inCode && buf.length) blocks.push({ kind: "code", t: buf.join("\n"), i: codeAt });
  // ilk bolumun ilk duz paragrafi DropCap ile acilir (aramada ya da satir ici bicim varsa acilmaz)
  const plain = (t: string) => t.length >= 40 && !/^([-*•]|\d+[.)]|#{1,6}|>|\|)\s*/.test(t) && !t.startsWith("[Konuşmacı notu]") && !t.includes(" | ") && !hasInline(t);
  const dropAt = drop && !needle ? (blocks.find((b) => b.kind === "line" && plain(b.t.trim()))?.i ?? -1) : -1;
  return (
    <div className="font-reading space-y-2">
      {blocks.map((b) => {
        const key = String(b.i);
        if (b.kind === "table") {
          const [first, ...rest] = b.rows;
          const body = b.head ? rest : b.rows;
          return (
            <div key={key} className="overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse font-body text-small">
                {b.head && first && (
                  <thead className="bg-surface-muted">
                    <tr>{first.map((c, j) => <th key={j} className="border-b px-2.5 py-1.5 text-left font-semibold text-text-primary">{inlineMd(c, mark, key + "h" + j)}</th>)}</tr>
                  </thead>
                )}
                <tbody>
                  {body.map((r, ri) => (
                    <tr key={ri} className="align-top even:bg-surface-muted/50">
                      {r.map((c, j) => <td key={j} className="border-b px-2.5 py-1.5 text-text-primary">{inlineMd(c, mark, key + "r" + ri + "c" + j)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.kind === "code") return <pre key={key} className="overflow-x-auto rounded-lg bg-surface-muted p-3 font-mono text-small leading-relaxed text-text-primary">{b.t}</pre>;
        const t = b.t.trim();
        if (!t) return null;
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return <hr key={key} className="my-3 border-border" />;
        const h = /^(#{1,6})\s+(.*)$/.exec(t);
        if (h) {
          const lvl = h[1].length;
          const cls = lvl <= 1 ? "text-xl" : lvl === 2 ? "text-lg" : "text-base";
          return <p key={key} role="heading" aria-level={Math.min(6, lvl + 1)} className={`font-heading ${cls} pt-2 text-text-primary`}>{inlineMd(h[2].replace(/\s*#+\s*$/, ""), mark, key)}</p>;
        }
        if (/^>\s?/.test(t)) return <blockquote key={key} className="border-l-2 border-accent-purple/40 pl-3 italic text-text-secondary">{inlineMd(t.replace(/^>\s?/, ""), mark, key)}</blockquote>;
        if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(t)) return null;   // Markdown tablo ayirici satiri
        if (/^[-*•]\s+/.test(t)) return <p key={key} className="pl-4 before:-ml-3 before:mr-1.5 before:content-['•']">{inlineMd(t.replace(/^[-*•]\s+/, ""), mark, key)}</p>;
        const ol = /^(\d+)[.)]\s+(.*)$/.exec(t);
        if (ol) return <p key={key} className="pl-6 -indent-5"><span className="mr-1.5 tabular-nums text-text-secondary">{ol[1]}.</span>{inlineMd(ol[2], mark, key)}</p>;
        if (t.startsWith("[Konuşmacı notu]")) return <p key={key} className="rounded-lg bg-surface-muted px-3 py-2 text-sm italic text-text-secondary">{mark(t)}</p>;
        if (t.startsWith("|") || t.includes(" | ")) return <p key={key} className="font-mono text-small text-text-secondary">{inlineMd(t, mark, key)}</p>;
        if (b.i === dropAt) return <DropCap key={key} text={t} />;
        return <p key={key}>{inlineMd(t, mark, key)}</p>;
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
  const plural = unit === "Slayt" ? "Slaytlar" : unit === "Tablo" ? "Tablolar" : "Bölümler";
  const ctx = useNotebookContext(doc);
  const isLg = useMedia("(min-width: 1024px)");
  const isXl = useMedia("(min-width: 1280px)");
  const [tocOpen, setTocOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Okuma kagidi (Ajan V2): metin kartlari Beyaz / Krem / Gece; Otomatik = uygulama temasina uyar
  const { paper, setPaper, paperTone } = usePaper();

  // icerik: hazir olana kadar yokla (sekme gizliyken / cevrimdisiyken durur)
  async function loadContent(): Promise<boolean> {
    const r = await api(`/documents/${id}/content`, {}, 1);
    if (r.ready) { setPages(r.pages || []); return true; }
    return false;
  }
  useEffect(() => { setPages(null); loadContent().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, doc.status]);
  usePoll(loadContent, { active: pages === null && doc.status !== "failed", base: 4000, max: 15000 });

  function go(n: number, smooth = true) {
    setActive(n);
    const el = box.current?.querySelector(`[data-page="${n}"]`) as HTMLElement | null;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - 8, behavior: smooth && !reduce ? "smooth" : "auto" });
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

  const sectionList = (
    <nav aria-label={`${unit} listesi`} className="min-h-0 flex-1 overflow-y-auto p-2">
      {(pages || []).map((p) => (
        <button key={p.page_number} type="button" onClick={() => { go(p.page_number); setTocOpen(false); }}
                aria-current={p.page_number === active ? "location" : undefined}
                className={"flex min-h-[40px] w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm " +
                  (p.page_number === active ? "bg-accent-soft font-medium text-text-primary" : "text-text-secondary hover:bg-surface-hover")}>
          <span className="w-6 shrink-0 text-right text-xs opacity-80">{p.page_number}</span>
          <span className="line-clamp-2">{p.title || p.text.slice(0, 60)}</span>
        </button>
      ))}
      {pages !== null && !pages.length && <p className="p-2 text-sm text-text-secondary">Bölüm yok.</p>}
    </nav>
  );

  return (
    <div className="flex h-dvh flex-col">
    <ReaderHeader doc={doc} ctx={ctx}>
      <PaperButton value={paper} tone={paperTone} onChange={setPaper} />
      {!isXl && (
        <button type="button" onClick={() => setTocOpen(true)} aria-haspopup="dialog"
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-text-secondary hover:bg-surface-hover">
          <ListTree size={18} aria-hidden /> <span className="hidden sm:inline">{plural}</span><span className="sr-only sm:hidden">{plural}</span>
        </button>
      )}
    </ReaderHeader>
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* sol: bolumler */}
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-surface xl:flex" aria-label="Kaynak bilgisi ve bölümler">
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
        {isXl && sectionList}
      </aside>

      {/* orta: icerik */}
      <section aria-label="Kaynak metni" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 sm:px-4">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary xl:hidden">
            <SourceIcon kind={kind} size={14} /> <span className="truncate">{KIND_LABEL[kind] || "Kaynak"}</span>
          </span>
          {doc.source_url && (
            <a href={doc.source_url} target="_blank" rel="noreferrer"
               className="flex min-h-[40px] shrink-0 items-center gap-1 text-xs text-accent-purple hover:underline xl:hidden">
              Orijinali <ExternalLink size={12} aria-hidden /><span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          )}
          <label className="ml-auto flex min-h-[40px] min-w-0 items-center gap-1.5 rounded-lg border bg-surface px-2">
            <Search size={14} className="shrink-0 text-text-secondary" aria-hidden />
            <span className="sr-only">Bu kaynakta ara</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bu kaynakta ara…"
                   className="w-32 min-w-0 bg-transparent text-sm outline-none sm:w-40" />
          </label>
        </div>
        <div ref={box} onScroll={onScroll}
             className="paper-scope relative min-h-0 flex-1 overflow-y-auto" data-paper={paperTone}>
          <div className="mx-auto max-w-3xl px-5 py-6">
            {pages === null ? (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                {doc.status === "failed" ? <span className="text-danger">⚠️ {doc.error_message || "Bu kaynak işlenemedi."}</span>
                  : <span role="status" className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden /> Hazırlanıyor · {st.label}</span>}
              </div>
            ) : !view.length ? (
              <p className="text-sm text-text-secondary">{needle ? "Eşleşme yok. Farklı bir kelime dene." : "Bu kaynaktan metin çıkarılamadı. Kaynağı Kütüphane'den yeniden işlemeyi dene."}</p>
            ) : view.map((p) => (
              <section key={p.page_number} data-page={p.page_number}
                       className={"mb-6 scroll-mt-4 rounded-2xl border p-5 transition " +
                         (p.page_number === active ? "border-accent-purple/40 bg-accent-purple/[0.03]" : "bg-surface")}>
                <p className="eyebrow mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {unit} {p.page_number}{p.title ? " · " : ""}<span className="normal-case">{p.title}</span>
                </p>
                {p.table ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border-b px-2 py-1.5 text-left text-xs font-medium text-text-secondary">#</th>
                          {p.table.header.map((h, i) => <th key={i} className="border-b px-2 py-1.5 text-left font-medium">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {p.table.rows.filter((r) => !needle || r.join(" ").toLowerCase().includes(needle)).map((r, i) => (
                          <tr key={i} className="odd:bg-surface-muted/40">
                            <td className="px-2 py-1 text-xs text-text-secondary">{p.table!.first_row + p.table!.rows.indexOf(r)}</td>
                            {r.map((c, j) => <td key={j} className="px-2 py-1 align-top">{c}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Para text={p.title && p.text.startsWith(p.title) ? p.text.slice(p.title.length) : p.text} needle={needle}
                        drop={!!pages && p.page_number === pages[0]?.page_number} />
                )}
              </section>
            ))}
          </div>
        </div>
      </section>

      {/* sag: sohbet (genis ekran) */}
      {isLg && (
        <aside className="flex w-[400px] shrink-0 flex-col border-l bg-surface" aria-label="Bu kaynağa sor">
          <div className="min-h-0 flex-1">
            <ChatPanel documentId={id} onGoPage={(n) => go(n)} generic notebookHref={ctx.id ? notebookHref(ctx) : null} />
          </div>
        </aside>
      )}
    </div>

    {/* dar ekran: sohbet alttan acilan tabakada */}
    {!isLg && (
      <div className="shrink-0 border-t bg-surface px-3 pt-2" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={() => setChatOpen(true)} aria-haspopup="dialog"
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent">
          <MessageSquare size={17} aria-hidden /> Bu kaynağa sor
        </button>
      </div>
    )}
    {!isLg && (
      <Modal open={chatOpen} onClose={() => setChatOpen(false)} ariaLabel="Bu kaynağa sor" size="lg" className="h-[85dvh] p-0">
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatPanel documentId={id} onGoPage={(n) => { setChatOpen(false); go(n); }} generic notebookHref={ctx.id ? notebookHref(ctx) : null}
                     onClose={() => setChatOpen(false)} />
        </div>
      </Modal>
    )}
    {!isXl && (
      <Modal open={tocOpen} onClose={() => setTocOpen(false)} title={plural} size="md" className="p-4">
        {doc.short_summary && <p className="mb-3 text-sm leading-relaxed text-text-secondary">{doc.short_summary}</p>}
        {sectionList}
      </Modal>
    )}
    </div>
  );
}
