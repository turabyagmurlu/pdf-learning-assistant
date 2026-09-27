"use client";
/**
 * El yazısı notunun küçük önizlemesi (Vurgular paneli, not penceresi, taslak ve Atölye kartları).
 * Darbeler kutuya ölçeklenir; koyu temada da okunsun diye açık kâğıt zemin üzerinde çizilir.
 */
import { useMemo } from "react";
import { strokePath, inkBox, type InkStroke } from "@/lib/ink";

export default function InkPreview({ strokes, box, label, className, maxHeight = 120 }: {
  strokes: InkStroke[];
  box?: [number, number, number, number] | null;
  /** Ekran okuyucu metni ("El yazısı notu · s. 4") */
  label?: string;
  className?: string;
  maxHeight?: number;
}) {
  const view = useMemo(() => {
    const b = box && box[2] > 0 && box[3] > 0 ? box : inkBox(strokes);
    const pad = 0.01;
    const x = (b[0] - pad) * 1000, y = (b[1] - pad) * 1000;
    const w = Math.max(20, (b[2] + 2 * pad) * 1000), h = Math.max(20, (b[3] + 2 * pad) * 1000);
    return { vb: `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`, aspect: w / h };
  }, [strokes, box]);
  const paths = useMemo(() => strokes.map((s) => ({ c: s.c, d: strokePath(s.p, s.w) })), [strokes]);
  if (!strokes.length) return null;
  return (
    <span className={`block overflow-hidden rounded-lg border ${className || ""}`}
          style={{ background: "#FFFDF8", borderColor: "rgba(27,34,51,0.12)" }}>
      <svg viewBox={view.vb} role="img" aria-label={label || "El yazısı notu"}
           style={{ display: "block", width: "100%", height: "auto", maxHeight, aspectRatio: String(view.aspect) }}
           preserveAspectRatio="xMidYMid meet">
        {paths.map((p, i) => <path key={i} d={p.d} fill={p.c} />)}
      </svg>
    </span>
  );
}
