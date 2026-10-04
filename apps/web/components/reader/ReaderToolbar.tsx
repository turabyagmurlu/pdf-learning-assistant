"use client";
/**
 * PDF okuyucu kontrolleri (3.0 "Derin ve Sade").
 * - Genis ekran (>=1024): ReaderToolbar, baslik satirinda tek satir, EN FAZLA 8 dugme (Geri dahil):
 *   Sol panel · ◀ sayfa ▶ · % (tek dugme; acilir −/sığdır/+) · Kalem · Odak · ⋯ · Sag panel.
 *   Kenar notu, silgi, alt cizgi, geri al: Kalem paletinde (PenPalette). Vurgulari disa aktarma: Çalışma notu'nda.
 * - "⋯" menusu EN FAZLA 5 madde: Kağıt · Metin/Sayfa · (dar ekranda Sayfaya sığdır) · Ses seçimi · Kısayollar.
 * - Dar ekran: ReaderMoreMenu (baslikta "⋯") + ReaderBottomBar (altta: Icindekiler · sayfa · Kalem · panel).
 * Tum hedefler en az 40 px (dar ekranda 44 px); her dugmenin gorunen metni ya da aria-label'i var.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PenTool, PaperChoice, PaperTone } from "@/lib/reader";
import { PAPER_CHOICES, PAPER_LABEL, loadPaper, savePaper, resolvePaper } from "@/lib/reader";
import {
  ChevronLeft, ChevronRight, Minus, Plus, Highlighter,
  FileText, AlignLeft, Maximize2, Minimize2, PanelLeft, PanelRight,
  MoreHorizontal, RotateCcw, Check, ListTree, MessageSquare, Volume2, Keyboard,
} from "lucide-react";

export type Theme = "light" | "sepia" | "dark";
/** Okuyucu araci: kalem paleti araclari (lib/reader PenTool) — none | ink | highlight | underline | note | eraser */
export type Tool = PenTool;
/** Paletle acilan araclar (vurgu dugmesi bunlardan biri acikken "basili" gorunur) */
export const PEN_TOOLS: Tool[] = ["ink", "highlight", "underline", "eraser"];
export const isPenTool = (t: Tool) => PEN_TOOLS.includes(t);
export const THEME_LABEL: Record<Theme, string> = { light: "Açık", sepia: "Sepya", dark: "Koyu" };
const THEME_ORDER: Theme[] = ["light", "sepia", "dark"];
export const nextTheme = (t: Theme): Theme => THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % 3];

export type ViewMode = "page" | "text";
export interface ToolbarProps {
  page: number; numPages: number; setPage: (n: number) => void;
  scale: number; setScale: (f: (s: number) => number) => void;
  tool: Tool; setTool: (t: Tool) => void;
  focus: boolean; setFocus: (b: boolean) => void;
  leftOpen: boolean; setLeftOpen: (b: boolean) => void;
  rightOpen: boolean; setRightOpen: (b: boolean) => void;
  /** "Sayfa | Metin" görünümü ("⋯" menüsünde) */
  viewMode?: ViewMode; setViewMode?: (m: ViewMode) => void;
  /** Okuma kagidi (Ajan V2): secim + o an uygulanan ton. setPaper verilirse "⋯" menusunde secici cikar. */
  paper?: PaperChoice; paperTone?: PaperTone; setPaper?: (p: PaperChoice) => void;
}

/** Ses seçimi (Ajan V): ListenDock / ses ayarı bu olayı dinler ve tek listeli seçiciyi açar. */
export const VOICE_PICKER_EVENT = "typdf:voice-picker";
const openVoicePicker = () => window.dispatchEvent(new CustomEvent(VOICE_PICKER_EVENT));
/** Kısayollar penceresi (components/Shortcuts "?" tuşunu dinler). */
const openShortcuts = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));

/* ===== Okuma kagidi (Ajan V2) ===== */

/** Kagit adlari (2.0 parsomen dili): "cream" anahtari ayni kaldi, adi "Parşömen". */
export const PAPER_NAME: Record<PaperChoice, string> = { ...PAPER_LABEL, cream: "Krem" };

