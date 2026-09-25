"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Library, LogOut, Search, Notebook, Sun, Moon, MonitorSmartphone } from "lucide-react";
import { clearToken, refreshSessionIfNeeded } from "@/lib/api";
import { BrandMarkSvg } from "@/components/BrandMark";
import ThemeToggle, { useTheme, THEME_LABEL } from "@/components/ThemeToggle";
import Shortcuts from "@/components/Shortcuts";
import BackButton, { isSubPage, parentOf } from "@/components/BackButton";
import Wake from "@/components/Wake";
import QuotaMeter from "@/components/QuotaMeter";
import CommandPalette, { openPalette } from "@/components/CommandPalette";
import ToastHost from "@/components/Toast";

const NAV = [
  { href: "/notebooks", label: "Defterler", Icon: Notebook, title: "Defterler" },
  { href: "/library", label: "Kütüphane", Icon: Library, title: "Kütüphane" },
  { href: "/search", label: "Araştır", Icon: Search, title: "Araştır" },
];
const cx = (...a: any[]) => a.filter(Boolean).join(" ");

/**
 * Ortak yerlesim olculeri (yuzen ogeler bunlara gore konumlanir; D1/D2 kullanir):
 *  --bottom-nav : mobil alt menu yuksekligi + alt guvenli alan. md ve ustunde, okuyucuda 0.
 *                 Ornek: style={{ bottom: "calc(var(--bottom-nav, 0px) + 12px)" }}
 *  --topbar-h   : mobil ust cubuk yuksekligi (ust guvenli alan dahil). md ve ustunde, okuyucuda 0.
 *                 Ornek (yapiskan serit): top-[var(--topbar-h,0px)]
 *  --reader-bar : okuyucunun dar ekrandaki alt cubugu (64px); diger durumlarda 0/tanimsiz.
 */
