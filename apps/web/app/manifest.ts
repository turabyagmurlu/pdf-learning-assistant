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
    // Sfumato: acilis ekrani parsomen zemin; durum cubugu/pencere rengi lapis (marka)
    background_color: "#FAF8F4",
    theme_color: "#2E4C8E",
    lang: "tr",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    // Android: baska uygulamadan "Paylaş → TY PDF" (PDF, gorsel, link ya da metin) → /share (T-6)
    // Next'in manifest tipi Web App Manifest standardiyla birebir degil (params'i dizi sanir);
    // tarayicinin okudugu JSON standarda uygun kalsin diye tipi burada gevsetiyoruz.
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          { name: "files", accept: ["application/pdf", ".pdf", "image/*"] },
        ],
      },
    } as unknown as MetadataRoute.Manifest["share_target"],
    shortcuts: [
      { name: "Defterler", url: "/notebooks" },
      { name: "Kütüphane", url: "/library" },
      { name: "Ara", url: "/search" },
    ],
  };
}
