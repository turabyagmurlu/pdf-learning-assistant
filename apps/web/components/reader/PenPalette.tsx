"use client";
/**
 * Kalem paleti (Apple Pencil "araç paleti" tarzı) — Ajan P.
 * Vurgu aracına dokununca açılır: sürüklenebilir koyu kapsül; araçlar (Vurgu · Altını çiz · Kenar notu · Silgi),
 * 5 renk, 3 kademe kalınlık/opaklık, geri al, kapat. Konum ve kademe cihazda saklanır (lib/reader loadPenPrefs).
 * Esc ya da dışına dokununca küçülür: yalnız seçili renk/araç yongası kalır, dokununca yeniden açılır.
 * Tüm hedefler 44 px. Kalem/lasso yok: araçlar metin tabanlıdır (seçim → vurgu).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Highlighter, Underline, StickyNote, Eraser, X, GripVertical, Check, Undo2 } from "lucide-react";
import { HIGHLIGHT_COLORS, OPACITY_STEPS, PenTool, PEN_TOOL_LABEL, darken } from "@/lib/reader";

export interface PenPaletteProps {
  tool: PenTool; setTool: (t: PenTool) => void;
  color: string; setColor: (c: string) => void;
  opacity: number; setOpacity: (o: number) => void;
  collapsed: boolean; setCollapsed: (b: boolean) => void;
  pos: { x: number; y: number } | null; setPos: (p: { x: number; y: number } | null) => void;
  /** Varsayılan yer: masaüstünde araç çubuğunun altı (top), tablette/telefonda ekranın altı (bottom) */
  dock: "top" | "bottom";
  onClose: () => void;
  onUndo?: () => void; canUndo?: boolean;
}

const TOOLS: { key: PenTool; Icon: typeof Highlighter; hint: string; kbd: string }[] = [
  { key: "highlight", Icon: Highlighter, hint: "Metni seç, bırakınca vurgulanır", kbd: "H" },
  { key: "underline", Icon: Underline, hint: "Metni seç, bırakınca altı çizilir", kbd: "U" },
  { key: "note", Icon: StickyNote, hint: "Sayfada bir yere dokun, not ekle", kbd: "" },
  { key: "eraser", Icon: Eraser, hint: "Bir vurguya dokun, silinir (Ctrl+Z geri alır)", kbd: "E" },
];