const LAYOUT_VARS = `
:root{--bottom-nav:calc(56px + env(safe-area-inset-bottom, 0px));--topbar-h:calc(max(env(safe-area-inset-top, 0px), 8px) + 53px)}
@media (min-width:768px){:root{--bottom-nav:0px;--topbar-h:0px}}
html[data-reader]{--bottom-nav:0px;--topbar-h:0px;--reader-bar:64px}
@media (min-width:1024px){html[data-reader]{--reader-bar:0px}}
`;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { dark, mode, set } = useTheme();
  // Okuyucu rotasi: uygulama menuleri gizli, okuyucunun kendi basligi (Geri + Defter › Kaynak) var
  const isReader = pathname.startsWith("/documents/");
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const sub = isSubPage(pathname);
  const parent = parentOf(pathname);

  // Ilk sayfadan sonra yapilan her gecis "uygulama ici gezinti"dir -> geri tusu gercek geri gider.
  const firstPath = useRef<string | null>(null);
  useEffect(() => {
    if (firstPath.current === null) { firstPath.current = pathname; return; }
    if (pathname !== firstPath.current) { try { sessionStorage.setItem("typdf.nav", "1"); } catch {} }
  }, [pathname]);

  // okuyucuda alt menu yok: yuzen ogeler (toast, kurulum cubugu) en alta insin
  useEffect(() => {
    const el = document.documentElement;
    if (isReader) el.setAttribute("data-reader", ""); else el.removeAttribute("data-reader");
    return () => el.removeAttribute("data-reader");
  }, [isReader]);

  // oturumu sessizce uzat (duzenli kullananin oturumu hic dusmez)
  useEffect(() => { refreshSessionIfNeeded(); }, []);

  // sekme basligi rotaya gore (okuyucu kendi basligini kaynak adiyla yazar)
  useEffect(() => {
    if (isReader) return;
    const n = NAV.find((x) => active(x.href));
    const base = "TY PDF";
    document.title = n ? `${n.title} · ${base}` : pathname.startsWith("/collections/") ? `Defter · ${base}` : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isReader]);

  const nextMode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  const ModeIcon = mode === "light" ? Sun : mode === "dark" ? Moon : MonitorSmartphone;
  const iconBtn = "flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted";

  return (
    <div className="flex min-h-screen">
      <style dangerouslySetInnerHTML={{ __html: LAYOUT_VARS }} />
      <a href="#main"
         className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg">
        İçeriğe atla
      </a>
      <Wake />
      {/* Masaustu: sol menu (okuyucuda gizli; okuyucu tum genisligi kullanir) */}
      <aside className={cx("hidden w-56 shrink-0 flex-col gap-1 border-r bg-surface p-4", !isReader && "md:flex")}>
        <Link href="/notebooks" className="flex items-center gap-2.5 px-2 py-3">
          <BrandMarkSvg variant={dark ? "night" : "day"} size={34} title="TY PDF" />
          <span className="font-heading text-lg leading-tight">TY PDF</span>
        </Link>
        {sub && (
          <BackButton fallback={parent.href}
                      className="mb-1 flex min-h-[40px] items-center gap-2 rounded-md border border-dashed px-3 text-sm text-text-secondary hover:border-accent-purple/50 hover:bg-surface-muted hover:text-text-primary" />
        )}
        <button type="button" onClick={openPalette}
                className="mb-2 flex min-h-[40px] items-center gap-2 rounded-lg border bg-surface-muted/50 px-3 text-left text-sm text-text-secondary hover:border-accent-purple/40">
          <Search size={15} aria-hidden /> <span className="flex-1 truncate">Ara…</span>
          <kbd className="rounded border bg-surface px-1 font-mono text-xs">Ctrl K</kbd>
        </button>
        <nav aria-label="Ana menü" className="flex flex-col gap-1">
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}
                  className={cx("flex min-h-[40px] items-center gap-2 rounded-md px-3 hover:bg-surface-muted",
                    active(href) && "bg-accent-purple/10 font-medium text-text-primary")}>
              <Icon size={18} aria-hidden className={active(href) ? "text-accent-purple" : ""} /> {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <QuotaMeter />
          <button type="button" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}
                  className="flex min-h-[40px] items-center gap-2 rounded-md px-3 text-text-secondary hover:bg-surface-muted">
            <span aria-hidden className="rounded border px-1.5 font-mono text-xs">?</span> Kısayollar
          </button>
          <ThemeToggle />
          <button type="button" onClick={() => { clearToken(); router.replace("/login"); }}
                  className="flex min-h-[40px] items-center gap-2 rounded-md px-3 text-text-secondary hover:bg-surface-muted">
            <LogOut size={18} aria-hidden /> Çıkış
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobil: ust cubuk (okuyucuda gizli, kendi basligi var) */}
        {!isReader && (
          <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-surface/95 px-4 backdrop-blur md:hidden"
                  style={{ paddingTop: "max(env(safe-area-inset-top), 8px)", paddingBottom: 8 }}>
            {sub ? (
              <BackButton fallback={parent.href}
                          className="-ml-2 flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm font-medium text-text-primary active:bg-surface-muted" />
            ) : (
              <Link href="/notebooks" className="flex min-h-[44px] items-center gap-2">
                <BrandMarkSvg variant={dark ? "night" : "day"} size={28} title="TY PDF" />
                <span className="font-heading text-base">TY PDF</span>
              </Link>
            )}
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={openPalette} aria-label="Ara ya da git" className={iconBtn}>
                <Search size={18} aria-hidden />
              </button>
              <QuotaMeter compact />
              <button type="button" onClick={() => set(nextMode as any)}
                      aria-label={`Tema: ${THEME_LABEL[mode]}. ${THEME_LABEL[nextMode]} temaya geç`} title={`Tema: ${THEME_LABEL[mode]}`}
                      className={iconBtn}>
                <ModeIcon size={18} aria-hidden />
              </button>
              <button type="button" onClick={() => { clearToken(); router.replace("/login"); }} aria-label="Çıkış" className={iconBtn}>
                <LogOut size={18} aria-hidden />
              </button>
            </div>
          </header>
        )}

        <main id="main" tabIndex={-1}
              className={cx("flex-1 overflow-auto outline-none", !isReader && "pb-[calc(var(--bottom-nav)+16px)] md:pb-0")}>
          {children}
        </main>
        <Shortcuts />
        <CommandPalette />
        <ToastHost />

        {/* Mobil: alt sekme cubugu (3 oge) */}
        {!isReader && (
          <nav aria-label="Ana menü" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t bg-surface/95 backdrop-blur md:hidden"
               style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            {NAV.map(({ href, label, Icon }) => (
              <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}
                    className={cx("flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs",
                      active(href) ? "font-semibold text-text-primary" : "text-text-secondary")}>
                <Icon size={22} strokeWidth={active(href) ? 2.2 : 1.8} aria-hidden className={active(href) ? "text-accent-purple" : ""} /> {label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
