"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API, getToken } from "@/lib/api";
import PodcastPlayer from "@/components/PodcastPlayer";
import { Skeleton, CardSkeleton } from "@/components/Skeleton";
import ConceptMap, { CMNode, CMEdge } from "@/components/ConceptMap";
import DraftEditor, { Block } from "@/components/DraftEditor";
import {
  BookOpen, Sparkles, FileText, ArrowLeft, PenLine,
  Loader2, Send, Pencil, Check, Headphones, Plus, X, Square, CheckSquare, Trash2,
  BookMarked, Search, RefreshCw, Clock, Share2,
} from "lucide-react";

type Doc = {
  id: string; title: string; status: string; page_count?: number | null;
  short_summary?: string | null; category?: string | null;
};
type Prog = { page: number; numPages: number; pct: number };
type GItem = {
  term: string; kind: string; definition: string;
  mentions: { document_id: string; title: string; pages: number[] }[];
};
type TEvent = {
  date: string; year: number; month: number; day: number; title: string; detail: string;
  kind: string; page: number | null; document_id: string; document_title: string;
};
const TKIND_LABEL: Record<string, string> = { savas: "Savaş", antlasma: "Antlaşma", siyasi: "Siyasi", kisisel: "Kişisel", diger: "Diğer" };
const TKIND_DOT: Record<string, string> = {
  savas: "bg-red-500", antlasma: "bg-amber-500", siyasi: "bg-accent-purple", kisisel: "bg-sky-500", diger: "bg-text-secondary",
};
const KIND_LABEL: Record<string, string> = {
  kisi: "Kişi", yer: "Yer", olay: "Olay", antlasma: "Antlaşma", kurum: "Kurum", kavram: "Kavram",
};
const KIND_STYLE: Record<string, string> = {
  kisi: "bg-accent-purple/10 text-accent-purple",
  yer: "bg-green-100 text-green-700",
  olay: "bg-red-100 text-red-700",
  antlasma: "bg-amber-100 text-amber-700",
  kurum: "bg-sky-100 text-sky-700",
  kavram: "bg-surface-muted text-text-secondary",
};

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}
function pctOf(n: number, total: number) {
  if (!total) return 0;
  return Math.round(((n || 0) / total) * 100);
}
function Legend({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cx("h-2 w-2 shrink-0 rounded-full", color)} />
      <span className="flex-1 text-text-secondary">{label}</span>
      <span className="font-medium">{n || 0}</span>
    </div>
  );
}
function Ring({ pct }: { pct: number }) {
  const r = 26, c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7"
              className="stroke-surface-muted" />
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
              className="stroke-accent-purple transition-all"
              strokeDasharray={c} strokeDashoffset={off} />
    </svg>
  );
}

