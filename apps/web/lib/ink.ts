/**
 * Kalem (Apple Pencil) yardimcilari — saf fonksiyonlar, DOM'suz (node ile sinanabilir).
 *
 * 1) Fosforlu kalem: darbenin gectigi satirlari PDF metin katmanindaki span'lerden bulur
 *    (rectsFromStroke). Yerel metin secimi KULLANILMAZ (iOS'ta secim tasiyordu).
 * 2) El yazisi: basinca gore kalinlasan, yumusatilmis darbe cizimi (strokePath) — perfect-freehand
 *    benzeri basit bir yontem: noktalar seyreltilir, yumusatilir, her noktada normal yonde
 *    basinca bagli yaricapla sol/sag kenar cikarilir, uclar yuvarlanir.
 *
 * Murekkep notu anchor bicimi (notes.anchor JSON):
 *   {type:"ink", strokes:[{c:"#1B2233", w:3.5, p:[[x,y,pressure],...]}], box:[x,y,w,h]}
 *   x, y, box: SAYFA GENISLIGINE gore 0-1 orani (y de genislige bolunur; 3 basamak).
 *   w: kalinlik, sayfa genisliginin binde biri (1000 birimlik sayfada px).
 */

export type InkPoint = [number, number, number];          // x, y (sayfa genisligi orani), basinc 0-1
export type InkStroke = { c: string; w: number; p: InkPoint[] };
export type InkData = { strokes: InkStroke[]; box: [number, number, number, number] };

/** Murekkep renkleri (vurgu renklerinden ayri). */
export const INK_COLORS: { key: string; label: string; value: string }[] = [
  { key: "black", label: "Siyah", value: "#1B2233" },
  { key: "purple", label: "Mor", value: "#5A48D8" },
  { key: "red", label: "Kırmızı", value: "#C0392B" },
  { key: "blue", label: "Mavi", value: "#1F6FB2" },
  { key: "green", label: "Yeşil", value: "#28784A" },
];
/** Kalinlik kademeleri (binde sayfa genisligi). */
export const INK_WIDTHS: { key: string; label: string; value: number }[] = [
  { key: "fine", label: "İnce", value: 2.2 },
  { key: "medium", label: "Orta", value: 3.6 },
  { key: "bold", label: "Kalın", value: 6 },
];
export const INK_MAX_STROKES = 60;
export const INK_MAX_POINTS = 4000;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Yakin noktalari atar (minDist: ayni birimde). Ilk ve son nokta korunur. */
export function thinPoints(pts: InkPoint[], minDist: number): InkPoint[] {
  if (pts.length <= 2) return pts.slice();
  const out: InkPoint[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= minDist) out.push(b);
  }
  const last = pts[pts.length - 1], prev = out[out.length - 1];
  if (out.length === 1 || last[0] !== prev[0] || last[1] !== prev[1]) out.push(last);
  return out;
}

