"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Keyboard } from "lucide-react";
import Modal from "@/components/Modal";

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
};

/** Tek tus kisayollari (G+harf, /, T) kapatilabilir (WCAG 2.1.4). "?" ve Esc her zaman calisir. */
const SINGLE_KEY = "shortcuts.single";
function singleKeysOn(): boolean {
  try { return localStorage.getItem(SINGLE_KEY) !== "0"; } catch { return true; }
}

/** Global klavye kisayollari: G+D/K/A sayfa, / arama, ? yardim, T tema. */
export default function Shortcuts() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const [help, setHelp] = useState(false);
  const [single, setSingle] = useState(true);

  useEffect(() => { setSingle(singleKeysOn()); }, []);

  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e)) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); setHelp((v) => !v); return; }
      if (!singleKeysOn()) return;
      // pencere / menu acikken sayfa kisayollari calismasin
      if ((e.target as HTMLElement | null)?.closest?.('[role="dialog"], [role="menu"]')) return;
      const k = e.key.toLowerCase();
      const now = Date.now();
      if (pendingG && now - pendingG < 900) {
        pendingG = 0;
        const map: Record<string, string> = { d: "/notebooks", k: "/library", a: "/search" };
        if (map[k]) { e.preventDefault(); router.push(map[k]); }
        return;
      }
      if (k === "g") { pendingG = now; return; }
      if (k === "/") {
        e.preventDefault();
        const inp = document.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Ara"], input[placeholder*="ara"]');
        if (inp) { inp.focus(); inp.select(); } else router.push("/search");
        return;
      }
      if (k === "t" && !pathname.startsWith("/documents/")) {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>('button[title^="Tema:"], button[aria-label^="Tema:"]')?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  function toggleSingle() {
    const v = !single;
    setSingle(v);
    try { localStorage.setItem(SINGLE_KEY, v ? "1" : "0"); } catch {}
  }

  const groups: [string, [string, string][]][] = [
    ["Genel", [
      ["Ctrl K", "Hızlı geçiş ve arama"], ["G  D", "Defterler"], ["G  K", "Kütüphane"], ["G  A", "Araştır"],
      ["/", "Aramaya odaklan"], ["T", "Tema (açık / koyu / sistem)"], ["?", "Bu pencere"], ["Esc", "Pencereyi kapat"],
    ]],
    ["Okuyucu (PDF)", [
      ["← →", "Sayfa değiştir"], ["F", "Odak modu (geniş ekranda)"], ["Ctrl Z", "Vurguyu geri al"], ["Ctrl Shift Z", "Yinele"],
    ]],
    ["Sohbet ve not", [
      ["Enter", "Soruyu gönder"], ["Shift Enter", "Yeni satır"], ["Ctrl Enter", "Notu kaydet"],
    ]],
  ];
  return (
    <Modal open={help} onClose={() => setHelp(false)} size="md"
           title={<span className="flex items-center gap-2"><Keyboard size={18} className="text-accent-purple" aria-hidden /> Klavye kısayolları</span>}>
      <div className="space-y-4">
        {groups.map(([g, rows]) => (
          <section key={g}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">{g}</h3>
            <dl className="space-y-1.5">
              {rows.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-text-secondary">{d}</dt>
                  <dd><kbd className="rounded-md border bg-surface-muted px-2 py-0.5 font-mono text-xs">{k}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 text-sm">
          <span>
            Tek tuş kısayolları (G, /, T)
            <span className="block text-xs text-text-secondary">Sesli komut ya da ekran okuyucu kullanıyorsan kapatabilirsin.</span>
          </span>
          <input type="checkbox" role="switch" checked={single} onChange={toggleSingle} className="h-5 w-5 accent-accent-purple" />
        </label>
      </div>
    </Modal>
  );
}
