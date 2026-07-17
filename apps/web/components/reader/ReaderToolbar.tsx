"use client";
import {
  ChevronLeft, ChevronRight, Minus, Plus, Highlighter, StickyNote,
  BookOpen, FileText, Maximize2, Minimize2, Sun, Contrast, Moon, PanelLeft, PanelRight, Download,
} from "lucide-react";

type Theme = "light" | "sepia" | "dark";
interface Props {
  page: number; numPages: number; setPage: (n: number) => void;
  scale: number; setScale: (f: (s: number) => number) => void;
  spread: boolean; setSpread: (b: boolean) => void;
  tool: "none" | "highlight" | "note"; setTool: (t: "none" | "highlight" | "note") => void;
  theme: Theme; setTheme: (t: Theme) => void;
  focus: boolean; setFocus: (b: boolean) => void;
  leftOpen: boolean; setLeftOpen: (b: boolean) => void;
  rightOpen: boolean; setRightOpen: (b: boolean) => void;
  onExport: () => void;
}

export default function ReaderToolbar(p: Props) {
  const btn = "flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 disabled:opacity-40";
  const active = "bg-[#6D5DF6]/12 text-[#6D5DF6]";
  return (
    <div className="reader-toolbar pointer-events-auto flex items-center gap-1 rounded-2xl px-2 py-1.5 shadow-md">
      {!p.focus && (
        <>
          <button className={btn} aria-label="Sol paneli aç/kapat" title="Sol panel"
                  onClick={() => p.setLeftOpen(!p.leftOpen)}><PanelLeft size={16} /></button>
          <Sep />
        </>
      )}
      <button className={btn} aria-label="Önceki sayfa" title="Önceki" disabled={p.page <= 1}
              onClick={() => p.setPage(Math.max(1, p.page - 1))}><ChevronLeft size={16} /></button>
      <div className="flex items-center gap-1 px-1 text-xs">
        <input aria-label="Sayfa numarası" value={p.page}
               onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) p.setPage(Math.min(Math.max(1, v), p.numPages || 1)); }}
               className="w-8 rounded-md border border-black/10 bg-white/60 px-1 py-0.5 text-center" />
        <span style={{ color: "var(--r-ink-2)" }}>/ {p.numPages || "–"}</span>
      </div>
      <button className={btn} aria-label="Sonraki sayfa" title="Sonraki" disabled={p.page >= p.numPages}
              onClick={() => p.setPage(Math.min(p.numPages, p.page + 1))}><ChevronRight size={16} /></button>
      <Sep />
      <button className={btn} aria-label="Uzaklaştır" title="Uzaklaştır" onClick={() => p.setScale((s) => Math.max(0.6, +(s - 0.1).toFixed(2)))}><Minus size={16} /></button>
      <button className="min-w-[46px] rounded-lg px-1 text-xs hover:bg-black/5" aria-label="Zoom sıfırla"
              onClick={() => p.setScale(() => 1)}>{Math.round(p.scale * 100)}%</button>
      <button className={btn} aria-label="Yakınlaştır" title="Yakınlaştır" onClick={() => p.setScale((s) => Math.min(2.2, +(s + 0.1).toFixed(2)))}><Plus size={16} /></button>
      <Sep />
      <button className={`${btn} ${p.spread ? active : ""}`} aria-label="Tek/çift sayfa" title={p.spread ? "Tek sayfa" : "Çift sayfa"}
              onClick={() => p.setSpread(!p.spread)}>{p.spread ? <FileText size={16} /> : <BookOpen size={16} />}</button>
      <Sep />
      <button className={`${btn} ${p.tool === "highlight" ? active : ""}`} aria-label="Highlight aracı" title="Highlight"
              onClick={() => p.setTool(p.tool === "highlight" ? "none" : "highlight")}><Highlighter size={16} /></button>
      <button className={`${btn} ${p.tool === "note" ? active : ""}`} aria-label="Not aracı" title="Kenar notu"
              onClick={() => p.setTool(p.tool === "note" ? "none" : "note")}><StickyNote size={16} /></button>
      <Sep />
      <ThemeSwitch theme={p.theme} setTheme={p.setTheme} btn={btn} active={active} />
      <button className={btn} aria-label="Notları dışa aktar" title="Markdown dışa aktar" onClick={p.onExport}><Download size={16} /></button>
      <button className={`${btn} ${p.focus ? active : ""}`} aria-label="Odak modu" title="Odak modu"
              onClick={() => p.setFocus(!p.focus)}>{p.focus ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      {!p.focus && (
        <>
          <Sep />
          <button className={btn} aria-label="Sağ paneli aç/kapat" title="Sağ panel"
                  onClick={() => p.setRightOpen(!p.rightOpen)}><PanelRight size={16} /></button>
        </>
      )}
    </div>
  );
}

function ThemeSwitch({ theme, setTheme, btn, active }: { theme: Theme; setTheme: (t: Theme) => void; btn: string; active: string }) {
  const order: Theme[] = ["light", "sepia", "dark"];
  const icon = theme === "light" ? <Sun size={16} /> : theme === "sepia" ? <Contrast size={16} /> : <Moon size={16} />;
  return (
    <button className={`${btn} ${theme !== "light" ? active : ""}`} aria-label="Tema değiştir"
            title={`Tema: ${theme}`} onClick={() => setTheme(order[(order.indexOf(theme) + 1) % 3])}>{icon}</button>
  );
}
function Sep() { return <div className="mx-0.5 h-5 w-px" style={{ background: "var(--r-border)" }} />; }
