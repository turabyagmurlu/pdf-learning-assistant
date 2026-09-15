"use client";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/** Service worker'i kaydeder ve tarayici izin verirse "Uygulama olarak yükle" cubugu gosterir. */
export default function PwaRegister() {
  const [prompt, setPrompt] = useState<any>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    if (standalone) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem("pwa.dismissed") === "1"; } catch {}
    const onPrompt = (e: any) => {
      e.preventDefault();
      setPrompt(e);
      if (!dismissed) setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setHidden(true));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (hidden || !prompt) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border bg-surface p-3 shadow-lg">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-purple text-sm font-bold text-white">TY</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Uygulama olarak yükle</p>
        <p className="text-xs text-text-secondary">Ana ekrana ekle, tarayıcı çubuğu olmadan tam ekran çalışsın.</p>
      </div>
      <button
        onClick={async () => { try { prompt.prompt(); await prompt.userChoice; } catch {} setHidden(true); }}
        className="flex items-center gap-1.5 rounded-lg bg-accent-purple px-3 py-2 text-sm text-white">
        <Download size={14} /> Yükle
      </button>
      <button
        onClick={() => { setHidden(true); try { localStorage.setItem("pwa.dismissed", "1"); } catch {} }}
        aria-label="Kapat" className="rounded-md p-1 text-text-secondary hover:bg-surface-muted">
        <X size={16} />
      </button>
    </div>
  );
}
