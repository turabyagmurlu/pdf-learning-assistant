"use client";
/**
 * Cevap metnindeki [K1], [K2, K3], [K1][K4] gibi atif etiketlerini tiklanabilir
 * rozetlere cevirir. Her rozet ilgili kaynagin sayfasina goturur:
 * iddia -> kanit tek tikla.
 */
import { Fragment, useRef, useState } from "react";
import { sourceColor, sourceTint } from "@/components/SourceIcon";

export type CiteTarget = { document_id?: string; title?: string | null; page?: number | null;
  kind?: string; time?: string; start?: number; unit?: string; snippet?: string };

/** Rozet konumu: videoda "▶ 04:00", PDF'te "s.12". */
export function citeLoc(src?: CiteTarget | null): string {
  if (!src) return "";
  if (src.time) return "▶ " + src.time;
  if (src.unit && src.page) return src.unit + " " + src.page;
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
  const [hover, setHover] = useState<{ key: string; n: number } | null>(null);
  const timer = useRef<any>(null);
  const show = (key: string, n: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => setHover({ key, n }), 180); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setHover(null), 220); };
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
          const key = k + "-" + i;
          const on = hover?.key === key;
          return (
            <span key={i} className="relative inline-block" onMouseEnter={() => show(key, n)} onMouseLeave={hide}>
            <button type="button" onClick={(e) => { e.stopPropagation(); onCite(n, src); }}
                    aria-label={tip}
                    className={"rounded-full px-1.5 py-[1px] font-body text-[11px] font-medium leading-tight transition hover:ring-1 hover:ring-current " + sourceTint(src?.kind) + " " + sourceColor(src?.kind)}>
              K{n}{loc ? <span className="opacity-70"> {loc}</span> : null}
            </button>
            {on && src && (
              <span role="tooltip" onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={hide}
                    className="absolute left-1/2 top-full z-40 mt-1.5 hidden w-72 -translate-x-1/2 rounded-xl border bg-surface p-3 text-left font-body shadow-medium md:block">
                <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                  <span className="truncate font-medium text-text-primary">{src.title || "Kaynak"}</span>
                  {loc && <span className="shrink-0">· {loc}</span>}
                </span>
                {src.snippet ? (
                  <span className="mt-1.5 block border-l-2 border-amber-400 pl-2 text-[12.5px] leading-relaxed text-text-primary">
                    “{src.snippet.length > 280 ? src.snippet.slice(0, 277) + "…" : src.snippet}”
                  </span>
                ) : (
                  <span className="mt-1.5 block text-xs text-text-secondary">Alıntının tamamı için kaynağı aç.</span>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); onCite(n, src); }}
                        className="mt-2 text-xs font-medium text-accent-purple hover:underline">
                  {src.kind === "youtube" || src.kind === "audio" ? "O ana git →" : "Kaynakta aç →"}
                </button>
              </span>
            )}
            </span>
          );
        })}
      </span>
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return <p className={className || "whitespace-pre-wrap text-sm leading-relaxed"}>{out}</p>;
}
