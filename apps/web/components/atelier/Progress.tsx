/**
 * İnce ilerleme çubuğu + "7 / 24". Kart geçişiyle aynı sürede akıcı dolar (transform: GPU dostu).
 * Ekran okuyucuya "Alıntı 7 / 24" kibarca duyurulur (`announce` kapatılabilir; ör. sesli dinlerken).
 */
export default function Progress({ index, count, label = "Alıntı", announce = true }: {
  index: number; count: number; label?: string; announce?: boolean;
}) {
  const n = Math.min(count, index + 1);
  const ratio = count ? n / count : 0;
  return (
    <div className="flex items-center gap-phi-2">
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-gold-soft"
           role="progressbar" aria-label={`${label} ${n} / ${count}`} aria-valuemin={0} aria-valuemax={count} aria-valuenow={n}>
        <div className="deck-progress h-full w-full rounded-full"
             style={{ transform: `scaleX(${ratio})`, background: "var(--gold)" }} />
      </div>
      <span className="shrink-0 font-heading text-sm tabular-nums text-text-secondary" aria-hidden>
        {n} <span className="text-gold">/</span> {count}
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announce && count ? `${label} ${n} / ${count}` : ""}
      </span>
    </div>
  );
}
