"use client";
/**
 * Vurgu haritasi (Ajan V2): okuyucunun sag kenarinda, kaydirma cubugunun yaninda ince dikey serit.
 *
 *   <div className="relative h-full">
 *     <div ref={scrollRef} className="h-full overflow-auto"> ... [data-page="N"] ... </div>
 *     <HighlightMap scrollRef={scrollRef} numPages={n} marks={annotationMarks(anns)} layoutKey={width} />
 *   </div>
 *
 * - Her vurgu / alt cizgi / kenar notu kendi renginde kucuk yatay cizgi; konum =
 *   (sayfa - 1 + sayfa ici y) / toplam sayfa. Birbirine 4 px'ten yakin cizgiler birlesir.
 * - O an gorunen bolge ince cerceveyle gosterilir (sayfa birimiyle olculur; farkli yukseklikte
 *   sayfalarda da dogru).
 * - Cizgiye dokun / tikla -> o sayfanin o yerine kaydirir. Uzerine gelince (ya da klavyeyle
 *   odaklaninca) ipucu: "s.N · metnin ilk 40 karakteri".
 * - Klavye: serit tek durak; yukari / asagi ok ile cizgiler arasinda gezilir, Enter ile gidilir.
 * - Gorsel serit 12 px; dokunmatikte gorunmez tiklama alani 24 px (reader.css .hl-map).
 * - Isaret yoksa hic cizilmez.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapMark } from "@/lib/reader";
import { pigmentOf } from "@/lib/reader";

/** Cizgi rengi: vurgular pigmente (eski hex'ler de), kenar notu (eski okuyucu moru) lapis olur. */
const STICKY_OLD = "#7B6CF0";
function markColor(c: string): string {
  return c.toUpperCase() === STICKY_OLD ? "var(--accent-purple, #2E4C8E)" : pigmentOf(c);
}

interface Props {
  /** Kaydirilan kap ([data-page] ogelerini icerir) */
  scrollRef: React.RefObject<HTMLElement>;
  numPages: number;
  marks: MapMark[];
  /** Sayfa boyutu degisince (yakinlastirma vb.) gorunen bolgeyi yeniden olcmek icin */
  layoutKey?: unknown;
}

type Group = { key: string; page: number; y: number; px: number; color: string; label: string; first: string; count: number };

const PAD = 4;          // seridin ust/alt ic boslugu (px)
const MERGE_PX = 4;     // bundan yakin cizgiler birlesir

