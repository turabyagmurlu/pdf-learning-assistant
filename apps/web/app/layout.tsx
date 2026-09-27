import "../styles/globals.css";
import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import PwaRegister from "@/components/PwaRegister";
import VisualViewportVars from "@/components/VisualViewportVars";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

// Baslik (Sfumato): Fraunces degisken yazi — opsz + SOFT (yumusak) + WONK (el yazisi egilimi),
// duz ve italik (alt baslik / epigraf). Agirlik verilmez: degisken (wght ekseni dahil).
// Govde: temiz sans (Inter).
const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-heading",
  display: "swap",
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK", "opsz"],
});
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TY PDF — Araştırma Defteri",
  description: "Kaynaklarını yükle, defterde soru sor, atıflı not al ve yaz.",
  applicationName: "TY PDF",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TY PDF",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false, email: false, address: false },
};

// Durum cubugu rengi sistem temasina gore; kullanici temayi elle degistirirse
// ThemeToggle.applyTheme tum theme-color etiketlerini gunceller.
// Yakinlastirma engellenmez (maximumScale / userScalable verilmez; WCAG 1.4.4).
// interactiveWidget: klavye acilinca duzen kuculsun (Android/Chrome); iOS icin
// hooks/useVisualViewport --vvh / --kb degiskenlerini verir.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4EEE3" },
    { media: "(prefers-color-scheme: dark)", color: "#13100C" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning className={`${fraunces.variable} ${inter.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <VisualViewportVars />
        <PwaRegister />
      </body>
    </html>
  );
}
