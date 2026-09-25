"use client";
/**
 * Klavye acilinca duzen (T-2): gorunur alan (visualViewport) yuksekligini ve
 * klavyenin kapladigi alani CSS degiskeni olarak <html>'e yazar.
 *
 *   --vvh : gorunur alanin yuksekligi (px). Klavye acikken kuculur.
 *   --kb  : klavyenin (ya da alt tarafta kalan gizli alanin) yuksekligi (px); klavye yokken 0.
 *   html[data-kb="1"] : klavye acikken (>= 80 px) isaret; CSS'te alt cubuklari gizlemek icin.
 *
 * Kullanim (tabaka / sohbet kutusu):
 *   style={{ height: "min(85dvh, calc(var(--vvh, 100dvh) - 12px))", marginBottom: "var(--kb, 0px)" }}
 *
 * Kanca birden cok yerde cagrilabilir; dinleyici tek kez kurulur (sayac).
 * iOS'ta klavye duzeni kucultmez, yalniz visualViewport kuculur; Android'de
 * `interactiveWidget: "resizes-content"` (app/layout.tsx) ile dvh de kuculur.
 */
import { useEffect, useState } from "react";

export type VisualViewportState = { height: number; keyboard: number; open: boolean };

const KB_MIN = 80;            // bundan kucuk farklar (adres cubugu vb.) klavye sayilmaz
let listeners = 0;
let state: VisualViewportState = { height: 0, keyboard: 0, open: false };
const subs = new Set<(s: VisualViewportState) => void>();
let raf = 0;

function measure() {
  raf = 0;
  if (typeof window === "undefined") return;
  const vv = window.visualViewport;
  const inner = window.innerHeight;
  const h = vv ? Math.round(vv.height) : inner;
  const kb = vv ? Math.max(0, Math.round(inner - vv.height - vv.offsetTop)) : 0;
  const open = kb >= KB_MIN;
  const root = document.documentElement;
  root.style.setProperty("--vvh", h + "px");
  root.style.setProperty("--kb", (open ? kb : 0) + "px");
  if (open) root.setAttribute("data-kb", "1"); else root.removeAttribute("data-kb");
  if (h !== state.height || kb !== state.keyboard || open !== state.open) {
    state = { height: h, keyboard: open ? kb : 0, open };
    subs.forEach((f) => f(state));
  }
}
function schedule() { if (!raf) raf = requestAnimationFrame(measure); }

function attach() {
  if (listeners++ > 0) return;
  const vv = window.visualViewport;
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  measure();
}
function detach() {
  if (--listeners > 0) return;
  listeners = 0;
  const vv = window.visualViewport;
  vv?.removeEventListener("resize", schedule);
  vv?.removeEventListener("scroll", schedule);
  window.removeEventListener("resize", schedule);
  window.removeEventListener("orientationchange", schedule);
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  const root = document.documentElement;
  root.style.removeProperty("--vvh");
  root.style.removeProperty("--kb");
  root.removeAttribute("data-kb");
}

/** --vvh / --kb degiskenlerini canli tutar; klavye durumunu dondurur. */
export function useVisualViewport(): VisualViewportState {
  const [s, setS] = useState<VisualViewportState>(state);
  useEffect(() => {
    attach();
    subs.add(setS);
    setS(state);
    return () => { subs.delete(setS); detach(); };
  }, []);
  return s;
}

export default useVisualViewport;
