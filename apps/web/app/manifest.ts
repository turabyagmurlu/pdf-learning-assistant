import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TY PDF — Araştırma Defteri",
    short_name: "TY PDF",
    description: "Kaynaklarını yükle, defterde soru sor, atıflı not al ve yaz.",
    start_url: "/notebooks",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6b45c",
    theme_color: "#f6b45c",
    lang: "tr",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      { name: "Defterler", url: "/notebooks" },
      { name: "Kütüphane", url: "/library" },
      { name: "Araştır", url: "/search" },
    ],
  };
}
