/**
 * Altin spiral — ozgun el cizimi (Fibonacci karelerinden kurulmus, hafif titrek cizgi).
 * Insaat cizgileri umber murekkeple (currentColor, soluk), spiral altin varakla (--gold),
 * ikinci iz kirmizi tebesirle (--accent-coral). animate=true → cizilerek belirir
 * (stroke-dashoffset; prefers-reduced-motion'da dogrudan tam gorunur).
 */
import type { CSSProperties } from "react";

export type GoldenSpiralProps = {
  /** Genislik (px); yukseklik 240/376 oranindan hesaplanir */
  size?: number;
  /** Cizilerek belirsin mi */
  animate?: boolean;
  className?: string;
  style?: CSSProperties;
};

const SPIRAL = "M10 230.1 C10.5 224.3 11.3 206.9 13.1 195.6 C14.9 184.2 17.3 173 20.8 162.1 C24.2 151.2 28.5 140.3 33.7 130.1 C38.9 119.9 45.4 110.3 52.1 101 C58.9 91.6 66 82.4 74.1 74.3 C82.1 66.2 90.9 59.1 100.3 52.3 C109.7 45.5 119.9 38.8 130.3 33.6 C140.7 28.4 151.5 24.6 162.5 21.2 C173.4 17.7 184.5 14.7 195.7 12.8 C206.9 10.9 220.4 9.8 229.7 9.6 C239 9.3 244.3 10.1 251.3 11.3 C258.3 12.4 265.1 14.2 271.7 16.4 C278.4 18.7 285 21.5 291.3 24.8 C297.7 28.1 304.1 32.1 309.9 36.3 C315.7 40.5 321.2 45 326.2 50 C331.2 54.9 335.9 60.5 340 66.2 C344.2 71.9 347.8 77.7 351.1 84.1 C354.4 90.4 357.5 97.6 359.8 104.4 C362 111.2 363.6 118 364.6 124.9 C365.6 131.8 366 139.2 365.8 145.8 C365.7 152.3 365 158.2 363.7 164.3 C362.4 170.4 360.5 176.7 357.9 182.4 C355.3 188 351.8 193.3 348 198.3 C344.1 203.2 339.8 208.1 334.8 212 C329.8 215.8 323.6 218.8 318 221.4 C312.4 224.1 307 226.5 301.1 227.9 C295.1 229.3 289 230.2 282.4 229.9 C275.9 229.6 267.9 228.7 261.7 226.2 C255.6 223.6 250.2 219.3 245.5 214.6 C240.8 209.8 236.1 203.8 233.6 197.7 C231 191.7 230.2 184.1 230.3 178.1 C230.3 172.2 231.5 166.5 234.1 161.9 C236.7 157.2 241.1 152.7 245.8 150 C250.5 147.4 257.7 146.1 262.1 145.9 C266.5 145.7 269.2 147 272 148.7 C274.9 150.4 277.6 153.2 279.2 156.1 C280.9 159 281.7 163.4 281.9 166 C282.1 168.7 281.3 170.3 280.3 172 C279.3 173.7 277.6 175.3 275.9 176.3 C274.2 177.4 271.7 177.9 270.1 178 C268.4 178.1 267.1 177.7 266 177 C264.8 176.3 263.7 175.1 263 174 C262.4 172.8 262.2 170.7 262 170";
const SQUARES = "M10.4 10.1L229.6 10.5L229.7 229.8L10.3 229.8ZM229.8 9.6L365.6 10.1L365.7 146.1L229.9 146ZM282.5 146L366.1 146.4L365.7 229.7L282.4 230.3ZM229.7 177.7L282.2 178.4L281.7 230.5L230.4 230.1ZM229.9 145.6L261.5 146.5L261.7 178.2L229.8 178.3ZM262.1 145.8L281.7 146.2L281.6 165.7L262.1 166.4ZM270.1 165.8L282.4 165.7L281.5 177.8L269.9 177.6Z";

export default function GoldenSpiral({ size = 320, animate = false, className = "", style }: GoldenSpiralProps) {
  const a = (n: 1 | 2 | 3) => (animate ? "draw-in" + (n > 1 ? " draw-in-" + n : "") : undefined);
  return (
    <svg width={size} height={Math.round((size * 240) / 376)} viewBox="0 0 376 240" fill="none"
         aria-hidden="true" focusable="false" className={className} style={style}>
      {/* insaat: Fibonacci kareleri, soluk murekkep */}
      <path d={SQUARES} pathLength={1} className={a(2)} stroke="currentColor" strokeOpacity={0.28}
            strokeWidth={0.9} strokeLinejoin="round" />
      {/* pergel izleri: kucuk yay isaretleri */}
      <path d="M8 222 q4 -3 8 0 M226 14 q3 -4 7 -1 M360 150 q3 3 0 7" pathLength={1} className={a(2)}
            stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.9} strokeLinecap="round" />
      {/* ikinci iz: kirmizi tebesir, hafif kaymis */}
      <path d={SPIRAL} pathLength={1} className={a(3)} transform="translate(1.6 -1.2)"
            style={{ stroke: "var(--accent-coral)" }} strokeOpacity={0.35} strokeWidth={0.8} strokeLinecap="round" />
      {/* ana spiral: altin varak */}
      <path d={SPIRAL} pathLength={1} className={a(1)} style={{ stroke: "var(--gold)" }}
            strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      {/* goz: spiralin odagi */}
      <circle cx="262" cy="170" r="2.2" style={{ fill: "var(--gold)" }} />
      <circle cx="262" cy="170" r="5.5" stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.7} />
    </svg>
  );
}
