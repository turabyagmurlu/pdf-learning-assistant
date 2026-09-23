"use client";
/** Metin yapistir -> kaynak: e-posta, not, yazisma, makale parcasi... */
import { useState } from "react";
import { StickyNote, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export default function TextAdd({ collectionId, onAdded }: { collectionId?: string; onAdded?: (d: any) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    if (text.trim().length < 40) { setMsg({ ok: false, text: "Biraz daha uzun bir metin yapıştır." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api("/documents/text", { method: "POST",
        body: JSON.stringify({ text, title: title.trim() || null, collection_id: collectionId || null }) }, 1);
      setText(""); setTitle(""); setOpen(false);
      setMsg({ ok: true, text: `“${r.title}” kaynak olarak eklendi.` });
      onAdded?.(r);
    } catch (e: any) { setMsg({ ok: false, text: e?.message || "Eklenemedi." }); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <div>
        <button onClick={() => { setOpen(true); setMsg(null); }}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-surface-muted">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600"><StickyNote size={18} /></span>
          <span>
            <span className="block font-medium">Metin yapıştır</span>
            <span className="block text-xs text-text-secondary">E-posta, not, yazışma, makale parçası… her yazı kaynak olabilir</span>
          </span>
        </button>
        {msg && <p className={"mt-1 pl-11 text-xs " + (msg.ok ? "text-green-600" : "text-red-600")}>{msg.text}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border p-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Başlık (isteğe bağlı)"
             className="mb-2 w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-amber-500" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} autoFocus
                placeholder="Metni buraya yapıştır… (# ile başlayan satırlar bölüm başlığı sayılır)"
                className="w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-amber-500" />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-text-secondary">{text.trim() ? `${text.trim().split(/\s+/).length} kelime` : ""}</span>
        <button onClick={() => setOpen(false)} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-muted">Vazgeç</button>
        <button onClick={save} disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {busy && <Loader2 size={14} className="animate-spin" />} Kaynak olarak ekle
        </button>
      </div>
      {msg && !msg.ok && <p className="mt-1 text-xs text-red-600">{msg.text}</p>}
    </div>
  );
}
