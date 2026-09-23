"use client";
/**
 * Cevap metnindeki [K1], [K2, K3], [K1][K4] gibi atif etiketlerini tiklanabilir
 * rozetlere cevirir. Her rozet ilgili kaynagin sayfasina goturur:
 * iddia -> kanit tek tikla.
 */
import { Fragment } from "react";

export type CiteTarget = { document_id?: string; title?: string | null; page?: number | null;
  kind?: string; time?: string; start?: number };

/** Rozet konumu: videoda "▶ 04:00", PDF'te "s.12". */
export function citeLoc(src?: CiteTarget | null): string {
  if (!src) return "";
  if (src.time) return "▶ " + src.time;
  return src.page ? "s." + src.page : "";
}

const TOKEN = /\[(K\s*\d+(?:\s*[,;]\s*K?\s*\d+)*)\]/g;

function nums(inner: string): number[] {
  return Array.from(inner.matchAll(/\d+/g)).map((m) => parseInt(m[0], 10)).filter((n) => n > 0);
}

export default function CitedText({ text, sources, onCite, className }: {
  text: string;
  sources: CiteTarget[];
  onCite: (n: number, src: CiteTarget | undefined) => void;
  className?: string;
}) {
  const out: React.ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<Fragment key={k++}>{text.slice(last, start)}</Fragment>);
    const ns = nums(m[1]);
    out.push(
      <span key={k++} className="mx-0.5 inline-flex flex-wrap gap-0.5 align-baseline">
        {ns.map((n, i) => {
          const src = sources[n - 1];
          const loc = citeLoc(src);
          const tip = src ? `${src.title || "Kaynak"}${loc ? " · " + loc : ""} — aç` : "Kaynak";
          return (
            <button key={i} type="button" onClick={(e) => { e.stopPropagation(); onCite(n, src); }}
                    title={tip} aria-label={tip}
                    className="rounded-md border border-accent-purple/40 bg-accent-purple/10 px-1.5 py-[1px] text-[11px] font-medium leading-tight text-accent-purple hover:bg-accent-purple hover:text-white">
              K{n}{loc ? <span className="opacity-70"> {loc}</span> : null}
            </button>
          );
        })}
      </span>
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return <p className={className || "whitespace-pre-wrap text-sm leading-relaxed"}>{out}</p>;
}
