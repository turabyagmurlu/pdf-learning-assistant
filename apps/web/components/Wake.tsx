"use client";
/**
 * Uyaniklik ve senkron:
 *  - Uygulama acilir acilmaz /health'e dokunur; sunucu uyuyorsa ilk gercek istek
 *    gelmeden uyanmaya baslar (Render ucretsiz plan ~50 sn).
 *  - Sunucu yavas cevap veriyorsa ustte ince bir "sunucu uyanıyor" seridi gosterir.
 *  - Sekme/uygulama one gelince (telefonda geri donunce) "typdf:refresh" olayi yayar;
 *    sayfalar bunu dinleyip verisini tazeler. 20 sn'den kisa aralari yok sayar.
 */
import { useEffect, useState } from "react";
import { API } from "@/lib/api";

export const REFRESH_EVENT = "typdf:refresh";

export default function Wake() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t0 = Date.now();
    const slow = setTimeout(() => { if (!cancelled) setWaking(true); }, 2500);
    fetch(`${API}/health`, { cache: "no-store" })
      .catch(() => {})
      .finally(() => { cancelled = true; clearTimeout(slow); setWaking(false); void t0; });

    let last = Date.now();
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < 20000) return;
      last = Date.now();
      fetch(`${API}/health`, { cache: "no-store" }).catch(() => {});
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

  if (!waking) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-accent-purple px-3 py-1 text-[12px] text-white"
         style={{ paddingTop: "max(env(safe-area-inset-top), 4px)" }}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
      Sunucu uyanıyor, birkaç saniye…
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
