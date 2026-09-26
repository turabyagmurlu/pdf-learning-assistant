// Reader / annotation data layer. Highlights & notes persist via the existing
// /notes backend (notes table already has page_number, selected_text,
// highlight_color, anchor JSONB, note_content, tags).
//
// Kalem paleti (Ajan P): stil (vurgu / alt cizgi) ve opaklik SUTUN EKLEMEDEN anchor JSON'unda
// tasinir: {type:"highlight", rects, style:"highlight"|"underline", opacity:0.45|0.75|1}.
import { API, getToken } from "@/lib/api";

export type Rect = { x: number; y: number; w: number; h: number }; // 0..1 relative to page
export type AnnType = "highlight" | "sticky";
export type HighlightStyle = "highlight" | "underline";
export interface Anchor {
  type: AnnType;
  rects?: Rect[];   // highlight rectangles (relative)
  x?: number;       // sticky note position (relative)
  y?: number;
  style?: HighlightStyle;   // vurgu (fosforlu) | alt cizgi — yoksa "highlight"
  opacity?: number;         // 0.45 | 0.75 | 1 — yoksa 1 (eski vurgular)
}
export interface Annotation {
  id: string;
  page_number: number;
  selected_text: string | null;
  note_content: string | null;
  highlight_color: string | null;
  anchor: Anchor;
  created_at?: string;
}

export const HIGHLIGHT_COLORS: { key: string; label: string; value: string }[] = [
  { key: "yellow", label: "Sarı", value: "#FFE78A" },
  { key: "green", label: "Yeşil", value: "#BFECCB" },
  { key: "blue", label: "Mavi", value: "#BFDFFF" },
  { key: "pink", label: "Pembe", value: "#FFD1E8" },
  { key: "purple", label: "Mor", value: "#D9CBFF" },
];

/** Kalinlik / opaklik kademeleri (palet). Alt cizgide kalinlik, vurguda seffaflik olarak uygulanir. */
export const OPACITY_STEPS: { key: string; label: string; value: number; underlinePx: number }[] = [
  { key: "light", label: "Hafif", value: 0.45, underlinePx: 2 },
  { key: "normal", label: "Orta", value: 0.75, underlinePx: 3 },
  { key: "strong", label: "Koyu", value: 1, underlinePx: 4 },
];
export const DEFAULT_OPACITY = 1;

/** Vurgu araclari (palet). "none": arac kapali. */
export type PenTool = "none" | "highlight" | "underline" | "note" | "eraser";
export const PEN_TOOL_LABEL: Record<PenTool, string> = {
  none: "Kapalı", highlight: "Vurgu", underline: "Altını çiz", note: "Kenar notu", eraser: "Silgi",
};

/** Palet tercihleri (renk, kademe, konum, kucultulmus mu) — cihazda saklanir. */
export type PenPrefs = { color: string; opacity: number; collapsed: boolean; pos: { x: number; y: number } | null };
const PEN_KEY = "reader.pen";
const LAST_COLOR_KEY = "reader.lastColor";   // eski anahtar: geriye uyum
export function loadPenPrefs(): PenPrefs {
  const def: PenPrefs = { color: HIGHLIGHT_COLORS[0].value, opacity: DEFAULT_OPACITY, collapsed: false, pos: null };
  try {
    const raw = localStorage.getItem(PEN_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PenPrefs>;
      if (typeof p.color === "string" && HIGHLIGHT_COLORS.some((c) => c.value === p.color)) def.color = p.color;
      if (typeof p.opacity === "number" && OPACITY_STEPS.some((s) => s.value === p.opacity)) def.opacity = p.opacity;
      if (typeof p.collapsed === "boolean") def.collapsed = p.collapsed;
      if (p.pos && typeof p.pos.x === "number" && typeof p.pos.y === "number") def.pos = { x: p.pos.x, y: p.pos.y };
    } else {
      const v = localStorage.getItem(LAST_COLOR_KEY);
      if (v && HIGHLIGHT_COLORS.some((c) => c.value === v)) def.color = v;
    }
  } catch {}
  return def;
}
export function savePenPrefs(p: PenPrefs) {
  try { localStorage.setItem(PEN_KEY, JSON.stringify(p)); localStorage.setItem(LAST_COLOR_KEY, p.color); } catch {}
}

