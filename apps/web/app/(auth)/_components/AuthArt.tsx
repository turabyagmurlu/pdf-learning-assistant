"use client";
/**
 * Giris / sifre sayfalarinin sanat eseri karsilamasi (Sfumato).
 * - AuthArtPanel: masaustunde solda buyuk, cizilerek beliren altin spiral + Fraunces "TY PDF" + italik epigraf.
 * - AuthMobileHeader: telefonda tek sutun — formun ustunde kucuk spiral + epigraf.
 * Ikisi de susleyicidir (aria-hidden); sayfanin h1'i formdadir.
 */
import { BrandMarkSvg } from "@/components/BrandMark";
import { GoldenSpiral, QuillSketch } from "@/components/art";
import { useTheme } from "@/components/ThemeToggle";

const EPIGRAPH = "«Öğrenmek zihni asla yormaz.»";
const AUTHOR = "Leonardo da Vinci";

export function AuthArtPanel() {
  const { dark } = useTheme();
  return (
    <section aria-hidden="true"
             className="relative hidden overflow-hidden border-r border-border md:flex md:w-[52%] md:flex-col md:justify-between md:p-12 lg:p-16"
             style={{ background:
               "radial-gradient(80% 60% at 32% 38%, var(--gold-soft) 0%, transparent 70%)," +
               "radial-gradient(60% 50% at 92% 96%, var(--accent-soft) 0%, transparent 70%)," +
               "radial-gradient(140% 120% at 50% 45%, transparent 60%, var(--ink-soft) 100%)" }}>
      <div className="flex items-center gap-phi-2">
        <BrandMarkSvg variant={dark ? "night" : "day"} size={36} uid="auth" />
        <span className="eyebrow">Okuma ve çalışma atölyesi</span>
      </div>

      <div className="flex flex-1 items-center justify-center py-phi-4">
        <GoldenSpiral animate size={560} className="h-auto w-full max-w-[560px] text-text-secondary" />
      </div>

      <div className="relative">
        <p className="font-heading text-[64px] leading-none tracking-[0.04em] lg:text-[80px]">TY PDF</p>
        <span className="rule-gold rule-gold-start mt-phi-3 w-56" />
        <blockquote className="font-heading-italic mt-phi-3 max-w-md text-[22px] leading-snug text-text-primary">
          {EPIGRAPH}
        </blockquote>
        <p className="eyebrow eyebrow-muted mt-phi-1">— {AUTHOR}</p>
        <QuillSketch size={96} className="absolute -bottom-2 right-0 text-text-secondary opacity-70" />
      </div>
    </section>
  );
}

export function AuthMobileHeader() {
  return (
    <div aria-hidden="true" className="mb-phi-4 md:hidden">
      <GoldenSpiral animate size={220} className="text-text-secondary" />
      <p className="font-heading-italic mt-phi-2 text-[17px] leading-snug text-text-primary">{EPIGRAPH}</p>
      <p className="eyebrow eyebrow-muted mt-1">— {AUTHOR}</p>
    </div>
  );
}
