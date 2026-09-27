"use client";
/**
 * Vurgudan vurguya bağ: aynı kaynaktaki önceki / sonraki vurgu (sayfa sırasıyla).
 * İnce bir sayfa çizgisi üzerinde her vurgu bir nokta; bu kart belirgin, komşular renkli.
 * Dokununca o karta geçilir (deste geçişiyle).
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AtelierCard } from "@/hooks/useAtelier";
import { cardColor } from "./QuoteCard";
import { snippet, sourceKey } from "./motion";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

type Item = { c: AtelierCard; i: number };

export default function Neighbors({ cards, index, onJump }: {
  cards: AtelierCard[]; index: number; onJump: (i: number) => void;
}) {
  const card = cards[index];
  if (!card) return null;
  const src = sourceKey(card);
  if (!src) return null;
  const same: Item[] = cards.map((c, i) => ({ c, i })).filter((x) => sourceKey(x.c) === src);
  if (same.length < 2) return null;
  const sorted = [...same].sort((a, b) => (a.c.page ?? 0) - (b.c.page ?? 0) || a.i - b.i);
  const pos = sorted.findIndex((x) => x.i === index);
  const prev = pos > 0 ? sorted[pos - 1] : null;
  const next = pos >= 0 && pos < sorted.length - 1 ? sorted[pos + 1] : null;

  const pages = sorted.map((x) => x.c.page).filter((p): p is number => typeof p === "number" && p > 0);
  const min = pages.length ? Math.min(...pages) : 0;
  const max = pages.length ? Math.max(...pages) : 0;
  const at = (p: number) => (max > min ? ((p - min) / (max - min)) * 100 : 50);

  const link = (x: Item | null, side: "prev" | "next") => {
    if (!x) return <span aria-hidden />;
    const pg = x.c.page ? `s. ${x.c.page}` : "";
    const word = side === "prev" ? "Önceki vurgu" : "Sonraki vurgu";
    const text = snippet(x.c.text, 50);
    return (
      <button type="button" onClick={() => onJump(x.i)}
              aria-label={`Aynı kaynakta ${word.toLowerCase()}${x.c.page ? `, sayfa ${x.c.page}` : ""}: ${text}`}
              className={cx("group flex min-h-[48px] min-w-0 items-center gap-2 rounded-xl border bg-surface/70 px-3 py-2 text-left",
                "hover:bg-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold",
                side === "next" && "flex-row-reverse text-right")}>
        {side === "prev"
          ? <ChevronLeft size={18} aria-hidden className="shrink-0 text-text-secondary group-hover:text-text-primary" />
          : <ChevronRight size={18} aria-hidden className="shrink-0 text-text-secondary group-hover:text-text-primary" />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs text-text-secondary" style={side === "next" ? { justifyContent: "flex-end" } : undefined}>
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: cardColor(x.c) }} />
            {word}{pg ? ` · ${pg}` : ""}
          </span>
          <span className="block truncate font-reading text-sm italic text-text-primary">{text}</span>
        </span>
      </button>
    );
  };

  return (
    <nav aria-label="Aynı kaynaktaki komşu vurgular" className="mt-phi-2">
      {pages.length >= 2 && max > min && (
        <div aria-hidden className="flex items-center gap-2 px-1">
          <span className="w-10 shrink-0 text-xs tabular-nums text-text-secondary">s. {min}</span>
          <div className="relative h-4 flex-1">
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
            {sorted.map((x) => {
              if (!x.c.page) return null;
              const me = x.i === index;
              const near = x === prev || x === next;
              const size = me ? 10 : near ? 8 : 5;
              return (
                <span key={x.c.key + ":" + x.i}
                      className="absolute top-1/2 rounded-full transition-[opacity] duration-300"
                      style={{
                        left: `calc(${at(x.c.page)}% - ${size / 2}px)`, width: size, height: size, marginTop: -size / 2,
                        background: me ? "var(--gold)" : near ? cardColor(x.c) : "var(--border-strong)",
                        opacity: me || near ? 1 : 0.5,
                        boxShadow: me ? "0 0 0 3px var(--gold-soft)" : undefined,
                      }} />
              );
            })}
          </div>
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-text-secondary">s. {max}</span>
        </div>
      )}
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {link(prev, "prev")}
        {link(next, "next")}
      </div>
    </nav>
  );
}
