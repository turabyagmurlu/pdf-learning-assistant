import { ImageResponse } from "next/og";
import { BRAND, BrandMarkSvg } from "@/components/BrandMark";

export const runtime = "edge";

/**
 * Maskable (Android uyarlanabilir) ikon: 512x512, /icon-maskable.
 * Parsomen zemin tam alani doldurur; madalyon 384 px (yaricap ~188 px) ile guvenli bolgede
 * (merkezden %40 yaricap = 205 px) kalir — Android yuvarlak/kare maske kirpsa da halka ve "TY" bozulmaz.
 * `/icon` (purpose: any) ile ayni cizim.
 */
export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: 512, height: 512, display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.parchment }}>
        <BrandMarkSvg variant="day" size={384} rounded />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
