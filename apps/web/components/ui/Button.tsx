"use client";
/**
 * Tek dugme bileseni (TS-2).
 * - variant: primary (dolgulu, tek mor) | secondary (cerceveli) | ghost (zeminsiz)
 * - size: sm 36px | md 40px | lg 44px (hepsi >= 36px dokunma hedefi; telefonda md → 44px)
 * - tone: "danger" → silme gibi geri alinamaz eylemler
 * - cost: "⚡N" rozeti (yapay zeka cagrisi harcayan dugmeler)
 * - icon: yalniz ikonlu kare dugme (aria-label zorunlu)
 * Kaynak turune gore renkli dolgu YOK: tur rengi yalniz ikonda kalir.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Cost } from "@/components/CostBadge";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  tone?: "danger";
  cost?: number;
  icon?: boolean;
  /** Sol/sag ikon gibi ek icerik icin children kullanilir */
  children?: ReactNode;
};

const BASE =
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-medium " +
  "transition-colors disabled:pointer-events-none disabled:opacity-50 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-purple";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent-purple text-on-accent hover:bg-accent-purple/90",
  secondary: "border border-border-strong/60 bg-surface text-text-primary hover:bg-surface-hover",
  ghost: "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
};

const DANGER: Record<ButtonVariant, string> = {
  primary: "bg-danger text-on-accent hover:bg-danger/90",
  secondary: "border border-danger/50 bg-surface text-danger hover:bg-danger-bg",
  ghost: "text-danger hover:bg-danger-bg",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-small",
  md: "h-10 px-4 text-body touch:h-11",
  lg: "h-11 px-5 text-body",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "h-9 w-9",
  md: "h-10 w-10 touch:h-11 touch:w-11",
  lg: "h-11 w-11",
};

/** Sinif dizisini disari da verir: <a> ya da <Link> ayni gorunumu alsin. */
export function buttonClass({ variant = "secondary", size = "md", tone, icon, className = "" }: {
  variant?: ButtonVariant; size?: ButtonSize; tone?: "danger"; icon?: boolean; className?: string;
}) {
  const v = tone === "danger" ? DANGER[variant] : VARIANT[variant];
  const s = icon ? ICON_SIZE[size] : SIZE[size];
  return [BASE, v, s, className].filter(Boolean).join(" ");
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", tone, cost, icon, className = "", type = "button", children, ...rest },
  ref,
) {
  const costCls = variant === "primary" ? "bg-on-accent/15" : "";
  return (
    <button ref={ref} type={type} className={buttonClass({ variant, size, tone, icon, className })} {...rest}>
      {children}
      {cost ? <Cost n={cost} className={costCls} /> : null}
    </button>
  );
});

export default Button;
