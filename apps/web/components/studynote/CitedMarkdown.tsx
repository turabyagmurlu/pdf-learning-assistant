"use client";
/**
 * Ders notu / sentez notu metni: Markdown + tıklanır atıf rozetleri.
 *  - Belge notunda `[s.12]` → "s.12" rozeti → onOpen(docId, 12)
 *  - Sentez notunda `[K2 s.4]` / `[K2]` → "K2 · s.4" rozeti → onOpen(sources[1].document_id, 4)
 *  - Video/ses kaynağında rozet "▶ 04:00" gösterir (media.sections), sayfa = bölüm numarası.
 * Atıf ayrıştırma saf fonksiyonda: components/studynote/cites.ts
 */
import Markdown from "@/components/Markdown";
import { extractPageRefs, refLabel, type PageRef } from "./cites";
import type { MediaSection, OpenPage } from "./types";

export type CiteSource = { document_id: string; title?: string | null };

export default function CitedMarkdown({ text, docId, sources, sections, onOpen, className }: {
  text: string;
  /** belge notu: tüm sayfa atıfları bu belgeye */
  docId?: string;
  /** sentez notu: [K#] → sources[#-1] */
  sources?: CiteSource[];
  sections?: MediaSection[] | null;
  onOpen: OpenPage;
  className?: string;
}) {
  const { text: t, refs } = extractPageRefs(text || "");
  const badge = (n: number) => {
    const ref: PageRef | undefined = refs[n - 1];
    if (!ref) return null;
    const src = ref.k && sources ? sources[ref.k - 1] : undefined;
    const target = src?.document_id || docId;
    const label = refLabel(ref, { sections: ref.k ? null : sections });
    if (!label) return null;
    const title = src?.title ? `${src.title}${ref.page ? ` · s.${ref.page}` : ""} — kaynakta aç` : "Kaynakta bu sayfayı aç";
    const clickable = !!target && (!!ref.page || !!src);
    if (!clickable) {
      return <span className="mx-0.5 inline-flex items-center rounded-full bg-surface-muted px-1.5 text-[11px] leading-5 text-text-secondary">{label}</span>;
    }
    return (
      <button type="button" onClick={() => onOpen(target as string, ref.page)} title={title} aria-label={title}
              className="mx-0.5 inline-flex min-h-[26px] items-center rounded-full border border-accent-purple/30 bg-accent-purple/10 px-1.5 text-[11px] font-medium leading-5 text-accent-purple hover:bg-accent-purple/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/40">
        {label}
      </button>
    );
  };
  return <Markdown text={t} cite={badge} className={className} />;
}
