"use client";
import { BrandScene } from "@/components/BrandMark";
import { useTheme } from "@/components/ThemeToggle";

/** Editoryal sayfa basligi: ust cizgi, kucuk etiket, buyuk serif baslik, alt aciklama.
 *  hero=true → arkada dar bir S1/S2 seridi. */
export default function PageHeader({ eyebrow, title, subtitle, hero, right }: {
  eyebrow?: string; title: string; subtitle?: string; hero?: boolean; right?: React.ReactNode;
}) {
  const { dark } = useTheme();
  return (
    <header className={hero ? "relative -mx-4 -mt-5 mb-8 overflow-hidden md:-mx-6 md:-mt-8" : "mb-8"}>
      {hero && (
        <>
          <div className="absolute inset-0 h-full w-full">
            <BrandScene variant={dark ? "night" : "day"} className="h-full w-full" />
          </div>
          <div className="absolute inset-0"
               style={{ background: dark
                 ? "linear-gradient(to right, rgba(15,20,32,0.92) 0%, rgba(15,20,32,0.7) 55%, rgba(15,20,32,0.35) 100%)"
                 : "linear-gradient(to right, rgba(250,248,244,0.94) 0%, rgba(250,248,244,0.78) 55%, rgba(250,248,244,0.4) 100%)" }} />
        </>
      )}
      <div className={hero ? "relative px-4 py-7 md:px-6 md:py-9" : ""}>
        {eyebrow && <p className="mb-2 text-2xs uppercase tracking-[0.28em] text-text-secondary">{eyebrow}</p>}
        <div className="flex flex-wrap items-end justify-between gap-3">
          {/* Sayfa h1 = display olcegi (32/36, md 40/44) */}
          <h1 className="font-heading text-display tracking-tight md:text-[40px] md:leading-[44px]">{title}</h1>
          {right}
        </div>
        {subtitle && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">{subtitle}</p>}
        <div className="mt-4 h-px w-16 bg-accent-purple/70" />
      </div>
    </header>
  );
}
