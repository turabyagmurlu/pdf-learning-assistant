import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
            width: 300,
            height: 360,
            background: "#ffffff",
            borderRadius: 32,
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ display: "flex", width: 200, height: 22, background: "#6d5ee0", borderRadius: 11, marginBottom: 26 }} />
          <div style={{ display: "flex", width: 200, height: 22, background: "#c9c2f5", borderRadius: 11, marginBottom: 26 }} />
          <div style={{ display: "flex", width: 140, height: 22, background: "#c9c2f5", borderRadius: 11, marginBottom: 40 }} />
          <div
            style={{
              display: "flex",
              fontSize: 96,
              fontWeight: 800,
              color: "#6d5ee0",
              letterSpacing: -4,
              fontFamily: "sans-serif",
            }}
          >
            TY
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
