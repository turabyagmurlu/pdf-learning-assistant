/** İnce altın ilerleme çubuğu + "7 / 24". */
export default function Progress({ index, count, label = "Alıntı" }: { index: number; count: number; label?: string }) {
  const n = Math.min(count, index + 1);
  const pct = count ? Math.round((n / count) * 100) : 0;
  return (
    <div className="flex items-center gap-phi-2">
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-gold-soft"
           role="progressbar" aria-label={`${label} ${n} / ${count}`} aria-valuemin={0} aria-valuemax={count} aria-valuenow={n}>
        <div className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
             style={{ width: pct + "%", background: "var(--gold)" }} />
      </div>
      <span className="shrink-0 font-heading text-sm tabular-nums text-text-secondary" aria-hidden>
        {n} <span className="text-gold">/</span> {count}
      </span>
    </div>
  );
}