export default function HighlightMap({ scrollRef, numPages, marks, layoutKey }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);                          // serit yuksekligi
  const [sbw, setSbw] = useState(0);                      // kaydirma cubugu genisligi
  const [view, setView] = useState<{ a: number; b: number } | null>(null);   // gorunen bolge (0..1)
  const [hover, setHover] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [kbd, setKbd] = useState(false);                  // klavye odagi: ipucu odakli cizgide

  // serit yuksekligi + kaydirma cubugu genisligi
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setSbw(Math.max(0, el.offsetWidth - el.clientWidth));
      setH(el.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef, numPages]);

  // gorunen bolgeyi sayfa birimiyle olc
  const measureView = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !numPages) { setView(null); return; }
    const els = Array.from(el.querySelectorAll<HTMLElement>("[data-page]"));
    if (!els.length) { setView(null); return; }
    const rows: { first: number; span: number; top: number }[] = [];
    for (const p of els) {
      const n = Number(p.dataset.page);
      const top = p.offsetTop;
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.top - top) < 2) { last.span = Math.max(last.span, n - last.first + 1); continue; }   // cift sayfa: ayni satir
      rows.push({ first: n, span: 1, top });
    }
    const unitAt = (y: number) => {
      let i = 0;
      while (i + 1 < rows.length && rows[i + 1].top <= y) i++;
      const r = rows[i];
      const next = i + 1 < rows.length ? rows[i + 1].top : el.scrollHeight;
      const frac = next > r.top ? Math.min(1, Math.max(0, (y - r.top) / (next - r.top))) : 0;
      return (r.first - 1 + frac * r.span) / numPages;
    };
    const a = unitAt(el.scrollTop);
    const b = unitAt(el.scrollTop + el.clientHeight);
    setView({ a: Math.max(0, a), b: Math.min(1, Math.max(a, b)) });
  }, [scrollRef, numPages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measureView(); }); };
    measureView();
    const t = setTimeout(measureView, 400);                 // sayfa yer tutuculari yerlesince
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); clearTimeout(t); };
  }, [scrollRef, measureView, layoutKey, h]);

  // cizgiler: sirala, yakin olanlari birlestir
  const groups = useMemo<Group[]>(() => {
    if (!numPages || h <= 0) return [];
    const usable = Math.max(1, h - PAD * 2);
    const sorted = marks
      .filter((m) => m.page >= 1 && m.page <= numPages)
      .map((m) => ({ m, pos: (m.page - 1 + m.y) / numPages }))
      .sort((x, z) => x.pos - z.pos);
    const out: Group[] = [];
    for (const { m, pos } of sorted) {
      const px = PAD + pos * usable;
      const last = out[out.length - 1];
      if (last && px - last.px < MERGE_PX) {
        last.count += 1;
        last.label = `${last.count} işaret · ${last.first}`;
        continue;
      }
      out.push({ key: m.id, page: m.page, y: m.y, px, color: m.color, label: m.label, first: m.label, count: 1 });
    }
    return out;
  }, [marks, numPages, h]);

  useEffect(() => { if (focusIdx >= groups.length) setFocusIdx(Math.max(0, groups.length - 1)); }, [groups.length, focusIdx]);

  const jump = useCallback((page: number, y: number) => {
    const el = scrollRef.current;
    const target = el?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (!el || !target) return;
    const top = Math.max(0, target.offsetTop + y * target.offsetHeight - el.clientHeight * 0.3);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const far = Math.abs(top - el.scrollTop) > el.clientHeight * 3;   // uzak atlamada ara sayfalar cizilmesin
    el.scrollTo({ top, behavior: reduce || far ? "auto" : "smooth" });
  }, [scrollRef]);

  // bos seride dokunus: en yakin cizgi (14 px icinde); yoksa o orana kaydir
  const onRailClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-mark]")) return;
    const r = railRef.current?.getBoundingClientRect();
    if (!r || !numPages) return;
    const y = e.clientY - r.top;
    let best: Group | null = null, bd = Infinity;
    for (const g of groups) { const d = Math.abs(g.px - y); if (d < bd) { bd = d; best = g; } }
    if (best && bd <= 14) { jump(best.page, best.y); return; }
    const pos = Math.min(1, Math.max(0, (y - PAD) / Math.max(1, r.height - PAD * 2))) * numPages;
    const page = Math.min(numPages, Math.floor(pos) + 1);
    jump(page, pos - (page - 1));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!groups.length) return;
    let n = focusIdx;
    if (e.key === "ArrowDown") n = Math.min(groups.length - 1, focusIdx + 1);
    else if (e.key === "ArrowUp") n = Math.max(0, focusIdx - 1);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = groups.length - 1;
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const g = groups[focusIdx]; if (g) jump(g.page, g.y); return; }
    else return;
    e.preventDefault();
    setFocusIdx(n); setKbd(true);
    railRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${n}"]`)?.focus();
  };

  if (!groups.length) return null;
  const tipIdx = hover ?? (kbd ? focusIdx : null);
  const tip = tipIdx !== null ? groups[tipIdx] : null;

  return (
    <div ref={railRef} className="hl-map" style={{ right: sbw }}
         role="group" aria-label={`Vurgu haritası: ${marks.length} işaret. Yukarı ve aşağı okla gez, Enter ile git`}
         onClick={onRailClick} onKeyDown={onKey}
         onMouseLeave={() => setHover(null)}
         onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setKbd(false); }}>
      <div className="hl-map-rail" aria-hidden />
      {view && (
        <div className="hl-map-view" aria-hidden
             style={{ top: PAD + view.a * Math.max(1, h - PAD * 2), height: Math.max(8, (view.b - view.a) * Math.max(1, h - PAD * 2)) }} />
      )}
      {groups.map((g, i) => (
        <button key={g.key} type="button" data-mark data-idx={i}
                tabIndex={i === focusIdx ? 0 : -1}
                className="hl-map-hit" style={{ top: g.px }}
                aria-label={`Sayfa ${g.page}: ${g.label}`}
                onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(i); }}
                onPointerLeave={() => setHover((v) => (v === i ? null : v))}
                onFocus={() => setFocusIdx(i)}
                onClick={() => { setFocusIdx(i); jump(g.page, g.y); }}>
          <span className="hl-map-mark" style={{ background: markColor(g.color), height: g.count > 1 ? 4 : 3 }} />
        </button>
      ))}
      {tip && (
        <div className="hl-map-tip" role="tooltip" style={{ top: tip.px }}>
          <span className="font-medium">s.{tip.page}</span> · {tip.label}
        </div>
      )}
    </div>
  );
}
