import type { Metadata } from "next";

// Sıfırlama bağlantısı adres çubuğunda token taşır; başka sitelere Referer ile sızmasın, aranmasın.
export const metadata: Metadata = {
  title: "Yeni şifre belirle — TY PDF",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ResetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
