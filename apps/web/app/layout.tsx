import "../styles/globals.css";
import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/PwaRegister";

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
  themeColor: "#6d5ee0",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
