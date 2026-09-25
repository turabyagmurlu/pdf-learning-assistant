"use client";
/**
 * Maliyet seffafligi: yapay zeka kullanimi harcayan dugmelerde "⚡N" rozeti.
 * Ekran okuyucu "simsek" demesin: gorunen rozet aria-hidden, yaninda sr-only aciklama.
 * Ayrica kisisel limit hatasini (USAGE_LIMIT) diger hatalardan ayiran yardimcilar.
 */
import { Clock } from "lucide-react";

export function Cost({ n = 1, className = "" }: { n?: number; className?: string }) {
  const k = Math.max(1, Math.round(n || 1));
  return (
    <>
      <span aria-hidden className={"ml-1 inline-flex items-center rounded-full bg-black/5 px-1.5 text-[11px] font-medium leading-5 dark:bg-white/10 " + className}>
        ⚡{k}
      </span>
      <span className="sr-only"> ({k} yapay zekâ kullanımı)</span>
    </>
  );
}

/** Dugme title'i icin: "Yapay zekâ kullanımından N düşer". */
export function costTitle(n = 1) {
  return `Yapay zekâ kullanımından ${Math.max(1, Math.round(n || 1))} düşer`;
}

/** Kisisel gunluk limit doldu mu? (lib/api hata objesine `code` koyar.) */
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

/** Hata satiri: kisisel limit sade/sari, digerleri kirmizi. */
export function ErrNote({ err, className = "" }: { err: Err; className?: string }) {
  if (!err) return null;
  if (err.limit) {
    return (
      <p role="status" className={"flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 " + className}>
        <Clock size={15} className="mt-0.5 shrink-0" />
        <span>{err.text} Kayıtlı cevaplar, arama ve okuma çalışmaya devam eder.</span>
      </p>
    );
  }
  return <p role="alert" className={"text-sm text-danger " + className}>{err.text}</p>;
}
