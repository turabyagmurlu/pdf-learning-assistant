import { ImageResponse } from "next/og";
import { BrandMarkSvg } from "@/components/BrandMark";

export const runtime = "edge";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/* Sfumato: lapis madalyon + ince altin halka + "TY" monogram, saydam zemin. purpose: any (kirpilmaz).
 * Maskable (Android) icin ayri: app/icon-maskable/route.tsx — madalyon guvenli bolgede, parsomen zemin. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: 512, height: 512, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent" }}>
        <BrandMarkSvg variant="day" size={512} rounded />
      </div>
    ),
    { ...size },
  );
}
