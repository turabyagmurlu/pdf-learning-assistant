"use client";
/**
 * Akilli geri tusu.
 * Uygulama (PWA) modunda tarayicinin geri tusu yok; bu yuzden her alt sayfada
 * icerden bir geri yolu gerekir. Gecmis varsa geri gider, yoksa ust sayfaya doner.
 */
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** Bir rotanin "ust" sayfasi: okuyucu -> Kutuphane, defter -> Defterler. */
export function parentOf(pathname: string): { href: string; label: string } {
  if (pathname.startsWith("/documents/")) return { href: "/library", label: "Kütüphane" };
  if (pathname.startsWith("/collections/")) return { href: "/notebooks", label: "Defterler" };
  return { href: "/notebooks", label: "Defterler" };
}

export function isSubPage(pathname: string) {
  return pathname.startsWith("/documents/") || pathname.startsWith("/collections/");
}

export function useGoBack(fallback: string) {
  const router = useRouter();
  return () => {
    // Uygulama icinde gezinildiyse gercek geri; dogrudan acildiysa ust sayfa.
    const cameFromApp = typeof window !== "undefined" && window.history.length > 1
      && (window.history.state?.__typdf || sessionStorage.getItem("typdf.nav") === "1");
    if (cameFromApp) router.back();
    else router.replace(fallback);
  };
}

export default function BackButton({ fallback, label, compact, className }: {
  fallback: string; label?: string; compact?: boolean; className?: string;
}) {
  const go = useGoBack(fallback);
  return (
    <button onClick={go} aria-label={label || "Geri"} title={label || "Geri"}
            className={className || "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-text-secondary hover:bg-surface-muted"}>
      <ArrowLeft size={compact ? 20 : 16} />
      {!compact && <span>{label || "Geri"}</span>}
    </button>
  );
}
