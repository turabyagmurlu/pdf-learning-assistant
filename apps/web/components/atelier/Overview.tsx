"use client";
/**
 * Genel bakış (ızgara): kartlar küçülerek kaynağa göre gruplu bir ızgaraya dağılır.
 * Açılırken bulunduğun kart kendi karosuna küçülür (FLIP); birine dokununca o kart
 * büyüyerek odaya döner (dönüş animasyonunu ReadMode yapar). Klavye: G ya da Esc → geri.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { useAtelierKeys, type AtelierCard } from "@/hooks/useAtelier";
import { cardColor } from "./QuoteCard";
import { cssVars, flipFrom, snippet, sourceKey } from "./motion";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

type Group = { key: string; name: string; items: { c: AtelierCard; i: number }[] };

export default function Overview({ cards, index, from, onPick, onClose }: {
  cards: AtelierCard[];
  index: number;
  /** Açılırken etkin kartın ekrandaki kutusu (küçülerek karoya iner). */
  from: DOMRect | null;
  onPick: (i: number, rect: DOMRect) => void;
  onClose: (rect: DOMRect | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    cards.forEach((c, i) => {
      const k = sourceKey(c) || "—";
      let g = m.get(k);
      if (!g) { g = { key: k, name: c.source || "Kendi satırların", items: [] }; m.set(k, g); }
      g.items.push({ c, i });
    });
    return Array.from(m.values());
  }, [cards]);

  const tileOf = (i: number) => root.current?.querySelector<HTMLElement>(`[data-i="${i}"]`) || null;

  useLayoutEffect(() => {
    const el = tileOf(index);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.focus({ preventScroll: true });
    flipFrom(el, from);
    // Yalnız açılışta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const back = () => onClose(tileOf(index)?.getBoundingClientRect() ?? null);
  useAtelierKeys({ Escape: back, g: back, G: back }, true, { capture: true });

  let order = 0;
  return (
    <div ref={root} role="region" aria-label="Tüm alıntılar, kaynağa göre" className="mt-phi-3">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.name} className="mb-phi-4">
          <h2 className="mb-phi-1 flex items-baseline gap-2 px-1">
            <span className="min-w-0 truncate font-heading text-base text-text-primary">{g.name}</span>
            <span className="shrink-0 text-xs text-text-secondary">{g.items.length} vurgu</span>
          </h2>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {g.items.map(({ c, i }) => {
              const me = i === index;
              const delay = Math.min(order++ * 18, 320);
              return (
                <li key={c.key + ":" + i}>
                  <button type="button" data-i={i} aria-current={me ? "true" : undefined}
                          onClick={(e) => onPick(i, e.currentTarget.getBoundingClientRect())}
                          style={me ? undefined : cssVars({ "--d": `${delay}ms` })}
                          className={cx("vellum relative flex h-full min-h-[112px] w-full flex-col justify-between overflow-hidden rounded-xl border py-3 pl-4 pr-3 text-left shadow-soft",
                            "hover:bg-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold",
                            me ? "ring-2 ring-gold" : "deck-tile-in")}>
                    <span aria-hidden className="absolute bottom-3 left-0 top-3 w-1 rounded-r-full" style={{ background: cardColor(c) }} />
                    <span className="sr-only">{i + 1}. alıntı{me ? " (şu an buradasın)" : ""}: </span>
                    <span className="line-clamp-4 font-reading text-[15px] italic leading-snug text-text-primary">{snippet(c.text, 180)}</span>
                    <span className="mt-2 flex items-center justify-between gap-2 text-xs text-text-secondary">
                      <span className="tabular-nums">{c.page ? `s. ${c.page}` : ""}</span>
                      <span aria-hidden className="tabular-nums">{i + 1}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
