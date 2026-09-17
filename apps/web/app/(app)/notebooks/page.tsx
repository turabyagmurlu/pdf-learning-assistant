"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { CardSkeleton } from "@/components/Skeleton";
import { useRefreshOn } from "@/components/Wake";
import { Notebook, Plus, FileText, Highlighter, PenLine, Check, BookMarked, Share2, Clock } from "lucide-react";

type NB = {
  id: string; title: string; description?: string | null; created_at: string; draft_at?: string | null;
  has_draft: boolean; doc_count: number; page_count: number; note_count: number;
  has_glossary: boolean; has_timeline: boolean; has_concept_map: boolean; last_activity: string;
};
const cx = (...a: any[]) => a.filter(Boolean).join(" ");

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} dk önce`;
  if (d < 86400) return `${Math.round(d / 3600)} sa önce`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

export default function NotebooksPage() {
  const router = useRouter();
  const [list, setList] = useState<NB[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  async function load() {
    setLoadErr("");
    try { setList(await api("/collections")); }
    catch (e: any) { setLoadErr(e?.message || "Sunucuya ulaşılamadı."); setList((l) => l ?? []); }
  }
  useEffect(() => { load(); }, []);
  useRefreshOn(load);

  async function create() {
    const t = title.trim();
    if (!t) { setCreating(false); return; }
    try {
      const r = await api("/collections", { method: "POST", body: JSON.stringify({ title: t }) });
      setTitle(""); setCreating(false);
      if (r?.id) router.push("/collections/" + r.id); else load();
    } catch {}
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-8">
      <PageHeader hero eyebrow="TY PDF" title="Defterler"
                  subtitle="Her defter bir araştırma: kaynaklar, kaynaklı sohbet, notlar ve taslağın bir arada."
                  right={
                    creating ? (
                      <div className="flex items-center gap-1.5">
                        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
                               onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setCreating(false); }}
                               placeholder="Defter adı" className="w-56 rounded-xl border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-purple" />
                        <button onClick={create} aria-label="Oluştur" className="rounded-xl bg-accent-purple p-2 text-white"><Check size={16} /></button>
                      </div>
                    ) : (
                      <button onClick={() => setCreating(true)}
                              className="flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2 text-sm text-white">
                        <Plus size={16} /> Yeni defter
                      </button>
                    )
                  } />

      {loadErr && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span>Sunucuya ulaşılamadı; defterlerin silinmedi, sadece yüklenemedi. {loadErr}</span>
          <button onClick={load} className="rounded-lg bg-accent-purple px-3 py-1.5 text-white">Tekrar dene</button>
        </div>
      )}
      {list === null ? (
        <CardSkeleton n={3} />
      ) : loadErr && list.length === 0 ? null : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center">
          <Notebook size={30} className="mx-auto text-accent-purple" />
          <p className="mt-3 text-sm text-text-secondary">
            Henüz defter yok. Bir defter aç, kütüphanenden kaynak ekle; sonra soru sor, not al, yaz.
          </p>
          <button onClick={() => setCreating(true)} className="mt-4 rounded-xl bg-accent-purple px-4 py-2 text-sm text-white">
            İlk defterini aç
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((nb) => (
            <button key={nb.id} onClick={() => router.push("/collections/" + nb.id)}
                    className="lift group rounded-2xl border bg-surface p-5 text-left hover:border-accent-purple/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-heading text-xl leading-tight">{nb.title}</h3>
                <span className="shrink-0 text-[11px] text-text-secondary">{ago(nb.last_activity)}</span>
              </div>
              {nb.description && <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{nb.description}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-secondary">
                <span className="flex items-center gap-1"><FileText size={13} /> {nb.doc_count} kaynak · {nb.page_count} s.</span>
                <span className="flex items-center gap-1"><Highlighter size={13} /> {nb.note_count} not</span>
                <span className={cx("flex items-center gap-1", nb.has_draft && "text-accent-purple")}><PenLine size={13} /> {nb.has_draft ? "taslak var" : "taslak yok"}</span>
              </div>
              <div className="mt-3 flex gap-1.5">
                {[["Sözlük", nb.has_glossary, BookMarked], ["Harita", nb.has_concept_map, Share2], ["Zaman", nb.has_timeline, Clock]].map(([label, ok, Icon]: any) => (
                  <span key={label} title={label + (ok ? " hazır" : " oluşturulmadı")}
                        className={cx("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                          ok ? "border-success/40 text-success" : "text-text-secondary/60")}>
                    <Icon size={10} /> {label}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
