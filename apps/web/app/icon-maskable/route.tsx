import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * Maskable (Android uyarlanabilir) ikon: 512x512, /icon-maskable.
 * Sahne %76 olcekte ortada; kenarlar duz gokyuzu rengiyle dolu. "TY" harfleri ve gunes
 * guvenli bolgede (merkezden %40 yaricap = 205 px) kalir; Android yuvarlak/kare maske kirpsa da okunur.
 * `/icon` (purpose: any) ile ayni cizim; yalniz ic bosluk ve harf konumu farkli.
 */
export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: 512, height: 512, display: "flex", background: "#f6b45c" }}>
        {/* viewBox -32..232: 200 birimlik sahne 512 px'in %76'sini kaplar */}
        <svg width="512" height="512" viewBox="-32 -32 264 264">
          <rect x="-32" y="-32" width="264" height="264" fill="#f6b45c" />
          <rect x="-32" y="-32" width="264" height="122" fill="#fbd27f" />
          <rect x="-32" y="-32" width="264" height="78" fill="#fde5a6" />
          <g fill="#f9c96a">
            <path d="M100 90 L-32 -22 L-32 2 Z" /><path d="M100 90 L30 -32 L58 -32 Z" /><path d="M100 90 L88 -32 L112 -32 Z" />
            <path d="M100 90 L142 -32 L170 -32 Z" /><path d="M100 90 L232 -22 L232 2 Z" />
            <path d="M100 90 L-32 50 L-32 68 Z" /><path d="M100 90 L232 50 L232 68 Z" />
          </g>
          <circle cx="100" cy="92" r="40" fill="#ffd166" />
          <circle cx="100" cy="92" r="32" fill="#f4772e" />
          <path d="M-32 232 L-32 130 Q40 108 90 124 Q140 140 232 118 L232 232 Z" fill="#d4652c" />
          <path d="M-32 232 L-32 148 Q60 128 110 144 Q160 160 232 140 L232 232 Z" fill="#b8481f" />
          <path d="M-32 232 L-32 168 Q100 146 232 172 L232 232 Z" fill="#7a2f12" />
          <path d="M-32 232 L-32 186 Q100 172 232 188 L232 232 Z" fill="#4e1c0a" />
          <path d="M0 0 L42 24 L42 176 L0 200 Z" fill="#fbf6ea" />
          <path d="M42 24 L48 28 L48 172 L42 176 Z" fill="#dcc9a2" />
          <path d="M200 0 L158 24 L158 176 L200 200 Z" fill="#fbf6ea" />
          <path d="M158 24 L152 28 L152 172 L158 176 Z" fill="#dcc9a2" />
          <path d="M8 52 L32 60 M8 68 L32 74 M8 84 L28 88 M8 102 L30 106" stroke="#e6d3b3" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M192 52 L168 60 M192 68 L168 74 M192 84 L172 88 M192 102 L170 106" stroke="#e6d3b3" strokeWidth="3" strokeLinecap="round" fill="none" />
        </svg>
        <div style={{
          position: "absolute", left: 0, right: 0, top: 388, display: "flex", justifyContent: "center",
          fontSize: 54, fontWeight: 700, color: "#ffe1a8", letterSpacing: 12, fontFamily: "serif",
        }}>TY</div>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
