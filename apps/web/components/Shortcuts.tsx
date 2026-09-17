"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, Keyboard } from "lucide-react";

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
};

/** Global klavye kisayollari: G+K/O/V/A sayfa, / arama, ? yardim, T tema. */
export default function Shortcuts() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { setHelp(false); return; }
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();
      const now = Date.now();
      if (pendingG && now - pendingG < 900) {
        pendingG = 0;
        const map: Record<string, string> = { d: "/notebooks", k: "/library", a: "/search" };
        if (map[k]) { e.preventDefault(); router.push(map[k]); }
        return;
      }
      if (k === "g") { pendingG = now; return; }
      if (e.key === "?" || (e.shiftKey && k === "/")) { e.preventDefault(); setHelp((v) => !v); return; }
      if (k === "/") {
        e.preventDefault();
        const inp = document.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Ara"], input[placeholder*="ara"]');
        if (inp) { inp.focus(); inp.select(); } else router.push("/search");
        return;
      }
      if (k === "t") {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>('button[title^="Tema:"]')?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  if (!help) return null;
  const rows: [string, string][] = [
    ["G  D", "Defterler"], ["G  K", "Kütüphane"], ["G  A", "Araştır"],
    ["/", "Aramaya odaklan"], ["T", "Tema (gündüz / gece / sistem)"], ["?", "Bu pencere"], ["Esc", "Kapat"],
    ["← →", "PDF'te sayfa değiştir"], ["F", "PDF'te odak modu"], ["Ctrl Z", "PDF'te vurguyu geri al"],
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setHelp(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border bg-surface p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-heading text-lg"><Keyboard size={18} className="text-accent-purple" /> Klavye kısayolları</h3>
          <button onClick={() => setHelp(false)} aria-label="Kapat" className="rounded-md p-1 text-text-secondary hover:bg-surface-muted"><X size={16} /></button>
        </div>
        <div className="mt-4 space-y-2">
          {rows.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">{d}</span>
              <kbd className="rounded-md border bg-surface-muted px-2 py-0.5 font-mono text-xs">{k}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
