/**
 * Renk paleti (TS-6): konu rengi ile kaynak turu rengi ayrilir.
 * - Konu: `--data-1..6` (pigmentler; lapis icermez). Kart kapagi, dagilim cubugu ve lejant HER ZAMAN konuyu gosterir;
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
 * Kaynak turu ikon rengi (yalniz ikon; dolgu/dugme icin KULLANILMAZ) — Sfumato pigmentleri.
 * Hepsi token: acik/koyu tema kendiliginden. Ikon (metin disi) >= 3:1; hepsi --surface uzerinde >= 3.8:1.
 */
export const TYPE_ICON_COLOR: Record<string, string> = {
  pdf: "text-accent-purple",      // lapis
  youtube: "text-accent-coral",   // kirmizi tebesir
  audio: "text-data-5",           // menekse
  docx: "text-data-1",            // cini mavisi
  xlsx: "text-data-2",            // yesil toprak
  csv: "text-data-2",
  pptx: "text-data-3",            // asi boyasi
  web: "text-accent-teal",        // bakir yesili
  html: "text-accent-teal",
  text: "text-accent-amber",
  md: "text-accent-amber",
  txt: "text-accent-amber",
  rtf: "text-accent-amber",
  epub: "text-data-4",            // gul kurusu
  image: "text-accent-purple",
};

/** Tur ikon rengi; bilinmeyen tur → lapis (PDF varsayilani). */
export function typeIconColor(kind?: string | null): string {
  return (kind && TYPE_ICON_COLOR[kind]) || TYPE_ICON_COLOR.pdf;
}
