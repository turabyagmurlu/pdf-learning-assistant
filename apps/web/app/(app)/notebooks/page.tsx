"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { CardSkeleton } from "@/components/Skeleton";
import { useRefreshOn } from "@/components/Wake";
import { toast } from "@/components/Toast";
import {
  Notebook, Plus, FileText, Highlighter, PenLine, Check, BookMarked, Share2, Clock, X, Loader2, Sparkles, MessageSquare, Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type NB = {
  id: string; title: string; description?: string | null; created_at: string; draft_at?: string | null;
  has_draft: boolean; doc_count: number; page_count: number; note_count: number;
  has_glossary: boolean; has_timeline: boolean; has_concept_map: boolean; last_activity: string;
  topics?: { label: string; n: number }[]; types?: [string, number][];
  last_chat?: string | null; last_chat_at?: string | null; chat_count?: number;
};
const TOPIC_BAR = ["bg-violet-500", "bg-emerald-500", "bg-orange-500", "bg-sky-500", "bg-pink-500", "bg-amber-500", "bg-stone-400"];
const TYPE_BAR: Record<string, string> = {
  pdf: "bg-violet-500", youtube: "bg-red-500", audio: "bg-purple-400", docx: "bg-blue-500", xlsx: "bg-emerald-500", csv: "bg-emerald-500",
  pptx: "bg-orange-500", web: "bg-sky-500", html: "bg-sky-500", text: "bg-amber-500", md: "bg-amber-500", txt: "bg-amber-500", rtf: "bg-amber-500", epub: "bg-fuchsia-500",
};
const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const WELCOME_KEY = "typdf.welcome.dismissed";
/** Ornek defter: herkese acik, kisa, Turkce bir Vikipedi maddesi */
const SAMPLE = { title: "Örnek: Uyku ve öğrenme", url: "https://tr.wikipedia.org/wiki/Uyku" };

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} dk önce`;
  if (d < 86400) return `${Math.round(d / 3600)} sa önce`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

const STEPS: { Icon: LucideIcon; t: string; d: string }[] = [
  { Icon: Notebook, t: "Defter aç", d: "Her araştırma konusu için bir defter." },
  { Icon: Upload, t: "Kaynak ekle", d: "PDF, Word, link, YouTube ya da metin; birkaç dakikada hazır olur." },
  { Icon: MessageSquare, t: "Soru sor", d: "Cevaplar kaynağına ve sayfasına atıflı gelir; tek tıkla taslağına taşı." },
];

export default function NotebooksPage() {
  const router = useRouter();
  const [list, setList] = useState<NB[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [welcome, setWelcome] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const busyRef = useRef(false);
  const fid = useId();

  async function load() {
    setLoadErr("");
    try { setList(await api("/collections")); }
    catch (e) { setLoadErr(errorMessage(e)); setList((l) => l ?? []); }
  }
  useEffect(() => { load(); }, []);
  useRefreshOn(load);

  useEffect(() => {
    try { setWelcome(localStorage.getItem(WELCOME_KEY) !== "1"); } catch { setWelcome(true); }
    // Hizli gecis paletinden "Yeni defter": /notebooks?new=1
    if (new URLSearchParams(window.location.search).get("new") === "1") setCreating(true);
    const onNew = () => { setCreateErr(""); setCreating(true); };
    window.addEventListener("typdf:new-notebook", onNew);
    return () => window.removeEventListener("typdf:new-notebook", onNew);
  }, []);

  function dismissWelcome() {
    setWelcome(false);
    try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* gizli sekme */ }
  }

  function startCreate() { setCreateErr(""); setCreating(true); }

  async function create() {
    const t = title.trim();
    if (!t) { setCreateErr("Defterine bir ad ver; örneğin “Osmanlı ekonomisi”."); return; }
    if (busyRef.current) return;                           // cift tiklama / cift Enter: tek defter
    busyRef.current = true; setBusy(true); setCreateErr("");
    try {
      const r = (await api("/collections", { method: "POST", body: JSON.stringify({ title: t }) })) as { id?: string } | null;
      setTitle(""); setCreating(false);
      if (r?.id) router.push("/collections/" + r.id); else load();
    } catch (e) {
      setCreateErr("Defter oluşturulamadı. " + errorMessage(e));   // yazilan ad korunur
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  async function trySample() {
    if (sampleBusy) return;
    setSampleBusy(true);
    let cid: string | undefined;
    try {
      const c = (await api("/collections", { method: "POST", body: JSON.stringify({ title: SAMPLE.title }) })) as { id?: string } | null;
      cid = c?.id;
      if (!cid) throw new Error("Örnek defter oluşturulamadı.");
      try {
        await api("/documents/web", { method: "POST", body: JSON.stringify({ url: SAMPLE.url, collection_id: cid }) });
        toast("Örnek defter hazır. Kaynak birkaç dakikada hazırlanır; sonra soru sorabilirsin.");
      } catch (e) {
        toast.error("Örnek defter açıldı ama kaynak eklenemedi. Defterin içinden “Link” ile ekleyebilirsin. " + errorMessage(e));
      }
      dismissWelcome();
      router.push("/collections/" + cid);
    } catch (e) {
      toast.error("Örnek defter oluşturulamadı. " + errorMessage(e));
    } finally { setSampleBusy(false); }
  }

  const createForm = (center: boolean) => (
    <form onSubmit={(e) => { e.preventDefault(); void create(); }}
          className={cx("flex flex-col gap-1.5", center ? "mx-auto mt-4 w-full max-w-sm" : "")}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={fid} className="sr-only">Defter adı</label>
        <input id={fid} autoFocus value={title} onChange={(e) => { setTitle(e.target.value); setCreateErr(""); }}
               onKeyDown={(e) => { if (e.key === "Escape" && !busy) setCreating(false); }}
               placeholder="Defter adı (ör. Osmanlı ekonomisi)" disabled={busy}
               aria-invalid={!!createErr} aria-describedby={createErr ? fid + "-err" : undefined}
               className={cx("min-w-0 rounded-xl border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-purple", center ? "flex-1" : "w-56")} />
        <button type="submit" disabled={busy} aria-label="Defteri oluştur"
                className="flex h-10 min-w-[40px] items-center justify-center gap-1 rounded-xl bg-accent-purple px-3 text-sm text-on-accent disabled:opacity-60">
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          {center && <span>Oluştur</span>}
        </button>
        {!center && (
          <button type="button" onClick={() => { setCreating(false); setCreateErr(""); }} disabled={busy} aria-label="Vazgeç"
                  className="flex h-10 w-10 items-center justify-center rounded-xl border text-text-secondary hover:bg-surface-muted">
            <X size={16} />
          </button>
        )}
      </div>
      {createErr && <p id={fid + "-err"} role="alert" className="text-sm text-danger">{createErr}</p>}
    </form>
  );

  const empty = list !== null && list.length === 0 && !loadErr;
  const showWelcome = list !== null && !loadErr && (empty || welcome);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-8">
      <PageHeader title="Defterler"
                  subtitle="Her defter bir araştırma: kaynaklar, kaynaklı sohbet, notlar ve taslağın bir arada."
                  right={
                    empty ? undefined : creating ? createForm(false) : (
                      <button type="button" onClick={startCreate}
                              className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm text-on-accent">
                        <Plus size={16} aria-hidden="true" /> Yeni defter
                      </button>
                    )
                  } />

      {loadErr && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span>Defterlerin silinmedi, sadece yüklenemedi. {loadErr}</span>
          <button type="button" onClick={load} className="min-h-[40px] rounded-lg bg-accent-purple px-3 text-on-accent">Tekrar dene</button>
        </div>
      )}

      {showWelcome && (
        <section aria-labelledby={fid + "-w"} className="relative mb-6 rounded-2xl border bg-surface p-5 md:p-6">
          {!empty && (
            <button type="button" onClick={dismissWelcome} aria-label="Nasıl çalışır kartını kapat"
                    className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
              <X size={16} />
            </button>
          )}
          <h2 id={fid + "-w"} className="font-heading text-xl">Nasıl çalışır?</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {STEPS.map(({ Icon, t, d }, i) => (
              <li key={t} className="flex gap-3 rounded-xl bg-surface-muted/60 p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-purple/10 text-sm font-medium text-accent-purple" aria-hidden="true">{i + 1}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium"><Icon size={15} aria-hidden="true" className="text-accent-purple" /> {t}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-text-secondary">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-text-secondary">
            Soru sormak gibi yapay zekâ işleri <b className="font-medium text-text-primary">⚡1</b> rozetiyle gösterilir ve günlük kullanımından düşer; okuma, arama ve kayıtlı cevaplar ücretsizdir.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!empty && (
              <button type="button" onClick={startCreate}
                      className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm text-on-accent">
                <Plus size={16} aria-hidden="true" /> Yeni defter aç
              </button>
            )}
            <button type="button" onClick={trySample} disabled={sampleBusy}
                    className="flex min-h-[44px] items-center gap-1.5 rounded-xl border px-4 text-sm hover:border-accent-purple/50 hover:text-accent-purple disabled:opacity-60">
              {sampleBusy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
              Örnek defterle dene
            </button>
            <span className="text-xs text-text-secondary">“Uyku” Vikipedi maddesiyle hazır bir defter açar.</span>
          </div>
        </section>
      )}

      {list === null ? (
        <CardSkeleton n={3} />
      ) : loadErr && list.length === 0 ? null : empty ? (
        <div className="rounded-2xl border border-dashed p-8 text-center md:p-12">
          <Notebook size={30} className="mx-auto text-accent-purple" aria-hidden="true" />
          <h2 className="mt-3 font-heading text-lg">İlk defterini oluştur</h2>
          <ul className="mx-auto mt-2 max-w-md space-y-1 text-left text-sm text-text-secondary">
            <li>• Bir konu için kaynaklarını (dosya, link, YouTube, metin) tek yerde toplar.</li>
            <li>• Kaynaklarına soru sorarsın; cevaplar sayfa numaralı atıflarla gelir.</li>
            <li>• Notlarını, vurgularını ve taslağını aynı yerde tutar.</li>
          </ul>
          {createForm(true)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((nb) => (
            <button type="button" key={nb.id} onClick={() => router.push("/collections/" + nb.id)}
                    aria-label={`${nb.title} defterini aç: ${nb.doc_count} kaynak`}
                    className="lift group flex flex-col rounded-2xl border bg-surface p-5 text-left hover:border-accent-purple/40">
              <h3 className="line-clamp-2 font-heading text-[22px] leading-tight">{nb.title}</h3>
              {(() => {
                const segs = nb.topics?.length
                  ? nb.topics.map((t, i) => ({ k: t.label, n: t.n, c: TOPIC_BAR[i % TOPIC_BAR.length] }))
                  : (nb.types || []).map(([k, n]) => ({ k, n, c: TYPE_BAR[k] || "bg-violet-500" }));
                return segs.length ? (
                  <div className="mt-3 flex h-1.5 w-full gap-0.5" aria-hidden="true" title={nb.topics?.length ? nb.topics.map((t) => `${t.label} (${t.n})`).join(" · ") : ""}>
                    {segs.map((g) => <div key={g.k} className={cx("h-full rounded-full", g.c)} style={{ flexGrow: g.n }} />)}
                  </div>
                ) : <div className="mt-3 h-1.5 w-full rounded-full bg-surface-muted" aria-hidden="true" />;
              })()}
              {nb.topics?.length ? (
                <p className="mt-1.5 line-clamp-1 text-xs text-text-secondary">{nb.topics.map((t) => t.label).join(" · ")}</p>
              ) : nb.description ? (
                <p className="mt-1.5 line-clamp-1 text-xs text-text-secondary">{nb.description}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                <span className="flex items-center gap-1"><FileText size={13} aria-hidden="true" /> {nb.doc_count} kaynak{nb.page_count ? ` · ${nb.page_count} s.` : ""}</span>
                {nb.note_count > 0 && <span className="flex items-center gap-1"><Highlighter size={13} aria-hidden="true" /> {nb.note_count} not</span>}
                {nb.has_draft && <span className="flex items-center gap-1 text-accent-purple"><PenLine size={13} aria-hidden="true" /> taslak</span>}
              </div>
              <div className="mt-auto flex items-center gap-1.5 border-t pt-2.5 text-xs text-text-secondary" style={{ marginTop: "0.9rem" }}>
                <Clock size={12} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {ago(nb.last_activity)}
                  {nb.last_chat ? <> · <span className="text-text-primary">“{nb.last_chat.length > 48 ? nb.last_chat.slice(0, 46) + "…" : nb.last_chat}”</span></> : null}
                </span>
                <span className="ml-auto flex shrink-0 gap-1">
                  {([["Sözlük", nb.has_glossary, BookMarked], ["Kavram haritası", nb.has_concept_map, Share2], ["Zaman çizelgesi", nb.has_timeline, Clock]] as [string, boolean, LucideIcon][]).map(([label, ok, Icon]) => (
                    <span key={label} title={label + (ok ? " hazır" : " henüz oluşturulmadı")}
                          className={cx("rounded-full p-1", ok ? "bg-green-500/10 text-green-800 dark:text-green-300" : "text-text-secondary/50")}>
                      <Icon size={11} aria-hidden="true" />
                      <span className="sr-only">{label + (ok ? " hazır" : " henüz oluşturulmadı")}</span>
                    </span>
                  ))}
                </span>
              </div>
            </button>
          ))}
          <button type="button" onClick={() => { startCreate(); window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }}
                  className="flex min-h-[150px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-sm text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
            <Plus size={17} aria-hidden="true" /> Yeni defter
          </button>
        </div>
      )}
    </div>
  );
}
