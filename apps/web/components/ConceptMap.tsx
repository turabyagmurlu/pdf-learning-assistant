"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ZoomIn, ZoomOut, Maximize2, ExternalLink } from "lucide-react";

export type CMNode = { id: string; kind: string; definition: string; mentions: { document_id: string; title: string; pages: number[] }[] };
export type CMEdge = { source: string; target: string; label: string; sentence: string; page: number | null; document_id: string; document_title: string };

const KIND_COLOR: Record<string, string> = {
  kisi: "#8b7cf0", yer: "#3fa96a", olay: "#e5735b", antlasma: "#e0a233", kurum: "#38a3d1", kavram: "#8a8f9c",
};
const KIND_LABEL: Record<string, string> = { kisi: "Kişi", yer: "Yer", olay: "Olay", antlasma: "Antlaşma", kurum: "Kurum", kavram: "Kavram" };

type P = { x: number; y: number; vx: number; vy: number; fixed?: boolean };
const cx = (...a: any[]) => a.filter(Boolean).join(" ");

/** Kutuphanesiz kuvvet-yerlesimli kavram haritasi (SVG). */
export default function ConceptMap({ nodes, edges, height = 560 }: { nodes: CMNode[]; edges: CMEdge[]; height?: number }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: height });
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<{ type: "node"; id: string } | { type: "edge"; i: number } | null>(null);
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const posRef = useRef<Record<string, P>>({});
  const [, force] = useState(0);
  const dragRef = useRef<{ id?: string; pan?: { x: number; y: number; zx: number; zy: number } } | null>(null);

  const degree = useMemo(() => {
    const d: Record<string, number> = {};
    for (const e of edges) { d[e.source] = (d[e.source] || 0) + 1; d[e.target] = (d[e.target] || 0) + 1; }
    return d;
  }, [edges]);

  const visNodes = useMemo(() => nodes.filter((n) => kinds.size === 0 || kinds.has(n.kind)), [nodes, kinds]);
  const visIds = useMemo(() => new Set(visNodes.map((n) => n.id)), [visNodes]);
  const visEdges = useMemo(() => edges.filter((e) => visIds.has(e.source) && visIds.has(e.target)), [edges, visIds]);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: height }));
    ro.observe(el); setSize({ w: el.clientWidth, h: height });
    return () => ro.disconnect();
  }, [height]);

  // baslangic konumlari (daire)
  useEffect(() => {
    const pos = posRef.current;
    const n = nodes.length || 1;
    nodes.forEach((nd, i) => {
      if (!pos[nd.id]) {
        const a = (i / n) * Math.PI * 2, r = Math.min(size.w, size.h) * 0.35;
        pos[nd.id] = { x: size.w / 2 + Math.cos(a) * r, y: size.h / 2 + Math.sin(a) * r, vx: 0, vy: 0 };
      }
    });
  }, [nodes, size.w, size.h]);

  // kuvvet simulasyonu
  useEffect(() => {
    let raf = 0, tick = 0;
    const pos = posRef.current;
    const ids = visNodes.map((n) => n.id);
    const adj = visEdges.map((e) => [e.source, e.target] as const);
    const step = () => {
      tick++;
      const alpha = Math.max(0.02, 0.35 * Math.pow(0.985, tick));
      // itme
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]]; if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy || 0.01;
        const f = (2600 / d2) * alpha; const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        if (!a.fixed) { a.vx -= dx * f; a.vy -= dy * f; }
        if (!b.fixed) { b.vx += dx * f; b.vy += dy * f; }
      }
      // cekme (kenar)
      for (const [s, t] of adj) {
        const a = pos[s], b = pos[t]; if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const want = 120; const f = ((d - want) / d) * 0.05 * alpha * 4;
        if (!a.fixed) { a.vx += dx * f; a.vy += dy * f; }
        if (!b.fixed) { b.vx -= dx * f; b.vy -= dy * f; }
      }
      // merkeze cekim + sonum
      for (const id of ids) {
        const p = pos[id]; if (!p || p.fixed) continue;
        p.vx += (size.w / 2 - p.x) * 0.002 * alpha * 4; p.vy += (size.h / 2 - p.y) * 0.002 * alpha * 4;
        p.vx *= 0.82; p.vy *= 0.82; p.x += p.vx; p.y += p.vy;
        p.x = Math.max(30, Math.min(size.w - 30, p.x)); p.y = Math.max(30, Math.min(size.h - 30, p.y));
      }
      force((v) => v + 1);
      if (tick < 300) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [visNodes, visEdges, size.w, size.h]);

  function toLocal(e: React.PointerEvent) {
    const r = (wrapRef.current as HTMLDivElement).getBoundingClientRect();
    return { x: (e.clientX - r.left - zoom.x) / zoom.k, y: (e.clientY - r.top - zoom.y) / zoom.k };
  }
  function onDownNode(id: string, e: React.PointerEvent) {
    e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id }; const p = posRef.current[id]; if (p) p.fixed = true;
  }
  function onDownBg(e: React.PointerEvent) {
    dragRef.current = { pan: { x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y } };
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current; if (!d) return;
    if (d.id) { const p = posRef.current[d.id]; const l = toLocal(e); if (p) { p.x = l.x; p.y = l.y; force((v) => v + 1); } }
    else if (d.pan) setZoom((z) => ({ ...z, x: d.pan!.zx + (e.clientX - d.pan!.x), y: d.pan!.zy + (e.clientY - d.pan!.y) }));
  }
  function onUp() {
    const d = dragRef.current;
    if (d?.id) { const p = posRef.current[d.id]; if (p) setTimeout(() => { p.fixed = false; }, 400); }
    dragRef.current = null;
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const r = (wrapRef.current as HTMLDivElement).getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k2 = Math.max(0.4, Math.min(3, zoom.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    setZoom({ k: k2, x: mx - (mx - zoom.x) * (k2 / zoom.k), y: my - (my - zoom.y) * (k2 / zoom.k) });
  }

  const selNode = sel?.type === "node" ? nodes.find((n) => n.id === sel.id) : null;
  const selEdge = sel?.type === "edge" ? edges[sel.i] : null;
  const neighbors = useMemo(() => {
    if (!selNode) return null;
    const s = new Set<string>([selNode.id]);
    for (const e of edges) { if (e.source === selNode.id) s.add(e.target); if (e.target === selNode.id) s.add(e.source); }
    return s;
  }, [selNode, edges]);

  const kindsPresent = Array.from(new Set(nodes.map((n) => n.kind)));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {kindsPresent.map((k) => {
          const on = kinds.size === 0 || kinds.has(k);
          return (
            <button key={k} onClick={() => setKinds((s) => { const n = new Set(s); if (n.size === 0) { kindsPresent.forEach((x) => n.add(x)); } n.has(k) ? n.delete(k) : n.add(k); if (n.size === kindsPresent.length) n.clear(); return n; })}
                    className={cx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", on ? "bg-surface" : "bg-surface opacity-40")}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR[k] || KIND_COLOR.kavram }} />
              {KIND_LABEL[k] || k} <span className="opacity-60">{nodes.filter((n) => n.kind === k).length}</span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom((z) => ({ ...z, k: Math.min(3, z.k * 1.2) }))} aria-label="Yakınlaştır" className="rounded-md border p-1.5 text-text-secondary hover:bg-surface-muted"><ZoomIn size={15} /></button>
          <button onClick={() => setZoom((z) => ({ ...z, k: Math.max(0.4, z.k / 1.2) }))} aria-label="Uzaklaştır" className="rounded-md border p-1.5 text-text-secondary hover:bg-surface-muted"><ZoomOut size={15} /></button>
          <button onClick={() => setZoom({ k: 1, x: 0, y: 0 })} aria-label="Sıfırla" className="rounded-md border p-1.5 text-text-secondary hover:bg-surface-muted"><Maximize2 size={15} /></button>
        </div>
      </div>

      <div ref={wrapRef} className="relative mt-3 overflow-hidden rounded-2xl border bg-surface" style={{ height, touchAction: "none" }}
           onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onWheel={onWheel}>
        <svg width={size.w} height={size.h} onPointerDown={(e) => { onDownBg(e); setSel(null); }} className="cursor-grab">
          <g transform={`translate(${zoom.x},${zoom.y}) scale(${zoom.k})`}>
            {visEdges.map((e, i) => {
              const a = posRef.current[e.source], b = posRef.current[e.target]; if (!a || !b) return null;
              const idx = edges.indexOf(e);
              const dim = neighbors ? !(neighbors.has(e.source) && neighbors.has(e.target) && (e.source === selNode!.id || e.target === selNode!.id)) : false;
              const on = sel?.type === "edge" && sel.i === idx;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return (
                <g key={i} onPointerDown={(ev) => { ev.stopPropagation(); setSel({ type: "edge", i: idx }); }} className="cursor-pointer">
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? "#8b7cf0" : "currentColor"} strokeOpacity={on ? 1 : dim ? 0.08 : 0.28} strokeWidth={on ? 2.5 : 1.2} className="text-text-secondary" />
                  {(on || zoom.k > 1.3) && !dim && (
                    <text x={mx} y={my - 4} textAnchor="middle" fontSize={10} fill="currentColor" className="text-text-secondary" style={{ pointerEvents: "none" }}>{e.label}</text>
                  )}
                </g>
              );
            })}
            {visNodes.map((n) => {
              const p = posRef.current[n.id]; if (!p) return null;
              const r = 7 + Math.min(10, (degree[n.id] || 0) * 1.6);
              const dim = neighbors ? !neighbors.has(n.id) : false;
              const on = sel?.type === "node" && sel.id === n.id;
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.18 : 1}
                   onPointerDown={(e) => { onDownNode(n.id, e); setSel({ type: "node", id: n.id }); }} className="cursor-pointer">
                  <circle r={r + (on ? 4 : 0)} fill={KIND_COLOR[n.kind] || KIND_COLOR.kavram} stroke={on ? "#fff" : "none"} strokeWidth={2} />
                  <text y={r + 12} textAnchor="middle" fontSize={11} fontWeight={on ? 600 : 400} fill="currentColor" className="text-text-primary" style={{ pointerEvents: "none", paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3 }}>
                    {n.id.length > 22 ? n.id.slice(0, 21) + "…" : n.id}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {(selNode || selEdge) && (
          <div className="absolute bottom-3 left-3 right-3 max-w-md rounded-xl border bg-surface/95 p-3 shadow-lg backdrop-blur md:left-auto">
            <button onClick={() => setSel(null)} aria-label="Kapat" className="absolute right-2 top-2 rounded-md p-1 text-text-secondary hover:bg-surface-muted"><X size={14} /></button>
            {selNode && (
              <>
                <div className="flex items-center gap-2 pr-6">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR[selNode.kind] || KIND_COLOR.kavram }} />
                  <h4 className="font-medium">{selNode.id}</h4>
                  <span className="text-[10px] uppercase tracking-wide text-text-secondary">{KIND_LABEL[selNode.kind] || selNode.kind}</span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{selNode.definition}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {selNode.mentions.map((m, j) => (m.pages.length ? m.pages.slice(0, 3) : [0]).map((pg, k) => (
                    <button key={j + "-" + k} onClick={() => router.push("/documents/" + m.document_id + (pg ? "?page=" + pg : ""))}
                            className="flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                      <ExternalLink size={10} /> {m.title}{pg ? " · s." + pg : ""}
                    </button>
                  )))}
                </div>
                <p className="mt-2 text-[11px] text-text-secondary">{degree[selNode.id] || 0} bağlantı · komşular vurgulandı</p>
              </>
            )}
            {selEdge && (
              <>
                <div className="pr-6 text-sm"><b>{selEdge.source}</b> <span className="text-accent-purple">{selEdge.label}</span> <b>{selEdge.target}</b></div>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{selEdge.sentence}</p>
                <button onClick={() => router.push("/documents/" + selEdge.document_id + (selEdge.page ? "?page=" + selEdge.page : ""))}
                        className="mt-2 flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                  <ExternalLink size={10} /> {selEdge.document_title}{selEdge.page ? " · s." + selEdge.page : ""}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-text-secondary">Sürükle: taşı · Tekerlek: yakınlaştır · Düğüm: madde · Çizgi: ilişki. Büyük düğüm = çok bağlantı.</p>
    </div>
  );
}
