"use client";
/**
 * YouTube linkini kaynak olarak ekler. Dokum arka planda cikarilir
 * (once videonun altyazisi, yoksa yapay zeka videoyu izler), sonra
 * PDF gibi aranabilir / sorulabilir / atif verilebilir hale gelir.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export function isYoutubeUrl(s: string) {
  return /(youtube\.com\/(watch|shorts|live|embed)|youtu\.be\/)/i.test(s || "");
}

export function YoutubeIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" />
      <path d="M10 9.2v5.6l4.8-2.8z" fill="#fff" />
    </svg>
  );
}

export default function YoutubeAdd({ collectionId, onAdded, compact }: {
  collectionId?: string;
  onAdded?: (doc: any) => void;
  compact?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add() {
    const u = url.trim();
    if (!u) return;
    if (!isYoutubeUrl(u)) { setMsg({ ok: false, text: "Bu bir YouTube linki gibi görünmüyor." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api("/documents/youtube", { method: "POST",
        body: JSON.stringify({ url: u, collection_id: collectionId || null }) });
      setUrl("");
      setMsg({ ok: true, text: `“${r.title}” eklendi — döküm arka planda çıkarılıyor.` });
      onAdded?.(r);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Video eklenemedi." });
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <YoutubeIcon />}
        </div>
        <input value={url} onChange={(e) => setUrl(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") add(); }}
               onPaste={(e) => { const t = e.clipboardData.getData("text"); if (isYoutubeUrl(t)) setMsg(null); }}
               placeholder="YouTube linki yapıştır…" disabled={busy}
               className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-red-500" />
        <button onClick={add} disabled={busy || !url.trim()}
                className="shrink-0 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          {busy ? "Ekleniyor…" : "Ekle"}
        </button>
      </div>
      {!compact && !msg && (
        <p className="mt-1.5 pl-11 text-xs text-text-secondary">
          Konuşmalar zaman damgalı döküme çevrilir; sohbette atıfa tıklayınca video o saniyeden açılır.
        </p>
      )}
      {msg && (
        <p className={"mt-1.5 pl-11 text-xs " + (msg.ok ? "text-green-600" : "text-red-600")}>{msg.text}</p>
      )}
    </div>
  );
}
