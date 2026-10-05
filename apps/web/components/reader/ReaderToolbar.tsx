"use client";
/**
 * PDF okuyucu kontrolleri (Ajan T6, iPad sadelestirme).
 * - Tablet / genis ekran (>=768): ReaderToolbar, baslik satirinin saginda yalniz
 *     Sayfa "12 / 80" (dokununca sayfa numarasi yazilir) · Kalem · Panel (+N rozeti) · ⋯
 *   Odaktayken Panel yerine tek "Odak modundan çık".
 * - "⋯" menusu: İçindekiler · Metin/Sayfa görünümü · Odak modu · Ses seçimi · Kısayollar; altinda
 *   Sayfa (◀ ▶), Yakınlaştırma (− % + Sığdır) ve Kağıt gruplari.
 * - Telefon: baslikta "⋯" (ayni menu) + ReaderBottomBar (altta: sayfa · Kalem · Panel).
 * Tum hedefler en az 44 px; her dugmenin gorunen metni ya da aria-label'i var.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PenTool, PaperChoice, PaperTone } from "@/lib/reader";
import { PAPER_CHOICES, PAPER_LABEL, loadPaper, savePaper, resolvePaper } from "@/lib/reader";
import { requestVoicePicker } from "@/lib/audio";
import {
  ChevronLeft, ChevronRight, Minus, Plus, Highlighter,
  FileText, AlignLeft, Maximize2, Minimize2, PanelRight,
  MoreHorizontal, Check, ListTree, Volume2, Keyboard,
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
  /** Kalem kullanilabilir mi (sayfa gorunumu + PDF yuklu) */
  penAvailable?: boolean;
  focus: boolean; setFocus: (b: boolean) => void;
  /** İçindekiler cekmecesi ("⋯" › İçindekiler) */
  tocOpen: boolean; setTocOpen: (b: boolean) => void;
  rightOpen: boolean; setRightOpen: (b: boolean) => void;
  /** Panel kapaliyken eklenen yeni not sayisi ("+N" rozeti) */
  panelFresh?: number;
  /** "Sayfa | Metin" görünümü ("⋯" menüsünde) */
  viewMode?: ViewMode; setViewMode?: (m: ViewMode) => void;
  /** Okuma kagidi (Ajan V2): secim + o an uygulanan ton. setPaper verilirse "⋯" menusunde secici cikar. */
  paper?: PaperChoice; paperTone?: PaperTone; setPaper?: (p: PaperChoice) => void;
}

/** Ses seçimi (Ajan V): ListenDock bu olayı dinler ve tek listeli seçiciyi (components/audio/VoicePicker) açar. */
export { VOICE_PICKER_EVENT } from "@/lib/audio";
const openVoicePicker = () => requestVoicePicker();
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

/** Sayfa göstergesi "12 / 80": dokununca sayfa numarası yazılır (Enter ya da dışarı dokununca gider). */
export function PageChip({ page, numPages, setPage }: { page: number; numPages: number; setPage: (n: number) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(String(page));
  const btnRef = useRef<HTMLButtonElement>(null);
  function commit() {
    const n = parseInt(v, 10);
    if (!isNaN(n)) setPage(Math.min(Math.max(1, n), numPages || 1));
    setEdit(false);
  }
  if (edit) {
    return (
      <div className="flex h-11 items-center gap-1 px-1 text-sm">
        <input aria-label={`Sayfa numarası, toplam ${numPages || 0} sayfa`} inputMode="numeric" enterKeyHint="go" autoFocus value={v}
               onFocus={(e) => e.currentTarget.select()}
               onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))}
               onBlur={commit}
               onKeyDown={(e) => {
                 if (e.key === "Enter") { e.preventDefault(); commit(); setTimeout(() => btnRef.current?.focus(), 0); }
                 else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEdit(false); }
               }}
               className="h-10 w-14 rounded-md border bg-surface px-1 text-center text-[16px] text-text-primary" />
        <span className="text-text-secondary" aria-hidden>/ {numPages || "–"}</span>
      </div>
    );
  }
  return (
    <button ref={btnRef} type="button" onClick={() => { setV(String(page)); setEdit(true); }}
            aria-label={`Sayfa ${page} / ${numPages || "–"}. Sayfa numarası yazmak için dokun`} title="Sayfaya git"
            className="flex h-11 min-w-[64px] shrink-0 items-center justify-center rounded-lg px-2 text-sm tabular-nums text-text-primary hover:bg-surface-hover">
      {page} <span className="mx-1 text-text-secondary">/</span> {numPages || "–"}
    </button>
  );
}

