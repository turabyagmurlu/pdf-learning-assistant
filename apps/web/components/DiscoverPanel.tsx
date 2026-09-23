"use client";
/**
 * Web'den kaynak bul: defterin konusu (ya da yazilan konu) icin Google aramasi
 * destekli model gercek kaynaklar bulur; secilenler tek tikla deftere eklenir.
 */
import { useState } from "react";
import { Globe, Loader2, Search, Check, GraduationCap, FileText } from "lucide-react";
import { api } from "@/lib/api";

type R = { url: string; title: string; description?: string; site?: string; kind: string; academic?: boolean; words?: number; origin?: string };

export default function DiscoverPanel({ collectionId, onAdded }: { collectionId: string; onAdded?: () => void }) {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ overview: string; results: R[]; topic: string; note?: string } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [added, setAdded] = useState<Record<string, "ok" | string>>({});
  const [err, setErr] = useState("");

  async function search() {
    setBusy(true); setErr(""); setRes(null); setSel(new Set()); setAdded({});
    try {
      const r = await api(`/collections/${collectionId}/discover`, { method: "POST",
        body: JSON.stringify({ topic: topic.trim() || null }) }, 1);
      setRes(r);
      setSel(new Set((r.results || []).slice(0, 3).map((x: R) => x.url)));
      if (!r.results?.length) setErr("Uygun kaynak bulunamadı; konuyu biraz daha açık yazmayı dene.");
    } catch (e: any) { setErr(e?.message || "Arama yapılamadı."); }
    finally { setBusy(false); }
  }

  async function addSelected() {
    const list = (res?.results || []).filter((r) => sel.has(r.url) && !added[r.url]);
    if (!list.length) return;
    setAdding({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      try {
        await api("/documents/web", { method: "POST", body: JSON.stringify({ url: list[i].url, collection_id: collectionId }) }, 1);
        setAdded((a) => ({ ...a, [list[i].url]: "ok" }));
      } catch (e: any) {
        setAdded((a) => ({ ...a, [list[i].url]: e?.message || "eklenemedi" }));
      }
      setAdding({ done: i + 1, total: list.length });
    }
    setAdding(null); onAdded?.();
  }

  const toggle = (u: string) => setSel((s) => { const n = new Set(s); n.has(u) ? n.delete(u) : n.add(u); return n; });

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Globe size={18} />}
        </div>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }}
               placeholder="Web'de kaynak ara… (boş bırakırsan defterin konusu)" disabled={busy}
               className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-emerald-500" />
        <button onClick={search} disabled={busy}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          <Search size={14} /> Ara
        </button>
      </div>
      {!res && !busy && !err && (
        <p className="mt-1.5 pl-11 text-xs text-text-secondary">Google araması + açık erişimli akademik yayınlar (OpenAlex) + Vikipedi taranır; seçtiklerin tek tıkla deftere eklenir.</p>
      )}
      {busy && <p className="mt-1.5 pl-11 text-xs text-text-secondary">Web taranıyor, bulunan sayfalar kontrol ediliyor… (10–30 sn)</p>}
      {err && <p className="mt-1.5 pl-11 text-xs text-red-600">{err}</p>}

      {res && res.results.length > 0 && (
        <div className="mt-3 max-h-[45vh] space-y-2 overflow-y-auto pr-1">
          {res.note && <p className="rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-800">{res.note}</p>}
          {res.overview && (
            <p className="rounded-lg bg-emerald-500/5 p-2.5 text-xs leading-relaxed text-text-secondary">{res.overview}</p>
          )}
          {res.results.map((r) => {
            const st = added[r.url];
            return (
              <label key={r.url} className={"flex cursor-pointer gap-2.5 rounded-xl border p-2.5 transition " +
                (sel.has(r.url) ? "border-emerald-500/50 bg-emerald-500/5" : "hover:bg-surface-muted")}>
                <input type="checkbox" checked={sel.has(r.url)} onChange={() => toggle(r.url)} disabled={!!st}
                       className="mt-1 h-4 w-4 shrink-0 accent-emerald-600" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {r.kind === "pdf" ? <FileText size={13} className="shrink-0 text-accent-purple" /> : <Globe size={13} className="shrink-0 text-sky-600" />}
                    <span className="truncate text-sm font-medium">{r.title}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-secondary">
                    <span className="truncate">{r.site}</span>
                    {r.origin === "openalex" && <span className="rounded-full bg-indigo-500/10 px-1.5 text-indigo-700">açık erişim yayın</span>}
                    {r.academic && r.origin !== "openalex" && <span className="flex items-center gap-0.5 rounded-full bg-indigo-500/10 px-1.5 text-indigo-700"><GraduationCap size={11} /> akademik</span>}
                    {r.kind === "pdf" && <span className="rounded-full bg-accent-purple/10 px-1.5 text-accent-purple">PDF</span>}
                    {!!r.words && r.words > 1500 && <span className="rounded-full bg-surface-muted px-1.5">uzun içerik</span>}
                    <a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-sky-600 hover:underline">aç ↗</a>
                  </span>
                  {r.description && <span className="mt-1 line-clamp-2 block text-xs text-text-secondary">{r.description}</span>}
                  {st && (
                    <span className={"mt-1 flex items-center gap-1 text-[11px] " + (st === "ok" ? "text-green-600" : "text-red-600")}>
                      {st === "ok" ? <><Check size={12} /> Deftere eklendi</> : st}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-text-secondary">{sel.size} seçili</span>
            <button onClick={addSelected} disabled={!!adding || !sel.size}
                    className="ml-auto flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {adding ? <><Loader2 size={14} className="animate-spin" /> Ekleniyor {adding.done}/{adding.total}</> : "Seçilenleri deftere ekle"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
