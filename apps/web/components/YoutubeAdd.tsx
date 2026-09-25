"use client";
/**
 * Link kutusu: YouTube videosu, web sayfasi ya da PDF linki -> kaynak.
 * Video dokumu arka planda cikarilir; web sayfasinin ana metni (menu/reklam
 * haric) alinir; PDF linki dogrudan PDF olarak islenir.
 */
import { useState } from "react";
import { Loader2, Link2 } from "lucide-react";
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

/** Ayni kaynak zaten varsa API yeni kopya acmaz: {linked_existing: true}. */
export function linkedExistingText(hasCollection: boolean) {
  return hasCollection ? "Bu kaynak zaten kütüphanende vardı, deftere bağlandı." : "Bu kaynak zaten kütüphanende var.";
}

export default function YoutubeAdd({ collectionId, onAdded, compact, autoFocus, quiet }: {
  collectionId?: string;
  onAdded?: (doc: any) => void;
  compact?: boolean;
  autoFocus?: boolean;
  /** Basari mesajini ust bilesen (ör. bildirim) gosterecekse kendi satirini yazmaz. */
  quiet?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add() {
    const u = url.trim();
    if (!u) return;
    if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+/i.test(u)) { setMsg({ ok: false, text: "Bu bir web adresi gibi görünmüyor." }); return; }
    const yt = isYoutubeUrl(u);
    setBusy(true); setMsg(null);
    try {
      const r = await api(yt ? "/documents/youtube" : "/documents/web", { method: "POST",
        body: JSON.stringify({ url: u, collection_id: collectionId || null }) }, 1);
      setUrl("");
      if (!quiet) setMsg({ ok: true, text: r?.linked_existing ? linkedExistingText(!!collectionId)
        : yt ? `“${r.title}” eklendi — döküm arka planda çıkarılıyor.`
        : `“${r.title}” eklendi — ${r.source_type === "pdf" ? "PDF" : "sayfa metni"} işleniyor.` });
      onAdded?.(r);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Link eklenemedi; adresi kontrol edip tekrar dene." });
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
          (isYoutubeUrl(url) ? "bg-red-500/10 text-red-600" : "bg-sky-500/10 text-sky-600")}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : isYoutubeUrl(url) ? <YoutubeIcon /> : <Link2 size={18} />}
        </div>
        <input value={url} onChange={(e) => setUrl(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") add(); }}
               onPaste={(e) => { const t = e.clipboardData.getData("text"); if (isYoutubeUrl(t)) setMsg(null); }}
               placeholder="Link yapıştır: YouTube, web sayfası ya da PDF linki…" disabled={busy}
               aria-label="Link: YouTube, web sayfası ya da PDF linki" autoFocus={autoFocus} inputMode="url"
               className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-sky-500" />
        <button onClick={add} disabled={busy || !url.trim()}
                className="min-h-[40px] shrink-0 rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
          {busy ? "Ekleniyor…" : "Ekle"}
        </button>
      </div>
      {!compact && !msg && (
        <p className="mt-1.5 pl-11 text-xs text-text-secondary">
          Videoda konuşmalar zaman damgalı döküme çevrilir; web sayfasında menü ve reklamlar atılıp yalnız yazı alınır.
        </p>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={"mt-1.5 pl-11 text-xs " + (msg.ok ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300")}>{msg.text}</p>
      )}
    </div>
  );
}
