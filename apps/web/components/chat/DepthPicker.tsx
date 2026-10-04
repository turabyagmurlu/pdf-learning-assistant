"use client";
/**
 * Derinlik seçici — tek satır: Kısa · Ayrıntılı · Derin ⚡2. Varsayılan Ayrıntılı; seçim saklanır.
 * Her düğme ≥44px, radiogroup olarak erişilebilir.
 */
import { Cost } from "@/components/CostBadge";
import { DEPTHS, type Depth } from "./depth";

export default function DepthPicker({ value, onChange, compact, disabled }: {
  value: Depth; onChange: (d: Depth) => void; compact?: boolean; disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Cevap derinliği"
         className={"flex items-center gap-1 rounded-xl border bg-surface-muted p-0.5 " + (compact ? "text-xs" : "text-sm")}>
      {DEPTHS.map((d) => {
        const on = d.id === value;
        return (
          <button key={d.id} type="button" role="radio" aria-checked={on} title={d.hint} disabled={disabled}
                  onClick={() => onChange(d.id)}
                  className={"flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg px-2.5 font-medium transition disabled:opacity-60 " +
                    (on ? "bg-surface text-text-primary shadow-sm ring-1 ring-accent-purple/40" : "text-text-secondary hover:text-text-primary")}>
            {d.label}
            {d.cost > 1 && <Cost n={d.cost} className={on ? "bg-accent-purple/10" : ""} />}
          </button>
        );
      })}
    </div>
  );
}
