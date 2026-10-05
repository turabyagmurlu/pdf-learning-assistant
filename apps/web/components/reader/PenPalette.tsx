"use client";
/**
 * Kalem şeridi (Ajan T6, iPad sadeleştirme) — eski sürüklenebilir kapsülün yerine sabit, ince şerit.
 *
 *  - iPad / geniş ekranda PDF'in SOL kenarında dikey şerit (PDF'in yanında durur, sayfanın üstünü kapatmaz);
 *    telefonda alt çubuğun hemen üstünde yatay şerit (yatay kaydırılabilir).
 *  - Araçlar (Kalem · Vurgu · Altını çiz · Kenar notu · Silgi) ve renkler aynı şeritte: araç değiştirmek tek dokunuş.
 *  - Küçülme / sürükleme yok. Şerit, üst çubuktaki "Kalem" düğmesiyle açılır ve kapanır (araç seçili olduğu sürece görünür).
 *  - Tüm hedefler 44 px. Kalem (el yazısı) kendi mürekkep renkleri ve 3 kalınlıkla; Vurgu / Altını çiz 5 renk ve 3 kademe.
 */
import { Highlighter, Underline, StickyNote, Eraser, X, Check, Undo2, PenLine } from "lucide-react";
import { INK_COLORS, INK_WIDTHS } from "@/lib/ink";
import { HIGHLIGHT_COLORS, OPACITY_STEPS, PenTool, PEN_TOOL_LABEL, darken, pigmentOf, pigmentName } from "@/lib/reader";

export interface PenPaletteProps {
  tool: PenTool; setTool: (t: PenTool) => void;
  color: string; setColor: (c: string) => void;
  opacity: number; setOpacity: (o: number) => void;
  /** Kalem (el yazısı) rengi ve kalınlığı */
  inkColor: string; setInkColor: (c: string) => void;
  inkWidth: number; setInkWidth: (w: number) => void;
  /** vertical: sol kenarda dikey (tablet / geniş ekran); horizontal: altta yatay (telefon) */
  orientation: "vertical" | "horizontal";
  onClose: () => void;
  onUndo?: () => void; canUndo?: boolean;
}

const TOOLS: { key: PenTool; Icon: typeof Highlighter; hint: string; kbd: string }[] = [
  { key: "ink", Icon: PenLine, hint: "Kalemle sayfaya yaz ya da çiz; parmakla sayfa kayar", kbd: "P" },
  { key: "highlight", Icon: Highlighter, hint: "Kalemle satırın üstünden geç, vurgulanır", kbd: "H" },
  { key: "underline", Icon: Underline, hint: "Kalemle satırın üstünden geç, altı çizilir", kbd: "U" },
  { key: "note", Icon: StickyNote, hint: "Sayfada bir yere dokun, not ekle (kalemle boş yere uzun basmak da olur)", kbd: "" },
  { key: "eraser", Icon: Eraser, hint: "Bir vurguya dokun, silinir (Ctrl+Z geri alır)", kbd: "E" },
];

