"use client";
import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

/**
 * Service worker'i kaydeder ve kurulum ipucu gosterir.
 * - Android / masaustu Chrome: tarayici izin verirse "Uygulama olarak yükle" cubugu.
 * - iOS Safari (ana ekranda degilken): beforeinstallprompt hic gelmedigi icin bir kez
 *   "Paylaş → Ana Ekrana Ekle" talimati. Ilk ziyarette degil, 2. oturumdan itibaren.
 * Cubuk mobil alt menunun USTUNDE durur (--bottom-nav, bkz. app/(app)/layout.tsx).
 */
const APP_PATHS = /^\/(notebooks|library|search|collections)(\/|$)/;

/** Chrome/Edge'in kurulum olayi (standart tipte yok). */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function isIosSafari(): boolean {
  const ua = navigator.userAgent || "";
  const ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  // iOS'taki diger tarayicilar (Chrome, Firefox, Edge...) eski surumlerde ana ekrana ekleyemiyordu
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  return ios && !otherBrowser && /Safari/.test(ua);
}

export default function PwaRegister() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"none" | "android" | "ios">("none");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem("pwa.dismissed") === "1"; } catch {}

    // oturum sayaci (sekme basina bir kez)
    let visits = 0;
    try {
      visits = parseInt(localStorage.getItem("pwa.visits") || "0", 10) || 0;
      if (!sessionStorage.getItem("pwa.counted")) {
        visits += 1;
        localStorage.setItem("pwa.visits", String(visits));
        sessionStorage.setItem("pwa.counted", "1");
      }
    } catch {}

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
      if (!dismissed) setMode("android");
    };
    const onInstalled = () => { setMode("none"); try { localStorage.setItem("pwa.dismissed", "1"); } catch {} };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    let t: ReturnType<typeof setTimeout> | null = null;
    let iosShown = false;
    try { iosShown = localStorage.getItem("pwa.iosHint") === "1"; } catch {}
    if (!dismissed && !iosShown && visits >= 2 && isIosSafari() && APP_PATHS.test(window.location.pathname)) {
      t = setTimeout(() => {
        setMode("ios");
        try { localStorage.setItem("pwa.iosHint", "1"); } catch {}   // yalniz bir kez
      }, 6000);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  function dismiss() {
    setMode("none");
    try { localStorage.setItem("pwa.dismissed", "1"); } catch {}
  }

  if (mode === "none") return null;
  if (mode === "android" && !prompt) return null;

  return (
    <div role="region" aria-label="Uygulamayı yükle"
         className="fixed inset-x-3 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border bg-surface p-3 shadow-lg"
         style={{ bottom: "calc(max(var(--bottom-nav, 0px), env(safe-area-inset-bottom, 0px)) + var(--reader-bar, 0px) + 12px)" }}>
      <div aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-purple text-sm font-bold text-white">TY</div>
      <div className="min-w-0 flex-1">
        {mode === "ios" ? (
          <>
            <p className="text-sm font-medium">Uygulama gibi kullan</p>
            <p className="text-xs text-text-secondary">
              Safari&apos;de <Share size={13} className="inline -mt-0.5" aria-label="Paylaş" /> Paylaş → <b>Ana Ekrana Ekle</b>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Uygulama olarak yükle</p>
            <p className="text-xs text-text-secondary">Ana ekrana ekle, tarayıcı çubuğu olmadan tam ekran çalışsın.</p>
          </>
        )}
      </div>
      {mode === "android" && (
        <button type="button"
          onClick={async () => { try { await prompt?.prompt(); await prompt?.userChoice; } catch {} setMode("none"); }}
          className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent-purple px-3 text-sm text-white">
          <Download size={14} aria-hidden /> Yükle
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Kapat"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
