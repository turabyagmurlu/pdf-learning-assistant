"use client";
/**
 * PDF okuyucu kontrolleri.
 * - Genis ekran (>=1024): ReaderToolbar, baslik satirinda tek satir; birincil kontroller
 *   gorunur, ikinciller (tema, cift sayfa, geri al/yinele, disa aktar) "⋯" menusunde.
 * - Dar ekran: ReaderMoreMenu (baslikta "⋯") + ReaderBottomBar (altta: Icindekiler · sayfa · Sohbet).
 * Tum hedefler en az 40 px (dar ekranda 44 px); her dugmenin gorunen metni ya da aria-label'i var.
 */
import { useEffect, useRef, useState } from "react";
import type { PenTool } from "@/lib/reader";
import {
  ChevronLeft, ChevronRight, Minus, Plus, Highlighter, StickyNote,
  BookOpen, FileText, Maximize2, Minimize2, Sun, Contrast, Moon, PanelLeft, PanelRight, Download,
  Undo2, Redo2, MoreHorizontal, RotateCcw, Check, ListTree, MessageSquare,
} from "lucide-react";

export type Theme = "light" | "sepia" | "dark";
/** Okuyucu araci: kalem paleti araclari (lib/reader PenTool) — none | highlight | underline | note | eraser */
export type Tool = PenTool;
/** Paletle acilan araclar (vurgu dugmesi bunlardan biri acikken "basili" gorunur) */
export const PEN_TOOLS: Tool[] = ["highlight", "underline", "eraser"];
export const isPenTool = (t: Tool) => PEN_TOOLS.includes(t);
export const THEME_LABEL: Record<Theme, string> = { light: "Açık", sepia: "Sepya", dark: "Koyu" };
const THEME_ORDER: Theme[] = ["light", "sepia", "dark"];
export const nextTheme = (t: Theme): Theme => THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % 3];

export interface ToolbarProps {
  page: number; numPages: number; setPage: (n: number) => void;
  scale: number; setScale: (f: (s: number) => number) => void;
  spread: boolean; setSpread: (b: boolean) => void;
  tool: Tool; setTool: (t: Tool) => void;
  theme: Theme; setTheme: (t: Theme) => void;
  focus: boolean; setFocus: (b: boolean) => void;
  leftOpen: boolean; setLeftOpen: (b: boolean) => void;
  rightOpen: boolean; setRightOpen: (b: boolean) => void;
  onExport: () => void;
  onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean;
}

const zoomOut = (s: number) => Math.max(0.5, +(s - 0.1).toFixed(2));
const zoomIn = (s: number) => Math.min(2.5, +(s + 0.1).toFixed(2));

function PageInput({ page, numPages, setPage, tall }: { page: number; numPages: number; setPage: (n: number) => void; tall?: boolean }) {
  const [v, setV] = useState(String(page));
  useEffect(() => { setV(String(page)); }, [page]);
  function commit() {
    const n = parseInt(v, 10);
    if (!isNaN(n)) setPage(Math.min(Math.max(1, n), numPages || 1)); else setV(String(page));
  }
  return (
    <div className="flex items-center gap-1 px-1 text-sm">
      <input aria-label={`Sayfa numarası, toplam ${numPages || 0} sayfa`} inputMode="numeric" value={v}
             onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))}
             onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } }}
             className={`${tall ? "h-10" : "h-9"} w-11 rounded-md border bg-surface px-1 text-center text-[16px] text-text-primary sm:text-sm`} />
      <span style={{ color: "var(--r-ink-2)" }} aria-hidden>/ {numPages || "–"}</span>
    </div>
  );
}

