"use client";
/**
 * Cevap metnindeki [K1], [K2, K3], [K1][K4] gibi atif etiketlerini tiklanabilir
 * rozetlere cevirir. Her rozet ilgili kaynagin sayfasina goturur:
 * iddia -> kanit tek tikla.
 *
 * On izleme: farede uzerine gelince, klavyede odaklaninca acilir (Esc kapatir).
 * Dokunmatikte ilk dokunus on izlemeyi alttan acilan kucuk tabakada gosterir;
 * ikinci dokunus ya da "Kaynakta aç" kaynaga gider.
 */
import { Fragment, useEffect, useRef, useState } from "react";
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

/** Dokunmatik (hover yok) cihaz mi? */
function isTouch() {
  try { return typeof window !== "undefined" && window.matchMedia("(hover: none)").matches; } catch { return false; }
}

export default function CitedText({ text, sources, onCite, className }: {
  text: string;
  sources: CiteTarget[];
  onCite: (n: number, src: CiteTarget | undefined) => void;
  className?: string;
}) {
  const [open, setOpen] = useState<{ key: string; n: number; sheet: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (key: string, n: number, delay = 180) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen({ key, n, sheet: false }), delay);
  };
  const hide = (delay = 220) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen((o) => (o?.sheet ? o : null)), delay); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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
          const key = k + "-" + i;
          const on = open?.key === key;
          const popId = "cite-pop-" + key;
          const openLabel = src?.kind === "youtube" || src?.kind === "audio" ? "O ana git →" : "Kaynakta aç →";
          return (
            <span key={i} className="relative inline-block"
                  onMouseEnter={() => { if (!isTouch()) show(key, n); }}
                  onMouseLeave={() => { if (!isTouch()) hide(); }}>
              <button type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Dokunmatik: ilk dokunus on izleme, ikincisi kaynaga gider
                        if (isTouch() && src && !(on && open?.sheet)) { setOpen({ key, n, sheet: true }); return; }
                        onCite(n, src);
                      }}
                      onFocus={() => { if (!isTouch()) show(key, n, 0); }}
                      onBlur={(e) => {
                        const next = e.relatedTarget as Node | null;
                        if (next && document.getElementById(popId)?.contains(next)) return;
                        if (!open?.sheet) hide(120);
                      }}
                      aria-label={`K${n}${loc ? " " + loc : ""} · ${src?.title || "Kaynak"}`}
                      aria-expanded={on}
                      aria-controls={on ? popId : undefined}
                      className={"inline-flex min-h-[24px] items-center gap-1 rounded-full px-2 py-0.5 align-baseline font-body text-xs font-medium leading-tight text-text-primary transition hover:ring-1 hover:ring-current focus-visible:ring-2 focus-visible:ring-accent-purple " + sourceTint(src?.kind)}>
                <span aria-hidden className={"text-[9px] leading-none " + sourceColor(src?.kind)}>●</span>
                K{n}{loc ? <span className="text-text-secondary"> {loc}</span> : null}
              </button>
              {on && src && (
                <>
                  {open?.sheet && (
                    <span aria-hidden onClick={() => setOpen(null)} className="fixed inset-0 z-[69] block bg-black/20" />
                  )}
                  <span id={popId} role="dialog" aria-label={`K${n} alıntı önizlemesi`}
                        onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => { if (!open?.sheet) hide(); }}
                        onBlur={(e) => { const next = e.relatedTarget as Node | null; if (!open?.sheet && !(next && e.currentTarget.contains(next))) hide(120); }}
                        className={open?.sheet
                          ? "fixed inset-x-0 bottom-0 z-[70] block rounded-t-2xl border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-left font-body shadow-medium"
                          : "absolute left-1/2 top-full z-40 mt-1.5 block w-72 -translate-x-1/2 rounded-xl border bg-surface p-3 text-left font-body shadow-medium"}>
                    <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <span className="truncate font-medium text-text-primary">{src.title || "Kaynak"}</span>
                      {loc && <span className="shrink-0">· {loc}</span>}
                    </span>
                    {src.snippet ? (
                      <span className="mt-1.5 block border-l-2 border-amber-400 pl-2 text-[13px] leading-relaxed text-text-primary">
                        “{src.snippet.length > 280 ? src.snippet.slice(0, 277) + "…" : src.snippet}”
                      </span>
                    ) : (
                      <span className="mt-1.5 block text-xs text-text-secondary">Alıntının tamamı için kaynağı aç.</span>
                    )}
                    <span className="mt-2 flex items-center gap-2">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(null); onCite(n, src); }}
                              className="min-h-[40px] rounded-lg px-2 text-sm font-medium text-accent-purple hover:underline">
                        {openLabel}
                      </button>
                      {open?.sheet && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(null); }}
                                className="ml-auto min-h-[40px] rounded-lg border px-3 text-sm text-text-secondary">
                          Kapat
                        </button>
                      )}
                    </span>
                  </span>
                </>
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
