/**
 * TY PDF marka isareti (Sfumato): lapis madalyon, ince altin halka, "TY" Fraunces-ruhlu monogram.
 * Monogram yazi tipi yerine yol (path) olarak cizilir → uygulama ikonlarinda (next/og) da ayni gorunur.
 * day = gunduz (lapis + krem harf), night = gece muzesi (derin lapis + altin harf).
 * 200x200 koordinat uzayi; size ile olceklenir.
 * rounded=true  → saydam zemin uzerinde yuvarlak madalyon (menu, favicon)
 * rounded=false → parsomen kare zemin uzerinde madalyon (apple / kare ikon)
 * Bu dosya istemci kodu icermez: app/icon.tsx, apple-icon.tsx, icon-maskable de kullanir.
 * Renkler sabit hex (ikon ciziminde CSS degiskeni cozulmez); degerler globals.css token'lariyla ayni.
 */
export type BrandVariant = "day" | "night";

export const BRAND = {
  parchment: "#F4EEE3",
  night: "#13100C",
  lapis: "#2E4C8E",
  lapisDeep: "#1F3569",
  lapisLight: "#4A68AA",
  gold: "#C9A04E",
  goldDeep: "#A57A2C",
  cream: "#F7EFDC",
} as const;

/** Monogram: T ve Y, kalin-ince vurgulu, egik (bracketed) tirnakli serif harfler. */
export const MONO_T =
  "M47 66 L96 66 L97.2 80.5 L94.4 80.6 C92.6 73.8 89.4 71.8 83.8 71.8 L77.2 71.8 L77.2 126.8 C77.2 130.2 79.4 131.5 84.4 132 " +
  "L84.4 134.2 L59.6 134.2 L59.6 132 C64.6 131.5 66.8 130.2 66.8 126.8 L66.8 71.8 L60.2 71.8 C54.6 71.8 51.4 73.8 49.6 80.6 L46.8 80.5 Z";
export const MONO_Y =
  "M101.4 66 L123 66 L123 68.2 C118.6 68.6 118.2 70.4 119.8 73.4 L130.6 93.6 L140.8 74 C142.6 70.6 141.4 68.6 137.2 68.2 L137.2 66 " +
  "L153.6 66 L153.6 68.2 C149.8 68.8 147.8 70.4 145.2 75 L132.4 98.6 L132.4 126.8 C132.4 130.2 134.6 131.5 139.6 132 L139.6 134.2 " +
  "L114.8 134.2 L114.8 132 C119.8 131.5 122 130.2 122 126.8 L122 99.4 L108 74.2 C105.6 70 104.4 68.8 101.4 68.2 Z";

export function BrandMarkSvg({ variant = "day", size = 32, rounded = true, title }: {
  variant?: BrandVariant; size?: number; rounded?: boolean; title?: string;
}) {
  const id = "bm-" + variant + (rounded ? "-r" : "-s");
  const night = variant === "night";
  const letter = night ? BRAND.gold : BRAND.cream;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={title || "TY PDF"}
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* sfumato: sol ustten yumusak isik, kenarlara dogru derinlesen lapis */}
        <radialGradient id={id + "-g"} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor={night ? BRAND.lapis : BRAND.lapisLight} />
          <stop offset="62%" stopColor={night ? BRAND.lapisDeep : BRAND.lapis} />
          <stop offset="100%" stopColor={night ? "#16264D" : BRAND.lapisDeep} />
        </radialGradient>
      </defs>
      {!rounded && <rect width="200" height="200" fill={night ? BRAND.night : BRAND.parchment} />}
      {/* madalyon */}
      <circle cx="100" cy="100" r={rounded ? 98 : 86} fill={`url(#${id}-g)`} />
      <g transform={rounded ? undefined : "translate(100 100) scale(0.878) translate(-100 -100)"}>
        {/* ince altin halka + dis hairline */}
        <circle cx="100" cy="100" r="86" fill="none" stroke={BRAND.gold} strokeWidth="2.4" />
        <circle cx="100" cy="100" r="91.5" fill="none" stroke={BRAND.gold} strokeOpacity="0.55" strokeWidth="0.9" />
        {/* halkada dort kucuk elmas (pusula noktalari) */}
        <path d="M100 10.6 L102.6 14 L100 17.4 L97.4 14 Z M100 182.6 L102.6 186 L100 189.4 L97.4 186 Z" fill={BRAND.gold} />
        <path d="M10.6 100 L14 97.4 L17.4 100 L14 102.6 Z M182.6 100 L186 97.4 L189.4 100 L186 102.6 Z" fill={BRAND.gold} fillOpacity="0.8" />
        {/* monogram */}
        <g transform="translate(-0.6 0)">
          <path d={MONO_T} fill={letter} />
          <path d={MONO_Y} fill={letter} />
        </g>
        {/* altta ince altin ayrac */}
        <path d="M78 150.5 C90 148.6 110 148.6 122 150.5" fill="none" stroke={BRAND.gold} strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="100" cy="149.1" r="1.6" fill={BRAND.gold} />
      </g>
    </svg>
  );
}

/**
 * Tam alan kaplayan sfumato manzara (Leonardo'nun arka plan manzaralari ruhunda, ozgun):
 * parsomen gokyuzu, uzakta mavimsi sisli tepeler, altin bir nehir kivrimi. Harfsiz; kenarlari kirpar.
 */
export function BrandScene({ variant = "day", className = "" }: { variant?: BrandVariant; className?: string }) {
  const n = variant === "night";
  const id = "bs-" + variant;
  return (
    <svg className={className} viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"
         width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={id + "-sky"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={n ? "#13100C" : "#F4EEE3"} />
          <stop offset="70%" stopColor={n ? "#1D2233" : "#E4E3DC"} />
          <stop offset="100%" stopColor={n ? "#23283A" : "#D9DDDB"} />
        </linearGradient>
        <filter id={id + "-haze"} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <rect width="200" height="200" fill={`url(#${id}-sky)`} />
      <g filter={`url(#${id}-haze)`}>
        <path d="M0 118 C18 96 30 88 46 98 C60 76 74 70 88 90 C102 72 118 66 134 86 C150 70 170 72 200 96 L200 200 L0 200 Z"
              fill={n ? "#2A3350" : "#B9C3CF"} fillOpacity="0.7" />
        <path d="M0 140 C22 122 40 118 58 128 C76 110 96 108 114 124 C134 110 158 112 200 128 L200 200 L0 200 Z"
              fill={n ? "#262B3C" : "#9FA8AE"} fillOpacity="0.75" />
      </g>
      <path d="M0 164 C30 150 58 150 84 158 C112 148 150 146 200 158 L200 200 L0 200 Z" fill={n ? "#1B1712" : "#8C7A60"} fillOpacity={n ? 1 : 0.55} />
      <path d="M0 184 C40 172 80 176 120 182 C150 186 176 182 200 176 L200 200 L0 200 Z" fill={n ? "#13100C" : "#66563F"} fillOpacity={n ? 1 : 0.55} />
      {/* altin nehir */}
      <path d="M104 132 C98 140 116 144 108 152 C100 160 124 164 112 176 C104 184 132 190 126 200"
            fill="none" stroke={n ? "#D6B062" : "#A57A2C"} strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
