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
  topics?: { label: string; n: number }[]; types?: [string, number][];
  last_chat?: string | null; last_chat_at?: string | null;
};
const TOPIC_BAR = ["bg-violet-500", "bg-emerald-500", "bg-orange-500", "bg-sky-500", "bg-pink-500", "bg-amber-500", "bg-stone-400"];
const TYPE_BAR: Record<string, string> = {
  pdf: "bg-violet-500", youtube: "bg-red-500", audio: "bg-purple-400", docx: "bg-blue-500", xlsx: "bg-emerald-500", csv: "bg-emerald-500",
  pptx: "bg-orange-500", web: "bg-sky-500", html: "bg-sky-500", text: "bg-amber-500", md: "bg-amber-500", txt: "bg-amber-500", rtf: "bg-amber-500", epub: "bg-fuchsia-500",
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
      <PageHeader title="Defterler"
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
                    className="lift group flex flex-col rounded-2xl border bg-surface p-5 text-left hover:border-accent-purple/40">
              <h3 className="line-clamp-2 font-heading text-[22px] leading-tight">{nb.title}</h3>
              {(() => {
                const segs = nb.topics?.length
                  ? nb.topics.map((t, i) => ({ k: t.label, n: t.n, c: TOPIC_BAR[i % TOPIC_BAR.length] }))
                  : (nb.types || []).map(([k, n]) => ({ k, n, c: TYPE_BAR[k] || "bg-violet-500" }));
                return segs.length ? (
                  <div className="mt-3 flex h-1.5 w-full gap-0.5" title={nb.topics?.length ? nb.topics.map((t) => `${t.label} (${t.n})`).join(" · ") : ""}>
                    {segs.map((g) => <div key={g.k} className={cx("h-full rounded-full", g.c)} style={{ flexGrow: g.n }} />)}
                  </div>
                ) : <div className="mt-3 h-1.5 w-full rounded-full bg-surface-muted" />;
              })()}
              {nb.topics?.length ? (
                <p className="mt-1.5 line-clamp-1 text-[11px] text-text-secondary">{nb.topics.map((t) => t.label).join(" · ")}</p>
              ) : nb.description ? (
                <p className="mt-1.5 line-clamp-1 text-[11px] text-text-secondary">{nb.description}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                <span className="flex items-center gap-1"><FileText size={13} /> {nb.doc_count} kaynak · {nb.page_count} s.</span>
                {nb.note_count > 0 && <span className="flex items-center gap-1"><Highlighter size={13} /> {nb.note_count} not</span>}
                {nb.has_draft && <span className="flex items-center gap-1 text-accent-purple"><PenLine size={13} /> taslak</span>}
              </div>
              <div className="mt-auto flex items-center gap-1.5 border-t pt-2.5 text-[11px] text-text-secondary" style={{ marginTop: "0.9rem" }}>
                <Clock size={12} className="shrink-0" />
                <span className="min-w-0 truncate">
                  {ago(nb.last_activity)}
                  {nb.last_chat ? <> · <span className="text-text-primary">“{nb.last_chat.length > 48 ? nb.last_chat.slice(0, 46) + "…" : nb.last_chat}”</span></> : null}
                </span>
                <span className="ml-auto flex shrink-0 gap-1">
                  {[["Sözlük", nb.has_glossary, BookMarked], ["Harita", nb.has_concept_map, Share2], ["Zaman", nb.has_timeline, Clock]].map(([label, ok, Icon]: any) => (
                    <span key={label} title={label + (ok ? " hazır" : " oluşturulmadı")}
                          className={cx("rounded-full p-1", ok ? "bg-green-500/10 text-green-700 dark:text-green-400" : "text-text-secondary/40")}>
                      <Icon size={11} />
                    </span>
                  ))}
                </span>
              </div>
            </button>
          ))}
          <button onClick={() => { setCreating(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className="flex min-h-[150px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-sm text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
            <Plus size={17} /> Yeni defter
          </button>
        </div>
      )}
    </div>
  );
}
