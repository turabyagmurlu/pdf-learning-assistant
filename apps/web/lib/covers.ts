/**
 * Defter kapaklari: renk anahtari + simge adi.
 * Sunucudaki izinli listelerle (apps/api/app/api/collections.py COVER_COLORS / COVER_ICONS) AYNI sirada tutulur.
 * - Renk secilmemisse: id'den deterministik renk (sunucudaki default_cover_color ile ayni sonuc:
 *   uuid sayisi mod 8 == son onaltilik hane mod 8).
 * - Simge secilmemisse: BookOpen.
 * Tailwind siniflari tam metin olarak yazilir (derleyici bulabilsin); acik ve koyu tema icin ayri tonlar.
 */
import {
  Atom, BookOpen, Brain, Briefcase, Calculator, Code, Dna, Flag, FlaskConical, Gavel, Globe, GraduationCap,
  HeartPulse, History, Landmark, Languages, Leaf, Lightbulb, Microscope, Music, Palette, PenTool, Scale, Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const COVER_COLORS = ["teal", "coral", "purple", "blue", "amber", "pink", "green", "gray"] as const;
export type CoverColor = (typeof COVER_COLORS)[number];

export type CoverTone = {
  /** Turkce ad (ekran okuyucu + ipucu) */
  label: string;
  /** Kapak yuzeyi (acik zemin) */
  bg: string;
  /** Kapak uzerindeki simge / baslik rengi */
  fg: string;
  /** Kapak uzerindeki ikincil yazi ("N kaynak") */
  fgSoft: string;
  /** Kucuk renk noktasi / secim yuvarlagi (dolgu) */
  dot: string;
};

export const COVER_TONES: Record<CoverColor, CoverTone> = {
  teal: {
    label: "Deniz yeşili",
    bg: "bg-teal-100 dark:bg-teal-400/15",
    fg: "text-teal-900 dark:text-teal-100",
    fgSoft: "text-teal-800 dark:text-teal-200",
    dot: "bg-teal-600 dark:bg-teal-400",
  },
  coral: {
    label: "Mercan",
    bg: "bg-orange-100 dark:bg-orange-400/15",
    fg: "text-orange-900 dark:text-orange-100",
    fgSoft: "text-orange-800 dark:text-orange-200",
    dot: "bg-orange-600 dark:bg-orange-400",
  },
  purple: {
    label: "Mor",
    bg: "bg-violet-100 dark:bg-violet-400/15",
    fg: "text-violet-900 dark:text-violet-100",
    fgSoft: "text-violet-800 dark:text-violet-200",
    dot: "bg-violet-600 dark:bg-violet-400",
  },
  blue: {
    label: "Mavi",
    bg: "bg-sky-100 dark:bg-sky-400/15",
    fg: "text-sky-900 dark:text-sky-100",
    fgSoft: "text-sky-800 dark:text-sky-200",
    dot: "bg-sky-600 dark:bg-sky-400",
  },
  amber: {
    label: "Kehribar",
    bg: "bg-amber-100 dark:bg-amber-400/15",
    fg: "text-amber-900 dark:text-amber-100",
    fgSoft: "text-amber-900 dark:text-amber-200",
    dot: "bg-amber-500 dark:bg-amber-400",
  },
  pink: {
    label: "Pembe",
    bg: "bg-pink-100 dark:bg-pink-400/15",
    fg: "text-pink-900 dark:text-pink-100",
    fgSoft: "text-pink-800 dark:text-pink-200",
    dot: "bg-pink-600 dark:bg-pink-400",
  },
  green: {
    label: "Yeşil",
    bg: "bg-emerald-100 dark:bg-emerald-400/15",
    fg: "text-emerald-900 dark:text-emerald-100",
    fgSoft: "text-emerald-800 dark:text-emerald-200",
    dot: "bg-emerald-600 dark:bg-emerald-400",
  },
  gray: {
    label: "Gri",
    bg: "bg-stone-200 dark:bg-stone-400/15",
    fg: "text-stone-900 dark:text-stone-100",
    fgSoft: "text-stone-700 dark:text-stone-200",
    dot: "bg-stone-500 dark:bg-stone-400",
  },
};

export const COVER_ICONS: Record<string, { Icon: LucideIcon; label: string }> = {
  BookOpen: { Icon: BookOpen, label: "Kitap" },
  Flag: { Icon: Flag, label: "Bayrak" },
  FlaskConical: { Icon: FlaskConical, label: "Deney" },
  Trophy: { Icon: Trophy, label: "Kupa" },
  Landmark: { Icon: Landmark, label: "Kurum" },
  Scale: { Icon: Scale, label: "Terazi" },
  Brain: { Icon: Brain, label: "Beyin" },
  HeartPulse: { Icon: HeartPulse, label: "Sağlık" },
  Globe: { Icon: Globe, label: "Dünya" },
  Calculator: { Icon: Calculator, label: "Hesap" },
  Music: { Icon: Music, label: "Müzik" },
  Palette: { Icon: Palette, label: "Sanat" },
  Code: { Icon: Code, label: "Yazılım" },
  Leaf: { Icon: Leaf, label: "Doğa" },
  Atom: { Icon: Atom, label: "Fizik" },
  Dna: { Icon: Dna, label: "Biyoloji" },
  Microscope: { Icon: Microscope, label: "Mikroskop" },
  Gavel: { Icon: Gavel, label: "Hukuk" },
  History: { Icon: History, label: "Tarih" },
  Languages: { Icon: Languages, label: "Dil" },
  Briefcase: { Icon: Briefcase, label: "İş" },
  GraduationCap: { Icon: GraduationCap, label: "Okul" },
  Lightbulb: { Icon: Lightbulb, label: "Fikir" },
  PenTool: { Icon: PenTool, label: "Yazı" },
};
export const COVER_ICON_NAMES = Object.keys(COVER_ICONS);
export const DEFAULT_COVER_ICON = "BookOpen";

function isColor(v: unknown): v is CoverColor {
  return typeof v === "string" && (COVER_COLORS as readonly string[]).includes(v);
}

/** id'den deterministik renk (sunucuyla ayni: uuid sayisi mod 8 = son onaltilik hane mod 8). */
export function defaultCoverColor(id?: string | null): CoverColor {
  const h = (id || "").replace(/[^0-9a-f]/gi, "");
  const last = parseInt(h.slice(-1) || "0", 16);
  return COVER_COLORS[(Number.isFinite(last) ? last : 0) % COVER_COLORS.length];
}

export type Cover = { color: CoverColor; icon: string; tone: CoverTone; Icon: LucideIcon };

/** Defter nesnesinden (cover_color / cover_icon bos olabilir) gosterilecek kapak. */
export function coverOf(nb: { id?: string | null; cover_color?: string | null; cover_icon?: string | null } | null | undefined): Cover {
  const c = nb?.cover_color;
  const color: CoverColor = isColor(c) ? c : defaultCoverColor(nb?.id);
  const i = nb?.cover_icon;
  const icon = i && COVER_ICONS[i] ? i : DEFAULT_COVER_ICON;
  return { color, icon, tone: COVER_TONES[color], Icon: COVER_ICONS[icon].Icon };
}