/** Genis ekran arac cubugu (baslik satirinin sagi). */
export default function ReaderToolbar(p: ToolbarProps) {
  // H-9: secili arac uygulama moruyla (acik/koyu temada >= 4.5:1), hover zemini token
  const btn = "flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-hover disabled:opacity-40";
  const active = "bg-accent-purple/10 text-accent-purple";
  return (
    <div className="reader-toolbar flex shrink-0 items-center gap-0.5 rounded-xl px-1 py-0.5" role="toolbar" aria-label="Okuyucu araçları">
      {!p.focus && (
        <button className={`${btn} ${p.leftOpen ? active : ""}`} aria-label="İçindekiler ve özet paneli" aria-pressed={p.leftOpen}
                title="İçindekiler ve özet" onClick={() => p.setLeftOpen(!p.leftOpen)}><PanelLeft size={17} /></button>
      )}
      <Sep />
      <button className={btn} aria-label="Önceki sayfa" title="Önceki sayfa (←)" disabled={p.page <= 1}
              onClick={() => p.setPage(Math.max(1, p.page - 1))}><ChevronLeft size={17} /></button>
      <PageInput page={p.page} numPages={p.numPages} setPage={p.setPage} />
      <button className={btn} aria-label="Sonraki sayfa" title="Sonraki sayfa (→)" disabled={p.page >= p.numPages}
              onClick={() => p.setPage(Math.min(p.numPages, p.page + 1))}><ChevronRight size={17} /></button>
      <Sep />
      <button className={btn} aria-label="Uzaklaştır" title="Uzaklaştır" onClick={() => p.setScale(zoomOut)}><Minus size={17} /></button>
      <button className="h-10 min-w-[52px] rounded-lg px-1 text-xs hover:bg-surface-hover"
              aria-label={`Yakınlaştırma yüzde ${Math.round(p.scale * 100)}. Sayfaya sığdırmak için bas`}
              title="Yakınlaştırmayı sıfırla (sayfaya sığdır)"
              onClick={() => p.setScale(() => 1)}>{Math.round(p.scale * 100)}%</button>
      <button className={btn} aria-label="Yakınlaştır" title="Yakınlaştır" onClick={() => p.setScale(zoomIn)}><Plus size={17} /></button>
      <Sep />
      <button className={`${btn} ${isPenTool(p.tool) ? active : ""}`} aria-label="Vurgu aracı ve kalem paleti" aria-pressed={isPenTool(p.tool)}
              title="Vurgu aracı (H): paleti açar — renk, altını çiz, silgi"
              onClick={() => p.setTool(isPenTool(p.tool) ? "none" : "highlight")}><Highlighter size={17} /></button>
      <button className={`${btn} ${p.tool === "note" ? active : ""}`} aria-label="Kenar notu aracı" aria-pressed={p.tool === "note"}
              title="Kenar notu: sayfada bir yere tıkla" onClick={() => p.setTool(p.tool === "note" ? "none" : "note")}><StickyNote size={17} /></button>
      <button className={`${btn} ${p.focus ? active : ""}`} aria-label="Odak modu" aria-pressed={p.focus} title="Odak modu (F)"
              onClick={() => p.setFocus(!p.focus)}>{p.focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      <ReaderMoreMenu {...p} variant="wide" />
      {!p.focus && (
        <>
          <Sep />
          <button className={`${btn} ${p.rightOpen ? active : ""}`} aria-label="Sohbet, anlatım ve notlar paneli" aria-pressed={p.rightOpen}
                  title="Sohbet, anlatım ve notlar" onClick={() => p.setRightOpen(!p.rightOpen)}><PanelRight size={17} /></button>
        </>
      )}
    </div>
  );
}

type Item = { key: string; label: string; icon: JSX.Element; onSelect: () => void; disabled?: boolean; checked?: boolean };

/** "⋯" menusu. wide: yalniz ikincil araclar; narrow: dar ekranda tum araclar. */
export function ReaderMoreMenu(p: ToolbarProps & { variant: "wide" | "narrow" }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => listRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus(), 0);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);

  const themeIcon = p.theme === "light" ? <Sun size={17} /> : p.theme === "sepia" ? <Contrast size={17} /> : <Moon size={17} />;
  const items: Item[] = [];
  if (p.variant === "narrow") {
    items.push(
      { key: "zin", label: "Yakınlaştır", icon: <Plus size={17} />, onSelect: () => p.setScale(zoomIn) },
      { key: "zout", label: "Uzaklaştır", icon: <Minus size={17} />, onSelect: () => p.setScale(zoomOut) },
      { key: "zfit", label: `Sayfaya sığdır (şu an %${Math.round(p.scale * 100)})`, icon: <RotateCcw size={17} />, onSelect: () => p.setScale(() => 1) },
      { key: "hl", label: "Vurgu aracı ve kalem paleti", icon: <Highlighter size={17} />, checked: isPenTool(p.tool),
        onSelect: () => p.setTool(isPenTool(p.tool) ? "none" : "highlight") },
      { key: "note", label: "Kenar notu aracı", icon: <StickyNote size={17} />, checked: p.tool === "note",
        onSelect: () => p.setTool(p.tool === "note" ? "none" : "note") },
    );
  }
  items.push({ key: "theme", label: `Okuma teması: ${THEME_LABEL[p.theme]}`, icon: themeIcon, onSelect: () => p.setTheme(nextTheme(p.theme)) });
  if (p.variant === "wide") {
    items.push({ key: "spread", label: p.spread ? "Tek sayfa görünümü" : "Çift sayfa görünümü", icon: p.spread ? <FileText size={17} /> : <BookOpen size={17} />,
                 onSelect: () => p.setSpread(!p.spread) });
  }
  items.push(
    { key: "undo", label: "Geri al (Ctrl+Z)", icon: <Undo2 size={17} />, disabled: !p.canUndo, onSelect: () => p.onUndo?.() },
    { key: "redo", label: "Yinele (Ctrl+Shift+Z)", icon: <Redo2 size={17} />, disabled: !p.canRedo, onSelect: () => p.onRedo?.() },
    { key: "export", label: "Notları dışa aktar (Markdown)", icon: <Download size={17} />, onSelect: p.onExport },
  );

  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const list = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") || []);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1
      : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[n].focus();
  }

  const size = p.variant === "narrow" ? "h-11 w-11" : "h-10 w-10";
  return (
    <div ref={wrap} className="relative">
      <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Diğer okuyucu araçları"
              title="Diğer araçlar" onClick={() => setOpen((v) => !v)}
              className={`flex ${size} items-center justify-center rounded-lg hover:bg-surface-hover`}>
        <MoreHorizontal size={19} />
      </button>
      {open && (
        <div ref={listRef} role="menu" aria-label="Okuyucu araçları" onKeyDown={onListKey}
             className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border bg-surface p-1 text-text-primary shadow-xl">
          {items.map((it) => (
            <button key={it.key} type="button" disabled={it.disabled}
                    role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
                    aria-checked={it.checked !== undefined ? it.checked : undefined}
                    onClick={() => { it.onSelect(); if (it.key !== "zin" && it.key !== "zout") setOpen(false); }}
                    className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-surface-muted disabled:opacity-40">
              <span className="text-text-secondary">{it.icon}</span>
              <span className="flex-1">{it.label}</span>
              {it.checked && <Check size={16} className="text-accent-purple" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Dar ekran alt cubugu: panelleri acan etiketli dugmeler + sayfa gezinme. */
export function ReaderBottomBar({ page, numPages, setPage, onLeft, onRight, leftOpen, rightOpen }: {
  page: number; numPages: number; setPage: (n: number) => void;
  onLeft: () => void; onRight: () => void; leftOpen: boolean; rightOpen: boolean;
}) {
  const nav = "flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-hover disabled:opacity-40";
  // ikon ustte, metin altta: 375 px'e iki etiket + sayfa gezinme sigsin
  const lab = "flex h-12 min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 text-xs hover:bg-surface-hover";
  return (
    <div className="reader-toolbar flex shrink-0 items-center justify-between gap-1 border-t px-1.5"
         style={{ paddingBottom: "env(safe-area-inset-bottom)" }} role="toolbar" aria-label="Okuyucu gezinme">
      <button type="button" className={`${lab} ${leftOpen ? "text-accent-purple" : ""}`} onClick={onLeft} aria-expanded={leftOpen} aria-haspopup="dialog">
        <ListTree size={18} aria-hidden /><span>İçindekiler</span>
      </button>
      <div className="flex items-center">
        <button type="button" className={nav} aria-label="Önceki sayfa" disabled={page <= 1}
                onClick={() => setPage(Math.max(1, page - 1))}><ChevronLeft size={18} /></button>
        <PageInput page={page} numPages={numPages} setPage={setPage} tall />
        <button type="button" className={nav} aria-label="Sonraki sayfa" disabled={page >= numPages}
                onClick={() => setPage(Math.min(numPages, page + 1))}><ChevronRight size={18} /></button>
      </div>
      <button type="button" className={`${lab} ${rightOpen ? "text-accent-purple" : ""}`} onClick={onRight} aria-expanded={rightOpen} aria-haspopup="dialog">
        <MessageSquare size={18} aria-hidden /><span>Sohbet</span>
      </button>
    </div>
  );
}

function Sep() { return <div className="mx-0.5 h-5 w-px" aria-hidden style={{ background: "var(--r-border)" }} />; }
