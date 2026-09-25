"use client";
/**
 * Suzgec cipi (TS-4). Etkilesimli; tek "secili" stili (tur / kategori / etiket ayni gorunur).
 * - active: secili (mor yumusak zemin + mor yazi)
 * - count: sagda kucuk sayi
 * Gorsel yukseklik 32px; dokunmatikte gorunmez ::after ile dokunma alani 44px'e genisler.
 * Mor yalniz secim anlami tasir; renkli dolgu yok.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type FilterChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  count?: number | string | null;
  children?: ReactNode;
};

const BASE =
  "relative inline-flex h-8 shrink-0 select-none items-center gap-1 whitespace-nowrap rounded-full border px-3 text-small " +
  "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-purple " +
  "disabled:pointer-events-none disabled:opacity-50 " +
  "touch:after:absolute touch:after:-inset-y-1.5 touch:after:inset-x-0 touch:after:content-['']";
const OFF = "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary";
const ON = "border-accent-purple/40 bg-accent-soft text-accent-purple";

/** Sinif dizisini disari da verir: <Link> ya da <label> ayni gorunumu alsin. */
export function filterChipClass(active?: boolean, className = "") {
  return [BASE, active ? ON : OFF, className].filter(Boolean).join(" ");
}

const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip(
  { active = false, count, className = "", type = "button", children, ...rest },
  ref,
) {
  const hasCount = count !== undefined && count !== null && count !== "";
  return (
    <button ref={ref} type={type} aria-pressed={rest["aria-pressed"] ?? active}
            className={filterChipClass(active, className)} {...rest}>
      {children}
      {hasCount && (
        <span className={"rounded-full px-1.5 text-micro " + (active ? "bg-accent-purple/15" : "bg-surface-muted text-text-secondary")}>
          {count}
        </span>
      )}
    </button>
  );
});

export default FilterChip;
