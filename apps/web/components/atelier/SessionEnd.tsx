"use client";
/** Oturum sonu ve boş durum ekranları (Atölye). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, Sun, Library } from "lucide-react";
import { api } from "@/lib/api";
import { buttonClass } from "@/components/ui/Button";
import { CompassSketch, Fleuron, GoldenSpiral } from "@/components/art";
import type { Practice } from "@/hooks/useAtelier";

/** Sayıdan sonra gelen "-(s)ını" ekini Türkçe ses uyumuyla üretir: 14'ünü, 2'sini, 6'sını, 10'unu. */
const ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
function spoken(n: number): string {
  if (n === 0) return "sıfır";
  if (n % 1000 === 0) return "bin";
  if (n % 100 === 0) return "yüz";
  if (n % 10 === 0) return TENS[Math.floor(n / 10) % 10];
  return ONES[n % 10];
}
export function accPoss(n: number): string {
  const w = spoken(Math.abs(Math.round(n)));
  const vowels = w.match(/[aeıioöuü]/g) || ["e"];
  const last = vowels[vowels.length - 1];
  const v = "aı".includes(last) ? "ı" : "ei".includes(last) ? "i" : "ou".includes(last) ? "u" : "ü";
  const endsVowel = /[aeıioöuü]$/.test(w);
  return `${n}'${endsVowel ? "s" : ""}${v}n${v}`;
}

export function SessionEnd({ practice, count, known, onAgain }: {
  practice: Practice; count: number; known: number; onAgain: () => void;
}) {
  const [streak, setStreak] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    // Son tekrarın kaydı yetişsin diye kısa bir bekleme
    const t = setTimeout(() => {
      api("/atelier/today", {}, 1)
        .then((r: unknown) => { const s = (r as { streak_days?: number } | null)?.streak_days; if (alive && typeof s === "number") setStreak(s); })
        .catch(() => {});
    }, 900);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  const line = practice === "recall"
    ? `Bugün ${count} kart · ${accPoss(known)} bildin`
    : practice === "listen" ? `${count} alıntıyı dinledin` : `${count} alıntıyı okudun`;

  return (
    <section aria-labelledby="atelier-end" className="sfumato-in mx-auto flex w-full max-w-xl flex-col items-center px-6 py-phi-5 text-center">
      <div className="text-text-secondary" aria-hidden>
        <GoldenSpiral animate size={220} />
      </div>
      <p className="eyebrow mt-phi-3">Oturum tamam</p>
      <h1 id="atelier-end" className="mt-phi-1 font-heading text-display text-text-primary" role="status">{line}</h1>
      {streak != null && streak > 0 && (
        <p className="mt-phi-1 font-heading text-title italic text-text-secondary">
          {streak >= 2 ? `${streak} gün üst üste` : "Seriye bugün başladın"}
        </p>
      )}
      <div className="my-phi-4 w-full"><Fleuron /></div>
      <figure className="max-w-md">
        <blockquote className="font-reading text-[20px] italic leading-relaxed text-text-primary">
          «Öğrenmek zihni asla yormaz.»
        </blockquote>
        <figcaption className="mt-phi-1 text-sm text-text-secondary">— Leonardo da Vinci</figcaption>
      </figure>
      <div className="mt-phi-4 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={onAgain} className={buttonClass({ variant: "secondary", size: "lg" })} autoFocus>
          <RotateCcw size={16} aria-hidden /> Bir tur daha
        </button>
        <Link href="/today" className={buttonClass({ variant: "primary", size: "lg" })}>
          <Sun size={16} aria-hidden /> Bugün&apos;e dön
        </Link>
      </div>
    </section>
  );
}

export function EmptyAtelier({ scoped }: { scoped?: boolean }) {
  return (
    <section className="sfumato-in mx-auto flex w-full max-w-lg flex-col items-center px-6 py-phi-5 text-center">
      <div className="text-text-secondary" aria-hidden><CompassSketch /></div>
      <h1 className="mt-phi-3 font-heading text-title text-text-primary">
        {scoped ? "Bu kapsamda henüz alıntı yok." : "Henüz birikmiş alıntın yok."}
      </h1>
      <p className="mt-phi-1 text-body text-text-secondary">
        Okurken vurguladıkların burada çalışma kartına dönüşür.
      </p>
      <Link href="/library" className={buttonClass({ variant: "primary", size: "lg", className: "mt-phi-4" })}>
        <Library size={16} aria-hidden /> Kütüphane&apos;ye git
      </Link>
    </section>
  );
}

/** Hatırla: bugünlük tekrar kalmadı (ama kapsamda kart var). */
export function AllDone({ onAnyway }: { onAnyway: () => void }) {
  return (
    <section className="sfumato-in mx-auto flex w-full max-w-lg flex-col items-center px-6 py-phi-5 text-center">
      <div className="text-text-secondary" aria-hidden><GoldenSpiral size={120} /></div>
      <h1 className="mt-phi-3 font-heading text-title text-text-primary">Bugünlük tamam</h1>
      <p className="mt-phi-1 text-body text-text-secondary">
        Tekrar bekleyen kart kalmadı. Yarın yenileri gelir; istersen şimdi hepsini yine çalışabilirsin.
      </p>
      <div className="mt-phi-4 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={onAnyway} className={buttonClass({ variant: "secondary", size: "lg" })}>
          <RotateCcw size={16} aria-hidden /> Yine de çalış
        </button>
        <Link href="/today" className={buttonClass({ variant: "primary", size: "lg" })}>
          <Sun size={16} aria-hidden /> Bugün&apos;e dön
        </Link>
      </div>
    </section>
  );
}
