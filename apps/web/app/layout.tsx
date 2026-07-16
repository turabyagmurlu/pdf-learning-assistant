import "../styles/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PDF Öğrenme Asistanı",
  description: "PDF'lerini anla, sorgula, öğren.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
