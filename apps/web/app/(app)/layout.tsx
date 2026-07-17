"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Library, GraduationCap, LogOut, BookOpen, Compass } from "lucide-react";
import { clearToken } from "@/lib/api";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r bg-surface p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2 py-3 font-heading text-lg">
          <BookOpen size={20} className="text-accent-purple" /> Asistan
        </div>
        <Link href="/library" className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-muted">
          <Library size={18} /> Kütüphane
        </Link>
        <Link href="/study" className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-muted">
          <GraduationCap size={18} /> Öğrenme
        </Link>
        <Link href="/search" className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-muted">
          <Compass size={18} /> Keşfet
        </Link>
        <button onClick={() => { clearToken(); router.replace("/login"); }}
                className="mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-text-secondary hover:bg-surface-muted">
          <LogOut size={18} /> Çıkış
        </button>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
