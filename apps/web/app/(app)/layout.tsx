"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Library, GraduationCap, LogOut, Compass, Highlighter, Sun, Moon, MonitorSmartphone } from "lucide-react";
import { clearToken } from "@/lib/api";
import { BrandMarkSvg } from "@/components/BrandMark";
import ThemeToggle, { useTheme } from "@/components/ThemeToggle";
import Shortcuts from "@/components/Shortcuts";

const NAV = [
  { href: "/library", label: "Kütüphane", Icon: Library, title: "Kütüphane" },
  { href: "/study", label: "Öğrenme", Icon: GraduationCap, title: "Öğrenme" },
  { href: "/notes", label: "Vurgular", Icon: Highlighter, title: "Vurgular" },
  { href: "/search", label: "Keşfet", Icon: Compass, title: "Keşfet" },
];
const cx = (...a: any[]) => a.filter(Boolean).join(" ");

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { dark, mode, set } = useTheme();
  const isReader = pathname.startsWith("/documents/");
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // sekme basligi rotaya gore
  useEffect(() => {
    const n = NAV.find((x) => active(x.href));
    const base = "TY PDF";
    document.title = n ? `${n.title} · ${base}` : pathname.startsWith("/collections/") ? `Çalışma kitabı · ${base}` : base;
  }, [pathname]);

  const nextMode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  const ModeIcon = mode === "light" ? Sun : mode === "dark" ? Moon : MonitorSmartphone;

  return (
    <div className="flex min-h-screen">
      {/* Masaustu: sol menu */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r bg-surface p-4 md:flex">
        <Link href="/library" className="flex items-center gap-2.5 px-2 py-3">
          <BrandMarkSvg variant={dark ? "night" : "day"} size={34} title="TY PDF" />
          <span className="font-heading text-lg leading-tight">TY PDF</span>
        </Link>
        {NAV.map(({ href, label, Icon }) => (
          <Link key={href} href={href}
                className={cx("flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-muted",
                  active(href) && "bg-accent-purple/10 text-accent-purple")}>
            <Icon size={18} /> {label}
          </Link>
        ))}
        <div className="mt-auto flex flex-col gap-1">
          <button onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-text-secondary hover:bg-surface-muted">
            <span className="rounded border px-1.5 font-mono text-[11px]">?</span> Kısayollar
          </button>
          <ThemeToggle />
          <button onClick={() => { clearToken(); router.replace("/login"); }}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-text-secondary hover:bg-surface-muted">
            <LogOut size={18} /> Çıkış
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobil: ust cubuk (okuyucuda gizli, kendi arac cubugu var) */}
        {!isReader && (
          <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-surface/95 px-4 backdrop-blur md:hidden"
                  style={{ paddingTop: "max(env(safe-area-inset-top), 8px)", paddingBottom: 8 }}>
            <Link href="/library" className="flex items-center gap-2">
              <BrandMarkSvg variant={dark ? "night" : "day"} size={28} title="TY PDF" />
              <span className="font-heading text-base">TY PDF</span>
            </Link>
            <div className="flex items-center gap-1">
              <button onClick={() => set(nextMode as any)} aria-label="Tema" className="rounded-md p-2 text-text-secondary hover:bg-surface-muted">
                <ModeIcon size={18} />
              </button>
              <button onClick={() => { clearToken(); router.replace("/login"); }} aria-label="Çıkış" className="rounded-md p-2 text-text-secondary hover:bg-surface-muted">
                <LogOut size={18} />
              </button>
            </div>
          </header>
        )}

        <main className={cx("flex-1 overflow-auto", !isReader && "pb-20 md:pb-0")}>{children}</main>
        <Shortcuts />

        {/* Mobil: alt sekme cubugu */}
        {!isReader && (
          <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-surface/95 backdrop-blur md:hidden"
               style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            {NAV.map(({ href, label, Icon }) => (
              <Link key={href} href={href}
                    className={cx("flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px]",
                      active(href) ? "text-accent-purple" : "text-text-secondary")}>
                <Icon size={22} strokeWidth={active(href) ? 2.2 : 1.8} /> {label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
