"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Library, GraduationCap, LogOut, Compass } from "lucide-react";
import { clearToken } from "@/lib/api";
import { BrandMarkSvg } from "@/components/BrandMark";
import ThemeToggle, { useTheme } from "@/components/ThemeToggle";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { dark } = useTheme();
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r bg-surface p-4 flex flex-col gap-1">
        <Link href="/library" className="flex items-center gap-2.5 px-2 py-3">
          <BrandMarkSvg variant={dark ? "night" : "day"} size={34} title="TY PDF" />
          <span className="font-heading text-lg leading-tight">TY PDF</span>
        </Link>
        <Link href="/library" className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-muted">
          <Library size={18} /> Kütüphane
        </Link>
        <Link href="/study" className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-muted">
          <GraduationCap size={18} /> Öğrenme
        </Link>
        <Link href="/search" className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-muted">
          <Compass size={18} /> Keşfet
        </Link>
        <div className="mt-auto flex flex-col gap-1">
          <ThemeToggle />
          <button onClick={() => { clearToken(); router.replace("/login"); }}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-text-secondary hover:bg-surface-muted">
            <LogOut size={18} /> Çıkış
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
