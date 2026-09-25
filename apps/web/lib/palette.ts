/**
 * Renk paleti (TS-6): konu rengi ile kaynak turu rengi ayrilir.
 * - Konu: `--data-1..6` (mor icermez). Kart kapagi, dagilim cubugu ve lejant HER ZAMAN konuyu gosterir;
 *   konu yoksa notr `bg-surface-muted`.
 * - Tur: yalniz ikon ve etiket metniyle. Ikon renkleri `TYPE_ICON_COLOR` (SourceIcon bunu kullanir).
 * `TOPIC_BAR` / `TYPE_BAR` kopyalari (collections/[id], notebooks) yerine buradaki yardimcilar kullanilir.
 */

/** Konu (veri) paleti — Tailwind zemin siniflari, sirayla dondurulur. */
export const TOPIC_PALETTE: string[] = ["bg-data-1", "bg-data-2", "bg-data-3", "bg-data-4", "bg-data-5", "bg-data-6"];

/** Kart kapagi icin acik ton (--data-N uzerine %15 saydamlik). */
export const TOPIC_TINT: string[] = ["bg-data-1/15", "bg-data-2/15", "bg-data-3/15", "bg-data-4/15", "bg-data-5/15", "bg-data-6/15"];

export type TopicColor = { bar: string; tint: string };

/** i. konunun rengi (dongusel): `bar` nokta/cubuk (dolgu), `tint` kart kapagi (acik zemin). */
export function topicColor(i: number): TopicColor {
  const n = TOPIC_PALETTE.length;
  const k = ((Math.trunc(i) % n) + n) % n;
  return { bar: TOPIC_PALETTE[k], tint: TOPIC_TINT[k] };
}

/** Konu belirsiz / yok: notr kapak. */
export const TOPIC_NEUTRAL = "bg-surface-muted";

/**
 * Kaynak turu ikon rengi (yalniz ikon; dolgu/dugme icin KULLANILMAZ).
 * Acik temada 700 tonlari (>= 4.5:1), koyu temada 300 tonlari.
 */
export const TYPE_ICON_COLOR: Record<string, string> = {
  pdf: "text-accent-purple",
  youtube: "text-red-700 dark:text-red-300",
  audio: "text-violet-700 dark:text-violet-300",
  docx: "text-blue-700 dark:text-blue-300",
  xlsx: "text-emerald-700 dark:text-emerald-300",
  csv: "text-emerald-700 dark:text-emerald-300",
  pptx: "text-orange-700 dark:text-orange-300",
  web: "text-sky-700 dark:text-sky-300",
  html: "text-sky-700 dark:text-sky-300",
  text: "text-amber-800 dark:text-amber-300",
  md: "text-amber-800 dark:text-amber-300",
  txt: "text-amber-800 dark:text-amber-300",
  rtf: "text-amber-800 dark:text-amber-300",
  epub: "text-fuchsia-700 dark:text-fuchsia-300",
  image: "text-accent-purple",
};

/** Tur ikon rengi; bilinmeyen tur → mor (PDF varsayilani). */
export function typeIconColor(kind?: string | null): string {
  return (kind && TYPE_ICON_COLOR[kind]) || TYPE_ICON_COLOR.pdf;
}
