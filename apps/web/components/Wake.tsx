"use client";
/**
 * Uyaniklik ve senkron:
 *  - Uygulama acilir acilmaz /health'e dokunur; sunucu uyuyorsa ilk gercek istek
 *    gelmeden uyanmaya baslar (Render ucretsiz plan ~50 sn).
 *  - Sunucu yavas cevap veriyorsa ustte ince bir "uygulama hazirlaniyor" seridi gosterir.
 *  - Internet baglantisi yoksa ustte "Internet baglantin yok" seridi gosterir (sunucu uyaniyor denmez).
 *  - Sekme/uygulama one gelince (telefonda geri donunce) "typdf:refresh" olayi yayar;
 *    sayfalar bunu dinleyip verisini tazeler. 20 sn'den kisa aralari yok sayar.
 */
import { useEffect, useState } from "react";
import { API } from "@/lib/api";

const REFRESH_EVENT = "typdf:refresh";

export default function Wake() {
  const [waking, setWaking] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const upd = () => setOffline(navigator.onLine === false);
    upd();
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    return () => { window.removeEventListener("online", upd); window.removeEventListener("offline", upd); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const slow = setTimeout(() => { if (!cancelled && navigator.onLine !== false) setWaking(true); }, 3000);
    fetch(`${API}/health`, { cache: "no-store" })
      .catch(() => { /* cevrimdisi ya da sunucu kapali: seridi kapat, sayfa kendi hatasini gosterir */ })
      .finally(() => { cancelled = true; clearTimeout(slow); setWaking(false); });

    let last = Date.now();
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < 20000) return;
      last = Date.now();
      fetch(`${API}/health`, { cache: "no-store" }).catch(() => { /* yalniz isitma */ });
      window.dispatchEvent(new Event(REFRESH_EVENT));
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("online", onVis);
    return () => {
      cancelled = true; clearTimeout(slow);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("online", onVis);
    };
  }, []);

  if (offline) {
    return (
      <div role="status" className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-text-primary px-3 py-1.5 text-xs text-background"
           style={{ paddingTop: "max(env(safe-area-inset-top), 6px)" }}>
        İnternet bağlantın yok. Bağlantın gelince kaldığın yerden devam edebilirsin.
      </div>
    );
  }
  if (!waking) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-accent-purple px-3 py-1.5 text-xs text-white"
         style={{ paddingTop: "max(env(safe-area-inset-top), 6px)" }}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      Uygulama hazırlanıyor; ilk açılış 30 saniyeyi bulabilir…
    </div>
  );
}

/** Sayfalarda: useRefreshOn(() => load()) */
export function useRefreshOn(fn: () => void) {
  useEffect(() => {
    const h = () => fn();
    window.addEventListener(REFRESH_EVENT, h);
    return () => window.removeEventListener(REFRESH_EVENT, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn]);
}
