"use client";
import { useEffect, useState } from "react";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";

import { THEME_KEY as KEY } from "@/lib/theme-boot";
export type ThemeMode = "light" | "dark" | "system";

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}
export function resolveDark(mode: ThemeMode) {
  return mode === "dark" || (mode === "system" && systemDark());
}

/** html.dark sinifini, favicon'u ve theme-color'i uygular. */
export function applyTheme(mode: ThemeMode) {
  const dark = resolveDark(mode);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  // favicon: gunduz Ş1, gece Ş2
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-brand]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon"; link.type = "image/svg+xml"; link.setAttribute("data-brand", "1");
    document.head.appendChild(link);
  }
  link.href = dark ? "/brand-night.svg" : "/brand-day.svg";
  // durum cubugu rengi: layout'taki (media'li) etiketler dahil hepsi secilen temaya uysun
  const color = dark ? "#1c1747" : "#f6b45c";
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length) metas.forEach((m) => { m.content = color; });
  else {
    const meta = document.createElement("meta");
    meta.name = "theme-color"; meta.setAttribute("data-brand", "1"); meta.content = color;
    document.head.appendChild(meta);
  }
}

export function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* localStorage kapali olabilir */ }
  return "system";
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const m = readTheme();
    setMode(m); setDark(resolveDark(m)); applyTheme(m);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => { const cur = readTheme(); if (cur === "system") { applyTheme(cur); setDark(resolveDark(cur)); } };
    const onLocal = () => { const cur = readTheme(); setMode(cur); setDark(resolveDark(cur)); };
    mq?.addEventListener?.("change", onChange);
    window.addEventListener("themechange", onLocal);
    return () => { mq?.removeEventListener?.("change", onChange); window.removeEventListener("themechange", onLocal); };
  }, []);
  function set(m: ThemeMode) {
    try { localStorage.setItem(KEY, m); } catch { /* gizli sekme vb. */ }
    setMode(m); setDark(resolveDark(m)); applyTheme(m);
    window.dispatchEvent(new Event("themechange"));
  }
  return { mode, dark, set };
}

export const THEME_LABEL: Record<ThemeMode, string> = { light: "Açık", dark: "Koyu", system: "Sistem" };

/** Sol menudeki tema dugmesi: acik → koyu → sistem dongusu. */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode, set } = useTheme();
  const next: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };
  const label = THEME_LABEL[mode];
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : MonitorSmartphone;
  return (
    <button type="button" onClick={() => set(next[mode])}
            aria-label={`Tema: ${label}. ${THEME_LABEL[next[mode]]} temaya geçmek için tıkla`}
            className={"flex items-center gap-2 rounded-md px-3 py-2 text-text-secondary hover:bg-surface-muted " + className}>
      <Icon size={18} aria-hidden="true" /> Tema: {label}
    </button>
  );
}
