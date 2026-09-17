"use client";
/**
 * Kavram haritasi — odak oncelikli.
 *
 * Eski hali 190 dugumu birden ciziyordu: okunmaz bir yumak. Artik:
 *  - Acilista sadece EN COK BAGLANTILI birkac madde (omurga) gorunur.
 *  - Bir maddeye tiklayinca ODAK: yalniz o madde ve komsulari kalir.
 *  - Arama kutusu, gizli maddelere de dogrudan gider.
 *  - Baglantisiz maddeler haritada gosterilmez (gurultu); listede durur.
 *  - Liste gorunumu: "en cok baglantili kavramlar" siralamasi.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ZoomIn, ZoomOut, Maximize2, ExternalLink, Search, Network, List, ArrowLeft } from "lucide-react";

export type CMNode = { id: string; kind: string; definition: string; mentions: { document_id: string; title: string; pages: number[] }[] };
export type CMEdge = { source: string; target: string; label: string; sentence: string; page: number | null; document_id: string; document_title: string };

const KIND_COLOR: Record<string, string> = {
  kisi: "#8b7cf0", yer: "#3fa96a", olay: "#e5735b", antlasma: "#e0a233", kurum: "#38a3d1", kavram: "#8a8f9c",
};
const KIND_LABEL: Record<string, string> = { kisi: "Kişi", yer: "Yer", olay: "Olay", antlasma: "Antlaşma", kurum: "Kurum", kavram: "Kavram" };
const STEPS = [12, 20, 35, 60];

type P = { x: number; y: number; vx: number; vy: number; fixed?: boolean };
const cx = (...a: any[]) => a.filter(Boolean).join(" ");
const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/[â]/g, "a").replace(/[î]/g, "i").replace(/[û]/g, "u");

export default function ConceptMap({ nodes, edges, height = 560 }: { nodes: CMNode[]; edges: CMEdge[]; height?: number }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: height });
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<{ type: "node"; id: string } | { type: "edge"; i: number } | null>(null);
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [limit, setLimit] = useState(STEPS[0]);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"net" | "list">("net");
  const posRef = useRef<Record<string, P>>({});
  const [, force] = useState(0);
  const dragRef = useRef<{ id?: string; pan?: { x: number; y: number; zx: number; zy: number } } | null>(null);

  const degree = useMemo(() => {
    const d: Record<string, number> = {};
    for (const e of edges) { d[e.source] = (d[e.source] || 0) + 1; d[e.target] = (d[e.target] || 0) + 1; }
    return d;
  }, [edges]);

  const nbrsOf = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const e of edges) {
      (m[e.source] ||= new Set()).add(e.target);
      (m[e.target] ||= new Set()).add(e.source);
    }
    return m;
  }, [edges]);

  const byKind = (n: CMNode) => kinds.size === 0 || kinds.has(n.kind);

  /** Haritada gosterilecek dugumler: odak varsa o + komsulari, yoksa en baglantili N. */
  const visNodes = useMemo(() => {
    if (focusId) {
      const keep = new Set<string>([focusId, ...Array.from(nbrsOf[focusId] || [])]);
      return nodes.filter((n) => keep.has(n.id));          // odakta tur filtresi uygulanmaz
    }
    const connected = nodes.filter((n) => (degree[n.id] || 0) > 0).filter(byKind);
    return [...connected].sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0)).slice(0, limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, degree, nbrsOf, focusId, limit, kinds]);

  const visIds = useMemo(() => new Set(visNodes.map((n) => n.id)), [visNodes]);
  const visEdges = useMemo(() => edges.filter((e) => visIds.has(e.source) && visIds.has(e.target)), [edges, visIds]);

  /** Liste gorunumu / arama sonuclari: tum maddeler, baglantiya gore sirali. */
  const listNodes = useMemo(() => {
    const t = norm(q.trim());
    return nodes
      .filter(byKind)
      .filter((n) => !t || norm(n.id).includes(t) || norm(n.definition || "").includes(t))
      .sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, degree, q, kinds]);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: height }));
    ro.observe(el); setSize({ w: el.clientWidth, h: height });
    return () => ro.disconnect();
  }, [height]);

  // Gorunen kume degisince yerlesimi bastan kur: odak ortada, komsular cemberde.
  const setKey = visNodes.map((n) => n.id).join("|");
  useEffect(() => {
    const pos = posRef.current;
    const list = visNodes;
    const r = Math.min(size.w, size.h) * 0.34;
    list.forEach((nd, i) => {
      if (focusId && nd.id === focusId) { pos[nd.id] = { x: size.w / 2, y: size.h / 2, vx: 0, vy: 0 }; return; }
      const k = focusId ? i : i;
      const a = (k / Math.max(1, list.length)) * Math.PI * 2;
      pos[nd.id] = { x: size.w / 2 + Math.cos(a) * r, y: size.h / 2 + Math.sin(a) * r, vx: 0, vy: 0 };
    });
    setZoom({ k: 1, x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKey, size.w, size.h]);

  // kuvvet simulasyonu
  useEffect(() => {
    let raf = 0, tick = 0;
    const pos = posRef.current;
    const ids = visNodes.map((n) => n.id);
    const adj = visEdges.map((e) => [e.source, e.target] as const);
    // Az dugum varsa daha genis yay, cok dugum varsa daha sikisik dur.
    const rep = ids.length <= 14 ? 12000 : ids.length <= 30 ? 9000 : 6500;
    const want = ids.length <= 14 ? 190 : ids.length <= 30 ? 160 : 130;
    const step = () => {
      tick++;
      const alpha = Math.max(0.02, 0.35 * Math.pow(0.985, tick));
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]]; if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy || 0.01;
        const f = (rep / d2) * alpha; const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        if (!a.fixed) { a.vx -= dx * f; a.vy -= dy * f; }
        if (!b.fixed) { b.vx += dx * f; b.vy += dy * f; }
      }
      for (const [s, t] of adj) {
        const a = pos[s], b = pos[t]; if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = ((d - want) / d) * 0.04 * alpha * 4;
        if (!a.fixed) { a.vx += dx * f; a.vy += dy * f; }
        if (!b.fixed) { b.vx -= dx * f; b.vy -= dy * f; }
      }
      for (const id of ids) {
        const p = pos[id]; if (!p || p.fixed) continue;
        p.vx += (size.w / 2 - p.x) * 0.0012 * alpha * 4; p.vy += (size.h / 2 - p.y) * 0.0012 * alpha * 4;
        p.vx *= 0.82; p.vy *= 0.82; p.x += p.vx; p.y += p.vy;
        p.x = Math.max(40, Math.min(size.w - 40, p.x)); p.y = Math.max(30, Math.min(size.h - 30, p.y));
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
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setZoom((z) => {
        const k2 = Math.max(0.4, Math.min(3, z.k * (e.deltaY < 0 ? 1.12 : 0.89)));
        return { k: k2, x: mx - (mx - z.x) * (k2 / z.k), y: my - (my - z.y) * (k2 / z.k) };
      });
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  function openFocus(id: string) { setFocusId(id); setSel({ type: "node", id }); setView("net"); setQ(""); }

  const selNode = sel?.type === "node" ? nodes.find((n) => n.id === sel.id) : null;
  const selEdge = sel?.type === "edge" ? edges[sel.i] : null;
  const kindsPresent = Array.from(new Set(nodes.map((n) => n.kind)));
  const connectedCount = nodes.filter((n) => (degree[n.id] || 0) > 0).length;
  const hiddenCount = Math.max(0, connectedCount - visNodes.length);

  return (
    <div>
      {/* Arama + gorunum */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter" && listNodes[0]) openFocus(listNodes[0].id); }}
                 placeholder={`${nodes.length} madde içinde ara…`}
                 className="w-full rounded-xl border bg-surface py-1.5 pl-8 pr-3 text-sm outline-none focus:border-accent-purple" />
        </div>
        <div className="flex items-center gap-1 rounded-xl border p-0.5">
          <button onClick={() => setView("net")} title="Ağ görünümü"
                  className={cx("flex items-center gap-1 rounded-lg px-2 py-1 text-xs", view === "net" ? "bg-accent-purple text-white" : "text-text-secondary")}>
            <Network size={13} /> Ağ
          </button>
          <button onClick={() => setView("list")} title="Liste görünümü"
                  className={cx("flex items-center gap-1 rounded-lg px-2 py-1 text-xs", view === "list" ? "bg-accent-purple text-white" : "text-text-secondary")}>
            <List size={13} /> Liste
          </button>
        </div>
      </div>

      {/* Arama onerileri */}
      {q.trim() && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {listNodes.slice(0, 8).map((n) => (
            <button key={n.id} onClick={() => openFocus(n.id)}
                    className="flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 text-xs hover:border-accent-purple/50">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[n.kind] || KIND_COLOR.kavram }} />
              {n.id} <span className="opacity-50">{degree[n.id] || 0}</span>
            </button>
          ))}
          {listNodes.length === 0 && <p className="text-xs text-text-secondary">Eşleşen madde yok.</p>}
        </div>
      )}

      {view === "list" ? (
        <div className="mt-3 max-h-[560px] overflow-y-auto rounded-2xl border bg-surface">
          <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
            {kindsPresent.map((k) => {
              const on = kinds.size === 0 || kinds.has(k);
              return (
                <button key={k} onClick={() => setKinds((s) => { const n = new Set(s); if (n.size === 0) kindsPresent.forEach((x) => n.add(x)); n.has(k) ? n.delete(k) : n.add(k); if (n.size === kindsPresent.length) n.clear(); return n; })}
                        className={cx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", on ? "bg-surface" : "bg-surface opacity-40")}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR[k] || KIND_COLOR.kavram }} />
                  {KIND_LABEL[k] || k} <span className="opacity-60">{nodes.filter((n) => n.kind === k).length}</span>
                </button>
              );
            })}
          </div>
          {listNodes.map((n) => (
            <button key={n.id} onClick={() => openFocus(n.id)}
                    className="flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-muted">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[n.kind] || KIND_COLOR.kavram }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{n.id}</span>
                {n.definition && <span className="mt-0.5 line-clamp-1 block text-xs text-text-secondary">{n.definition}</span>}
              </span>
              <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-text-secondary">
                {degree[n.id] || 0} bağ
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          {/* Odak seridi ya da tur filtreleri + kac madde */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {focusId ? (
              <>
                <button onClick={() => { setFocusId(null); setSel(null); }}
                        className="flex items-center gap-1.5 rounded-full border border-accent-purple/40 bg-accent-purple/10 px-2.5 py-1 text-xs text-accent-purple">
                  <ArrowLeft size={12} /> Tüm haritaya dön
                </button>
                <span className="text-xs text-text-secondary">
                  <b className="text-text-primary">{focusId}</b> ve {Math.max(0, visNodes.length - 1)} komşusu
                </span>
              </>
            ) : (
              <>
                {kindsPresent.map((k) => {
                  const on = kinds.size === 0 || kinds.has(k);
                  return (
                    <button key={k} onClick={() => setKinds((s) => { const n = new Set(s); if (n.size === 0) kindsPresent.forEach((x) => n.add(x)); n.has(k) ? n.delete(k) : n.add(k); if (n.size === kindsPresent.length) n.clear(); return n; })}
                            className={cx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", on ? "bg-surface" : "bg-surface opacity-40")}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOR[k] || KIND_COLOR.kavram }} />
                      {KIND_LABEL[k] || k} <span className="opacity-60">{nodes.filter((n) => n.kind === k).length}</span>
                    </button>
                  );
                })}
                <span className="ml-1 text-xs text-text-secondary">
                  En bağlantılı {visNodes.length} madde
                  {hiddenCount > 0 && <> · {hiddenCount} tanesi gizli</>}
                </span>
                {hiddenCount > 0 && (
                  <button onClick={() => setLimit((l) => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(l) + 1)] || l + 25)}
                          className="rounded-full border px-2.5 py-1 text-xs text-accent-purple hover:border-accent-purple/50">
                    Daha fazla göster
                  </button>
                )}
                {limit !== STEPS[0] && (
                  <button onClick={() => setLimit(STEPS[0])} className="rounded-full border px-2.5 py-1 text-xs text-text-secondary">
                    Sadeleştir
                  </button>
                )}
              </>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => setZoom((z) => ({ ...z, k: Math.min(3, z.k * 1.2) }))} aria-label="Yakınlaştır" className="rounded-md border p-1.5 text-text-secondary hover:bg-surface-muted"><ZoomIn size={15} /></button>
              <button onClick={() => setZoom((z) => ({ ...z, k: Math.max(0.4, z.k / 1.2) }))} aria-label="Uzaklaştır" className="rounded-md border p-1.5 text-text-secondary hover:bg-surface-muted"><ZoomOut size={15} /></button>
              <button onClick={() => setZoom({ k: 1, x: 0, y: 0 })} aria-label="Sıfırla" className="rounded-md border p-1.5 text-text-secondary hover:bg-surface-muted"><Maximize2 size={15} /></button>
            </div>
          </div>

          <div ref={wrapRef} className="relative mt-3 overflow-hidden rounded-2xl border bg-surface" style={{ height, touchAction: "none" }}
               onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
            <svg width={size.w} height={size.h} onPointerDown={(e) => { onDownBg(e); setSel(null); }} className="cursor-grab">
              <g transform={`translate(${zoom.x},${zoom.y}) scale(${zoom.k})`}>
                {visEdges.map((e, i) => {
                  const a = posRef.current[e.source], b = posRef.current[e.target]; if (!a || !b) return null;
                  const idx = edges.indexOf(e);
                  const on = sel?.type === "edge" && sel.i === idx;
                  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                  const few = visNodes.length <= 14;
                  return (
                    <g key={i} onPointerDown={(ev) => { ev.stopPropagation(); setSel({ type: "edge", i: idx }); }} className="cursor-pointer">
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? "#8b7cf0" : "currentColor"}
                            strokeOpacity={on ? 1 : 0.3} strokeWidth={on ? 2.5 : 1.2} className="text-text-secondary" />
                      {(on || few || zoom.k > 1.4) && (
                        <text x={mx} y={my - 4} textAnchor="middle" fontSize={10} fill="currentColor" className="text-text-secondary"
                              style={{ pointerEvents: "none", paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3 }}>{e.label}</text>
                      )}
                    </g>
                  );
                })}
                {visNodes.map((n) => {
                  const p = posRef.current[n.id]; if (!p) return null;
                  const isFocus = focusId === n.id;
                  const r = (isFocus ? 12 : 7) + Math.min(10, (degree[n.id] || 0) * 1.4);
                  const on = sel?.type === "node" && sel.id === n.id;
                  return (
                    <g key={n.id} transform={`translate(${p.x},${p.y})`}
                       onPointerDown={(e) => { onDownNode(n.id, e); setSel({ type: "node", id: n.id }); }}
                       onDoubleClick={() => openFocus(n.id)} className="cursor-pointer">
                      <circle r={r + (on ? 4 : 0)} fill={KIND_COLOR[n.kind] || KIND_COLOR.kavram}
                              stroke={isFocus ? "#8b7cf0" : on ? "#fff" : "none"} strokeWidth={isFocus ? 3 : 2} />
                      <text y={r + 13} textAnchor="middle" fontSize={isFocus ? 13 : 11} fontWeight={on || isFocus ? 600 : 400}
                            fill="currentColor" className="text-text-primary"
                            style={{ pointerEvents: "none", paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3.5 }}>
                        {n.id.length > 24 ? n.id.slice(0, 23) + "…" : n.id}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {visNodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-text-secondary">
                Bu filtreyle bağlantılı madde yok. Filtreyi değiştir ya da Liste görünümüne geç.
              </div>
            )}

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
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[11px] text-text-secondary">{degree[selNode.id] || 0} bağlantı</span>
                      {focusId !== selNode.id && (degree[selNode.id] || 0) > 0 && (
                        <button onClick={() => openFocus(selNode.id)}
                                className="rounded-full border border-accent-purple/40 bg-accent-purple/10 px-2 py-0.5 text-[11px] text-accent-purple">
                          Bunu merkeze al
                        </button>
                      )}
                    </div>
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
          <p className="mt-2 text-[11px] text-text-secondary">
            Bir maddeye çift tıkla: yalnız onu ve komşularını gör · Çizgiye tıkla: ilişkinin geçtiği cümle ve sayfa · Sürükle: taşı
          </p>
        </>
      )}
    </div>
  );
}
