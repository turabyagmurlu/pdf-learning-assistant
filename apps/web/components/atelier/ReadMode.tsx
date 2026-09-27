"use client";
/**
 * Oku (Akış): tek kart, ←/→ ya da kaydırma ile gezinme, "Sesli oku" (cihaz sesi, ücretsiz).
 */
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Volume2, Square } from "lucide-react";
import QuoteCard from "./QuoteCard";
import Progress from "./Progress";
import { useDeviceVoice } from "./voice";
import { useAtelierKeys, type AtelierCard } from "@/hooks/useAtelier";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const navBtn = "flex h-12 w-12 items-center justify-center rounded-full border bg-surface text-text-secondary shadow-soft " +
  "hover:text-text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold";

export default function ReadMode({ cards, index, onPrev, onNext }: {
  cards: AtelierCard[]; index: number; onPrev: () => void; onNext: () => void;
}) {
  const card = cards[index];
  const voice = useDeviceVoice();
  const speaking = voice.state !== "idle";
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Kart değişince okuma durur (yeni kart sessizce gelir)
  const { stop } = voice;
  useEffect(() => { stop(); }, [index, stop]);

  const toggleVoice = () => {
    if (!card) return;
    if (speaking) voice.stop();
    else voice.speak([card.text]);
  };

  useAtelierKeys({ ArrowLeft: onPrev, ArrowRight: onNext, s: toggleVoice, S: toggleVoice });

  if (!card) return null;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-4 pb-phi-5 md:px-8"
         onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }}
         onTouchEnd={(e) => {
           const s = touch.current; touch.current = null;
           if (!s) return;
           const t = e.changedTouches[0];
           const dx = t.clientX - s.x, dy = t.clientY - s.y;
           if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) (dx < 0 ? onNext : onPrev)();
         }}>
      <Progress index={index} count={cards.length} />
      <div key={card.key + ":" + index} className="card-turn mt-phi-3">
        <QuoteCard card={card} active={speaking}
                   footer={
                     <button type="button" onClick={toggleVoice} aria-pressed={speaking}
                             className={cx("inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm",
                               speaking ? "border-gold bg-gold-soft text-text-primary" : "text-text-secondary hover:text-text-primary")}>
                       {speaking ? <Square size={14} aria-hidden /> : <Volume2 size={15} aria-hidden />}
                       {speaking ? "Durdur" : "Sesli oku"}
                     </button>
                   } />
      </div>
      <div className="mt-phi-3 flex items-center justify-center gap-phi-4">
        <button type="button" onClick={onPrev} disabled={index === 0} aria-label="Önceki alıntı (←)" className={navBtn}>
          <ChevronLeft size={22} aria-hidden />
        </button>
        <span className="text-xs text-text-secondary">← → ya da kaydır</span>
        <button type="button" onClick={onNext} aria-label={index + 1 >= cards.length ? "Oturumu bitir (→)" : "Sonraki alıntı (→)"} className={navBtn}>
          <ChevronRight size={22} aria-hidden />
        </button>
      </div>
    </div>
  );
}
