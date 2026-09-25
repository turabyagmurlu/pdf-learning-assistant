"use client";
/**
 * Akilli geri tusu.
 * Uygulama (PWA) modunda tarayicinin geri tusu yok; bu yuzden her alt sayfada
 * icerden bir geri yolu gerekir. Gecmis varsa geri gider, yoksa ust sayfaya doner.
 *
 * Etiket her zaman duz "Geri": hedef (router.back() ya da fallback) her zaman
 * kesin bilinmedigi icin etikete hedef adi yazmiyoruz. Baglam (hangi defter)
 * okuyucudaki "Defter › Kaynak" basliginda gosterilir.
 */
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** Bir rotanin "ust" sayfasi (yalniz dogrudan acilista kullanilir): okuyucu -> Kutuphane, defter -> Defterler. */
export function parentOf(pathname: string): { href: string; label: string } {
  if (pathname.startsWith("/documents/")) return { href: "/library", label: "Kütüphane" };
  if (pathname.startsWith("/collections/")) return { href: "/notebooks", label: "Defterler" };
  return { href: "/notebooks", label: "Defterler" };
}

export function isSubPage(pathname: string) {
  return pathname.startsWith("/documents/") || pathname.startsWith("/collections/");
}

/** Uygulama icinde en az bir gecis yapildiysa true (layout "typdf.nav" isaretini yazar). */
export function cameFromApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.history.length > 1 && sessionStorage.getItem("typdf.nav") === "1";
  } catch { return false; }
}

export function useGoBack(fallback: string) {
  const router = useRouter();
  return () => {
    // Uygulama icinde gezinildiyse gercek geri; dogrudan acildiysa ust sayfa.
    if (cameFromApp()) router.back();
    else router.replace(fallback);
  };
}

export default function BackButton({ fallback, label, compact, className }: {
  fallback: string; label?: string; compact?: boolean; className?: string;
}) {
  const go = useGoBack(fallback);
  const text = label || "Geri";
  return (
    <button type="button" onClick={go} aria-label={text} title={text}
            className={className || "flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm text-text-secondary hover:bg-surface-muted"}>
      <ArrowLeft size={compact ? 20 : 16} aria-hidden />
      {!compact && <span>{text}</span>}
    </button>
  );
}
