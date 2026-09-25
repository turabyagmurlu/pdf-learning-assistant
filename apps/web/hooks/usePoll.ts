"use client";
/**
 * Ortak durum yoklama kancasi (pil ve veri dostu).
 *
 *   usePoll(async () => { const s = await api(...); return s.status === "ready"; },
 *           { active: !bitti, base: 3000, max: 15000 });
 *
 * - `fn` true donerse yoklama durur (bir sonraki `active` false->true gecisine kadar).
 * - Sekme gorunmezken (document.hidden) ya da cihaz cevrimdisiyken istek atilmaz;
 *   sekme gorunur olunca / baglanti gelince hemen bir kez calisir, aralik basa doner.
 * - Aralik her turda 1.5 kat uzar: 3 -> 4.5 -> 6.75 -> 10 -> 15 sn (max).
 * - Hata firlatan tur da sayilir (aralik yine uzar); yoklama durmaz.
 * - Donen `kick()` araligi basa alir: bir sonraki tur `base` ms sonra
 *   (ornegin ilerleme degistiginde; `fn` icinden cagrilabilir).
 */
import { useCallback, useEffect, useRef } from "react";

export type PollOpts = { active: boolean; base?: number; max?: number };

export function usePoll(fn: () => Promise<boolean | void>, opts: PollOpts) {
  const { active } = opts;
  const base = Math.max(500, opts.base ?? 3000);
  const max = Math.max(base, opts.max ?? 15000);

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active) { kickRef.current = () => {}; return; }
    let alive = true;
    let stopped = false;
    let running = false;
    let resetAfterRun = false;
    let delay = base;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const canRun = () =>
      alive && !stopped &&
      (typeof document === "undefined" || !document.hidden) &&
      (typeof navigator === "undefined" || navigator.onLine !== false);

    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const schedule = (ms: number) => {
      clear();
      if (!alive || stopped) return;
      timer = setTimeout(tick, ms);
    };

    async function tick() {
      timer = null;
      if (!canRun()) return;            // gorunmez / cevrimdisi: olay gelince devam eder
      if (running) return;
      running = true;
      try {
        const done = await fnRef.current();
        if (done === true) { stopped = true; return; }
      } catch {
        /* sessizce devam; aralik yine uzar */
      } finally {
        running = false;
      }
      if (resetAfterRun) { resetAfterRun = false; delay = base; schedule(base); return; }
      delay = Math.min(max, Math.round(delay * 1.5));
      schedule(delay);
    }

    const resume = () => {
      if (!canRun()) { clear(); return; }
      delay = base;
      schedule(0);
    };
    const onVis = () => { if (document.hidden) clear(); else resume(); };
    const onOffline = () => clear();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", resume);
    window.addEventListener("offline", onOffline);
    kickRef.current = () => {
      if (!alive || stopped) return;
      if (running) { resetAfterRun = true; return; }
      delay = base;
      if (canRun()) schedule(base);
    };
    schedule(base);

    return () => {
      alive = false;
      clear();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", onOffline);
      kickRef.current = () => {};
    };
  }, [active, base, max]);

  return { kick: useCallback(() => kickRef.current(), []) };
}

export default usePoll;
