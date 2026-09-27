/**
 * Atölye geçiş yardımcıları (deste, ızgara, kendiliğinden akış).
 *  - DECK_MS: kart geçiş süresi (CSS'teki --deck-ms ile aynı).
 *  - prefersReduced(): "hareketi azalt" açıksa geçişler anlık olur.
 *  - sourceKey / snippet / dwellMs: kaynak eşleme, kısa önizleme, okuma süresi.
 */
import type { CSSProperties } from "react";
import type { AtelierCard } from "@/hooks/useAtelier";

export const DECK_MS = 380;
export const DECK_EASE = "cubic-bezier(.22,.61,.36,1)";

export function prefersReduced(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** CSS değişkenlerini (--x) stil nesnesine çevirir. */
export function cssVars(o: Record<string, string>): CSSProperties {
  return o as unknown as CSSProperties;
}

/** Aynı kaynaktan mı? Belge kimliği yoksa kaynak adıyla eşlenir. */
export function sourceKey(c: Pick<AtelierCard, "document_id" | "source">): string {
  return c.document_id || c.source || "";
}

/** Alıntının ilk ~n karakteri (kelime ortasında kesmeden). */
export function snippet(text: string, n = 50): string {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (t.length <= n) return t;
  const cut = t.slice(0, n).replace(/\s+\S*$/, "");
  return (cut || t.slice(0, n)) + "…";
}

/** Kendiliğinden geçişte bekleme: ≈ 250 kelime/dk + kısa nefes; 3,5 sn – 60 sn arası. */
export function dwellMs(text: string): number {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  const ms = (words / 250) * 60_000 + 1500;
  return Math.round(Math.max(3500, Math.min(60_000, ms)));
}

/** FLIP: öğeyi `from` kutusundan bugünkü yerine büyüterek/küçülterek taşır (yalnız transform/opacity). */
export function flipFrom(el: HTMLElement | null, from: DOMRect | null) {
  if (!el || !from || prefersReduced() || typeof el.animate !== "function") return;
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const dx = from.left - to.left, dy = from.top - to.top;
  const sx = from.width / to.width, sy = from.height / to.height;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return;
  el.style.willChange = "transform, opacity";
  el.style.transformOrigin = "0 0";
  const a = el.animate(
    [
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`, opacity: 0.55 },
      { transform: "none", opacity: 1 },
    ],
    { duration: DECK_MS, easing: DECK_EASE },
  );
  const clean = () => { el.style.willChange = ""; el.style.transformOrigin = ""; };
  a.onfinish = clean;
  a.oncancel = clean;
}
