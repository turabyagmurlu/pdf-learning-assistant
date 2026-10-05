"use client";
/**
 * L2 Ders notu (belge): bölüm bölüm Markdown + [s.N] rozetleri, kavram ilişkileri (düz yazı),
 * sık yanlış anlamalar, 5 sorgulayıcı soru. Harita/kart/puan yok.
 */
import { useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Cost, costTitle } from "@/components/CostBadge";
import CitedMarkdown from "./CitedMarkdown";
import { fmtWhen, type Lesson, type MediaSection, type OpenPage } from "./types";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export default function LessonNote({ note, docId, sections, onOpen, compact, stale, at, refreshCalls, onRefresh, busy, label = "Ders notu" }: {
  note: Lesson;
  /** bölge adı (okuyucunun Özet sekmesinde "Bölüm bölüm özet") */
  label?: string;
  docId: string;
  sections?: MediaSection[] | null;
  onOpen: OpenPage;
  compact?: boolean;
  /** kaynak metni değişti: yeniden hazırlamayı öner */
  stale?: boolean;
  at?: string | null;
  refreshCalls: number;
  onRefresh: () => void;
  busy?: boolean;
}) {
  // compact (okuyucu paneli): bölümler katlı başlar; ilk bölüm açık
  const [open, setOpen] = useState<Set<number>>(() => new Set(compact ? [0] : note.sections.map((_, i) => i)));
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const allOpen = open.size >= note.sections.length;
  const body = compact ? "text-[14px] leading-[1.75]" : "text-[15px] leading-[1.8]";

  return (
    <section aria-label={label} className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
        <span>{note.sections.length} bölüm · {note.words} kelime{at ? ` · hazırlandı ${fmtWhen(at)}` : ""}</span>
        {note.sections.length > 1 && (
          <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(note.sections.map((_, i) => i)))}
                  className="min-h-[32px] rounded-lg px-2 text-accent-purple hover:bg-surface-muted">
            {allOpen ? "Hepsini kapat" : "Hepsini aç"}
          </button>
        )}
      </div>

      {stale && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-warning">
          Kaynağın metni değişmiş; bu not eski metne göre. İstersen yeniden hazırla.
        </p>
      )}

      <ol className="space-y-2">
        {note.sections.map((s, i) => {
          const on = open.has(i);
          return (
            <li key={i} className="rounded-2xl border bg-surface">
              <button type="button" onClick={() => toggle(i)} aria-expanded={on} aria-controls={`ls-${docId}-${i}`}
                      className="flex min-h-[48px] w-full items-center gap-2 px-3 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className={cx("block font-heading leading-snug text-text-primary", compact ? "text-[15px]" : "text-base")}>{s.title}</span>
                  {s.page_start ? <span className="text-xs text-text-secondary">s.{s.page_start}’ten itibaren</span> : null}
                </span>
                <ChevronDown size={16} aria-hidden className={cx("shrink-0 text-text-secondary transition", on && "rotate-180")} />
              </button>
              {on && (
                <div id={`ls-${docId}-${i}`} className={cx("border-t px-3 pb-3 pt-2 font-reading text-text-primary", body)}>
                  <CitedMarkdown text={s.body_md} docId={docId} sections={sections} onOpen={onOpen} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {note.concept_relations_md && (
        <div className="vellum rounded-2xl border p-4">
          <p className="eyebrow">Kavramlar nasıl bağlanıyor</p>
          <div className={cx("mt-2 font-reading text-text-primary", body)}>
            <CitedMarkdown text={note.concept_relations_md} docId={docId} sections={sections} onOpen={onOpen} />
          </div>
        </div>
      )}

      {note.misconceptions.length > 0 && (
        <div className="rounded-2xl border bg-surface p-4">
          <p className="eyebrow">Sık yanlış anlamalar</p>
          <ul className={cx("mt-2 space-y-2 font-reading text-text-primary", body)}>
            {note.misconceptions.map((m, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-coral" />
                <span className="min-w-0"><CitedMarkdown text={m} docId={docId} sections={sections} onOpen={onOpen} /></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {note.questions.length > 0 && (
        <div className="rounded-2xl border bg-surface p-4">
          <p className="eyebrow">Kendini sına</p>
          <p className="mt-1 text-xs text-text-secondary">Önce kendin cevapla; sonra sayfayı açıp karşılaştır.</p>
          <ol className={cx("mt-2 list-decimal space-y-2 pl-5 font-reading text-text-primary", body)}>
            {note.questions.map((q, i) => (
              <li key={i}>
                {q.q}{" "}
                {q.page ? (
                  <button type="button" onClick={() => onOpen(docId, q.page)} title="Cevabın geçtiği sayfayı aç"
                          className="ml-1 inline-flex min-h-[26px] items-center rounded-full border border-accent-purple/30 bg-accent-purple/10 px-1.5 text-[11px] font-medium text-accent-purple hover:bg-accent-purple/20">
                    s.{q.page}
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <span>Bir kez hazırlandı ve saklandı; tekrar açmak ücretsiz.</span>
        <button type="button" onClick={onRefresh} disabled={busy} title={"Yeniden hazırla · " + costTitle(refreshCalls)}
                className="ml-auto flex min-h-[36px] items-center gap-1 rounded-lg border bg-surface px-2.5 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-text-primary disabled:opacity-60">
          <RefreshCw size={12} aria-hidden className={busy ? "animate-spin" : ""} /> Yeniden hazırla <Cost n={refreshCalls} />
        </button>
      </div>
    </section>
  );
}