/** Uygulama temasi koyu mu (<html class="dark">); tema degisince guncellenir. */
export function useAppDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const r = document.documentElement;
    const apply = () => setDark(r.classList.contains("dark"));
    apply();
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(apply);
    mo.observe(r, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

/** Kagit secimi (localStorage "typdf-paper") + cozulmus ton. readerTheme: PDF okuyucunun kendi temasi (Otomatik icin). */
export function usePaper(readerTheme?: Theme) {
  const [paper, setPaperRaw] = useState<PaperChoice>("auto");
  useEffect(() => { setPaperRaw(loadPaper()); }, []);
  const setPaper = useCallback((p: PaperChoice) => { setPaperRaw(p); savePaper(p); }, []);
  const appDark = useAppDark();
  return { paper, setPaper, paperTone: resolvePaper(paper, appDark, readerTheme) };
}

/** Kagit secici: Otomatik / Beyaz / Parşömen / Gece — yuvarlak ornekli dugmeler (aria-pressed). */
export function PaperPicker({ value, tone, onChange }: { value: PaperChoice; tone: PaperTone; onChange: (p: PaperChoice) => void }) {
  return (
    <div role="group" aria-label="Kağıt rengi" className="px-1 py-1">
      <div className="flex items-center justify-between px-2 pb-1 text-xs text-text-secondary">
        <span className="font-medium text-text-primary">Kağıt</span>
        <span aria-live="polite">{value === "auto" ? `Otomatik · şu an ${PAPER_NAME[tone]}` : PAPER_NAME[value]}</span>
      </div>
      <div className="flex items-stretch gap-1">
        {PAPER_CHOICES.map((c) => (
          <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)}
                  title={c === "auto" ? "Otomatik: uygulama koyu temadaysa Gece, açıksa Beyaz" : `Kağıt: ${PAPER_NAME[c]}`}
                  className={`flex min-h-[56px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-lg text-xs hover:bg-surface-muted ${value === c ? "bg-accent-purple/10 font-medium text-text-primary ring-2 ring-inset ring-accent-purple" : "text-text-secondary"}`}>
            <span className="paper-swatch" data-tone={c} aria-hidden />
            {PAPER_NAME[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tek dugme + acilir kagit secici (menusu olmayan okuyucular icin: metin kaynaklari). */
export function PaperButton({ value, tone, onChange }: { value: PaperChoice; tone: PaperTone; onChange: (p: PaperChoice) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  return (
    <div ref={wrap} className="relative shrink-0">
      <button ref={btnRef} type="button" aria-expanded={open} aria-haspopup="true"
              aria-label={`Kağıt rengi: ${value === "auto" ? `Otomatik (${PAPER_NAME[tone]})` : PAPER_NAME[value]}`}
              title="Kağıt rengi" onClick={() => setOpen((v) => !v)}
              className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-hover">
        <span className="paper-swatch" data-tone={value === "auto" ? "auto" : tone} aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border bg-surface p-1 text-text-primary shadow-xl">
          <PaperPicker value={value} tone={tone} onChange={onChange} />
        </div>
      )}
    </div>
  );
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

/** Yakınlaştırma: tek düğme (%); açılınca −  Sığdır  + (klavye: − / + / 0). */
function ZoomButton({ scale, setScale, btn }: { scale: number; setScale: ToolbarProps["setScale"]; btn: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  const pct = Math.round(scale * 100);
  return (
    <div ref={wrap} className="relative">
      <button ref={btnRef} type="button" aria-haspopup="true" aria-expanded={open}
              className="h-10 min-w-[52px] rounded-lg px-1 text-xs hover:bg-surface-hover"
              aria-label={`Yakınlaştırma yüzde ${pct}; büyütme seçenekleri`} title="Yakınlaştırma"
              onClick={() => setOpen((v) => !v)}>{pct}%</button>
      {open && (
        <div role="group" aria-label="Yakınlaştırma" className="absolute left-1/2 top-full z-50 mt-1 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border bg-surface p-1 shadow-xl">
          <button type="button" className={btn} aria-label="Uzaklaştır" title="Uzaklaştır (−)" onClick={() => setScale(zoomOut)}><Minus size={17} /></button>
          <button type="button" className="h-10 rounded-lg px-2 text-xs hover:bg-surface-hover" aria-label="Sayfaya sığdır" title="Sayfaya sığdır (0)"
                  onClick={() => { setScale(() => 1); setOpen(false); }}>Sığdır</button>
          <button type="button" className={btn} aria-label="Yakınlaştır" title="Yakınlaştır (+)" onClick={() => setScale(zoomIn)}><Plus size={17} /></button>
        </div>
      )}
    </div>
  );
}

/** Genis ekran arac cubugu (baslik satirinin sagi) — 7 dugme (+ basliktaki Geri = 8). */
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
      <ZoomButton scale={p.scale} setScale={p.setScale} btn={btn} />
      <button className={`${btn} ${isPenTool(p.tool) || p.tool === "note" ? active : ""}`} aria-label="Kalem: vurgula, altını çiz, kenar notu, el yazısı" aria-pressed={isPenTool(p.tool) || p.tool === "note"}
              title="Kalem: vurgula, altını çiz, kenar notu, el yazısı (H)"
              onClick={() => p.setTool(p.tool !== "none" ? "none" : "highlight")}><Highlighter size={17} /></button>
      <button className={`${btn} ${p.focus ? active : ""}`} aria-label="Odak modu" aria-pressed={p.focus} title="Odak modu (F)"
              onClick={() => p.setFocus(!p.focus)}>{p.focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      <ReaderMoreMenu {...p} variant="wide" />
      {!p.focus && (
        <>
          <Sep />
          <button className={`${btn} ${p.rightOpen ? active : ""}`} aria-label="Çalışma notu, Sor ve Bağlantılar paneli" aria-pressed={p.rightOpen}
                  title="Çalışma notu · Sor · Bağlantılar" onClick={() => p.setRightOpen(!p.rightOpen)}><PanelRight size={17} /></button>
        </>
      )}
    </div>
  );
}

type Item = { key: string; label: string; icon: JSX.Element; onSelect: () => void; disabled?: boolean; checked?: boolean };

/** "⋯" menusu (≤5 madde). wide: Metin/Sayfa · Ses seçimi · Kısayollar + Kağıt; narrow: + Sayfaya sığdır. */
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

  const items: Item[] = [];
  if (p.setViewMode) {
    const text = p.viewMode === "text";
    items.push({ key: "view", label: text ? "Sayfa görünümüne geç" : "Metin görünümü (yeniden akan yazı)",
                 icon: text ? <FileText size={17} /> : <AlignLeft size={17} />, checked: text,
                 onSelect: () => p.setViewMode?.(text ? "page" : "text") });
  }
  if (p.variant === "narrow" && p.viewMode !== "text") {
    items.push({ key: "zfit", label: `Sayfaya sığdır (şu an %${Math.round(p.scale * 100)})`, icon: <RotateCcw size={17} />, onSelect: () => p.setScale(() => 1) });
  }
  items.push(
    { key: "voice", label: "Ses seçimi", icon: <Volume2 size={17} />, onSelect: openVoicePicker },
    { key: "keys", label: "Kısayollar", icon: <Keyboard size={17} />, onSelect: openShortcuts },
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
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border bg-surface p-1 text-text-primary shadow-xl">
        <div ref={listRef} role="menu" aria-label="Okuyucu araçları" onKeyDown={onListKey}>
          {items.map((it) => (
            <button key={it.key} type="button" disabled={it.disabled}
                    role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
                    aria-checked={it.checked !== undefined ? it.checked : undefined}
                    onClick={() => { it.onSelect(); setOpen(false); }}
                    className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-surface-muted disabled:opacity-40">
              <span className="text-text-secondary">{it.icon}</span>
              <span className="flex-1">{it.label}</span>
              {it.checked && <Check size={16} className="text-accent-purple" aria-hidden />}
            </button>
          ))}
        </div>
        {/* Kagit: menunun altinda ayri grup (secince menu acik kalir, fark hemen gorulur) */}
        {p.setPaper && (
          <div className="mt-1 border-t pt-1">
            <PaperPicker value={p.paper || "auto"} tone={p.paperTone || "white"} onChange={p.setPaper} />
          </div>
        )}
        </div>
      )}
    </div>
  );
}

/** Dar ekran alt cubugu: İçindekiler · ◀ sayfa ▶ · Kalem · sag panel (4 oge).
 *  rightLabel: sag panelin o anki sekmesi; rightFresh: Çalışma notu'na yeni biriken sayi (altin nokta).
 *  tool/setTool verilirse Kalem dugmesi cikar (palet PenPalette ile acilir). */
export function ReaderBottomBar({ page, numPages, setPage, onLeft, onRight, leftOpen, rightOpen, rightLabel = "Sor", rightIcon, rightFresh = 0, tool, setTool }: {
  page: number; numPages: number; setPage: (n: number) => void;
  onLeft: () => void; onRight: () => void; leftOpen: boolean; rightOpen: boolean;
  rightLabel?: string; rightIcon?: JSX.Element; rightFresh?: number;
  tool?: Tool; setTool?: (t: Tool) => void;
}) {
  const penOn = !!tool && tool !== "none";
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
      {setTool && (
        <button type="button" className={`${lab} ${penOn ? "text-accent-purple" : ""}`} aria-pressed={penOn}
                aria-label="Kalem: vurgula, altını çiz, kenar notu, el yazısı" onClick={() => setTool(penOn ? "none" : "highlight")}>
          <Highlighter size={18} aria-hidden /><span>Kalem</span>
        </button>
      )}
      <button type="button" className={`${lab} relative ${rightOpen ? "text-accent-purple" : ""}`} onClick={onRight} aria-expanded={rightOpen} aria-haspopup="dialog"
              aria-label={`${rightLabel} paneli${rightFresh > 0 ? `, çalışma notuna ${rightFresh} yeni vurgu eklendi` : ""}`}>
        {rightIcon || <MessageSquare size={18} aria-hidden />}<span>{rightLabel}</span>
        {rightFresh > 0 && <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full" style={{ background: "var(--gold, #A57A2C)" }} />}
      </button>
    </div>
  );
}

function Sep() { return <div className="mx-0.5 h-5 w-px" aria-hidden style={{ background: "var(--r-border)" }} />; }