/** Vurgu dikdortgeninin gorunumu (PdfReader katmani + Notlar paneli ayni kurali kullanir). */
export function highlightStyle(a: Pick<Annotation, "highlight_color" | "anchor">): {
  background: string; opacity: number; borderBottom: string; underline: boolean;
} {
  const color = a.highlight_color || HIGHLIGHT_COLORS[0].value;
  const op = typeof a.anchor?.opacity === "number" ? a.anchor.opacity : DEFAULT_OPACITY;
  const underline = a.anchor?.style === "underline";
  const step = OPACITY_STEPS.find((s) => s.value === op) || OPACITY_STEPS[2];
  return underline
    ? { background: "transparent", opacity: 1, borderBottom: `${step.underlinePx}px solid ${darken(color)}`, underline: true }
    : { background: color, opacity: op, borderBottom: "none", underline: false };
}
/** Pastel vurgu rengini alt cizgi icin koyulastirir (beyaz kagitta gorunsun). */
export function darken(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const f = (h: string) => Math.max(0, Math.round(parseInt(h, 16) * 0.62));
  return `rgb(${f(m[1])}, ${f(m[2])}, ${f(m[3])})`;
}
export function annotationKindLabel(a: Pick<Annotation, "anchor">): string {
  if (a.anchor.type === "sticky") return "Kenar notu";
  return a.anchor.style === "underline" ? "Altı çizili" : "Vurgu";
}

function authHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {};
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

// PDF is streamed through our API (CORS-friendly for pdf.js) with token query param.
export function rawPdfUrl(docId: string): string {
  return `${API}/documents/${docId}/raw?token=${getToken() ?? ""}`;
}

export async function listAnnotations(docId: string): Promise<Annotation[]> {
  const res = await fetch(`${API}/documents/${docId}/notes`, { headers: authHeaders(false) });
  if (!res.ok) return [];
  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    id: r.id,
    page_number: r.page_number ?? 1,
    selected_text: r.selected_text ?? null,
    note_content: r.note_content ?? null,
    highlight_color: r.highlight_color ?? null,
    anchor: normalizeAnchor(r.anchor),
    created_at: r.created_at,
  }));
}

function normalizeAnchor(a: any): Anchor {
  if (!a) return { type: "highlight" };
  if (typeof a === "string") { try { a = JSON.parse(a); } catch { return { type: "highlight" }; } }
  const out: Anchor = { type: a.type === "sticky" ? "sticky" : "highlight", rects: a.rects, x: a.x, y: a.y };
  if (a.style === "underline") out.style = "underline";
  if (typeof a.opacity === "number" && a.opacity > 0 && a.opacity <= 1) out.opacity = a.opacity;
  return out;
}

export async function createAnnotation(docId: string, a: Omit<Annotation, "id" | "created_at">): Promise<Annotation | null> {
  const res = await fetch(`${API}/documents/${docId}/notes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      page_number: a.page_number,
      selected_text: a.selected_text,
      note_content: a.note_content ?? "",
      highlight_color: a.highlight_color,
      anchor: a.anchor,
      tags: [],
    }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return { ...a, id: j.id };
}

/** Not metni / renk / stil guncelleme (PATCH; sil + yeniden olustur yok, cop kutusuna iz dusmez). */
export async function patchAnnotation(id: string, p: Partial<Pick<Annotation, "note_content" | "highlight_color" | "anchor">>): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (p.note_content !== undefined) body.note_content = p.note_content ?? "";
  if (p.highlight_color !== undefined && p.highlight_color !== null) body.highlight_color = p.highlight_color;
  if (p.anchor !== undefined) body.anchor = p.anchor;
  const res = await fetch(`${API}/notes/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body) });
  return res.ok;
}

/** Cop kutusuna tasir (30 gun icinde geri alinabilir). */
export async function deleteAnnotation(id: string): Promise<boolean> {
  const res = await fetch(`${API}/notes/${id}`, { method: "DELETE", headers: authHeaders(false) });
  return res.ok;
}

/** Copten geri getirir (ayni kimlikle). */
export async function restoreAnnotation(id: string): Promise<boolean> {
  const res = await fetch(`${API}/trash/note/${id}/restore`, { method: "POST", headers: authHeaders(false) });
  return res.ok;
}

export function exportMarkdown(title: string, anns: Annotation[]): string {
  const lines = [`# ${title} — Notlar ve vurgular\n`];
  const byPage = [...anns].sort((a, b) => a.page_number - b.page_number);
  for (const a of byPage) {
    const kind = a.anchor.type === "sticky" ? "Not" : a.anchor.style === "underline" ? "Altı çizili" : "Vurgu";
    lines.push(`## Sayfa ${a.page_number} · ${kind}`);
    if (a.selected_text) lines.push(`> ${a.selected_text}`);
    if (a.note_content) lines.push(`\n${a.note_content}`);
    lines.push("");
  }
  return lines.join("\n");
}
