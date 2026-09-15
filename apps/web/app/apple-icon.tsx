import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS ana ekran ikonu: kose yuvarlatmayi iOS kendisi yapar, kare ve dolu olmali
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #6d5ee0 0%, #8b7cf0 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 106,
            height: 128,
            background: "#ffffff",
            borderRadius: 12,
          }}
        >
          <div style={{ display: "flex", width: 70, height: 8, background: "#6d5ee0", borderRadius: 4, marginBottom: 9 }} />
          <div style={{ display: "flex", width: 70, height: 8, background: "#c9c2f5", borderRadius: 4, marginBottom: 9 }} />
          <div style={{ display: "flex", width: 48, height: 8, background: "#c9c2f5", borderRadius: 4, marginBottom: 14 }} />
          <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: "#6d5ee0", letterSpacing: -1, fontFamily: "sans-serif" }}>
            TY
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