/** "+N" rozeti (Panel düğmesi ve Notlarım sekmesi) */
export function FreshBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span className="draft-fresh">+{n}<span className="sr-only"> yeni not</span></span>;
}

/** Tablet / geniş ekran araç çubuğu (başlık satırının sağı): Sayfa · Kalem · Panel · ⋯ */
export default function ReaderToolbar(p: ToolbarProps) {
  const btn = "flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-hover";
  const active = "bg-accent-purple/10 text-accent-purple";
  const penOn = p.tool !== "none";
  const fresh = p.panelFresh || 0;
  return (
    <div className="reader-toolbar flex shrink-0 items-center gap-0.5 rounded-xl px-1 py-0.5" role="toolbar" aria-label="Okuyucu araçları">
      <PageChip page={p.page} numPages={p.numPages} setPage={p.setPage} />
      {p.penAvailable !== false && (
        <button type="button" className={`flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm hover:bg-surface-hover ${penOn ? active : ""}`}
                aria-pressed={penOn} aria-label="Kalem: vurgula, altını çiz, yaz"
                title="Kalem şeridini aç / kapat (H)" onClick={() => p.setTool(penOn ? "none" : "highlight")}>
          <Highlighter size={18} aria-hidden /><span className="hidden sm:inline">Kalem</span>
        </button>
      )}
      {p.focus ? (
        <button type="button" className={`${btn} ${active}`} aria-label="Odak modundan çık" aria-pressed title="Odak modundan çık (F / Esc)"
                onClick={() => p.setFocus(false)}><Minimize2 size={18} /></button>
      ) : (
        <button type="button" className={`relative flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm hover:bg-surface-hover ${p.rightOpen ? active : ""}`}
                aria-pressed={p.rightOpen}
                aria-label={`Panel: Notlarım, Özet, Sor${fresh > 0 ? ` · ${fresh} yeni not` : ""}`}
                title="Notlarım · Özet · Sor" onClick={() => p.setRightOpen(!p.rightOpen)}>
          <PanelRight size={18} aria-hidden /><span className="hidden sm:inline">Panel</span>
          {!p.rightOpen && <FreshBadge n={fresh} />}
        </button>
      )}
      <ReaderMoreMenu {...p} variant="wide" />
    </div>
  );
}

type Item = { key: string; label: string; icon: JSX.Element; onSelect: () => void; disabled?: boolean; checked?: boolean };

