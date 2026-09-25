"use client";
/**
 * Araçlar: Sözlük, Harita, Zaman çizelgesi.
 * Her kaynagin cikarimi kaynaga kaydedilir; "Yenile" yalniz yeni kaynaklari isler (maliyet: yeni kaynak sayisi).
 */
import { ReactNode, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, RefreshCw, Search, BookMarked, Share2, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { Cost, costTitle, ErrNote, Err, toErr } from "@/components/CostBadge";
import type { CMNode, CMEdge } from "@/components/ConceptMap";
import type { ConfirmOptions } from "@/components/Confirm";

const ConceptMap = dynamic(() => import("@/components/ConceptMap"), { ssr: false, loading: () => <Skeleton className="h-[480px] w-full rounded-2xl" /> });

type Confirm = (o: ConfirmOptions) => Promise<boolean>;
type ExtKind = "glossary" | "relations" | "timeline";
type Stat = { cached: number; pending: number } | null;

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Kaynak basina cikarim durumu + butceli yenileme (hepsi hazirsa ucretsiz birlestirme). */
function useBudget(id: string, kind: ExtKind, confirm: Confirm) {
  const [stat, setStat] = useState<Stat>(null);
  const [note, setNote] = useState("");
  async function loadStat(): Promise<Stat> {
    try { const r = await api(`/collections/${id}/extract-status`); const s = r?.[kind] || null; setStat(s); return s; }
    catch { setStat(null); return null; }
  }
  useEffect(() => { loadStat(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, kind]);

  async function run<T>(fn: (force: boolean) => Promise<T>): Promise<T | null> {
    const st = await loadStat();
    const pending = st?.pending ?? 0, cached = st?.cached ?? 0;
    let force = false;
    if (pending === 0 && cached > 0) {
      const merge = await confirm({
        title: "Yeni kaynak yok",
        description: `${cached} kaynağın hepsi daha önce işlenmiş. Mevcut sonuçlar ücretsiz olarak yeniden birleştirilir.`,
        keeps: ["Birleştir: anında, ücretsiz (önerilen)"],
        losses: [`Sıfırdan üret: her kaynak yeniden yapay zekâya gider, ${cached} kullanım düşer`],
        confirmLabel: "Birleştir", cancelLabel: "Sıfırdan üret",
      });
      force = !merge;
      if (force) {
        const ok = await confirm({
          title: `${cached} kaynak sıfırdan işlensin mi?`,
          description: `Bu işlem yapay zekâ kullanımından ${cached} düşer. Yalnızca sonuçlardan memnun değilsen gerekli.`,
          confirmLabel: "Evet, sıfırdan üret", danger: true,
        });
        if (!ok) return null;
      }
    } else if (pending > 0 && cached > 0) {
      setNote(`${cached} kaynak hazır, ${pending} kaynak işleniyor (⚡${pending})…`);
    } else if (pending > 0) {
      setNote(`${pending} kaynak işleniyor…`);
    }
    try {
      const r = await fn(force);
      const any = r as unknown as { cached?: number; fresh?: number } | null;
      setNote(any && typeof any.cached === "number" ? `${any.cached} kaynak hazırdı, ${any.fresh ?? 0} kaynak yeni işlendi` : "");
      return r;
    } catch (e) { setNote(""); throw e; }
    finally { loadStat(); }
  }
  /** Olustur dugmesi icin tahmini maliyet (bilinmiyorsa hazir kaynak sayisi) */
  const buildCost = (readyN: number) => (stat ? Math.max(stat.pending, 1) : Math.max(readyN, 1));
  return { stat, note, run, buildCost };
}

function RefreshBtn({ stat, note, busy, onClick, small }: { stat: Stat; note: string; busy: boolean; onClick: () => void; small?: boolean }) {
  const pending = stat?.pending ?? 0, cached = stat?.cached ?? 0;
  const label = busy ? "İşleniyor…"
    : !stat ? "Yenile"
    : pending > 0 ? `${pending} yeni kaynağı işle`
    : cached > 0 ? "Yenile · ücretsiz"
    : "Oluştur";
  const tip = !stat ? "Kaynaklar değiştiyse yeniden çıkar"
    : pending > 0 ? `${pending} kaynak ilk kez işlenecek (⚡${pending}), ${cached} kaynak hazır (ücretsiz)`
    : "Tüm kaynaklar daha önce işlenmiş; birleştirmek ücretsiz.";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button onClick={onClick} disabled={busy} title={tip}
              className={cx("flex items-center gap-1.5 rounded-xl border text-text-secondary hover:border-accent-purple/50 disabled:opacity-60",
                small ? "min-h-[36px] px-2.5 text-xs" : "min-h-[40px] px-3 text-sm",
                pending > 0 && "border-amber-500/50 text-amber-900 dark:text-amber-300")}>
        {busy ? <Loader2 size={small ? 13 : 14} className="animate-spin" /> : <RefreshCw size={small ? 13 : 14} />} {label}
        {!busy && pending > 0 && <Cost n={pending} />}
      </button>
      {note && <span role="status" className="text-xs text-text-secondary">{note}</span>}
    </span>
  );
}

function EmptyTool({ Icon, children, action, busy, busyText, cost, err, extra }: {
  Icon: typeof BookMarked; children: ReactNode; action: () => void; busy: boolean; busyText: string; cost: number; err: Err; extra?: ReactNode;
}) {
  return (
    <div className="max-w-3xl rounded-2xl border border-dashed p-8 text-center">
      <Icon size={28} className="mx-auto text-accent-purple" />
      <p className="mt-3 text-sm text-text-secondary">{children}</p>
      {extra}
      <button onClick={action} disabled={busy} title={costTitle(cost)}
              className="mx-auto mt-4 flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm text-white disabled:opacity-60">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {busy ? busyText : <>Oluştur <Cost n={cost} className="bg-white/20" /></>}
      </button>
      <ErrNote err={err} className="mt-3" />
    </div>
  );
}

/* ---------------- Sözlük ---------------- */
type GItem = { term: string; kind: string; definition: string; mentions: { document_id: string; title: string; pages: number[] }[] };
const KIND_LABEL: Record<string, string> = { kisi: "Kişi", yer: "Yer", olay: "Olay", antlasma: "Antlaşma", kurum: "Kurum", kavram: "Kavram" };
const KIND_STYLE: Record<string, string> = {
  kisi: "bg-accent-purple/10 text-text-primary",
  yer: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  olay: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  antlasma: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  kurum: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  kavram: "bg-surface-muted text-text-secondary",
};

export function GlossaryTab({ id, readyN, confirm }: { id: string; readyN: number; confirm: Confirm }) {
  const router = useRouter();
  const b = useBudget(id, "glossary", confirm);
  const [items, setItems] = useState<GItem[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  useEffect(() => {
    (async () => {
      try { const r = await api(`/collections/${id}/glossary`); setItems(r?.items || []); setAt(r?.generated_at || null); }
      catch { setItems([]); }
    })();
  }, [id]);
  async function build() {
    setBusy(true); setErr(null);
    try {
      const r = await b.run((force) => api(`/collections/${id}/glossary${force ? "?force=1" : ""}`, { method: "POST" }, 1));
      if (!r) return;
      setItems(r?.items || []); setAt(r?.generated_at || null);
      if (!(r?.items || []).length) setErr({ text: "Kaynaklardan madde çıkarılamadı.", limit: false });
    } catch (e) { setErr(toErr(e, "Sözlük oluşturulamadı; birazdan tekrar dene.")); if (items === null) setItems([]); }
    finally { setBusy(false); }
  }
  if (items === null) return <p className="text-sm text-text-secondary">Yükleniyor…</p>;
  if (!items.length) {
    return (
      <EmptyTool Icon={BookMarked} action={build} busy={busy} busyText="Çıkarılıyor… (kaynak başına ~15 sn)" cost={b.buildCost(readyN)} err={err}
                 extra={readyN < 3 ? <p className="mt-2 text-xs text-text-secondary">3 ya da daha fazla kaynakla daha verimli olur; şimdi de oluşturabilirsin.</p> : null}>
        Bu defterdeki tüm kaynaklardan <b>kişi, yer, olay, kurum ve kavramları</b> çıkarır; her birinin kısa açıklamasını ve hangi kaynakta hangi sayfada geçtiğini gösterir.
        Kaynak başına 1 yapay zekâ kullanımı harcar; sonuç saklanır.
      </EmptyTool>
    );
  }
  const ql = q.trim().toLocaleLowerCase("tr");
  const list = items.filter((g) => !kind || g.kind === kind)
    .filter((g) => !ql || g.term.toLocaleLowerCase("tr").includes(ql) || g.definition.toLocaleLowerCase("tr").includes(ql));
  const groups: Record<string, GItem[]> = {};
  for (const g of list) { const ch = (g.term[0] || "#").toLocaleUpperCase("tr-TR"); (groups[ch] ||= []).push(g); }
  const keys = Object.keys(groups).sort((a, c) => a.localeCompare(c, "tr"));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border bg-surface px-3">
          <Search size={15} className="text-text-secondary" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: ad, kavram, açıklama…" aria-label="Sözlükte ara"
                 className="w-full bg-transparent py-2 text-sm outline-none" />
        </div>
        <RefreshBtn stat={b.stat} note={b.note} busy={busy} onClick={build} />
      </div>
      <ErrNote err={err} className="mt-2" />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {([["", "Tümü"], ["kisi", "Kişi"], ["yer", "Yer"], ["olay", "Olay"], ["antlasma", "Antlaşma"], ["kurum", "Kurum"], ["kavram", "Kavram"]] as const).map(([k, label]) => {
          const n = k ? items.filter((g) => g.kind === k).length : items.length;
          if (k && n === 0) return null;
          return (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
                    className={cx("min-h-[36px] rounded-full px-2.5 py-1 text-xs",
                      kind === k ? "bg-accent-purple/15 font-semibold text-text-primary" : "border bg-surface text-text-secondary hover:border-accent-purple/50")}>
              {label} <span className="opacity-70">{n}</span>
            </button>
          );
        })}
        {at && <span className="ml-auto self-center text-xs text-text-secondary">{new Date(at).toLocaleDateString("tr-TR")}</span>}
      </div>
      {!list.length ? <p className="mt-6 text-sm text-text-secondary">Eşleşen madde yok.</p> : (
        <div className="mt-4 space-y-5">
          {keys.map((ch) => (
            <div key={ch}>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-heading text-lg text-accent-purple">{ch}</span>
                <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {groups[ch].map((g, i) => (
                  <div key={i} className="rounded-xl border bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium">{g.term}</h4>
                      <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] tracking-wide", KIND_STYLE[g.kind] || KIND_STYLE.kavram)}>
                        {KIND_LABEL[g.kind] || g.kind}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-text-secondary">{g.definition}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {g.mentions.map((m, j) => (m.pages.length ? m.pages.slice(0, 4) : [0]).map((pg, k) => (
                        <button key={j + "-" + k} onClick={() => router.push("/documents/" + m.document_id + (pg ? "?page=" + pg : ""))}
                                title={m.title + (pg ? " · sayfa " + pg : "")}
                                className="min-h-[32px] max-w-[220px] truncate rounded-full border bg-surface px-2 py-0.5 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                          {m.title}{pg ? " · s." + pg : ""}
                        </button>
                      )))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- Kavram haritası ---------------- */
export function MapTab({ id, readyN, confirm }: { id: string; readyN: number; confirm: Confirm }) {
  const b = useBudget(id, "relations", confirm);
  const [cm, setCm] = useState<{ nodes: CMNode[]; edges: CMEdge[] } | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err>(null);
  useEffect(() => {
    (async () => {
      try { const r = await api(`/collections/${id}/concept-map`); setCm({ nodes: r?.nodes || [], edges: r?.edges || [] }); setAt(r?.generated_at || null); }
      catch { setCm({ nodes: [], edges: [] }); }
    })();
  }, [id]);
  async function build() {
    setBusy(true); setErr(null);
    try {
      const r = await b.run((force) => api(`/collections/${id}/concept-map${force ? "?force=1" : ""}`, { method: "POST" }, 1));
      if (!r) return;
      setCm({ nodes: r?.nodes || [], edges: r?.edges || [] }); setAt(r?.generated_at || null);
      if (!(r?.nodes || []).length) setErr({ text: "Harita için madde bulunamadı.", limit: false });
    } catch (e) { setErr(toErr(e, "Harita oluşturulamadı; birazdan tekrar dene.")); if (cm === null) setCm({ nodes: [], edges: [] }); }
    finally { setBusy(false); }
  }
  if (cm === null) return <Skeleton className="h-[480px] w-full rounded-2xl" />;
  if (!cm.nodes.length) {
    return (
      <EmptyTool Icon={Share2} action={build} busy={busy} busyText="Haritalanıyor… (kaynak başına ~20 sn)" cost={b.buildCost(readyN)} err={err}>
        Kaynaklardaki <b>kişi, olay ve kurumları</b> metindeki ilişkilerle birbirine bağlayan bir kavram haritası çizer; maddeye dokununca sayfası,
        çizgiye dokununca kaynak cümlesi açılır. Kaynak başına 1 yapay zekâ kullanımı harcar; sonuç saklanır.
      </EmptyTool>
    );
  }
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">{cm.nodes.length} madde · {cm.edges.length} ilişki</p>
        <RefreshBtn stat={b.stat} note={b.note} busy={busy} onClick={build} small />
      </div>
      <ErrNote err={err} className="mb-2" />
      <ConceptMap nodes={cm.nodes} edges={cm.edges} height={Math.max(420, Math.min(720, 300 + cm.nodes.length * 8))} />
      {at && <p className="mt-1 text-xs text-text-secondary">Oluşturma: {new Date(at).toLocaleDateString("tr-TR")}</p>}
    </>
  );
}

/* ---------------- Zaman çizelgesi ---------------- */
type TEvent = { date: string; year: number; month: number; day: number; title: string; detail: string;
  kind: string; page: number | null; document_id: string; document_title: string };
const TKIND_LABEL: Record<string, string> = { savas: "Savaş", antlasma: "Antlaşma", siyasi: "Siyasi", kisisel: "Kişisel", diger: "Diğer" };
const TKIND_DOT: Record<string, string> = { savas: "bg-red-500", antlasma: "bg-amber-500", siyasi: "bg-accent-purple", kisisel: "bg-sky-500", diger: "bg-text-secondary" };

export function TimelineTab({ id, readyN, confirm }: { id: string; readyN: number; confirm: Confirm }) {
  const router = useRouter();
  const b = useBudget(id, "timeline", confirm);
  const [events, setEvents] = useState<TEvent[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err>(null);
  const [kind, setKind] = useState("");
  const [doc, setDoc] = useState("");
  useEffect(() => {
    (async () => {
      try { const r = await api(`/collections/${id}/timeline`); setEvents(r?.events || []); setAt(r?.generated_at || null); }
      catch { setEvents([]); }
    })();
  }, [id]);
  async function build() {
    setBusy(true); setErr(null);
    try {
      const r = await b.run((force) => api(`/collections/${id}/timeline${force ? "?force=1" : ""}`, { method: "POST" }, 1));
      if (!r) return;
      setEvents(r?.events || []); setAt(r?.generated_at || null);
      if (!(r?.events || []).length) setErr({ text: "Kaynaklarda tarihli olay bulunamadı.", limit: false });
    } catch (e) { setErr(toErr(e, "Zaman çizelgesi oluşturulamadı; birazdan tekrar dene.")); if (events === null) setEvents([]); }
    finally { setBusy(false); }
  }
  if (events === null) return <p className="text-sm text-text-secondary">Yükleniyor…</p>;
  if (!events.length) {
    return (
      <EmptyTool Icon={Clock} action={build} busy={busy} busyText="Çıkarılıyor… (kaynak başına ~15 sn)" cost={b.buildCost(readyN)} err={err}>
        Bu defterdeki tüm kaynaklardan <b>tarihli olayları</b> çıkarıp tek bir kronolojik çizgiye dizer; her olaydan kaynak sayfasına gidersin.
        Kaynak başına 1 yapay zekâ kullanımı harcar; tarih içermeyen kaynaklarda sonuç az olabilir.
      </EmptyTool>
    );
  }
  const evs = events.filter((e) => !kind || e.kind === kind).filter((e) => !doc || e.document_id === doc);
  const docsIn = Array.from(new Map(events.map((e) => [e.document_id, e.document_title])).entries());
  const byYear: Record<string, TEvent[]> = {};
  for (const e of evs) (byYear[e.year] ||= []).push(e);
  const years = Object.keys(byYear).map(Number).sort((a, c) => a - c);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {([["", "Tümü"], ["savas", "Savaş"], ["antlasma", "Antlaşma"], ["siyasi", "Siyasi"], ["kisisel", "Kişisel"], ["diger", "Diğer"]] as const).map(([k, label]) => {
            const n = k ? events.filter((e) => e.kind === k).length : events.length;
            if (k && n === 0) return null;
            return (
              <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
                      className={cx("flex min-h-[36px] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
                        kind === k ? "bg-accent-purple/15 font-semibold text-text-primary" : "border bg-surface text-text-secondary hover:border-accent-purple/50")}>
                {k && <span className={cx("h-2 w-2 rounded-full", TKIND_DOT[k])} />}{label} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        {docsIn.length > 1 && (
          <select value={doc} onChange={(e) => setDoc(e.target.value)} aria-label="Kaynağa göre süz" className="min-h-[36px] rounded-lg border bg-surface px-2.5 py-1.5 text-xs">
            <option value="">Tüm kaynaklar</option>
            {docsIn.map(([did, t]) => <option key={did} value={did}>{t}</option>)}
          </select>
        )}
        <span className="ml-auto"><RefreshBtn stat={b.stat} note={b.note} busy={busy} onClick={build} small /></span>
      </div>
      <ErrNote err={err} className="mt-2" />
      <div className="relative mt-6 pl-6">
        <div className="absolute bottom-0 left-[9px] top-0 w-px bg-black/15 dark:bg-white/15" />
        {years.map((y) => (
          <div key={y} className="relative mb-7">
            <div className="absolute -left-6 top-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-accent-purple bg-surface" />
            <div className="mb-2 font-heading text-2xl text-accent-purple">{y}</div>
            <div className="space-y-2">
              {byYear[y].map((e, i) => (
                <div key={i} className="rounded-xl border bg-surface p-3">
                  <div className="flex items-start gap-2.5">
                    <span className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", TKIND_DOT[e.kind] || TKIND_DOT.diger)} title={TKIND_LABEL[e.kind] || e.kind} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs text-text-secondary">{e.date}</span>
                        <h4 className="font-medium">{e.title}</h4>
                      </div>
                      {e.detail && <p className="mt-1 text-sm leading-relaxed text-text-secondary">{e.detail}</p>}
                      <button onClick={() => router.push("/documents/" + e.document_id + (e.page ? "?page=" + e.page : ""))}
                              className="mt-2 min-h-[32px] max-w-full truncate rounded-full border bg-surface px-2 py-0.5 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                        {e.document_title}{e.page ? " · s." + e.page : ""}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {evs.length === 0 && <p className="text-sm text-text-secondary">Filtreyle eşleşen olay yok.</p>}
      </div>
      {at && <p className="mt-2 text-xs text-text-secondary">Oluşturma: {new Date(at).toLocaleDateString("tr-TR")}</p>}
    </>
  );
}
