import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/* Ş1: isin huzmeli gun dogumu, kapi gibi acilan sayfalar. purpose: any (kirpilmaz).
 * Maskable (Android) icin ayri: app/icon-maskable/route.tsx — harfler guvenli bolgede. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: 512, height: 512, display: "flex", position: "relative", background: "#f6b45c" }}>
        <svg width="512" height="512" viewBox="0 0 200 200" style={{ position: "absolute", top: 0, left: 0 }}>
          <rect width="200" height="200" fill="#f6b45c" />
          <rect width="200" height="90" fill="#fbd27f" />
          <rect width="200" height="46" fill="#fde5a6" />
          <path d="M100 90 L0 10 L0 34 Z" fill="#f9c96a" />
          <path d="M100 90 L30 0 L58 0 Z" fill="#f9c96a" />
          <path d="M100 90 L88 0 L112 0 Z" fill="#f9c96a" />
          <path d="M100 90 L142 0 L170 0 Z" fill="#f9c96a" />
          <path d="M100 90 L200 10 L200 34 Z" fill="#f9c96a" />
          <path d="M100 90 L0 60 L0 78 Z" fill="#f9c96a" />
          <path d="M100 90 L200 60 L200 78 Z" fill="#f9c96a" />
          <circle cx="100" cy="92" r="40" fill="#ffd166" />
          <circle cx="100" cy="92" r="32" fill="#f4772e" />
          <path d="M0 200 L0 126 Q40 108 90 124 Q140 140 200 116 L200 200 Z" fill="#d4652c" />
          <path d="M0 200 L0 144 Q60 128 110 144 Q160 160 200 138 L200 200 Z" fill="#b8481f" />
          <path d="M0 200 L0 166 Q100 146 200 170 L200 200 Z" fill="#7a2f12" />
          <path d="M0 200 L0 184 Q100 172 200 186 L200 200 Z" fill="#4e1c0a" />
          <path d="M0 0 L42 24 L42 176 L0 200 Z" fill="#fbf6ea" />
          <path d="M42 24 L48 28 L48 172 L42 176 Z" fill="#dcc9a2" />
          <path d="M200 0 L158 24 L158 176 L200 200 Z" fill="#fbf6ea" />
          <path d="M158 24 L152 28 L152 172 L158 176 Z" fill="#dcc9a2" />
          <path d="M8 52 L32 60 M8 68 L32 74 M8 84 L28 88 M8 102 L30 106" stroke="#e6d3b3" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M192 52 L168 60 M192 68 L168 74 M192 84 L172 88 M192 102 L170 106" stroke="#e6d3b3" strokeWidth="3" strokeLinecap="round" fill="none" />
        </svg>
        <div style={{
          position: "absolute", left: 0, right: 0, top: 428, display: "flex", justifyContent: "center",
          fontSize: 60, fontWeight: 700, color: "#ffe1a8", letterSpacing: 14, fontFamily: "serif",
        }}>TY</div>
      </div>
    ),
    { ...size },
  );
}
