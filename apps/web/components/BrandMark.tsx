/** TY PDF marka isareti. day = Ş1 (isin huzmeli gun dogumu), night = Ş2 (yildizli alacakaranlik).
 *  200x200 koordinat uzayinda cizilir; size ile olceklenir. rounded=false → tam kare (maskable/apple ikon). */
export type BrandVariant = "day" | "night";

export function BrandMarkSvg({ variant = "day", size = 32, rounded = true, title }: {
  variant?: BrandVariant; size?: number; rounded?: boolean; title?: string;
}) {
  const id = "bm-" + variant + (rounded ? "-r" : "-s");
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={title || "TY PDF"}>
      {rounded && (
        <defs>
          <clipPath id={id}><rect width="200" height="200" rx="44" /></clipPath>
        </defs>
      )}
      <g clipPath={rounded ? `url(#${id})` : undefined}>
        {variant === "day" ? <Day letters /> : <Night letters />}
      </g>
    </svg>
  );
}

/** Tam alan kaplayan sahne (giris ekrani sol panel gibi). Harfsiz; kenarlari kirpar. */
export function BrandScene({ variant = "day", className = "" }: { variant?: BrandVariant; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"
         width="100%" height="100%" aria-hidden="true">
      {variant === "day" ? <Day letters={false} /> : <Night letters={false} />}
    </svg>
  );
}

function Doors({ paper, edge, line }: { paper: string; edge: string; line: string }) {
  return (
    <>
      <path d="M0 0 L42 24 L42 176 L0 200 Z" fill={paper} />
      <path d="M42 24 L48 28 L48 172 L42 176 Z" fill={edge} />
      <path d="M200 0 L158 24 L158 176 L200 200 Z" fill={paper} />
      <path d="M158 24 L152 28 L152 172 L158 176 Z" fill={edge} />
      <path d="M8 52 L32 60 M8 68 L32 74 M8 84 L28 88 M8 102 L30 106" stroke={line} strokeWidth="3" strokeLinecap="round" />
      <path d="M192 52 L168 60 M192 68 L168 74 M192 84 L172 88 M192 102 L170 106" stroke={line} strokeWidth="3" strokeLinecap="round" />
    </>
  );
}

function Day({ letters = true }: { letters?: boolean }) {
  return (
    <>
      <rect width="200" height="200" fill="#f6b45c" />
      <rect width="200" height="90" fill="#fbd27f" />
      <rect width="200" height="46" fill="#fde5a6" />
      <g fill="#f9c96a">
        <path d="M100 90 L0 10 L0 34 Z" /><path d="M100 90 L30 0 L58 0 Z" /><path d="M100 90 L88 0 L112 0 Z" />
        <path d="M100 90 L142 0 L170 0 Z" /><path d="M100 90 L200 10 L200 34 Z" />
        <path d="M100 90 L0 60 L0 78 Z" /><path d="M100 90 L200 60 L200 78 Z" />
      </g>
      <circle cx="100" cy="92" r="40" fill="#ffd166" />
      <circle cx="100" cy="92" r="32" fill="#f4772e" />
      <path d="M0 200 L0 126 Q40 108 90 124 Q140 140 200 116 L200 200 Z" fill="#d4652c" />
      <path d="M0 200 L0 144 Q60 128 110 144 Q160 160 200 138 L200 200 Z" fill="#b8481f" />
      <path d="M0 200 L0 166 Q100 146 200 170 L200 200 Z" fill="#7a2f12" />
      <path d="M0 200 L0 184 Q100 172 200 186 L200 200 Z" fill="#4e1c0a" />
      <Doors paper="#fbf6ea" edge="#dcc9a2" line="#e6d3b3" />
      {letters && <text x="100" y="188" textAnchor="middle" fontFamily="Georgia, serif" fontSize="22" fontWeight="700" fill="#ffe1a8" letterSpacing="5">TY</text>}
    </>
  );
}

function Night({ letters = true }: { letters?: boolean }) {
  return (
    <>
      <rect width="200" height="200" fill="#1c1747" />
      <rect width="200" height="120" fill="#3b2a6e" />
      <rect width="200" height="90" fill="#6b3f8f" />
      <rect y="80" width="200" height="40" fill="#b8507a" />
      <rect y="100" width="200" height="24" fill="#e8784f" />
      <g fill="#fff3c4">
        <circle cx="24" cy="18" r="1.6" /><circle cx="60" cy="30" r="1.2" /><circle cx="90" cy="14" r="1.8" />
        <circle cx="130" cy="26" r="1.2" /><circle cx="168" cy="16" r="1.6" /><circle cx="150" cy="44" r="1.2" />
        <circle cx="46" cy="52" r="1.2" /><circle cx="110" cy="46" r="1.4" />
      </g>
      <circle cx="100" cy="112" r="34" fill="#ffb347" />
      <circle cx="100" cy="112" r="26" fill="#ff8a3d" />
      <path d="M0 200 L0 130 L28 106 L58 128 L90 96 L124 124 L156 100 L182 118 L200 108 L200 200 Z" fill="#5a2c5e" />
      <path d="M0 200 L0 150 L40 132 L80 150 L120 128 L164 148 L200 134 L200 200 Z" fill="#341a44" />
      <path d="M0 200 L0 172 L60 160 L120 172 L200 158 L200 200 Z" fill="#1a0f2a" />
      <Doors paper="#ecdfc4" edge="#c9b48c" line="#d6c39c" />
      {letters && <text x="100" y="188" textAnchor="middle" fontFamily="Georgia, serif" fontSize="22" fontWeight="700" fill="#ffb347" letterSpacing="5">TY</text>}
    </>
  );
}
