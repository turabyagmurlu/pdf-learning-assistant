"use client";
import { useMemo, useState } from "react";
import { Annotation, annotationKindLabel, highlightStyle, darken } from "@/lib/reader";
import { Trash2, StickyNote, Highlighter, Underline, Search, Quote } from "lucide-react";

/** #RRGGBB -> rgba (vurgu kademesi listede de gorunsun; metin okunakli kalsin) */
function withAlpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}
/** Listedeki alinti: vurgu -> zemin (kademeyle), alt cizgi -> renkli alt cizgi (kalinlikla) */
function quoteStyle(a: Annotation): React.CSSProperties {
  const hs = highlightStyle(a);
  if (hs.underline) return { background: "transparent", borderBottom: hs.borderBottom, borderRadius: 0, paddingBottom: 1 };
  return { background: withAlpha(hs.background, hs.opacity) };
}

interface Props {
  annotations: Annotation[];
  docTitle?: string;
  onJump: (a: Annotation) => void;
  onDelete: (id: string) => void;
  onEditNote: (a: Annotation) => void;
}

export default function NotesPanel({ annotations, docTitle, onJump, onDelete, onEditNote }: Props) {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  async function copyCite(a: Annotation) {
    const t = (a.selected_text || "").trim().replace(/\s+/g, " ");
    const cite = `"${t}" (${docTitle || "Kaynak"}${a.page_number ? ", s. " + a.page_number : ""})`;
    try { await navigator.clipboard.writeText(cite); setCopied(a.id); setTimeout(() => setCopied(null), 1500); } catch {}
  }
  const items = useMemo(() => {
    const list = [...annotations].sort((a, b) => a.page_number - b.page_number);
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter((a) => (a.selected_text || "").toLowerCase().includes(s) || (a.note_content || "").toLowerCase().includes(s));
  }, [annotations, q]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="flex items-center gap-2 rounded-lg border bg-surface-muted px-2">
          <Search size={14} className="text-text-secondary" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Notlarda ve vurgularda ara…"
                 className="min-h-[40px] w-full bg-transparent text-sm outline-none" aria-label="Notlarda ve vurgularda ara" />
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {items.length === 0 ? (
          <div className="mt-8 text-center text-sm text-text-secondary">
            Henüz not ya da vurgu yok. Metni seçip bir renk seç ya da kenar notu aracını kullan.
          </div>
        ) : items.map((a) => (
          <div key={a.id} className="group rounded-lg border bg-surface p-2.5 hover:border-accent-purple/50 transition">
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span className="flex items-center gap-1" title={annotationKindLabel(a)}>
                {a.anchor.type === "sticky" ? <StickyNote size={12} aria-hidden />
                  : a.anchor.style === "underline" ? <Underline size={12} aria-hidden style={{ color: darken(a.highlight_color || "#FFE78A") }} />
                  : <Highlighter size={12} aria-hidden />}
                <span className="sr-only">{annotationKindLabel(a)},</span> s.{a.page_number}
              </span>
              <span className="-my-1 flex items-center">
                {a.selected_text && (
                  <button type="button" className="flex h-10 min-w-[40px] items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover hover:text-accent-purple"
                          aria-label="Alıntıyı kaynak ve sayfayla kopyala"
                          title="Alıntıyı kaynak ve sayfayla kopyala" onClick={() => copyCite(a)}>
                    {copied === a.id ? <span className="px-1 text-xs text-accent-purple" role="status">kopyalandı</span> : <Quote size={14} aria-hidden />}
                  </button>
                )}
                <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover hover:text-danger"
                        title="Çöp kutusuna taşı (30 gün içinde geri alabilirsin)"
                        aria-label={`Sayfa ${a.page_number} ${a.anchor.type === "sticky" ? "kenar notunu" : a.anchor.style === "underline" ? "alt çizgisini" : "vurgusunu"} çöp kutusuna taşı`}
                        onClick={() => onDelete(a.id)}><Trash2 size={15} aria-hidden /></button>
              </span>
            </div>
            {a.anchor.type !== "sticky" && a.selected_text && (
              <button type="button" onClick={() => onJump(a)} className="mt-1 block w-full text-left" aria-label={`Sayfa ${a.page_number}'e git: ${(a.selected_text || "").slice(0, 80)}`}>
                <span className="rounded px-1 text-sm text-text-primary line-clamp-3" style={quoteStyle(a)}>{a.selected_text}</span>
              </button>
            )}
            {a.note_content ? (
              <button type="button" onClick={() => onEditNote(a)} aria-label={`Notu düzenle: ${a.note_content.slice(0, 80)}`}
                      className="mt-1.5 block w-full cursor-text text-left text-sm text-text-primary line-clamp-4">{a.note_content}</button>
            ) : a.anchor.type === "sticky" ? (
              <button type="button" onClick={() => onEditNote(a)} className="mt-1 min-h-[40px] text-sm text-accent-purple">Not ekle…</button>
            ) : (
              <button type="button" onClick={() => onEditNote(a)} className="mt-1 min-h-[40px] text-sm text-accent-purple">+ Not ekle</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
