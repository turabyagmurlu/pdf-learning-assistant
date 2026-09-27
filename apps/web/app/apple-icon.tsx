import { ImageResponse } from "next/og";
import { BRAND, BrandMarkSvg } from "@/components/BrandMark";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/* Sfumato — iOS ana ekran ikonu: parsomen kare zemin uzerinde lapis madalyon
 * (iOS saydamligi siyaha boyar; kose yuvarlatmayi iOS yapar). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, display: "flex", background: BRAND.parchment }}>
        <BrandMarkSvg variant="day" size={180} rounded={false} />
      </div>
    ),
    { ...size },
  );
}
