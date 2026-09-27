"use client";
/**
 * Oku (Akış): deste hâlinde tek kart; ←/→, düğmeler ya da parmakla sürükleyerek gezinme.
 *  - "Sesli oku" (cihaz sesi, ücretsiz).
 *  - Aynı kaynaktaki önceki/sonraki vurguya bağ (sayfa çizgisi).
 *  - "Hepsini gör" (G): ızgara; bir karta dokununca o kart büyüyerek geri gelir. Esc → geri.
 *  - "Kendiliğinden geç": kart uzunluğuna göre (≈250 kelime/dk) bekler, ince çizgi dolar; dokununca durur.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Volume2, Square, LayoutGrid, X } from "lucide-react";
import QuoteCard from "./QuoteCard";
import Progress from "./Progress";
import Deck from "./Deck";
import Neighbors from "./Neighbors";
import Overview from "./Overview";
import { useDeviceVoice } from "./voice";
import { dwellMs, flipFrom } from "./motion";
import { useAtelierKeys, type AtelierCard } from "@/hooks/useAtelier";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const navBtn = "flex h-12 w-12 items-center justify-center rounded-full border bg-surface text-text-secondary shadow-soft " +
  "hover:text-text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold";
const AUTO_KEY = "atelier.auto";

export default function ReadMode({ cards, index, onPrev, onNext, onJump }: {
  cards: AtelierCard[]; index: number; onPrev: () => void; onNext: () => void; onJump: (i: number) => void;
}) {
  const card = cards[index];
  const voice = useDeviceVoice();
  const speaking = voice.state !== "idle";
  const [grid, setGrid] = useState(false);
  const [auto, setAuto] = useState(false);
  const cardEl = useRef<HTMLDivElement | null>(null);
  const flip = useRef<{ from: DOMRect | null; dir: "open" | "close" } | null>(null);

  useEffect(() => { try { setAuto(localStorage.getItem(AUTO_KEY) === "1"); } catch {} }, []);
  const setAutoSaved = useCallback((v: boolean) => {
    setAuto(v);
    try { localStorage.setItem(AUTO_KEY, v ? "1" : "0"); } catch {}
  }, []);

  // Kart değişince okuma durur (yeni kart sessizce gelir)
  const { stop } = voice;
  useEffect(() => { stop(); }, [index, stop]);

  // Kendiliğinden geç: sesli okuma ya da ızgara açıkken bekler
  const dwell = useMemo(() => dwellMs(card?.text || ""), [card]);
  useEffect(() => {
    if (!auto || grid || speaking || !card) return;
    const t = window.setTimeout(onNext, dwell);
    return () => window.clearTimeout(t);
  }, [auto, grid, speaking, card, index, dwell, onNext]);

  const toggleVoice = () => {
    if (!card) return;
    if (speaking) voice.stop();
    else voice.speak([card.text]);
  };

  const openGrid = () => {
    flip.current = { from: cardEl.current?.getBoundingClientRect() ?? null, dir: "open" };
    voice.stop();
    setGrid(true);
  };
  const closeGrid = (i: number, from: DOMRect | null) => {
    flip.current = { from, dir: "close" };
    if (i !== index) onJump(i);
    setGrid(false);
  };

  // Izgaradan dönüş: kart dokunulan karonun yerinden büyüyerek yerine oturur
  useLayoutEffect(() => {
    const f = flip.current;
    if (grid || !f || f.dir !== "close") return;
    flip.current = null;
    const el = cardEl.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.focus({ preventScroll: true });
    flipFrom(el, f.from);
  }, [grid]);

  useAtelierKeys({
    ArrowLeft: onPrev, ArrowRight: onNext, s: toggleVoice, S: toggleVoice, g: openGrid, G: openGrid,
  }, !grid);

  if (!card) return null;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-4 pb-phi-5 md:px-8">
      <div className="flex items-center gap-phi-2">
        <div className="min-w-0 flex-1"><Progress index={index} count={cards.length} announce={!grid} /></div>
        <button type="button" aria-pressed={grid}
                onClick={() => (grid ? closeGrid(index, null) : openGrid())}
                title={grid ? "Karta dön (Esc)" : "Hepsini gör (G)"}
                className={cx("inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm",
                  grid ? "border-gold bg-gold-soft text-text-primary" : "bg-surface text-text-secondary hover:text-text-primary")}>
          {grid ? <X size={15} aria-hidden /> : <LayoutGrid size={15} aria-hidden />}
          {grid ? "Karta dön" : "Hepsini gör"}
          <kbd className="hidden rounded border px-1 font-mono text-xs text-text-secondary sm:inline">{grid ? "Esc" : "G"}</kbd>
        </button>
      </div>

      {grid ? (
        <Overview cards={cards} index={index} from={flip.current?.dir === "open" ? flip.current.from : null}
                  onPick={(i, rect) => closeGrid(i, rect)}
                  onClose={(rect) => closeGrid(index, rect)} />
      ) : (
        <>
          <div className="mt-phi-3">
            <Deck cards={cards} index={index} cardRef={cardEl}
                  onSwipe={(d) => (d === "left" ? onNext() : onPrev())}
                  canSwipe={(d) => d === "left" || index > 0}
                  onInteract={() => { if (auto) setAutoSaved(false); }}
                  render={(c, _i, active) => (
                    <QuoteCard card={c} active={active && speaking}
                               footer={active ? (
                                 <button type="button" onClick={toggleVoice} aria-pressed={speaking}
                                         className={cx("inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm",
                                           speaking ? "border-gold bg-gold-soft text-text-primary" : "text-text-secondary hover:text-text-primary")}>
                                   {speaking ? <Square size={14} aria-hidden /> : <Volume2 size={15} aria-hidden />}
                                   {speaking ? "Durdur" : "Sesli oku"}
                                 </button>
                               ) : null} />
                  )} />
            {/* Kendiliğinden geç: ince çizgi kartın altında dolar */}
            <div aria-hidden className={cx("mx-4 mt-2 h-[2px] overflow-hidden rounded-full transition-opacity duration-300",
                   auto && !speaking ? "bg-gold-soft opacity-100" : "opacity-0")}>
              {auto && !speaking && (
                <div key={card.key + ":" + index} className="deck-dwell" style={{ animationDuration: dwell + "ms" }} />
              )}
            </div>
          </div>

          <Neighbors cards={cards} index={index} onJump={onJump} />

          <div className="mt-phi-3 flex items-center justify-center gap-phi-3">
            <button type="button" onClick={onPrev} disabled={index === 0} aria-label="Önceki alıntı (←)" className={navBtn}>
              <ChevronLeft size={22} aria-hidden />
            </button>
            <button type="button" role="switch" aria-checked={auto} onClick={() => setAutoSaved(!auto)}
                    title="Her kart okuma süresi kadar bekler, sonra kendiliğinden geçer. Karta dokununca durur."
                    className={cx("inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3 text-sm",
                      auto ? "border-gold bg-gold-soft text-text-primary" : "bg-surface text-text-secondary hover:text-text-primary")}>
              <span aria-hidden className={cx("relative inline-block h-5 w-8 rounded-full transition-colors", auto ? "bg-gold" : "bg-border")}>
                <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-soft transition-transform duration-200",
                  auto ? "translate-x-3.5" : "translate-x-0.5")} />
              </span>
              Kendiliğinden geç
            </button>
            <button type="button" onClick={onNext} aria-label={index + 1 >= cards.length ? "Oturumu bitir (→)" : "Sonraki alıntı (→)"} className={navBtn}>
              <ChevronRight size={22} aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-text-secondary">← → ya da kartı kaydır · G ile hepsini gör</p>
        </>
      )}
    </div>
  );
}