export default function CollectionPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"raf" | "sor" | "taslak" | "sozluk" | "harita" | "zaman" | "ders">("raf");

  // Kavram haritasi
  const [cm, setCm] = useState<{ nodes: CMNode[]; edges: CMEdge[] } | null>(null);
  const [cmAt, setCmAt] = useState<string | null>(null);
  const [cmBusy, setCmBusy] = useState(false);
  const [cmErr, setCmErr] = useState("");
  async function loadMap() {
    try { const r = await api(`/collections/${id}/concept-map`); setCm({ nodes: r?.nodes || [], edges: r?.edges || [] }); setCmAt(r?.generated_at || null); }
    catch { setCm({ nodes: [], edges: [] }); }
  }
  useEffect(() => { if (tab === "harita" && cm === null) loadMap(); }, [tab]);
  async function buildMap() {
    setCmBusy(true); setCmErr("");
    try {
      const r = await api(`/collections/${id}/concept-map`, { method: "POST" });
      setCm({ nodes: r?.nodes || [], edges: r?.edges || [] }); setCmAt(r?.generated_at || null);
      if (!(r?.nodes || []).length) setCmErr("Harita için madde bulunamadı.");
    } catch (e: any) { setCmErr(e?.message || "Harita oluşturulamadı."); if (cm === null) setCm({ nodes: [], edges: [] }); }
    finally { setCmBusy(false); }
  }

  // Zaman cizelgesi
  const [tEvents, setTEvents] = useState<TEvent[] | null>(null);
  const [tAt, setTAt] = useState<string | null>(null);
  const [tBusy, setTBusy] = useState(false);
  const [tErr, setTErr] = useState("");
  const [tKind, setTKind] = useState("");
  const [tDoc, setTDoc] = useState("");
  async function loadTimeline() {
    try { const r = await api(`/collections/${id}/timeline`); setTEvents(r?.events || []); setTAt(r?.generated_at || null); }
    catch { setTEvents([]); }
  }
  useEffect(() => { if (tab === "zaman" && tEvents === null) loadTimeline(); }, [tab]);
  async function buildTimeline() {
    setTBusy(true); setTErr("");
    try {
      const r = await api(`/collections/${id}/timeline`, { method: "POST" });
      setTEvents(r?.events || []); setTAt(r?.generated_at || null);
      if (!(r?.events || []).length) setTErr("Belgelerde tarihli olay bulunamadı.");
    } catch (e: any) { setTErr(e?.message || "Zaman çizelgesi oluşturulamadı."); if (tEvents === null) setTEvents([]); }
    finally { setTBusy(false); }
  }

  // Sozluk (kisiler & kavramlar)
  const [gItems, setGItems] = useState<GItem[] | null>(null);
  const [gAt, setGAt] = useState<string | null>(null);
  const [gBusy, setGBusy] = useState(false);
  const [gErr, setGErr] = useState("");
  const [gQ, setGQ] = useState("");
  const [gKind, setGKind] = useState("");

  // Sesli ders
  const [lecBusy, setLecBusy] = useState(false);
  const [lecture, setLecture] = useState("");
  const [lecErr, setLecErr] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string>("");
  const [prog, setProg] = useState<Record<string, Prog>>({});

  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  // sohbet (kaynakli)
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [thread, setThread] = useState<{ q: string; answer: string; sources: any[] }[]>([]);

  // taslak (blok editor): Sohbet'ten gelen bloklar kuyrukta bekler
  const [inbox, setInbox] = useState<Block[]>([]);
  const [material, setMaterial] = useState<any[] | null>(null);
  function answerToDraft(t: { q: string; answer: string; sources: any[] }) {
    setInbox((q) => [...q, { id: Math.random().toString(36).slice(2, 10), type: "answer", q: t.q, text: t.answer.trim(),
      sources: (t.sources || []).map((s: any) => ({ title: s.title, page: s.page ?? null, document_id: s.document_id })) }]);
    setTab("taslak");
  }
  async function loadMaterial() {
    try { const all = await api("/notes"); setMaterial((all || []).filter((n: any) => n.collection_id === id)); }
    catch { setMaterial([]); }
  }
  useEffect(() => { if (tab === "taslak" && material === null) loadMaterial(); }, [tab]);

  // belge ekleme (kutuphaneden sec)
  const [picker, setPicker] = useState(false);
  const [allDocs, setAllDocs] = useState<Doc[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [addBusy, setAddBusy] = useState(false);
  const [pickQ, setPickQ] = useState("");

  async function openPicker() {
    setPicker(true); setPicked({}); setPickQ(""); setAllDocs(null);
    try { setAllDocs((await api("/documents")) as Doc[]); } catch { setAllDocs([]); }
  }
  async function addPicked() {
    const ids = Object.keys(picked).filter((k) => picked[k]);
    if (!ids.length) { setPicker(false); return; }
    setAddBusy(true);
    try {
      await Promise.all(ids.map((docId) =>
        api("/documents/" + docId, { method: "PATCH", body: JSON.stringify({ collection_id: id }) })
      ));
      setPicker(false);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Belgeler eklenemedi.");
    } finally { setAddBusy(false); }
  }
  async function removeFromCollection(docId: string) {
    try {
      await api("/documents/" + docId, { method: "PATCH", body: JSON.stringify({ collection_id: "" }) });
      await load();
    } catch {}
  }

  async function load() {
    try {
      const d = await api(`/collections/${id}`);
      setData(d);
      setNewTitle(d?.collection?.title || "");
    } catch (e: any) {
      setErr(e?.message || "Defter açılamadı.");
    }
  }
  useEffect(() => { load(); }, [id]);

  // okuma ilerlemesi (reader localStorage'a yazar)
  useEffect(() => {
    const docs: Doc[] = data?.documents || [];
    if (!docs.length) return;
    const out: Record<string, Prog> = {};
    for (const d of docs) {
      try {
        const raw = localStorage.getItem("reader.prog." + d.id);
        if (raw) {
          const p = JSON.parse(raw);
          if (p && typeof p.pct === "number") out[d.id] = p;
        }
      } catch {}
    }
    setProg(out);
  }, [data]);

  async function ask() {
    const question = q.trim();
    if (question.length < 3) return;
    setAsking(true); setQ("");
    try {
      const r = await api(`/collections/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) });
      setThread((t) => [...t, { q: question, answer: r.answer, sources: r.sources || [] }]);
    } catch (e: any) {
      setThread((t) => [...t, { q: question, answer: e?.message || "Cevap alınamadı.", sources: [] }]);
    } finally { setAsking(false); }
  }

  async function loadGlossary() {
    try {
      const r = await api(`/collections/${id}/glossary`);
      setGItems(r?.items || []); setGAt(r?.generated_at || null);
    } catch { setGItems([]); }
  }
  useEffect(() => { if (tab === "sozluk" && gItems === null) loadGlossary(); }, [tab]);

  async function buildGlossary() {
    setGBusy(true); setGErr("");
    try {
      const r = await api(`/collections/${id}/glossary`, { method: "POST" });
      setGItems(r?.items || []); setGAt(r?.generated_at || null);
      if (!(r?.items || []).length) setGErr("Belgelerden madde çıkarılamadı.");
    } catch (e: any) {
      setGErr(e?.message || "Sözlük oluşturulamadı.");
      if (gItems === null) setGItems([]);
    } finally { setGBusy(false); }
  }

  const [audioUrl, setAudioUrl] = useState("");
  const [audioReady, setAudioReady] = useState(false); // onbellekte ses var mi
  const LEC_KEY = "lecture.text." + id;
  const AUDIO_KEY = "/typdf-audio/lecture/" + id;

  function stopAudio() {
    try { if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = ""; } } catch {}
    setAudioUrl(""); setPlaying(false);
  }
  useEffect(() => () => { stopAudio(); }, []);

  // ders metni ve ses onbellegini yukle (sayfaya donunce yeniden uretmeye gerek yok)
  useEffect(() => {
    try { const t = localStorage.getItem(LEC_KEY); if (t) setLecture(t); } catch {}
    (async () => {
      try {
        if (!("caches" in window)) return;
        const c = await caches.open("typdf-audio");
        const hit = await c.match(AUDIO_KEY);
        setAudioReady(!!hit);
      } catch {}
    })();
  }, [id]);

  async function makeLecture() {
    setLecBusy(true); setLecErr(""); setLecture(""); stopAudio(); setAudioReady(false);
    try {
      const r = await api(`/collections/${id}/lecture`, { method: "POST" });
      const s = r.script || "";
      setLecture(s);
      try { localStorage.setItem(LEC_KEY, s); localStorage.removeItem("lecture.pos." + id); } catch {}
      try { if ("caches" in window) { const c = await caches.open("typdf-audio"); await c.delete(AUDIO_KEY); } } catch {}
    } catch (e: any) {
      setLecErr(e?.message || "Ders oluşturulamadı.");
    } finally { setLecBusy(false); }
  }

  async function playLecture() {
    if (!lecture) return;
    setAudioBusy(true); setLecErr(""); stopAudio();
    try {
      let blob: Blob | null = null;
      // 1) onbellek
      try {
        if ("caches" in window) {
          const c = await caches.open("typdf-audio");
          const hit = await c.match(AUDIO_KEY);
          if (hit) blob = await hit.blob();
        }
      } catch {}
      // 2) uret
      if (!blob) {
        const res = await fetch(`${API}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
          body: JSON.stringify({ text: lecture.slice(0, 5500) }),
        });
        if (!res.ok) throw new Error("Seslendirme yapılamadı.");
        blob = await res.blob();
        try {
          if ("caches" in window) {
            const c = await caches.open("typdf-audio");
            await c.put(AUDIO_KEY, new Response(blob, { headers: { "Content-Type": blob.type || "audio/mpeg" } }));
            setAudioReady(true);
          }
        } catch {}
      }
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      setAudioUrl(url); setPlaying(true);
    } catch (e: any) {
      setLecErr(e?.message || "Seslendirme yapılamadı.");
    } finally { setAudioBusy(false); }
  }

  async function saveTitle() {
    const t = newTitle.trim();
    if (!t) { setRenaming(false); return; }
    try {
      await api(`/collections/${id}`, { method: "PATCH", body: JSON.stringify({ title: t }) });
      setRenaming(false); load();
    } catch { setRenaming(false); }
  }

  if (err) return <div className="p-8 text-danger">{err}</div>;
  if (!data) return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-8">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-9 w-56" />
      <Skeleton className="mt-2 h-3 w-40" />
      <div className="mt-6"><CardSkeleton n={3} /></div>
    </div>
  );

  const col = data.collection;
  const docs: Doc[] = data.documents || [];
  const st = data.stats || {};
  const studio = data.studio || {};
  const glist: GItem[] = gItems || [];
  const read = docs.filter((d) => (prog[d.id]?.pct || 0) >= 95).length;
  const overall = docs.length
    ? Math.round(docs.reduce((s, d) => s + (prog[d.id]?.pct || 0), 0) / docs.length)
    : 0;
  // kalan sayfa ve tahmini süre (~1.5 dk/sayfa)
  const remainingPages = docs.reduce((s, d) => {
    const total = d.page_count || 0;
    const done = Math.round((total * (prog[d.id]?.pct || 0)) / 100);
    return s + Math.max(0, total - done);
  }, 0);
  const mins = Math.round(remainingPages * 1.5);
  const etaText = mins >= 60 ? `${Math.round(mins / 60)} saat` : `${mins} dk`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-8">
      <button onClick={() => router.push("/notebooks")}
              className="mb-4 flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent-purple">
        <ArrowLeft size={15} /> Defterler
      </button>

      {/* başlık */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen size={22} className="shrink-0 text-accent-purple" />
            {renaming ? (
              <div className="flex items-center gap-1.5">
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); }}
                       autoFocus
                       className="rounded-lg border bg-surface px-2 py-1 font-heading text-2xl outline-none" />
                <button onClick={saveTitle} aria-label="Kaydet"
                        className="rounded-md bg-accent-purple p-1.5 text-white"><Check size={15} /></button>
              </div>
            ) : (
              <h1 className="truncate font-heading text-[34px] leading-[1.05] tracking-tight md:text-[40px]">{col.title}</h1>
            )}
            {!renaming && (
              <button onClick={() => setRenaming(true)} aria-label="Yeniden adlandır"
                      className="rounded-md p-1 text-text-secondary hover:bg-black/5"><Pencil size={14} /></button>
            )}
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            {st.documents} kaynak · {st.pages || 0} sayfa · {st.notes || 0} not
          </p>
        </div>
        <button
          onClick={async () => {
            const n = docs.length;
            const msg = n > 0
              ? `"${col.title}" defterini silmek istiyor musun?\n\nİçindeki ${n} kaynak silinmez, deftersiz kalır.`
              : `"${col.title}" defterini silmek istiyor musun?`;
            if (!window.confirm(msg)) return;
            try { await api("/collections/" + id, { method: "DELETE" }); router.push("/notebooks"); }
            catch (e: any) { setErr(e?.message || "Silinemedi."); }
          }}
          title="Defteri sil" aria-label="Defteri sil"
          className="shrink-0 rounded-lg border px-3 py-1.5 text-sm text-text-secondary hover:border-danger/50 hover:text-danger">
          <Trash2 size={15} />
        </button>
      </div>

      {/* DASHBOARD */}
      {docs.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* okuma halkası */}
          <div className="rounded-2xl border bg-surface p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Okuma</p>
            <div className="flex items-center gap-4">
              <Ring pct={overall} />
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-none">%{overall}</p>
                <p className="mt-1 text-xs text-text-secondary">{read}/{docs.length} belge bitti</p>
                {remainingPages > 0 && (
                  <p className="mt-1.5 text-xs text-text-secondary">
                    ~{remainingPages} sayfa kaldı · yaklaşık {etaText}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* notlar & taslak */}
          <div className="rounded-2xl border bg-surface p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Notlar & taslak</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold">{st.notes || 0}</span>
              <span className="text-sm text-text-secondary">not / vurgu</span>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {st.draft_words > 0 ? `Taslak: ${st.draft_words} kelime` : "Taslak henüz boş"}
            </p>
            <button onClick={() => setTab("taslak")}
                    className="mt-3 w-full rounded-xl bg-accent-purple px-3 py-2 text-sm text-white">
              {st.draft_words > 0 ? "Taslağa devam et" : "Yazmaya başla"}
            </button>
          </div>

          {/* studyo durumu */}
          <div className="rounded-2xl border bg-surface p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Stüdyo</p>
            <div className="space-y-1.5 text-sm">
              {([["sozluk", "Sözlük", studio.glossary], ["harita", "Harita", studio.concept_map], ["zaman", "Zaman çizelgesi", studio.timeline]] as const).map(([k, label, ok]) => (
                <button key={k} onClick={() => setTab(k)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-surface-muted">
                  <span>{label}</span>
                  <span className={cx("text-xs", ok ? "text-success" : "text-text-secondary")}>{ok ? "hazır" : "oluşturulmadı"}</span>
                </button>
              ))}
              <button onClick={() => setTab("ders")} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-surface-muted">
                <span>Sesli özet</span><span className="text-xs text-text-secondary">{lecture ? "hazır" : "—"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* sekmeler */}
      <div className="mt-6 flex gap-1 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {([["raf", "Kaynaklar", FileText], ["sor", "Sohbet", Sparkles], ["taslak", "Taslak", PenLine],
           ["sozluk", "Sözlük", BookMarked], ["harita", "Harita", Share2], ["zaman", "Zaman", Clock],
           ["ders", "Sesli özet", Headphones]] as const).map(
          ([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k as any)}
                    className={cx("flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm md:px-4",
                      tab === k ? "border-b-2 border-accent-purple text-accent-purple" : "text-text-secondary")}>
              <Icon size={15} /> {label}
            </button>
          ))}
      </div>

      {/* RAF */}
      {tab === "raf" && (
        <div className="mt-5">
          {docs.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center">
              <p className="text-text-secondary">
                Bu defter boş. Kütüphanendeki kaynakları buraya ekle.
              </p>
              <button onClick={openPicker}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2 text-sm text-white">
                <Plus size={15} /> Kaynak ekle
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border bg-surface-muted/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-text-secondary">{docs.length} kaynak</p>
                <button onClick={openPicker}
                        className="inline-flex items-center gap-1.5 rounded-lg border bg-surface px-3 py-1.5 text-sm text-accent-purple hover:border-accent-purple/50">
                  <Plus size={15} /> Kaynak ekle
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {docs.map((d) => {
                  const p = prog[d.id];
                  return (
                    <div key={d.id} role="button" tabIndex={0}
                         onClick={() => router.push("/documents/" + d.id)}
                         onKeyDown={(e) => { if (e.key === "Enter") router.push("/documents/" + d.id); }}
                         className="lift group relative cursor-pointer rounded-xl border bg-surface p-4 hover:border-accent-purple/40">
                      <button onClick={(e) => { e.stopPropagation(); removeFromCollection(d.id); }}
                              aria-label="Bu defterden çıkar" title="Bu defterden çıkar"
                              className="absolute right-2 top-2 rounded-md p-1 text-text-secondary hover:bg-surface-muted hover:text-danger">
                        <X size={14} />
                      </button>
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 h-10 w-1.5 shrink-0 rounded-full bg-accent-purple/70" />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate pr-6 text-sm font-medium">{d.title}</h3>
                          {d.short_summary && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{d.short_summary}</p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className={cx("rounded-full px-2 py-0.5",
                              d.status === "ready" ? "bg-green-100 text-green-700" : "bg-surface-muted text-text-secondary")}>
                              {d.status === "ready" ? "Hazır" : "İşleniyor"}
                            </span>
                            {d.page_count ? (
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-text-secondary">
                                {d.page_count} sayfa
                              </span>
                            ) : null}
                          </div>
                          {p && p.pct > 0 && (
                            <div className="mt-2">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                                <div className="h-full rounded-full bg-accent-purple" style={{ width: p.pct + "%" }} />
                              </div>
                              <p className="mt-1 text-[11px] text-text-secondary">
                                %{p.pct} · s.{p.page}/{p.numPages}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* KONUYA SOR */}
      {tab === "sor" && (
        <div className="mt-5 max-w-3xl">
          {thread.length === 0 && !asking && (
            <p className="mb-3 text-sm text-text-secondary">
              Soru sor; <b>{col.title}</b> defterindeki {st.documents} kaynağın tamamında arayıp atıflı cevaplayayım.
              Beğendiğin cevabı tek tuşla taslağa alırsın.
            </p>
          )}
          <div className="space-y-4">
            {thread.map((t, i) => (
              <div key={i} className="fade-in">
                <p className="mb-1.5 text-sm font-medium">{t.q}</p>
                <div className="rounded-2xl border bg-surface p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.answer}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                    {t.sources.map((s: any, j: number) => (
                      <button key={j} onClick={() => router.push("/documents/" + s.document_id + (s.page ? "?page=" + s.page : ""))}
                              className="rounded-full border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                        [K{j + 1}] {s.title} · s.{s.page}
                      </button>
                    ))}
                    <button onClick={() => answerToDraft(t)}
                            className="ml-auto flex items-center gap-1 rounded-full border border-accent-purple/40 bg-accent-purple/5 px-2.5 py-1 text-xs text-accent-purple">
                      <PenLine size={12} /> Taslağa ekle
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {asking && <p className="text-sm text-text-secondary">Kaynaklar taranıyor…</p>}
          </div>
          <div className="sticky bottom-20 mt-5 flex gap-2 md:bottom-4">
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                   placeholder={thread.length ? "Devam et…" : "Örn: Bu kaynaklar Enver Paşa'nın Anadolu'ya girişini nasıl anlatıyor?"}
                   className="flex-1 rounded-xl border bg-surface px-3 py-2.5 text-sm shadow-sm outline-none focus:border-accent-purple" />
            <button onClick={ask} disabled={asking}
                    className="flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2.5 text-sm text-white disabled:opacity-60">
              {asking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Sor
            </button>
          </div>
        </div>
      )}

      {/* TASLAK: blok editor */}
      {tab === "taslak" && (
        <div className="mt-5">
          <DraftEditor notebookId={id} title={col.title} initial={col.draft}
                       material={material} onReloadMaterial={loadMaterial}
                       inbox={inbox} onInboxConsumed={() => setInbox([])}
                       onSaved={(ser) => setData((d: any) => d ? { ...d, collection: { ...d.collection, draft: ser } } : d)} />
        </div>
      )}

      {/* SOZLUK: kisiler ve kavramlar */}
      {tab === "sozluk" && (
        <div className="mt-5">
          {gItems === null ? (
            <p className="text-sm text-text-secondary">Yükleniyor…</p>
          ) : gItems.length === 0 ? (
            <div className="max-w-3xl rounded-2xl border border-dashed p-8 text-center">
              <BookMarked size={28} className="mx-auto text-accent-purple" />
              <p className="mt-3 text-sm text-text-secondary">
                Kitaptaki tüm belgelerden <b>kişi, yer, olay, antlaşma, kurum ve kavramları</b> çıkarır;
                her biri için kısa açıklama ve hangi belgede hangi sayfada geçtiğini gösterir.
              </p>
              <button onClick={buildGlossary} disabled={gBusy}
                      className="mx-auto mt-4 flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2 text-sm text-white disabled:opacity-60">
                {gBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {gBusy ? "Çıkarılıyor… (belge başına ~15 sn)" : "Sözlüğü oluştur"}
              </button>
              {gErr && <p className="mt-3 text-sm text-danger">{gErr}</p>}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border bg-surface px-3">
                  <Search size={15} className="text-text-secondary" />
                  <input value={gQ} onChange={(e) => setGQ(e.target.value)} placeholder="Ara: ad, kavram, açıklama…"
                         className="w-full bg-transparent py-2 text-sm outline-none" />
                </div>
                <button onClick={buildGlossary} disabled={gBusy} title="Belgeler değiştiyse yeniden çıkar"
                        className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm text-text-secondary hover:border-accent-purple/50 disabled:opacity-60">
                  {gBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Yenile
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {([["", "Tümü"], ["kisi", "Kişi"], ["yer", "Yer"], ["olay", "Olay"], ["antlasma", "Antlaşma"],
                   ["kurum", "Kurum"], ["kavram", "Kavram"]] as const).map(([k, label]) => {
                  const n = k ? glist.filter((g) => g.kind === k).length : glist.length;
                  if (k && n === 0) return null;
                  return (
                    <button key={k} onClick={() => setGKind(k)}
                            className={cx("rounded-full px-2.5 py-1 text-xs",
                              gKind === k ? "bg-accent-purple/15 text-accent-purple" : "border bg-surface text-text-secondary hover:border-accent-purple/50")}>
                      {label} <span className="opacity-60">{n}</span>
                    </button>
                  );
                })}
                {gAt && <span className="ml-auto self-center text-[11px] text-text-secondary">{new Date(gAt).toLocaleDateString("tr-TR")}</span>}
              </div>

              {(() => {
                const q = gQ.trim().toLowerCase();
                const list = glist
                  .filter((g) => !gKind || g.kind === gKind)
                  .filter((g) => !q || g.term.toLowerCase().includes(q) || g.definition.toLowerCase().includes(q));
                if (!list.length) return <p className="mt-6 text-sm text-text-secondary">Eşleşen madde yok.</p>;
                // harf gruplari
                const groups: Record<string, typeof list> = {};
                for (const g of list) {
                  const ch = (g.term[0] || "#").toLocaleUpperCase("tr-TR");
                  (groups[ch] ||= []).push(g);
                }
                const keys = Object.keys(groups).sort((a, b) => a.localeCompare(b, "tr"));
                return (
                  <div className="mt-4 space-y-5">
                    {keys.map((ch) => (
                      <div key={ch}>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="font-heading text-lg text-accent-purple">{ch}</span>
                          <span className="h-px flex-1 bg-black/10" />
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {groups[ch].map((g, i) => (
                            <div key={i} className="rounded-xl border bg-surface p-3">
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="font-medium">{g.term}</h4>
                                <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide", KIND_STYLE[g.kind] || KIND_STYLE.kavram)}>
                                  {KIND_LABEL[g.kind] || g.kind}
                                </span>
                              </div>
                              <p className="mt-1 text-sm leading-relaxed text-text-secondary">{g.definition}</p>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {g.mentions.map((m, j) =>
                                  (m.pages.length ? m.pages.slice(0, 4) : [0]).map((pg, k) => (
                                    <button key={j + "-" + k}
                                            onClick={() => router.push("/documents/" + m.document_id + (pg ? "?page=" + pg : ""))}
                                            title={m.title + (pg ? " · sayfa " + pg : "")}
                                            className="max-w-[200px] truncate rounded-full border bg-surface px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
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
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* KAVRAM HARITASI */}
      {tab === "harita" && (
        <div className="mt-5">
          {cm === null ? (
            <Skeleton className="h-[560px] w-full rounded-2xl" />
          ) : cm.nodes.length === 0 ? (
            <div className="max-w-3xl rounded-2xl border border-dashed p-8 text-center">
              <Share2 size={28} className="mx-auto text-accent-purple" />
              <p className="mt-3 text-sm text-text-secondary">
                Sözlükteki <b>kişi, olay, antlaşma ve kurumları</b> metindeki ilişkilerle birbirine bağlar:
                kim kimi komuta etti, kim neyi imzaladı, kim kime mektup yazdı. Düğüme tıkla → sayfa; çizgiye tıkla → kaynak cümle.
              </p>
              <button onClick={buildMap} disabled={cmBusy}
                      className="mx-auto mt-4 flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2 text-sm text-white disabled:opacity-60">
                {cmBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {cmBusy ? "Haritalanıyor… (belge başına ~20 sn)" : "Haritayı oluştur"}
              </button>
              {cmErr && <p className="mt-3 text-sm text-danger">{cmErr}</p>}
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm text-text-secondary">{cm.nodes.length} madde · {cm.edges.length} ilişki</p>
                <button onClick={buildMap} disabled={cmBusy} title="Belgeler değiştiyse yeniden çıkar"
                        className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs text-text-secondary hover:border-accent-purple/50 disabled:opacity-60">
                  {cmBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Yenile
                </button>
              </div>
              <ConceptMap nodes={cm.nodes} edges={cm.edges} height={Math.max(420, Math.min(720, 300 + cm.nodes.length * 8))} />
              {cmAt && <p className="mt-1 text-[11px] text-text-secondary">Oluşturma: {new Date(cmAt).toLocaleDateString("tr-TR")}</p>}
            </>
          )}
        </div>
      )}

      {/* ZAMAN CIZELGESI */}
      {tab === "zaman" && (
        <div className="mt-5">
          {tEvents === null ? (
            <p className="text-sm text-text-secondary">Yükleniyor…</p>
          ) : tEvents.length === 0 ? (
            <div className="max-w-3xl rounded-2xl border border-dashed p-8 text-center">
              <Clock size={28} className="mx-auto text-accent-purple" />
              <p className="mt-3 text-sm text-text-secondary">
                Kitaptaki tüm belgelerden <b>tarihli olayları</b> çıkarır, tek bir kronolojik çizgiye dizer.
                İki belge aynı dönemi anlatıyorsa olaylar iç içe geçer; her olay kaynak sayfasına tıklanır.
              </p>
              <button onClick={buildTimeline} disabled={tBusy}
                      className="mx-auto mt-4 flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2 text-sm text-white disabled:opacity-60">
                {tBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {tBusy ? "Çıkarılıyor… (belge başına ~15 sn)" : "Zaman çizelgesini oluştur"}
              </button>
              {tErr && <p className="mt-3 text-sm text-danger">{tErr}</p>}
            </div>
          ) : (() => {
            const evs = tEvents
              .filter((e) => !tKind || e.kind === tKind)
              .filter((e) => !tDoc || e.document_id === tDoc);
            const docsIn = Array.from(new Map(tEvents.map((e) => [e.document_id, e.document_title])).entries());
            const byYear: Record<string, TEvent[]> = {};
            for (const e of evs) (byYear[e.year] ||= []).push(e);
            const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
            return (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {([["", "Tümü"], ["savas", "Savaş"], ["antlasma", "Antlaşma"], ["siyasi", "Siyasi"], ["kisisel", "Kişisel"], ["diger", "Diğer"]] as const).map(([k, label]) => {
                      const n = k ? tEvents.filter((e) => e.kind === k).length : tEvents.length;
                      if (k && n === 0) return null;
                      return (
                        <button key={k} onClick={() => setTKind(k)}
                                className={cx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
                                  tKind === k ? "bg-accent-purple/15 text-accent-purple" : "border bg-surface text-text-secondary hover:border-accent-purple/50")}>
                          {k && <span className={cx("h-2 w-2 rounded-full", TKIND_DOT[k])} />}{label} <span className="opacity-60">{n}</span>
                        </button>
                      );
                    })}
                  </div>
                  {docsIn.length > 1 && (
                    <select value={tDoc} onChange={(e) => setTDoc(e.target.value)} className="rounded-lg border bg-surface px-2.5 py-1.5 text-xs">
                      <option value="">Tüm belgeler</option>
                      {docsIn.map(([did, t]) => <option key={did} value={did}>{t}</option>)}
                    </select>
                  )}
                  <button onClick={buildTimeline} disabled={tBusy} title="Belgeler değiştiyse yeniden çıkar"
                          className="ml-auto flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs text-text-secondary hover:border-accent-purple/50 disabled:opacity-60">
                    {tBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Yenile
                  </button>
                </div>

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
                                        className="mt-2 max-w-full truncate rounded-full border bg-surface px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
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
                {tAt && <p className="mt-2 text-[11px] text-text-secondary">Oluşturma: {new Date(tAt).toLocaleDateString("tr-TR")}</p>}
              </>
            );
          })()}
        </div>
      )}

      {/* SESLI DERS */}
      {tab === "ders" && (
        <div className="mt-5 max-w-3xl">
          <p className="text-sm text-text-secondary">
            Bu defterdeki {st.ready || st.documents} kaynağı tek bir akıcı sesli özete çeviririm;
            yolda dinlersin.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={makeLecture} disabled={lecBusy}
                    className="flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2.5 text-sm text-white disabled:opacity-60">
              {lecBusy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
              {lecBusy ? "Özet hazırlanıyor…" : lecture ? "Yeniden hazırla" : "Özeti hazırla"}
            </button>
            {lecture && !audioUrl && (
              <button onClick={playLecture} disabled={audioBusy}
                      className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm hover:bg-black/5 disabled:opacity-60">
                {audioBusy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
                {audioBusy ? (audioReady ? "Açılıyor…" : "Ses hazırlanıyor… (~20 sn)") : (audioReady ? "Dinle (hazır)" : "Dinle")}
              </button>
            )}
          </div>
          {lecErr && <p className="mt-3 text-sm text-danger">{lecErr}</p>}
          {audioUrl && (
            <div className="mt-4">
              <PodcastPlayer src={audioUrl} title={col.title} subtitle={`Sesli özet · ${st.ready || st.documents} belge`}
                             artwork="/icon" storageKey={"lecture.pos." + id} autoPlay />
              <p className="mt-2 text-[11px] text-text-secondary">
                Ekran kilitliyken kulaklık/bildirim tuşlarıyla kontrol edebilirsin. Kaldığın yer hatırlanır; ses cihazda saklanır, tekrar üretilmez.
              </p>
            </div>
          )}
          {lecture && (
            <details className="mt-4 rounded-2xl border bg-surface p-4" open={!audioUrl}>
              <summary className="cursor-pointer text-sm font-medium">Ders metni</summary>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{lecture}</p>
            </details>
          )}
        </div>
      )}

      {/* BELGE SECICI */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
             onClick={() => !addBusy && setPicker(false)}>
          <div onClick={(e) => e.stopPropagation()}
               className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border bg-surface sm:rounded-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-medium">Kütüphaneden kaynak ekle</h3>
              <button onClick={() => setPicker(false)} aria-label="Kapat"
                      className="rounded-md p-1 text-text-secondary hover:bg-surface-muted">
                <X size={18} />
              </button>
            </div>

            <div className="border-b px-4 py-2.5">
              <input value={pickQ} onChange={(e) => setPickQ(e.target.value)}
                     placeholder="Belge ara…"
                     className="w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-purple" />
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {allDocs === null ? (
                <p className="p-6 text-center text-sm text-text-secondary">Yükleniyor…</p>
              ) : (() => {
                const mine = new Set(docs.map((d) => d.id));
                const list = allDocs
                  .filter((d) => !mine.has(d.id))
                  .filter((d) => !pickQ.trim() || (d.title || "").toLowerCase().includes(pickQ.trim().toLowerCase()));
                if (!list.length) {
                  return (
                    <p className="p-6 text-center text-sm text-text-secondary">
                      {allDocs.length === 0
                        ? "Kütüphanende hiç kaynak yok."
                        : pickQ.trim()
                          ? "Aramayla eşleşen belge yok."
                          : "Kütüphanendeki tüm kaynaklar zaten bu defterde."}
                    </p>
                  );
                }
                return list.map((d) => {
                  const on = !!picked[d.id];
                  return (
                    <button key={d.id} onClick={() => setPicked((p) => ({ ...p, [d.id]: !on }))}
                            className={cx("flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition",
                              on ? "bg-accent-purple/10" : "hover:bg-surface-muted")}>
                      {on ? <CheckSquare size={17} className="mt-0.5 shrink-0 text-accent-purple" />
                          : <Square size={17} className="mt-0.5 shrink-0 text-text-secondary" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.title}</span>
                        {d.short_summary && (
                          <span className="mt-0.5 line-clamp-1 text-xs text-text-secondary">{d.short_summary}</span>
                        )}
                      </span>
                    </button>
                  );
                });
              })()}
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <button onClick={() => setPicker(false)} disabled={addBusy}
                      className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-muted disabled:opacity-60">
                Vazgeç
              </button>
              <button onClick={addPicked} disabled={addBusy || !Object.values(picked).some(Boolean)}
                      className="flex items-center gap-1.5 rounded-lg bg-accent-purple px-4 py-1.5 text-sm text-white disabled:opacity-50">
                {addBusy && <Loader2 size={14} className="animate-spin" />}
                {Object.values(picked).filter(Boolean).length || ""} kaynak ekle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