/** Hareketli ortalama ile yumusatma (uclar sabit kalir). */
export function smoothPoints(pts: InkPoint[], passes = 2): InkPoint[] {
  let cur = pts.slice();
  for (let k = 0; k < passes; k++) {
    if (cur.length < 3) return cur;
    const next: InkPoint[] = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1], b = cur[i], c = cur[i + 1];
      next.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Kaydedilecek darbe: seyreltilmis, 3 basamakli, basinc 2 basamakli. */
export function packStroke(pts: InkPoint[], color: string, width: number): InkStroke {
  const thin = thinPoints(pts, 0.0015);
  return { c: color, w: width, p: thin.map((q) => [r3(q[0]), r3(q[1]), r2(clamp01(q[2] || 0.5))] as InkPoint) };
}

function clamp01(v: number) { return Math.min(1, Math.max(0, v)); }

/** Basinca gore yaricap: hafif dokunusta ince, bastirinca kalin (w = tam kalinlik). */
export function radiusAt(w: number, pressure: number): number {
  const p = clamp01(Number.isFinite(pressure) ? pressure : 0.5);
  return (w / 2) * (0.45 + 1.1 * p);
}

/**
 * Darbenin doldurulmus dis hatti (SVG path "d"). pts: `scale` ile carpilacak birimde (orn. 0-1 oran),
 * w: `scale` biriminde tam kalinlik (orn. 1000'lik sayfada 3.6). Tek nokta -> daire.
 */
export function strokePath(pts: InkPoint[], w: number, scale = 1000): string {
  if (!pts.length) return "";
  const P = smoothPoints(thinPoints(pts.map((q) => [q[0] * scale, q[1] * scale, q[2]] as InkPoint), Math.max(0.6, w * 0.25)), 2);
  const f = (v: number) => (Math.round(v * 10) / 10).toString();
  if (P.length === 1) {
    const [x, y, p] = P[0];
    const r = radiusAt(w, p);
    return `M${f(x - r)},${f(y)}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0Z`;
  }
  // basinci da yumusat (ani kalinlik sicramasi olmasin); uclari hafif incelt
  const n = P.length;
  const left: [number, number][] = [], right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const taper = Math.min(1, 0.55 + 0.45 * Math.min(i, n - 1 - i) / 3);
    const r = radiusAt(w, P[i][2]) * taper;
    left.push([P[i][0] - dy * r, P[i][1] + dx * r]);
    right.push([P[i][0] + dy * r, P[i][1] - dx * r]);
  }
  const rEnd = radiusAt(w, P[n - 1][2]) * 0.55, rStart = radiusAt(w, P[0][2]) * 0.55;
  const seg = (arr: [number, number][]) => {
    // orta noktalar arasinda ikinci derece egriler: puruzsuz kenar
    let d = "";
    for (let i = 1; i < arr.length - 1; i++) {
      const mx = (arr[i][0] + arr[i + 1][0]) / 2, my = (arr[i][1] + arr[i + 1][1]) / 2;
      d += `Q${f(arr[i][0])},${f(arr[i][1])} ${f(mx)},${f(my)}`;
    }
    const l = arr[arr.length - 1];
    d += `L${f(l[0])},${f(l[1])}`;
    return d;
  };
  const rr = right.slice().reverse();
  return `M${f(left[0][0])},${f(left[0][1])}` + seg(left)
    + `A${f(rEnd)},${f(rEnd)} 0 0,0 ${f(rr[0][0])},${f(rr[0][1])}` + seg(rr)
    + `A${f(rStart)},${f(rStart)} 0 0,0 ${f(left[0][0])},${f(left[0][1])}Z`;
}

/** Darbelerin sinir kutusu [x, y, w, h] (kalinlik payi dahil, 3 basamak). */
export function inkBox(strokes: InkStroke[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const pad = (s.w || 3) / 1000;
    for (const q of s.p) {
      x0 = Math.min(x0, q[0] - pad); y0 = Math.min(y0, q[1] - pad);
      x1 = Math.max(x1, q[0] + pad); y1 = Math.max(y1, q[1] + pad);
    }
  }
  if (!Number.isFinite(x0)) return [0, 0, 0, 0];
  return [r3(x0), r3(y0), r3(x1 - x0), r3(y1 - y0)];
}

/** Sunucudan gelen murekkep verisini dogrular (bozuk noktalari atar, sinirlar). */
export function normalizeInk(a: any): InkData | null {
  if (!a || !Array.isArray(a.strokes)) return null;
  const strokes: InkStroke[] = [];
  let total = 0;
  for (const s of a.strokes.slice(0, INK_MAX_STROKES)) {
    if (!s || !Array.isArray(s.p)) continue;
    const p: InkPoint[] = [];
    for (const q of s.p) {
      if (total >= INK_MAX_POINTS) break;
      if (!Array.isArray(q) || q.length < 2) continue;
      const x = Number(q[0]), y = Number(q[1]), pr = q.length > 2 ? Number(q[2]) : 0.5;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      p.push([x, y, Number.isFinite(pr) ? pr : 0.5]); total++;
    }
    if (p.length) strokes.push({ c: typeof s.c === "string" ? s.c.slice(0, 20) : INK_COLORS[0].value, w: Number(s.w) > 0 ? Math.min(20, Number(s.w)) : 3.6, p });
  }
  if (!strokes.length) return null;
  const b = Array.isArray(a.box) && a.box.length === 4 && a.box.every((v: unknown) => Number.isFinite(Number(v)))
    ? (a.box.map(Number) as [number, number, number, number]) : inkBox(strokes);
  return { strokes, box: b };
}

/* ======================= Fosforlu kalem: darbe -> satir dikdortgenleri ======================= */

export type Span = { x: number; y: number; w: number; h: number; text: string };
export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

type Line = { cy: number; h: number; spans: Span[] };

