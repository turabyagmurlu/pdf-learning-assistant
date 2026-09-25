"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Library, LogOut, Search, Notebook, Sun, Moon, MonitorSmartphone, MoreHorizontal, Keyboard } from "lucide-react";
import { clearToken, refreshSessionIfNeeded } from "@/lib/api";
import { BrandMarkSvg } from "@/components/BrandMark";
import ThemeToggle, { useTheme, THEME_LABEL, ThemeMode } from "@/components/ThemeToggle";
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
 *  --sidebar-w  : sol menu genisligi. Telefon 0 · md (768-1023) 72px ikon rayi · lg+ 224px tam menu.
 *                 Okuyucuda 0. Ornek (yapiskan serit): md:left-[var(--sidebar-w)]
 *  --reader-bar : okuyucunun dar ekrandaki alt cubugu (64px); diger durumlarda 0/tanimsiz.
 */
const LAYOUT_VARS = `
:root{--bottom-nav:calc(56px + env(safe-area-inset-bottom, 0px));--topbar-h:calc(max(env(safe-area-inset-top, 0px), 8px) + 53px);--sidebar-w:0px}
@media (min-width:768px){:root{--bottom-nav:0px;--topbar-h:0px;--sidebar-w:72px}}
@media (min-width:1024px){:root{--sidebar-w:224px}}
html[data-reader]{--bottom-nav:0px;--topbar-h:0px;--sidebar-w:0px;--reader-bar:64px}
@media (min-width:1024px){html[data-reader]{--reader-bar:0px}}
`;

/**
 * "⋯" menusu: tema, kisayollar ve cikis tek yerde (TK-5).
 * Telefon ust cubugunda ve tablet ikon rayinda kullanilir; tam menude (lg+) ayri satirlar var.
 */
