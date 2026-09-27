import GoldenSpiral from "@/components/art/GoldenSpiral";

/** Editoryal sayfa basligi (Sfumato): altin ust etiket (eyebrow), Fraunces display baslik,
 *  istege bagli Fraunces italik alt baslik, altta iki yani sonen altin hairline.
 *  hero=true → arkada sisli (sfumato) bir parsomen seridi ve sagda soluk altin spiral cizimi. */
export default function PageHeader({ eyebrow, title, subtitle, hero, right }: {
  eyebrow?: string; title: string; subtitle?: string; hero?: boolean; right?: React.ReactNode;
}) {
  return (
    <header className={hero ? "relative -mx-4 -mt-5 mb-phi-4 overflow-hidden md:-mx-6 md:-mt-8" : "mb-phi-4"}>
      {hero && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute inset-0"
               style={{ background:
                 "radial-gradient(90% 120% at 100% 0%, var(--gold-soft) 0%, transparent 60%)," +
                 "radial-gradient(70% 90% at 85% 100%, var(--accent-soft) 0%, transparent 65%)," +
                 "linear-gradient(to bottom, var(--surface) 0%, transparent 100%)" }} />
          <GoldenSpiral size={340} className="absolute -right-10 top-1/2 hidden -translate-y-1/2 text-text-secondary opacity-40 sm:block" />
          <span className="rule-gold absolute inset-x-0 bottom-0 opacity-40" />
        </div>
      )}
      <div className={hero ? "relative px-4 py-phi-4 md:px-6 md:py-phi-5" : ""}>
        {eyebrow && <p className="eyebrow mb-phi-1">{eyebrow}</p>}
        <div className="flex flex-wrap items-end justify-between gap-3">
          {/* Sayfa h1 = display olcegi (32/36, md 44/48) */}
          <h1 className="font-heading text-display tracking-tight md:text-[44px] md:leading-[48px]">{title}</h1>
          {right}
        </div>
        {subtitle && (
          <p className="font-heading-italic mt-phi-1 max-w-2xl text-[17px] leading-relaxed text-text-secondary">{subtitle}</p>
        )}
        <span className="rule-gold rule-gold-start mt-phi-3 w-40" aria-hidden="true" />
      </div>
    </header>
  );
}
