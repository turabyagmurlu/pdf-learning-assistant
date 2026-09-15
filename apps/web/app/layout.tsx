import "../styles/globals.css";
import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/PwaRegister";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

export const metadata: Metadata = {
  title: "TY PDF — Öğrenme Asistanı",
  description: "PDF'lerini yükle, kartlar ve quizlerle çalış, sesli ders dinle.",
  applicationName: "TY PDF",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TY PDF",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#f6b45c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
