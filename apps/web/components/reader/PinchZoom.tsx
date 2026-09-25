"use client";
/**
 * Dokunmatik yakinlastirma sarmalayicisi (T-4). PdfReader'in DISINA sarilir:
 *
 *   <PinchZoom scale={scale} onScaleChange={(s) => setScale(() => s)} disabled={tool === "note"}>
 *     <PdfReader ... scale={scale} />
 *   </PinchZoom>
 *
 * - Iki parmak: hareket boyunca yalniz CSS transform ile onizleme (bulanik ama akici);
 *   parmaklar kalkinca onScaleChange(yeni olcek) -> PdfReader keskin yeniden cizer.
 *   Ust/alt cubuklar buyumez (tarayici yakinlastirmasi degil).
 * - Cift dokunus (300 ms, 24 px icinde): 1 <-> 1.75. Metin secimi varsa ya da
 *   `disabled` ise devreye girmez (kenar notu araci gibi).
 * - Olcek > 1 iken altta "Sigdir" cipi; basinca 1'e doner.
 * - Tek parmak kaydirma ve uzun basma secimi tarayiciya birakilir (touch-action: pan-x pan-y).
 * - Fare/kalem olaylarina dokunmaz; masaustu davranisi degismez.
 */
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Minimize2 } from "lucide-react";

export interface PinchZoomProps {
  scale: number;
  onScaleChange: (s: number) => void;
  children: ReactNode;
  /** "Sigdir" cipinin metni */
  fitLabel?: string;
  min?: number;
  max?: number;
  /** Hareketleri kapat (or. kenar notu araci acikken) */
  disabled?: boolean;
  /** Cift dokunusta gidilecek olcek */
  doubleTapScale?: number;
  className?: string;
}

const DT_MS = 300;      // cift dokunus araligi
const DT_PX = 24;       // cift dokunus mesafesi

type Pt = { x: number; y: number };

export default function PinchZoom({
  scale, onScaleChange, children, fitLabel = "Sığdır", min = 0.5, max = 3, disabled, doubleTapScale = 1.75, className,
}: PinchZoomProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, Pt>>(new Map());
  const start = useRef<{ dist: number; mid: Pt; scale: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);   // hareket sirasinda gecici oran
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const clamp = useCallback((s: number) => Math.min(max, Math.max(min, +s.toFixed(2))), [min, max]);

  // onizlemeyi temizle (olcek disaridan degisince ya da bilesen kalkinca)
  const clearPreview = useCallback(() => {
    const el = innerRef.current;
    if (el) { el.style.transform = ""; el.style.transformOrigin = ""; el.style.willChange = ""; }
    setPreview(null);
  }, []);
  useEffect(() => () => clearPreview(), [clearPreview]);

  // Iki parmak dokununca tarayicinin kaydirmayi devralmasini (pointercancel) engelle:
  // pasif olmayan touch dinleyicileri yalniz 2+ parmakta preventDefault yapar,
  // tek parmak kaydirma ve uzun basma secimi dokunulmadan kalir.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const guard = (e: TouchEvent) => { if (!disabled && e.touches.length >= 2 && e.cancelable) e.preventDefault(); };
    el.addEventListener("touchstart", guard, { passive: false });
    el.addEventListener("touchmove", guard, { passive: false });
    return () => { el.removeEventListener("touchstart", guard); el.removeEventListener("touchmove", guard); };
  }, [disabled]);

  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType !== "touch" || disabled) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const wrap = wrapRef.current;
      const r = wrap?.getBoundingClientRect();
      const m = mid(a, b);
      start.current = { dist: Math.max(1, dist(a, b)), mid: { x: m.x - (r?.left ?? 0), y: m.y - (r?.top ?? 0) }, scale: scaleRef.current };
      lastTap.current = null;                       // iki parmak: cift dokunus sayilmaz
      const el = innerRef.current;
      if (el) {
        el.style.transformOrigin = `${start.current.mid.x}px ${start.current.mid.y}px`;
        el.style.willChange = "transform";
      }
      // secim varsa kaldir; iki parmak hareketi secimle karismasin
      try { window.getSelection()?.removeAllRanges(); } catch { /* yok say */ }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (e.pointerType !== "touch" || disabled) return;
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = start.current;
    if (!st || pointers.current.size < 2) return;
    const [a, b] = Array.from(pointers.current.values());
    const ratio = dist(a, b) / st.dist;
    const target = clamp(st.scale * ratio);
    const visual = target / st.scale;               // ekrandaki gecici buyutme orani
    const el = innerRef.current;
    if (el) el.style.transform = `scale(${visual})`;
    setPreview(target);
    e.preventDefault();
  }

  function endPointer(e: React.PointerEvent) {
    if (e.pointerType !== "touch") return;
    const had = pointers.current.has(e.pointerId);
    pointers.current.delete(e.pointerId);
    const st = start.current;
    if (st) {
      if (pointers.current.size < 2) {
        // pinch bitti: keskin yeniden cizim icin gercek olcegi bildir
        const target = preview;
        start.current = null;
        clearPreview();
        pointers.current.clear();
        if (target !== null && Math.abs(target - st.scale) >= 0.02) onScaleChange(target);
      }
      return;
    }
    if (!had || disabled || e.type !== "pointerup") return;
    // cift dokunus (tek parmak, hizli, yakin)
    const now = Date.now();
    const lt = lastTap.current;
    if (lt && now - lt.t <= DT_MS && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) <= DT_PX) {
      lastTap.current = null;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;   // metin secimi cift dokunusa oncelikli
      const cur = scaleRef.current;
      const next = Math.abs(cur - 1) < 0.05 ? clamp(doubleTapScale) : 1;
      onScaleChange(next);
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
  }

  const zoomed = scale > 1.01;
  const pct = Math.round((preview ?? scale) * 100);

  return (
    <div ref={wrapRef} className={"relative h-full w-full overflow-hidden " + (className || "")}
         onPointerDown={onPointerDown} onPointerMove={onPointerMove}
         onPointerUp={endPointer} onPointerCancel={endPointer}
         style={{ touchAction: disabled ? undefined : "pan-x pan-y" }}>
      <div ref={innerRef} className="h-full w-full">
        {children}
      </div>

      {preview !== null && (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-sm font-medium text-white">
          %{pct}
        </div>
      )}

      {zoomed && preview === null && (
        <button type="button" onClick={() => onScaleChange(1)}
                aria-label={`${fitLabel}: yakınlaştırmayı sıfırla (şu an %${pct})`}
                className="absolute bottom-3 left-1/2 z-40 flex min-h-[40px] -translate-x-1/2 items-center gap-1.5 rounded-full border bg-surface/95 px-3.5 text-sm font-medium text-text-primary shadow-lg backdrop-blur">
          <Minimize2 size={15} aria-hidden /> {fitLabel} <span className="text-xs text-text-secondary">%{pct}</span>
        </button>
      )}
    </div>
  );
}
