"use client";
/**
 * Defter "Sentez notu": kaynaklar arası büyük resim, ortak kavramlar, çelişkiler, tamamlayıcı noktalar,
 * okuma sırası, sorular. Atıflar [K2 s.4] → kaynak rozeti (tıkla → o kaynağın sayfası).
 */
import { RefreshCw } from "lucide-react";
import { Cost, costTitle } from "@/components/CostBadge";
import CitedMarkdown from "./CitedMarkdown";
import { fmtWhen, type ColSource, type OpenPage, type Synthesis } from "./types";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export default function SynthesisNote({ note, sources, onOpen, compact, stale, at, onRefresh, busy }: {
  note: Synthesis;
  sources: ColSource[];
  onOpen: OpenPage;
  compact?: boolean;
  stale?: boolean;
  at?: string | null;
  onRefresh: () => void;
  busy?: boolean;
}) {
  const body = compact ? "text-[14px] leading-[1.75]" : "text-[15px] leading-[1.8]";
  const srcs = sources.map((s) => ({ document_id: s.document_id, title: s.title }));
  const blocks: [string, string][] = [
    ["Ortak kavramlar ve uzlaşılar", note.common_md],
    ["Kaynakların ayrıştığı yerler", note.conflicts_md],
    ["Birbirini tamamlayan noktalar", note.complementary_md],
  ];
  return (
    <section aria-label="Sentez notu" className="space-y-4">
      <p className="text-xs text-text-secondary">
        {sources.filter((s) => s.status === "ready").length} kaynak · {note.words} kelime{at ? ` · hazırlandı ${fmtWhen(at)}` : ""}
      </p>
      {stale && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-warning">
          Defterin kaynakları ya da ders notları değişmiş; bu sentez eski hâle göre. İstersen yeniden hazırla.
        </p>
      )}
      {note.overview_md && (
        <div className={cx("vellum rounded-2xl border p-4 font-reading text-text-primary", body)}>
          <p className="eyebrow mb-2">Büyük resim</p>
          <CitedMarkdown text={note.overview_md} sources={srcs} onOpen={onOpen} />
        </div>
      )}
      {blocks.filter(([, t]) => !!t).map(([title, text]) => (
        <div key={title} className="rounded-2xl border bg-surface p-4">
          <p className="eyebrow">{title}</p>
          <div className={cx("mt-2 font-reading text-text-primary", body)}>
            <CitedMarkdown text={text} sources={srcs} onOpen={onOpen} />
          </div>
        </div>
      ))}
      {note.reading_order.length > 0 && (
        <div className="rounded-2xl border bg-surface p-4">
          <p className="eyebrow">Önerilen okuma sırası</p>
          <ol className={cx("mt-2 list-decimal space-y-1.5 pl-5 font-reading text-text-primary", body)}>
            {note.reading_order.map((r, i) => <li key={i}><CitedMarkdown text={r} sources={srcs} onOpen={onOpen} /></li>)}
          </ol>
        </div>
      )}
      {note.questions.length > 0 && (
        <div className="rounded-2xl border bg-surface p-4">
          <p className="eyebrow">Kaynaklar arası sorular</p>
          <p className="mt-1 text-xs text-text-secondary">Önce kendin düşün; istersen soruyu Sor’a taşı.</p>
          <ol className={cx("mt-2 list-decimal space-y-1.5 pl-5 font-reading text-text-primary", body)}>
            {note.questions.map((q, i) => <li key={i}><CitedMarkdown text={q} sources={srcs} onOpen={onOpen} /></li>)}
          </ol>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <span>Kaynak numaraları (K1, K2…) yukarıdaki listeye göre. Not saklandı; tekrar açmak ücretsiz.</span>
        <button type="button" onClick={onRefresh} disabled={busy} title={"Yeniden sentezle · " + costTitle(1)}
                className="ml-auto flex min-h-[36px] items-center gap-1 rounded-lg border bg-surface px-2.5 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-text-primary disabled:opacity-60">
          <RefreshCw size={12} aria-hidden className={busy ? "animate-spin" : ""} /> Yeniden sentezle <Cost n={1} />
        </button>
      </div>
    </section>
  );
}