export default function PenPalette(p: PenPaletteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [, force] = useState(0);
  const CurIcon = (TOOLS.find((t) => t.key === p.tool) || TOOLS[0]).Icon;

  // Konumu kaba sınırla (kap küçülünce palet dışarıda kalmasın)
  const clamp = (x: number, y: number) => {
    const el = ref.current; const parent = el?.parentElement;
    if (!el || !parent) return { x, y };
    const maxX = Math.max(0, parent.clientWidth - el.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - el.offsetHeight);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  };
  useLayoutEffect(() => {
    if (!p.pos) return;
    const c = clamp(p.pos.x, p.pos.y);
    if (c.x !== p.pos.x || c.y !== p.pos.y) p.setPos(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pos, p.collapsed]);
  useEffect(() => {
    const onResize = () => force((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Esc ya da dışına dokununca küçül (araç açık kalır)
  useEffect(() => {
    if (p.collapsed) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) p.setCollapsed(true); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[role="dialog"], [role="menu"]')) return;
      p.setCollapsed(true);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.collapsed]);

  // Sürükleme (tutamaç ya da küçük yonga): fare, parmak ve kalem aynı yoldan
  const onDragStart = (e: React.PointerEvent) => {
    const el = ref.current; const parent = el?.parentElement;
    if (!el || !parent) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const pr = parent.getBoundingClientRect(); const r = el.getBoundingClientRect();
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left - pr.left, oy: r.top - pr.top, moved: false };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    p.setPos(clamp(d.ox + dx, d.oy + dy));
  };
  const onDragEnd = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    return d.moved;
  };

  const style: React.CSSProperties = p.pos
    ? { left: p.pos.x, top: p.pos.y }
    : p.dock === "top"
      ? { left: "50%", top: 12, transform: "translateX(-50%)" }
      : { left: "50%", bottom: "calc(12px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)" };
  const capsule = "absolute z-40 select-none rounded-full border border-white/10 text-white shadow-2xl backdrop-blur";
  const bg = { background: "rgba(31,29,26,0.92)" };
  const btn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10 focus-visible:outline-white";
  const on = "bg-white/20";

  // Küçültülmüş: yalnız seçili renk + araç yongası (48 px)
  if (p.collapsed) {
    return (
      <div ref={ref} className={`${capsule} touch-none`} style={{ ...style, ...bg }}>
        <button type="button" className="flex h-12 w-12 items-center justify-center rounded-full"
                aria-label={`Kalem paleti (küçük): ${PEN_TOOL_LABEL[p.tool]}. Açmak için dokun`}
                title="Kalem paletini aç"
                onPointerDown={onDragStart} onPointerMove={onDragMove}
                onPointerUp={(e) => { const moved = onDragEnd(e); if (!moved) p.setCollapsed(false); }}
                onPointerCancel={onDragEnd}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.setCollapsed(false); } }}>
          <span className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white/80"
                style={{ background: p.tool === "eraser" ? "transparent" : p.color }}>
            <CurIcon size={15} aria-hidden style={{ color: p.tool === "eraser" ? "#fff" : darken(p.color) }} />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} role="toolbar" aria-label="Kalem paleti" aria-orientation="horizontal"
         className={`${capsule} flex max-w-[calc(100%-16px)] flex-wrap items-center justify-center gap-0.5 px-1.5 py-1`}
         style={{ ...style, ...bg }}>
      <button type="button" className={`${btn} cursor-grab touch-none active:cursor-grabbing`} aria-label="Paleti sürükle"
              title="Sürükleyerek taşı"
              onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
              onKeyDown={(e) => {
                const d = e.key === "ArrowLeft" ? [-24, 0] : e.key === "ArrowRight" ? [24, 0] : e.key === "ArrowUp" ? [0, -24] : e.key === "ArrowDown" ? [0, 24] : null;
                if (!d) return;
                e.preventDefault();
                const el = ref.current; const parent = el?.parentElement;
                if (!el || !parent) return;
                const pr = parent.getBoundingClientRect(); const r = el.getBoundingClientRect();
                p.setPos(clamp(r.left - pr.left + d[0], r.top - pr.top + d[1]));
              }}>
        <GripVertical size={18} aria-hidden className="opacity-70" />
      </button>

      {/* Araçlar */}
      <div className="flex items-center gap-0.5" role="group" aria-label="Araç">
        {TOOLS.map(({ key, Icon, hint, kbd }) => (
          <button key={key} type="button" aria-pressed={p.tool === key}
                  aria-label={`${PEN_TOOL_LABEL[key]}${kbd ? ` (${kbd})` : ""}`}
                  title={`${PEN_TOOL_LABEL[key]}${kbd ? ` (${kbd})` : ""}: ${hint}`}
                  onClick={() => p.setTool(key)}
                  className={`${btn} ${p.tool === key ? on : ""}`}>
            <Icon size={19} aria-hidden />
          </button>
        ))}
      </div>
      <Sep />

      {/* Renkler (1-5) */}
      <div className="flex items-center gap-0.5" role="group" aria-label="Renk">
        {HIGHLIGHT_COLORS.map((c, i) => {
          const sel = c.value === p.color;
          return (
            <button key={c.key} type="button" aria-pressed={sel} aria-label={`${c.label} (${i + 1})`}
                    title={`${c.label} (${i + 1})`} onClick={() => { p.setColor(c.value); if (p.tool === "eraser" || p.tool === "note") p.setTool("highlight"); }}
                    className={btn} disabled={p.tool === "eraser"}>
              <span className={`flex items-center justify-center rounded-full border-2 transition ${sel ? "h-8 w-8 border-white" : "h-6 w-6 border-white/30"} ${p.tool === "eraser" ? "opacity-40" : ""}`}
                    style={{ background: c.value }}>
                {sel && <Check size={15} aria-hidden style={{ color: darken(c.value) }} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      <Sep />

      {/* Kalınlık / opaklık: 3 kademe */}
      <div className="flex items-center gap-0.5" role="group" aria-label={p.tool === "underline" ? "Çizgi kalınlığı" : "Vurgu koyuluğu"}>
        {OPACITY_STEPS.map((s) => {
          const sel = s.value === p.opacity;
          return (
            <button key={s.key} type="button" aria-pressed={sel} aria-label={s.label} title={s.label}
                    onClick={() => p.setOpacity(s.value)} disabled={p.tool === "eraser" || p.tool === "note"}
                    className={`${btn} ${sel ? on : ""} disabled:opacity-40`}>
              <span className="flex h-6 w-6 items-end justify-center rounded bg-white/90 pb-[3px]">
                {p.tool === "underline"
                  ? <span className="w-4 rounded-sm" style={{ height: s.underlinePx, background: darken(p.color) }} />
                  : <span className="h-3 w-4 rounded-sm" style={{ background: p.color, opacity: s.value }} />}
              </span>
            </button>
          );
        })}
      </div>

      {p.onUndo && (
        <>
          <Sep />
          <button type="button" className={`${btn} disabled:opacity-40`} aria-label="Geri al (Ctrl+Z)" title="Geri al (Ctrl+Z)"
                  disabled={!p.canUndo} onClick={p.onUndo}>
            <Undo2 size={18} aria-hidden />
          </button>
        </>
      )}
      <Sep />
      <button type="button" className={btn} aria-label="Paleti kapat (aracı bırak)" title="Kapat — Esc yalnız küçültür"
              onClick={p.onClose}>
        <X size={19} aria-hidden />
      </button>
    </div>
  );
}

function Sep() { return <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-white/15" />; }