function MoreMenu({ mode, setMode, onLogout, up, className }: {
  mode: ThemeMode; setMode: (m: ThemeMode) => void; onLogout: () => void;
  /** Menu yukari acilsin (ray altindaki dugme icin) */
  up?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => listRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), 0);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const list: HTMLButtonElement[] = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") || []);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1
      : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[n].focus();
  }
  const nextMode: ThemeMode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  const ModeIcon = mode === "light" ? Sun : mode === "dark" ? Moon : MonitorSmartphone;
  const item = "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-surface-muted";
  return (
    <div ref={wrap} className={cx("relative", className)}>
      <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Diğer seçenekler: tema, kısayollar, çıkış"
              title="Diğer seçenekler" onClick={() => setOpen((v) => !v)}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
        <MoreHorizontal size={20} aria-hidden />
      </button>
      {open && (
        <div ref={listRef} role="menu" aria-label="Diğer seçenekler" onKeyDown={onListKey}
             className={cx("absolute z-50 w-60 rounded-xl border bg-surface p-1 text-text-primary shadow-xl",
               up ? "bottom-full left-0 mb-1" : "right-0 top-full mt-1")}>
          <button type="button" role="menuitem" className={item}
                  onClick={() => { setMode(nextMode); }}
                  aria-label={`Tema: ${THEME_LABEL[mode]}. ${THEME_LABEL[nextMode]} temaya geç`}>
            <ModeIcon size={17} aria-hidden className="text-text-secondary" />
            <span className="flex-1">Tema: {THEME_LABEL[mode]}</span>
            <span className="text-xs text-text-secondary">→ {THEME_LABEL[nextMode]}</span>
          </button>
          <button type="button" role="menuitem" className={item}
                  onClick={() => { setOpen(false); window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" })); }}>
            <Keyboard size={17} aria-hidden className="text-text-secondary" />
            <span className="flex-1">Kısayollar</span>
            <kbd className="rounded border bg-surface-muted px-1.5 font-mono text-xs">?</kbd>
          </button>
          <div className="my-1 border-t" role="separator" />
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onLogout(); }}>
            <LogOut size={17} aria-hidden className="text-text-secondary" />
            <span className="flex-1">Çıkış</span>
          </button>
        </div>
      )}
    </div>
  );
}

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

  const logout = () => { clearToken(); router.replace("/login"); };
  const iconBtn = "flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted";
  // Ray (md) ve tam menu (lg+) icin ortak menu ogesi: rayda ikon ustte, kucuk etiket altta
  const navItem = "flex min-h-[40px] items-center rounded-md hover:bg-surface-muted md:min-h-[56px] md:w-full md:flex-col md:justify-center md:gap-0.5 md:px-1 md:text-2xs lg:min-h-[40px] lg:flex-row lg:justify-start lg:gap-2 lg:px-3 lg:text-sm";

  return (
    <div className="flex min-h-screen">
      <style dangerouslySetInnerHTML={{ __html: LAYOUT_VARS }} />
      <a href="#main"
         className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg">
        İçeriğe atla
      </a>
      <Wake />
      {/*
       * Sol menu (okuyucuda gizli; okuyucu tum genisligi kullanir).
       *  - md (768-1023): 72 px ikon rayi (ikon + kucuk etiket); tema / kisayollar / cikis "⋯" menusunde.
       *  - lg+: 224 px tam menu.
       *  - Yapiskan: uzun sayfada menu ekranda kalir, kendi icinde kayar (TB-1).
       * Genislik --sidebar-w degiskeninden gelir (yapiskan seritler de ayni degiskeni kullanir).
       */}
      <aside className={cx("hidden shrink-0 flex-col gap-1 border-r bg-surface",
               "md:sticky md:top-0 md:h-dvh md:w-[var(--sidebar-w)] md:items-center md:overflow-y-auto md:px-2 md:py-3",
               "lg:items-stretch lg:p-4",
               !isReader && "md:flex")}
             aria-label="Kenar menüsü">
        <Link href="/notebooks" className="flex items-center gap-2.5 px-2 py-3 md:justify-center md:px-0 lg:justify-start lg:px-2" aria-label="TY PDF ana sayfa">
          <span className="hidden md:inline lg:hidden"><BrandMarkSvg variant={dark ? "night" : "day"} size={28} title="TY PDF" /></span>
          <span className="hidden lg:inline"><BrandMarkSvg variant={dark ? "night" : "day"} size={34} title="TY PDF" /></span>
          <span className="hidden font-heading text-lg leading-tight lg:inline">TY PDF</span>
        </Link>
        {sub && (
          <>
            <BackButton fallback={parent.href} compact
                        className="mb-1 flex h-11 w-11 items-center justify-center rounded-md border border-dashed text-text-secondary hover:border-accent-purple/50 hover:bg-surface-muted hover:text-text-primary lg:hidden" />
            <BackButton fallback={parent.href}
                        className="mb-1 hidden min-h-[40px] items-center gap-2 rounded-md border border-dashed px-3 text-sm text-text-secondary hover:border-accent-purple/50 hover:bg-surface-muted hover:text-text-primary lg:flex" />
          </>
        )}
        <button type="button" onClick={openPalette} aria-label="Ara ya da git (Ctrl K)" title="Ara ya da git (Ctrl K)"
                className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg border bg-surface-muted/50 text-text-secondary hover:border-accent-purple/40 lg:h-auto lg:min-h-[40px] lg:w-full lg:justify-start lg:gap-2 lg:px-3 lg:text-left lg:text-sm">
          <Search size={17} aria-hidden /> <span className="hidden flex-1 truncate lg:inline">Ara…</span>
          <kbd className="hidden rounded border bg-surface px-1 font-mono text-xs lg:inline">Ctrl K</kbd>
        </button>
        <nav aria-label="Ana menü" className="flex w-full flex-col gap-1">
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} aria-label={label} title={label}
                  className={cx(navItem, active(href) && "bg-accent-purple/10 font-medium text-text-primary")}>
              <Icon size={18} aria-hidden className={cx("md:h-[22px] md:w-[22px] lg:h-[18px] lg:w-[18px]", active(href) ? "text-accent-purple" : "")} />
              <span className="truncate">{label}</span>
            </Link>
          ))}
        </nav>
        {/* Alt grup: rayda kompakt gosterge + "⋯"; tam menude ayri satirlar */}
        <div className="mt-auto flex w-full flex-col items-center gap-1 lg:items-stretch">
          <span className="hidden md:inline lg:hidden"><QuotaMeter compact /></span>
          <span className="hidden lg:block"><QuotaMeter /></span>
          <MoreMenu mode={mode} setMode={set} onLogout={logout} up className="hidden md:block lg:hidden" />
          <button type="button" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}
                  className="hidden min-h-[40px] items-center gap-2 rounded-md px-3 text-text-secondary hover:bg-surface-muted lg:flex">
            <span aria-hidden className="rounded border px-1.5 font-mono text-xs">?</span> Kısayollar
          </button>
          <ThemeToggle className="hidden lg:flex" />
          <button type="button" onClick={logout}
                  className="hidden min-h-[40px] items-center gap-2 rounded-md px-3 text-text-secondary hover:bg-surface-muted lg:flex">
            <LogOut size={18} aria-hidden /> Çıkış
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobil: ust cubuk (okuyucuda gizli, kendi basligi var). Cikis ve tema "⋯" menusunde (TK-5). */}
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
              <MoreMenu mode={mode} setMode={set} onLogout={logout} />
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

        {/* Mobil: alt sekme cubugu (3 oge). `bottom-nav`: klavye acikken globals.css gizler. */}
        {!isReader && (
          <nav aria-label="Ana menü" className="bottom-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t bg-surface/95 backdrop-blur md:hidden"
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
