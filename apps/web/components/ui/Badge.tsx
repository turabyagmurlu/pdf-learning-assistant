/**
 * Durum rozeti (TS-4). Etkilesimsiz; renk yalniz anlam tasir:
 * neutral (meta) · info ("hazırlanıyor") · success ("hazır") · warning · danger ("hata") · accent (secili/etiket).
 * Mor (accent) yalniz eylem/secim icin; durum icin info kullan.
 */
import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-text-secondary",
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  accent: "bg-accent-soft text-accent-purple",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  /** xs: dugme icinde (⚡N gibi); sm: varsayilan 20px */
  size?: "xs" | "sm";
  children?: ReactNode;
};

export default function Badge({ tone = "neutral", size = "sm", className = "", children, ...rest }: BadgeProps) {
  const s = size === "xs" ? "h-4 px-1.5" : "h-5 px-2";
  return (
    <span
      className={["inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium text-micro", s, TONE[tone], className].join(" ")}
      {...rest}
    >
      {children}
    </span>
  );
}
