"use client";
/**
 * Maliyet seffafligi: Gemini cagrisi yapan dugmelerde "⚡N" rozeti (TK-3: ipucu "N Gemini çağrısı";
 * sahip kisisel sinirdan muaf oldugu icin "günlük kullanımından düşer" denmez).
 * Ekran okuyucu "simsek" demesin: gorunen rozet aria-hidden, yaninda sr-only aciklama.
 * Ayrica servis doldu hatasini (USAGE_LIMIT) diger hatalardan ayiran yardimcilar.
 */
import { Clock } from "lucide-react";

export function Cost({ n = 1, className = "" }: { n?: number; className?: string }) {
  const k = Math.max(1, Math.round(n || 1));
  // Dolgulu (mor) dugme icinde Button `bg-on-accent/15` verir; o zaman varsayilan zemin eklenmez.
  const bg = /\bbg-/.test(className) ? "" : "bg-surface-muted ";
  return (
    <>
      <span aria-hidden className={"ml-1 inline-flex items-center rounded-full px-1.5 text-2xs font-medium leading-5 " + bg + className}>
        ⚡{k}
      </span>
      <span className="sr-only"> ({k} Gemini çağrısı)</span>
    </>
  );
}

/** Dugme title'i icin: "N Gemini çağrısı". */
export function costTitle(n = 1) {
  return `${Math.max(1, Math.round(n || 1))} Gemini çağrısı`;
}

/** Gemini doldu / yogun mu? (lib/api hata objesine `code` koyar.) */
export function isUsageLimit(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "USAGE_LIMIT";
}

export type Err = { text: string; limit: boolean } | null;

/** Hata nesnesini ekranda gosterilecek hale getirir; metin disi ayrinti sizmaz. */
export function toErr(e: unknown, fallback: string): Err {
  const m = e && typeof e === "object" ? (e as { message?: unknown }).message : null;
  const text = typeof m === "string" && m.trim() ? m : fallback;
  return { text, limit: isUsageLimit(e) };
}

/** Hata satiri: Gemini yogun/dolu sari (bilgi), digerleri kirmizi. */
export function ErrNote({ err, className = "" }: { err: Err; className?: string }) {
  if (!err) return null;
  if (err.limit) {
    return (
      <p role="status" className={"flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-warning " + className}>
        <Clock size={15} className="mt-0.5 shrink-0" />
        <span>{err.text} Kayıtlı cevaplar, arama ve okuma çalışmaya devam eder.</span>
      </p>
    );
  }
  return <p role="alert" className={"text-sm text-danger " + className}>{err.text}</p>;
}
