"use client";
/**
 * Deste sahnesi: etkin kart + arkasında sıradaki 2 kartın kenarı (üst üste kâğıt hissi).
 *  - Yön duyarlı geçiş: çıkan kart gittiği yöne kayıp hafifçe dönerek solar, gelen kart karşı
 *    taraftan yerine oturur (≈380 ms, yalnız transform/opacity).
 *  - Parmakla/fareyle sürükleme: kart parmağı izler; eşik (~90px) ya da hızlı fırlatma geçilirse
 *    `onSwipe` çağrılır, geçilmezse yaylanarak geri döner. Dikey kaydırma tarayıcıda kalır
 *    (touch-action: pan-y; yalnız yatay hareket baskınsa yakalanır).
 *  - Kaynak değişince üstte ince "Yeni kaynak · <ad>" etiketi belirir.
 *  - Hareketi azalt açıksa geçişler anlıktır.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { AtelierCard } from "@/hooks/useAtelier";
import { cardColor } from "./QuoteCard";
import { DECK_MS, cssVars, prefersReduced, sourceKey } from "./motion";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const THRESHOLD = 90;     // px
const FLING = 0.55;       // px/ms
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type SwipeDir = "left" | "right";

type Leaving = { id: number; card: AtelierCard; i: number; style: CSSProperties };
type Drag = {
  id: number; x: number; y: number; axis: "x" | null;
  dx: number; r: number; lastX: number; lastT: number; v: number; el: HTMLDivElement;
};

function paint(el: HTMLDivElement, dx: number): number {
  const r = clamp(dx * 0.045, -9, 9);
  el.style.transform = `translate3d(${dx}px,0,0) rotate(${r}deg)`;
  el.style.setProperty("--swipe-r", String(clamp(dx / THRESHOLD, 0, 1)));
  el.style.setProperty("--swipe-l", String(clamp(-dx / THRESHOLD, 0, 1)));
  return r;
}

/** Yaylanarak yerine dön (hareketi azaltta anlık). */
function settle(el: HTMLDivElement) {
  el.style.setProperty("--swipe-r", "0");
  el.style.setProperty("--swipe-l", "0");
  el.style.userSelect = "";
  const done = () => {
    el.style.transition = ""; el.style.willChange = "";
    el.removeEventListener("transitionend", done);
  };
  if (prefersReduced()) { el.style.transform = ""; done(); return; }
  el.style.transition = "transform 460ms cubic-bezier(.34,1.56,.64,1)";
  el.style.transform = "";
  el.addEventListener("transitionend", done);
  window.setTimeout(done, 520);
}