export default function PenPalette(p: PenPaletteProps) {
  const vertical = p.orientation === "vertical";
  // seçili renk pigment olarak (eski kayıtlı hex'ler de yeni pigmentle görünür)
  const cur = pigmentOf(p.color);
  const ink = p.tool === "ink";
  const btn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition hover:bg-surface-hover";
  const on = "bg-accent-purple/15 text-accent-purple";
  const group = vertical ? "flex flex-col items-center gap-0.5" : "flex items-center gap-0.5";

  return (
    <div role="toolbar" aria-label="Kalem şeridi" aria-orientation={vertical ? "vertical" : "horizontal"}
         className={vertical
           ? "reader-toolbar flex w-[52px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-y-0 border-l-0 py-1.5"
           : "reader-toolbar flex shrink-0 items-center gap-0.5 overflow-x-auto border-x-0 border-b-0 px-1.5 py-0.5"}>
      {/* Araçlar */}
      <div className={group} role="group" aria-label="Araç">
        {TOOLS.map(({ key, Icon, hint, kbd }) => (
          <button key={key} type="button" aria-pressed={p.tool === key}
                  aria-label={`${PEN_TOOL_LABEL[key]}${kbd ? ` (${kbd})` : ""}`}
                  title={`${PEN_TOOL_LABEL[key]}${kbd ? ` (${kbd})` : ""}: ${hint}`}
                  onClick={() => p.setTool(key)}
                  className={`${btn} ${p.tool === key ? on : "text-text-secondary"}`}>
            <Icon size={20} aria-hidden />
          </button>
        ))}
      </div>
      <Sep vertical={vertical} />

      {ink ? (
        <>
          <div className={group} role="group" aria-label="Mürekkep rengi">
            {INK_COLORS.map((c, i) => {
              const sel = c.value === p.inkColor;
              return (
                <button key={c.key} type="button" aria-pressed={sel} aria-label={`${c.label} mürekkep (${i + 1})`}
                        title={`${c.label} (${i + 1})`} onClick={() => p.setInkColor(c.value)} className={btn}>
                  <span className={`flex items-center justify-center rounded-full border-2 transition ${sel ? "h-7 w-7 border-accent-purple" : "h-6 w-6 border-black/10"}`}
                        style={{ background: c.value }}>
                    {sel && <Check size={14} aria-hidden style={{ color: "#fff" }} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
          <Sep vertical={vertical} />
          <div className={group} role="group" aria-label="Kalem kalınlığı">
            {INK_WIDTHS.map((w) => {
              const sel = w.value === p.inkWidth;
              return (
                <button key={w.key} type="button" aria-pressed={sel} aria-label={`${w.label} uç`} title={`${w.label} uç`}
                        onClick={() => p.setInkWidth(w.value)} className={`${btn} ${sel ? on : ""}`}>
                  <span className="rounded-full" style={{ width: Math.round(w.value * 1.6) + 2, height: Math.round(w.value * 1.6) + 2, background: p.inkColor }} />
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className={group} role="group" aria-label="Renk">
            {HIGHLIGHT_COLORS.map((c, i) => {
              const hex = pigmentOf(c.value);
              const name = pigmentName(c.value);
              const sel = hex === cur;
              return (
                <button key={c.key} type="button" aria-pressed={sel} aria-label={`${name} (${i + 1})`}
                        title={`${name} (${i + 1})`}
                        onClick={() => { p.setColor(c.value); if (p.tool === "eraser" || p.tool === "note") p.setTool("highlight"); }}
                        className={btn}>
                  <span className={`flex items-center justify-center rounded-full border-2 transition ${sel ? "h-7 w-7 border-accent-purple" : "h-6 w-6 border-black/10"}`}
                        style={{ background: hex }}>
                    {sel && <Check size={14} aria-hidden style={{ color: darken(hex) }} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
          <Sep vertical={vertical} />
          <div className={group} role="group" aria-label={p.tool === "underline" ? "Çizgi kalınlığı" : "Vurgu koyuluğu"}>
            {OPACITY_STEPS.map((s) => {
              const sel = s.value === p.opacity;
              return (
                <button key={s.key} type="button" aria-pressed={sel} aria-label={s.label} title={s.label}
                        onClick={() => p.setOpacity(s.value)} disabled={p.tool === "eraser" || p.tool === "note"}
                        className={`${btn} ${sel ? on : ""} disabled:opacity-40`}>
                  {p.tool === "underline"
                    ? <span className="w-5 rounded-sm" style={{ height: s.underlinePx, background: darken(cur) }} />
                    : <span className="h-3 w-5 rounded-sm" style={{ background: cur, opacity: s.value }} />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {p.onUndo && (
        <>
          <Sep vertical={vertical} />
          <button type="button" className={`${btn} disabled:opacity-40`} aria-label="Geri al (Ctrl+Z)" title="Geri al (Ctrl+Z)"
                  disabled={!p.canUndo} onClick={p.onUndo}>
            <Undo2 size={18} aria-hidden />
          </button>
        </>
      )}
      <button type="button" className={`${btn} text-text-secondary ${vertical ? "mt-auto" : "ml-auto"}`}
              aria-label="Kalem şeridini kapat" title="Kapat (kalemi bırak)" onClick={p.onClose}>
        <X size={19} aria-hidden />
      </button>
    </div>
  );
}

function Sep({ vertical }: { vertical: boolean }) {
  return vertical
    ? <span aria-hidden className="my-0.5 h-px w-7 shrink-0" style={{ background: "var(--r-border)" }} />
    : <span aria-hidden className="mx-0.5 h-6 w-px shrink-0" style={{ background: "var(--r-border)" }} />;
}
