import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TY PDF — Öğrenme Asistanı",
    short_name: "TY PDF",
    description: "PDF'lerini yükle, kartlar ve quizlerle çalış, sesli ders dinle.",
    start_url: "/library",
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
      { name: "Kütüphane", url: "/library" },
      { name: "Öğrenme", url: "/study" },
      { name: "Keşfet", url: "/search" },
    ],
  };
}