export default function Deck({
  cards, index, render, onSwipe, canSwipe, hints, exitDir, cardRef, onInteract, label = "Alıntı",
}: {
  cards: AtelierCard[];
  index: number;
  /** Kartı çizer; `active` false ise çıkan (etkileşimsiz) kopyadır. */
  render: (card: AtelierCard, i: number, active: boolean) => ReactNode;
  /** Eşik geçilince çağrılır: sola = "left", sağa = "right". Verilmezse sürükleme kapalı. */
  onSwipe?: (dir: SwipeDir) => void;
  /** O yöne geçilebilir mi? (ör. ilk kartta geri yok — kart esner ve geri döner) */
  canSwipe?: (dir: SwipeDir) => boolean;
  /** Kart kenarında beliren soluk ipuçları (Hatırla: sol "Tekrar", sağ "Bildim"). */
  hints?: { left: string; right: string };
  /** Üst bileşen bir sonraki çıkışın yönünü belirleyebilir (-1 sola, 1 sağa). */
  exitDir?: MutableRefObject<number>;
  cardRef?: MutableRefObject<HTMLDivElement | null>;
  /** Karta dokunulunca (ör. kendiliğinden akışı durdurmak için). */
  onInteract?: () => void;
  label?: string;
}) {
  const card = cards[index];
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const [enter, setEnter] = useState<{ key: string; style: CSSProperties } | null>(null);
  const [shift, setShift] = useState<{ key: string; name: string } | null>(null);
  const last = useRef({ index, cards });
  const pending = useRef<{ dir: number; x: number; r: number } | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const setEl = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el;
    if (cardRef) cardRef.current = el;
  }, [cardRef]);

  // Kart değişti: çıkan kopyayı ve geliş yönünü boyamadan önce hazırla
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { index, cards };
    if (prev.index === index) return;
    const from = prev.cards[prev.index];
    const to = cards[index];
    const p = pending.current; pending.current = null;
    const hinted = exitDir?.current || 0;
    if (exitDir) exitDir.current = 0;
    if (!to) return;

    setShift(from && sourceKey(from) !== sourceKey(to)
      ? { key: to.key + ":" + index, name: to.source || "Adsız kaynak" } : null);

    // Odak eski kartın içindeyse kaybolmasın: yeni karta geçer
    const ae = document.activeElement;
    if (!ae || ae === document.body) elRef.current?.focus({ preventScroll: true });

    window.clearTimeout(timer.current);
    if (!from || prefersReduced()) { setLeaving(null); setEnter(null); return; }

    const dir = p?.dir ?? (hinted || (index > prev.index ? -1 : 1));
    const id = ++seq.current;
    setLeaving({
      id, card: from, i: prev.index,
      style: cssVars({
        "--deck-x0": `${p ? p.x : 0}px`, "--deck-r0": `${p ? p.r : 0}deg`,
        "--deck-to": `${dir * (p ? 115 : 42)}%`, "--deck-to-r": `${dir * (p ? 10 : 5)}deg`,
      }),
    });
    setEnter({
      key: to.key + ":" + index,
      style: cssVars({ "--deck-from": `${-dir * 26}%`, "--deck-from-r": `${-dir * 1.5}deg` }),
    });
    timer.current = window.setTimeout(() => { setLeaving(null); setEnter(null); }, DECK_MS + 60);
  }, [index, cards, exitDir]);

  useLayoutEffect(() => () => window.clearTimeout(timer.current), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    moved.current = false;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable='true']")) return;
    onInteract?.();
    if (!onSwipe) return;
    drag.current = {
      id: e.pointerId, x: e.clientX, y: e.clientY, axis: null,
      dx: 0, r: 0, lastX: e.clientX, lastT: e.timeStamp, v: 0, el: e.currentTarget,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) { drag.current = null; return; }  // dikey: sayfa kaysın
      d.axis = "x";
      moved.current = true;
      try { d.el.setPointerCapture(e.pointerId); } catch { /* eski tarayıcı */ }
      d.el.style.transition = "none";
      d.el.style.willChange = "transform";
      d.el.style.userSelect = "none";
    }
    const ok = !canSwipe || canSwipe(dx < 0 ? "left" : "right");
    const eff = ok ? dx : dx * 0.28;               // geçilemeyen yönde esner
    d.r = paint(d.el, eff);
    d.dx = eff;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = 0.8 * ((e.clientX - d.lastX) / dt) + 0.2 * d.v;
    d.lastX = e.clientX; d.lastT = e.timeStamp;
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.axis !== "x") return;
    try { d.el.releasePointerCapture(e.pointerId); } catch { /* yok say */ }
    const dir: SwipeDir = d.dx < 0 ? "left" : "right";
    const ok = !canSwipe || canSwipe(dir);
    const fast = Math.abs(d.v) > FLING && Math.abs(d.dx) > 24 && Math.sign(d.v) === Math.sign(d.dx);
    if (cancelled || !ok || !onSwipe || !(Math.abs(d.dx) > THRESHOLD || fast)) { settle(d.el); return; }
    pending.current = { dir: dir === "left" ? -1 : 1, x: d.dx, r: d.r };
    const el = d.el;
    onSwipe(dir);
    // Kart değişmediyse (ör. son kart → oturum sonu) yerine dönsün
    window.setTimeout(() => {
      if (el.isConnected && elRef.current === el) { pending.current = null; settle(el); }
    }, 90);
  };

  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!moved.current) return;
    moved.current = false;
    e.preventDefault(); e.stopPropagation();          // sürükleme bir dokunuş sayılmasın
  };

  if (!card) return null;
  const curKey = card.key + ":" + index;
  const shells = [2, 1]
    .map((d) => ({ d, c: cards[index + d], i: index + d }))
    .filter((x): x is { d: number; c: AtelierCard; i: number } => !!x.c);

  return (
    <div className="deck-stage">
      {shells.map(({ d, c, i }) => (
        <div key={c.key + ":" + i} aria-hidden className="deck-shell" data-depth={d}
             style={{ borderTopColor: cardColor(c) }} />
      ))}
      {leaving && (
        <div key={"out:" + leaving.id} aria-hidden className="deck-out" style={leaving.style}
             ref={(el) => { el?.setAttribute("inert", ""); }}>
          {render(leaving.card, leaving.i, false)}
        </div>
      )}
      <div key={curKey} ref={setEl} tabIndex={-1}
           role="group" aria-roledescription="kart" aria-label={`${label} ${index + 1} / ${cards.length}`}
           className={cx("deck-card", enter?.key === curKey && "deck-in")}
           style={enter?.key === curKey ? enter.style : undefined}
           onPointerDown={onPointerDown} onPointerMove={onPointerMove}
           onPointerUp={(e) => endDrag(e, false)} onPointerCancel={(e) => endDrag(e, true)}
           onClickCapture={onClickCapture}
           onDragStart={onSwipe ? (e) => e.preventDefault() : undefined /* bağlantının yerel sürüklemesi kartı kilitlemesin */}>
        {render(card, index, true)}
        {hints && onSwipe && (
          <>
            <span aria-hidden className="deck-hint deck-hint-l"><span className="font-heading text-lg">← {hints.left}</span></span>
            <span aria-hidden className="deck-hint deck-hint-r"><span className="font-heading text-lg">{hints.right} →</span></span>
          </>
        )}
      </div>
      <div className="deck-shift-slot" role="status">
        {shift && (
          <span key={shift.key}
                className="deck-shift inline-flex max-w-[85%] items-center gap-1.5 truncate rounded-full border bg-surface px-3 py-1 text-xs text-text-secondary shadow-soft">
            <span className="shrink-0 text-gold" aria-hidden>❦</span>
            <span className="truncate">Yeni kaynak · <span className="text-text-primary">{shift.name}</span></span>
          </span>
        )}
      </div>
    </div>
  );
}