/** Span'leri satirlara toplar (dikey merkezleri yarim satir yuksekliginden yakin olanlar ayni satir). */
export function groupLines(spans: Span[]): Line[] {
  const sorted = spans.filter((s) => s.w > 0 && s.h > 0 && s.text.length > 0)
    .sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
  const lines: Line[] = [];
  for (const s of sorted) {
    const cy = s.y + s.h / 2;
    const L = lines[lines.length - 1];
    if (L && Math.abs(L.cy - cy) <= Math.min(L.h, s.h) * 0.5) {
      L.spans.push(s);
      L.cy = (L.cy * (L.spans.length - 1) + cy) / L.spans.length;
      L.h = Math.max(L.h, s.h);
    } else lines.push({ cy, h: s.h, spans: [s] });
  }
  for (const L of lines) L.spans.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Darbenin gectigi satirlar: her darbe noktasi, dikey merkezi kendisine satir yuksekliginin
 * `tol` katindan yakin olan EN YAKIN satira atanir. Satirin x araligi = atanan noktalarin min-max'i.
 * O araliga giren her span, karakter orantisiyla kirpilir. Ayni satirdaki bitisik parcalar tek rect.
 * Hic satir bulunmazsa (taranmis sayfa) rects bos doner.
 */
export function rectsFromStroke(spans: Span[], pts: Pt[], tol = 0.6): { rects: Box[]; text: string } {
  const lines = groupLines(spans);
  if (!lines.length || !pts.length) return { rects: [], text: "" };
  const ranges = new Map<number, { x0: number; x1: number }>();
  for (const p of pts) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const d = Math.abs(p.y - lines[i].cy);
      if (d <= lines[i].h * tol && d < bd) { bd = d; best = i; }
    }
    if (best < 0) continue;
    const r = ranges.get(best);
    if (r) { r.x0 = Math.min(r.x0, p.x); r.x1 = Math.max(r.x1, p.x); }
    else ranges.set(best, { x0: p.x, x1: p.x });
  }
  const rects: Box[] = [];
  const texts: string[] = [];
  const order = Array.from(ranges.keys()).sort((a, b) => a - b);
  for (const li of order) {
    const L = lines[li];
    const { x0, x1 } = ranges.get(li)!;
    let cur: Box | null = null;
    let lineText = "";
    let prevEnd = -Infinity;
    for (const s of L.spans) {
      const a = Math.max(s.x, x0), b = Math.min(s.x + s.w, x1);
      if (b <= a) continue;
      const n = s.text.length;
      let i0 = Math.floor(((a - s.x) / s.w) * n + 0.35);
      let i1 = Math.ceil(((b - s.x) / s.w) * n - 0.35);
      i0 = Math.max(0, Math.min(n, i0)); i1 = Math.max(0, Math.min(n, i1));
      if (i1 <= i0) continue;
      const piece = s.text.slice(i0, i1);
      if (!piece.trim()) continue;
      const rx = s.x + (s.w * i0) / n, rw = (s.w * (i1 - i0)) / n;
      if (cur && rx - (cur.x + cur.w) <= L.h * 0.6) {
        const right = Math.max(cur.x + cur.w, rx + rw);
        const top = Math.min(cur.y, s.y), bottom = Math.max(cur.y + cur.h, s.y + s.h);
        cur.w = right - cur.x; cur.y = top; cur.h = bottom - top;
      } else {
        if (cur) rects.push(cur);
        cur = { x: rx, y: s.y, w: rw, h: s.h };
      }
      const gap = rx - prevEnd;
      lineText += (lineText && gap > L.h * 0.15 && !/\s$/.test(lineText) && !/^\s/.test(piece) ? " " : "") + piece;
      prevEnd = rx + rw;
    }
    if (cur) rects.push(cur);
    if (lineText.trim()) texts.push(lineText.trim());
  }
  // satir sonu tiresi: "kelime-" + sonraki satir -> birlestir
  let text = "";
  for (const t of texts) {
    if (!text) text = t;
    else if (/[a-zçğıöşü]-$/i.test(text) && /^[a-zçğıöşü]/.test(t)) text = text.slice(0, -1) + t;
    else text += " " + t;
  }
  return { rects, text: text.replace(/\s+/g, " ").trim() };
}

/** Taranmis sayfa (metin yok): darbenin kendi kutusu, satir yuksekliginde. */
export function strokeBoxRect(pts: Pt[], lineH: number): Box | null {
  if (!pts.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sy = 0;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); sy += p.y; }
  if (y1 - y0 <= lineH * 1.5) {
    const cy = sy / pts.length;
    return { x: x0, y: cy - lineH / 2, w: Math.max(lineH * 0.5, x1 - x0), h: lineH };
  }
  return { x: x0, y: y0 - lineH / 2, w: Math.max(lineH * 0.5, x1 - x0), h: y1 - y0 + lineH };
}

/** Darbe uzunlugu (px). */
export function pathLength(pts: Pt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}
