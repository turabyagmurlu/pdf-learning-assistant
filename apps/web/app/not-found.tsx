import Link from "next/link";

/**
 * 404 — Türkçe, klasik tema (kök layout'un fontları ve renk değişkenleri uygulanır).
 * Kaldırılan rotalar (/atelier) next.config yönlendirmesiyle Bugün'e gider; buraya yalnız gerçekten olmayan adresler düşer.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-text-primary">
      <div className="w-full max-w-md text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-2 font-heading text-[32px] leading-tight md:text-[40px]">Bu sayfa artık yok</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          Aradığın adres kaldırılmış ya da hiç olmamış olabilir. Okumaya Bugün sayfasından devam edebilirsin.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link href="/today"
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent-purple px-5 text-sm font-medium text-white hover:opacity-90">
            Bugün&apos;e dön
          </Link>
          <Link href="/library"
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border px-5 text-sm text-text-secondary hover:text-text-primary">
            Kütüphane
          </Link>
        </div>
      </div>
    </main>
  );
}
