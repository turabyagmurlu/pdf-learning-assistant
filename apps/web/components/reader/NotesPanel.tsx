"use client";
import { useMemo, useState } from "react";
import { Annotation } from "@/lib/reader";
import { Trash2, StickyNote, Highlighter, Search } from "lucide-react";

interface Props {
  annotations: Annotation[];
  onJump: (a: Annotation) => void;
  onDelete: (id: string) => void;
  onEditNote: (a: Annotation) => void;
}

export default function NotesPanel({ annotations, onJump, onDelete, onEditNote }: Props) {
  const [q, setQ] = useState("");
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Notlarda ara…"
                 className="w-full bg-transparent py-1.5 text-sm outline-none" aria-label="Notlarda ara" />
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {items.length === 0 ? (
          <div className="mt-8 text-center text-sm text-text-secondary">
            Henüz not/highlight yok. Metni seçip renk seç ya da kenar-notu aracını kullan.
          </div>
        ) : items.map((a) => (
          <div key={a.id} className="group rounded-lg border bg-surface p-2.5 hover:border-accent-purple/50 transition">
            <div className="flex items-center justify-between text-[11px] text-text-secondary">
              <span className="flex items-center gap-1">
                {a.anchor.type === "sticky" ? <StickyNote size={12} /> : <Highlighter size={12} />}
                s.{a.page_number}
              </span>
              <button className="opacity-0 group-hover:opacity-100 text-danger" aria-label="Sil"
                      onClick={() => onDelete(a.id)}><Trash2 size={13} /></button>
            </div>
            {a.anchor.type !== "sticky" && a.selected_text && (
              <button onClick={() => onJump(a)} className="mt-1 block w-full text-left">
                <span className="rounded px-1 text-sm text-text-primary line-clamp-3"
                      style={{ background: a.highlight_color || "#FFE78A" }}>{a.selected_text}</span>
              </button>
            )}
            {a.note_content ? (
              <p onClick={() => onEditNote(a)} className="mt-1.5 cursor-text text-sm text-text-primary line-clamp-4">{a.note_content}</p>
            ) : a.anchor.type === "sticky" ? (
              <button onClick={() => onEditNote(a)} className="mt-1 text-xs text-accent-purple">Not ekle…</button>
            ) : (
              <button onClick={() => onEditNote(a)} className="mt-1 text-xs text-accent-purple">+ not</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
