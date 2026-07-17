"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API, getToken } from "@/lib/api";
import { Search, FileText, ArrowRight, Compass } from "lucide-react";

type Doc = { id: string; title: string; status: string };
type Hit = { id: string; document_id: string; page_number?: number | null; section_title?: string | null; content: string; score: number; title: string };

const cx = (...a: any[]) => a.filter(Boolean).join(" ");

export default function SearchPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { (async () => { try { const d = await api("/documents"); setDocs((d as Doc[]).filter((x) => x.status === "ready")); } catch {} })(); }, []);

  function toggle(id: string) { setSel((s) => s.indexOf(id) >= 0 ? s.filter((x) => x !== id) : [...s, id]); }

  async function run() {
    if (!q.trim()) return;
    setBusy(true); setHits(null);
    try {
      const body: any = { query: q.trim() };
      if (sel.length) body.document_ids = sel;
      const r = await fetch(API + "/search", { method: "POST", headers: { Authorization: "Bearer " + getToken(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) setHits(await r.json()); else setHits([]);
    } catch { setHits([]); }
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="mb-5">
        <h1 className="font-heading text-3xl">Keşfet</h1>
        <p className="mt-1 text-sm text-text-secondary">Tüm belgelerinde anlam bazlı ara; ilgili pasajları belge ve sayfa bilgisiyle bul.</p>
      </div>

      <div className="flex items-center gap-2 rounded-xl border bg-surface px-3">
        <Search size={18} className="text-text-secondary" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run(); }} placeholder="Örn. Trablusgarp'ta Mustafa Kemal'in rolü" aria-label="Arama sorgusu" className="w-full bg-transparent py-3 text-sm outline-none" />
        <button onClick={run} disabled={busy || !q.trim()} className="shrink-0 rounded-lg bg-accent-purple px-4 py-1.5 text-sm text-white disabled:opacity-50">{busy ? "Aranıyor…" : "Ara"}</button>
      </div>

      {docs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-text-secondary">Kapsam:</span>
          <button onClick={() => setSel([])} className={cx("rounded-full px-2.5 py-1 text-xs", sel.length === 0 ? "bg-accent-purple/15 text-accent-purple" : "border bg-surface text-text-secondary")}>Tüm belgeler</button>
          {docs.map((d) => (
            <button key={d.id} onClick={() => toggle(d.id)} className={cx("rounded-full px-2.5 py-1 text-xs", sel.indexOf(d.id) >= 0 ? "bg-accent-purple/15 text-accent-purple" : "border bg-surface text-text-secondary hover:border-accent-purple/50")}>{d.title}</button>
          ))}
        </div>
      )}

      <div className="mt-6">
        {busy ? <p className="text-sm text-text-secondary">Anlam bazlı arama yapılıyor…</p> :
         hits === null ? (
          <div className="rounded-2xl border bg-surface p-10 text-center text-sm text-text-secondary"><Compass size={26} className="mx-auto mb-2 text-accent-purple" />Bir soru yaz; belgelerinden en ilgili pasajları getireyim.</div>
         ) :
         hits.length === 0 ? <p className="text-sm text-text-secondary">Sonuç bulunamadı.</p> :
         (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">{hits.length} pasaj bulundu</p>
            {hits.map((h) => (
              <div key={h.id} onClick={() => router.push("/documents/" + h.document_id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") router.push("/documents/" + h.document_id); }} className="group cursor-pointer rounded-2xl border bg-surface p-4 transition hover:border-accent-purple/50 hover:shadow-sm">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <FileText size={15} className="shrink-0 text-accent-purple" />
                    <span className="truncate font-medium text-text-primary">{h.title}</span>
                    {h.page_number ? <span className="shrink-0 text-xs text-text-secondary">· s.{h.page_number}</span> : null}
                    {h.section_title ? <span className="hidden truncate text-xs text-text-secondary sm:inline">· {h.section_title}</span> : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-accent-purple/10 px-2 py-0.5 text-xs text-accent-purple">%{Math.round((h.score || 0) * 100)}</span>
                </div>
                <p className="line-clamp-3 text-sm leading-relaxed text-text-secondary">{h.content}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-xs text-accent-purple opacity-0 transition group-hover:opacity-100">Belgeyi aç <ArrowRight size={12} /></span>
              </div>
            ))}
          </div>
         )}
      </div>
    </div>
  );
}
