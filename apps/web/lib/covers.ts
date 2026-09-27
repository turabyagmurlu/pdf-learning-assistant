/**
 * Defter kapaklari: renk anahtari + simge adi.
 * Sunucudaki izinli listelerle (apps/api/app/api/collections.py COVER_COLORS / COVER_ICONS) AYNI sirada tutulur.
 * - Renk secilmemisse: id'den deterministik renk (sunucudaki default_cover_color ile ayni sonuc:
 *   uuid sayisi mod 8 == son onaltilik hane mod 8).
 * - Simge secilmemisse: BookOpen.
 * Tailwind siniflari tam metin olarak yazilir (derleyici bulabilsin); acik ve koyu tema icin ayri tonlar.
 * Sfumato: Tailwind hazir paleti yerine Leonardo pigmentleri (bakir yesili, kirmizi tebesir, lapis, asi boyasi...).
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

/* Pigment tonlari (Sfumato). Kontrast: fg/zemin >= 7.3:1, fgSoft/zemin >= 5.0:1 (acik);
 * koyu temada (%14 pigment, --surface uzerinde) fg >= 10.7:1, fgSoft >= 7.8:1. */
export const COVER_TONES: Record<CoverColor, CoverTone> = {
  teal: {
    label: "Bakır yeşili",
    bg: "bg-[#DCEAE4] dark:bg-[rgba(114_195_170_/_0.14)]",
    fg: "text-[#1F4F43] dark:text-[#D3EEE5]",
    fgSoft: "text-[#2C6B5B] dark:text-[#A9DCCB]",
    dot: "bg-[#2C6B5B] dark:bg-[#72C3AA]",
  },
  coral: {
    label: "Kırmızı tebeşir",
    bg: "bg-[#F4DDD3] dark:bg-[rgba(238_155_128_/_0.14)]",
    fg: "text-[#6E2A18] dark:text-[#F8DDD3]",
    fgSoft: "text-[#8C3822] dark:text-[#F2B8A4]",
    dot: "bg-[#A2432A] dark:bg-[#EE9B80]",
  },
  purple: {
    label: "Menekşe",
    bg: "bg-[#E6E0EE] dark:bg-[rgba(163_166_218_/_0.14)]",
    fg: "text-[#3B3566] dark:text-[#E4E3F6]",
    fgSoft: "text-[#4C4F85] dark:text-[#C4C6EC]",
    dot: "bg-[#56598F] dark:bg-[#A3A6DA]",
  },
  blue: {
    label: "Lapis",
    bg: "bg-[#DDE4F1] dark:bg-[rgba(157_179_236_/_0.14)]",
    fg: "text-[#1F3569] dark:text-[#E1E8FA]",
    fgSoft: "text-[#2E4C8E] dark:text-[#BCCBF2]",
    dot: "bg-[#2E4C8E] dark:bg-[#9DB3EC]",
  },
  amber: {
    label: "Aşı boyası",
    bg: "bg-[#F3E4C4] dark:bg-[rgba(228_180_95_/_0.14)]",
    fg: "text-[#5E3D0A] dark:text-[#F6E6C6]",
    fgSoft: "text-[#7A5210] dark:text-[#EBCB8C]",
    dot: "bg-[#B0702A] dark:bg-[#E4B45F]",
  },
  pink: {
    label: "Gül kurusu",
    bg: "bg-[#F1DCE0] dark:bg-[rgba(208_138_157_/_0.14)]",
    fg: "text-[#6A2F3E] dark:text-[#F5DDE3]",
    fgSoft: "text-[#8A3F52] dark:text-[#E6B3C0]",
    dot: "bg-[#9A4A5E] dark:bg-[#D08A9D]",
  },
  green: {
    label: "Yeşil toprak",
    bg: "bg-[#E1E8D3] dark:bg-[rgba(163_189_126_/_0.14)]",
    fg: "text-[#3A4D22] dark:text-[#E4EDD8]",
    fgSoft: "text-[#4F6630] dark:text-[#C6D8AD]",
    dot: "bg-[#5E7A3A] dark:bg-[#A3BD7E]",
  },
  gray: {
    label: "Umber",
    bg: "bg-[#E8DFD0] dark:bg-[rgba(196_176_138_/_0.14)]",
    fg: "text-[#3D3024] dark:text-[#EDE3D2]",
    fgSoft: "text-[#5B4C39] dark:text-[#D1C2A6]",
    dot: "bg-[#86714E] dark:bg-[#C4B08A]",
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
