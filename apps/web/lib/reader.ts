// Reader / annotation data layer. Highlights & notes persist via the existing
// /notes backend (notes table already has page_number, selected_text,
// highlight_color, anchor JSONB, note_content, tags).
import { API, getToken } from "@/lib/api";

export type Rect = { x: number; y: number; w: number; h: number }; // 0..1 relative to page
export type AnnType = "highlight" | "sticky";
export interface Anchor {
  type: AnnType;
  rects?: Rect[];   // highlight rectangles (relative)
  x?: number;       // sticky note position (relative)
  y?: number;
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
  return { type: a.type === "sticky" ? "sticky" : "highlight", rects: a.rects, x: a.x, y: a.y };
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

export async function deleteAnnotation(id: string): Promise<boolean> {
  const res = await fetch(`${API}/notes/${id}`, { method: "DELETE", headers: authHeaders(false) });
  return res.ok;
}

export function exportMarkdown(title: string, anns: Annotation[]): string {
  const lines = [`# ${title} — Notlar & Highlight'lar\n`];
  const byPage = [...anns].sort((a, b) => a.page_number - b.page_number);
  for (const a of byPage) {
    const kind = a.anchor.type === "sticky" ? "Not" : "Highlight";
    lines.push(`## Sayfa ${a.page_number} · ${kind}`);
    if (a.selected_text) lines.push(`> ${a.selected_text}`);
    if (a.note_content) lines.push(`\n${a.note_content}`);
    lines.push("");
  }
  return lines.join("\n");
}