/** "⋯" menüsü: İçindekiler · görünüm · odak · ses · kısayollar; altında Sayfa, Yakınlaştırma ve Kağıt grupları. */
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

  const items: Item[] = [
    { key: "toc", label: "İçindekiler", icon: <ListTree size={17} />, onSelect: () => p.setTocOpen(true) },
  ];
  if (p.setViewMode) {
    const text = p.viewMode === "text";
    items.push({ key: "view", label: text ? "Sayfa görünümüne geç" : "Metin görünümü (yeniden akan yazı)",
                 icon: text ? <FileText size={17} /> : <AlignLeft size={17} />, checked: text,
                 onSelect: () => p.setViewMode?.(text ? "page" : "text") });
  }
  if (p.variant === "wide") {
    items.push({ key: "focus", label: p.focus ? "Odak modundan çık" : "Odak modu (paneller gizlenir)", icon: p.focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />,
                 checked: p.focus, onSelect: () => p.setFocus(!p.focus) });
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

  const sq = "flex h-11 w-11 items-center justify-center rounded-lg border hover:bg-surface-muted disabled:opacity-40";
  const pct = Math.round(p.scale * 100);
  return (
    <div ref={wrap} className="relative">
      <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Diğer okuyucu araçları"
              title="Diğer araçlar" onClick={() => setOpen((v) => !v)}
              className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-hover">
        <MoreHorizontal size={19} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-[calc(100dvh-80px)] w-72 overflow-y-auto rounded-xl border bg-surface p-1 text-text-primary shadow-xl">
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
        {/* Sayfa ve yakınlaştırma: seçince menü açık kalır (birkaç kez basılabilir) */}
        <div className="mt-1 flex items-center gap-2 border-t px-2 pt-2" role="group" aria-label="Sayfa">
          <span className="flex-1 text-xs font-medium">Sayfa</span>
          <button type="button" className={sq} aria-label="Önceki sayfa" title="Önceki sayfa (←)" disabled={p.page <= 1}
                  onClick={() => p.setPage(Math.max(1, p.page - 1))}><ChevronLeft size={18} /></button>
          <span className="min-w-[56px] text-center text-xs tabular-nums text-text-secondary">{p.page} / {p.numPages || "–"}</span>
          <button type="button" className={sq} aria-label="Sonraki sayfa" title="Sonraki sayfa (→)" disabled={p.page >= p.numPages}
                  onClick={() => p.setPage(Math.min(p.numPages, p.page + 1))}><ChevronRight size={18} /></button>
        </div>
        {p.viewMode !== "text" && (
          <div className="mt-1 flex items-center gap-2 px-2 pb-1 pt-1" role="group" aria-label="Yakınlaştırma">
            <span className="flex-1 text-xs font-medium">Yakınlaştırma</span>
            <button type="button" className={sq} aria-label="Uzaklaştır" title="Uzaklaştır (−)" onClick={() => p.setScale(zoomOut)}><Minus size={17} /></button>
            <button type="button" className="h-11 min-w-[56px] rounded-lg border px-1 text-xs tabular-nums hover:bg-surface-muted"
                    aria-label={`Yüzde ${pct}; sayfaya sığdır`} title="Sayfaya sığdır" onClick={() => p.setScale(() => 1)}>%{pct}</button>
            <button type="button" className={sq} aria-label="Yakınlaştır" title="Yakınlaştır (+)" onClick={() => p.setScale(zoomIn)}><Plus size={17} /></button>
          </div>
        )}
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

/** Telefon alt çubuğu: sayfa "12 / 80" · Kalem · Panel (+N). İçindekiler ve sayfa okları "⋯" menüsünde. */
export function ReaderBottomBar({ page, numPages, setPage, onRight, rightOpen, rightLabel = "Panel", rightIcon, rightFresh = 0, tool, setTool }: {
  page: number; numPages: number; setPage: (n: number) => void;
  onRight: () => void; rightOpen: boolean;
  rightLabel?: string; rightIcon?: JSX.Element; rightFresh?: number;
  tool?: Tool; setTool?: (t: Tool) => void;
}) {
  const penOn = !!tool && tool !== "none";
  // ikon ustte, metin altta
  const lab = "flex h-12 min-w-[64px] flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 text-xs hover:bg-surface-hover";
  return (
    <div className="reader-toolbar flex shrink-0 items-center justify-between gap-1 border-t px-1.5"
         style={{ paddingBottom: "env(safe-area-inset-bottom)" }} role="toolbar" aria-label="Okuyucu gezinme">
      <PageChip page={page} numPages={numPages} setPage={setPage} />
      {setTool && (
        <button type="button" className={`${lab} ${penOn ? "text-accent-purple" : ""}`} aria-pressed={penOn}
                aria-label="Kalem: vurgula, altını çiz, yaz" onClick={() => setTool(penOn ? "none" : "highlight")}>
          <Highlighter size={18} aria-hidden /><span>Kalem</span>
        </button>
      )}
      <button type="button" className={`${lab} relative ${rightOpen ? "text-accent-purple" : ""}`} onClick={onRight} aria-expanded={rightOpen} aria-haspopup="dialog"
              aria-label={`Panel: ${rightLabel}${rightFresh > 0 ? `, ${rightFresh} yeni not` : ""}`}>
        {rightIcon || <PanelRight size={18} aria-hidden />}<span className="max-w-[84px] truncate">{rightLabel}</span>
        {rightFresh > 0 && <span className="absolute -right-0.5 top-0.5"><FreshBadge n={rightFresh} /></span>}
      </button>
    </div>
  );
}
