"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API, getToken } from "@/lib/api";
import PodcastPlayer from "@/components/PodcastPlayer";
import BrowserVoice, { browserVoiceSupported } from "@/components/BrowserVoice";
import { stageInfo } from "@/lib/docstage";
import CitedText, { citeLoc } from "@/components/CitedText";
import YoutubeAdd from "@/components/YoutubeAdd";
import TextAdd from "@/components/TextAdd";
import DiscoverPanel from "@/components/DiscoverPanel";
import SourceIcon, { sourceColor } from "@/components/SourceIcon";
import { ACCEPT, TYPES_HINT, rejectReason } from "@/lib/sources";
import { useRefreshOn } from "@/components/Wake";
import { useConfirm } from "@/components/Confirm";
import NotebookSearch from "@/components/NotebookSearch";
import { Skeleton, CardSkeleton } from "@/components/Skeleton";
import ConceptMap, { CMNode, CMEdge } from "@/components/ConceptMap";
import DraftEditor, { Block } from "@/components/DraftEditor";
import {
  BookOpen, Sparkles, FileText, ArrowLeft, PenLine,
  Loader2, Send, Pencil, Check, Headphones, Plus, X, Square, CheckSquare, Trash2,
  BookMarked, Search, RefreshCw, Clock, Share2, Volume2,
} from "lucide-react";

type Doc = {
  id: string; title: string; status: string; page_count?: number | null;
  short_summary?: string | null; category?: string | null;
  processing_stage?: string | null; progress_done?: number | null; progress_total?: number | null;
  error_message?: string | null;
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

  // Kota bilinci: her belgenin cikarimi belgeye kaydedilir; "Yenile" yalniz yeni belgeleri isler.
  type ExtKind = "glossary" | "relations" | "timeline";
  const [extStat, setExtStat] = useState<Record<ExtKind, { cached: number; pending: number }> | null>(null);
  const [extNote, setExtNote] = useState<Record<string, string>>({});
  async function loadExtractStatus() {
    try {
      const r = await api(`/collections/${id}/extract-status`);
      const s = { glossary: r.glossary, relations: r.relations, timeline: r.timeline };
      setExtStat(s); return s;
    } catch { setExtStat(null); return null; }
  }
  useEffect(() => { if (["sozluk", "harita", "zaman"].includes(tab)) loadExtractStatus(); /* eslint-disable-line */ }, [tab]);

  /** Yenile dugmesi: kac kaynagin yeni isleneceğini soyler; hepsi hazirsa "kota harcamaz" der. */
  function RefreshBtn({ kind, busy, onClick, small }: { kind: ExtKind; busy: boolean; onClick: () => void; small?: boolean }) {
    const st = extStat?.[kind];
    const pending = st?.pending ?? 0, cached = st?.cached ?? 0;
    const label = busy ? "İşleniyor…"
      : !st ? "Yenile"
      : pending > 0 ? `${pending} yeni kaynağı işle`
      : cached > 0 ? "Yenile (kota harcamaz)"
      : "Oluştur";
    const tip = !st ? "Belgeler değiştiyse yeniden çıkar"
      : pending > 0 ? `${pending} kaynak ilk kez işlenecek (kota), ${cached} kaynak hazırdan gelir`
      : "Tüm kaynaklar daha önce işlenmiş; birleştirme kota harcamaz";
    return (
      <span className="flex items-center gap-2">
        <button onClick={onClick} disabled={busy} title={tip}
                className={cx("flex items-center gap-1.5 rounded-xl border text-text-secondary hover:border-accent-purple/50 disabled:opacity-60",
                  small ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
                  pending > 0 && "border-accent-amber/50 text-accent-amber")}>
          {busy ? <Loader2 size={small ? 13 : 14} className="animate-spin" /> : <RefreshCw size={small ? 13 : 14} />} {label}
        </button>
        {extNote[kind] && <span className="text-[11px] text-text-secondary">{extNote[kind]}</span>}
      </span>
    );
  }

  /** Yenile: yeni belge yoksa kota harcanmaz; sifirdan uretmek icin force (onayli). */
  async function refreshWithBudget(kind: ExtKind, run: (force: boolean) => Promise<any>) {
    const fresh = await loadExtractStatus();       // her seferinde guncel say
    const st = fresh?.[kind];
    const pending = st?.pending ?? 0, cached = st?.cached ?? 0;
    let force = false;
    if (pending === 0 && cached > 0) {
      const again = await confirm({
        title: "Yeni kaynak yok",
        description: `${cached} kaynağın hepsi daha önce işlenmiş. Kota harcamadan mevcut sonuçlar yeniden birleştirilir.`,
        keeps: ["Birleştir: anında, kota harcamaz (önerilen)"],
        losses: ["Sıfırdan üret: her kaynak yeniden yapay zekâya gider, günlük kotadan " + cached + " istek düşer"],
        confirmLabel: "Birleştir", cancelLabel: "Sıfırdan üret",
      });
      force = !again;      // "Sifirdan uret" secildiyse force
      if (force) {
        const ok = await confirm({
          title: `${cached} kaynak sıfırdan işlensin mi?`,
          description: "Bu, günlük yapay zekâ kotasından " + cached + " istek harcar. Sadece sonuçlardan memnun değilsen gerekli.",
          confirmLabel: "Evet, sıfırdan üret", danger: true,
        });
        if (!ok) return;
      }
    } else if (pending > 0 && cached > 0) {
      setExtNote((n) => ({ ...n, [kind]: `${cached} kaynak hazırdan, ${pending} kaynak için kota harcanıyor…` }));
    } else if (pending > 0) {
      setExtNote((n) => ({ ...n, [kind]: `${pending} kaynak işleniyor…` }));
    }
    const r = await run(force);
    setExtNote((n) => ({ ...n, [kind]: r && typeof r.cached === "number"
      ? `${r.cached} kaynak önbellekten, ${r.fresh} kaynak yeni işlendi` : "" }));
    loadExtractStatus();
    return r;
  }
  async function loadMap() {
    try { const r = await api(`/collections/${id}/concept-map`); setCm({ nodes: r?.nodes || [], edges: r?.edges || [] }); setCmAt(r?.generated_at || null); }
    catch { setCm({ nodes: [], edges: [] }); }
  }
  useEffect(() => { if (tab === "harita" && cm === null) loadMap(); }, [tab]);
  async function buildMap() {
    setCmBusy(true); setCmErr("");
    try {
      const r = await refreshWithBudget("relations", (force) =>
        api(`/collections/${id}/concept-map${force ? "?force=1" : ""}`, { method: "POST" }));
      if (!r) return;
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
      const r = await refreshWithBudget("timeline", (force) =>
        api(`/collections/${id}/timeline${force ? "?force=1" : ""}`, { method: "POST" }));
      if (!r) return;
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
  const [thread, setThread] = useState<{ q: string; answer: string; sources: any[]; followups?: string[]; cached?: boolean; cachedQ?: string }[]>([]);

  // Yonlendirici soru onerileri: kaynak ozetlerinden, kaynaklar degismedikce onbellekten (kota harcamaz)
  type SGroup = { kind: string; label: string; questions: { q: string; why: string }[] };
  const [sugg, setSugg] = useState<{ theme: string; groups: SGroup[]; source: string } | null>(null);
  const [suggBusy, setSuggBusy] = useState(false);
  const [suggOpen, setSuggOpen] = useState(true);
  async function loadSuggestions(refresh = false) {
    setSuggBusy(true);
    try {
      const r = await api(`/collections/${id}/suggestions${refresh ? "?refresh=1" : ""}`);
      setSugg({ theme: r.theme || "", groups: r.groups || [], source: r.source || "ai" });
    } catch { if (!sugg) setSugg({ theme: "", groups: [], source: "hata" }); }
    finally { setSuggBusy(false); }
  }

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
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function reprocessDoc(docId: string) {
    try { await api("/documents/" + docId + "/reprocess", { method: "POST" }); } catch {}
    load();
  }

  // Defter icinden dogrudan PDF yukleme: dosya yuklenir ve bu deftere baglanir.
  const upRef = useRef<HTMLInputElement>(null);
  const [upBusy, setUpBusy] = useState<{ done: number; total: number } | null>(null);
  const [upDrag, setUpDrag] = useState(false);
  async function uploadHere(files: FileList | File[] | null) {
    const all = Array.from(files || []);
    const bad = all.map(rejectReason).filter(Boolean) as string[];
    const list = all.filter((f) => !rejectReason(f));
    if (!list.length) { if (bad.length) setErr(bad[0]); return; }
    setUpBusy({ done: 0, total: list.length }); setErr("");
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      const fd = new FormData();
      fd.append("file", list[i]);
      fd.append("collection_id", id);
      try {
        const r = await fetch(API + "/documents", { method: "POST", headers: { Authorization: "Bearer " + getToken() }, body: fd });
        if (!r.ok) failed++;
      } catch { failed++; }
      setUpBusy({ done: i + 1, total: list.length });
    }
    setUpBusy(null); setPicker(false);
    if (failed || bad.length) setErr([failed ? `${failed} dosya yüklenemedi (bozuk olabilir ya da boyut sınırını aşıyor).` : "", ...bad].filter(Boolean).join(" "));
    await load();
  }

  // Islenen belge varken defteri tazele (ilerleme canli aksin)
  useEffect(() => {
    const list: Doc[] = data?.documents || [];
    const anyProc = list.some((d) => d.status !== "ready" && d.status !== "failed");
    if (!anyProc) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function removeFromCollection(docId: string) {
    const d = (data?.documents || []).find((x: Doc) => x.id === docId);
    const ok = await confirm({
      title: `"${d?.title || "Bu kaynak"}" defterden çıkarılsın mı?`,
      keeps: ["Kaynak silinmez; Kütüphane'de kalır ve istediğinde geri eklenebilir"],
      confirmLabel: "Defterden çıkar",
    });
    if (!ok) return;
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
  useRefreshOn(load);

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

  useEffect(() => { if (tab === "sor" && sugg === null) loadSuggestions(); /* eslint-disable-line */ }, [tab]);

  async function ask(text?: string, fresh = false) {
    const question = (text ?? q).trim();
    if (question.length < 3 || asking) return;
    setAsking(true); setQ(""); setSuggOpen(false);
    try {
      const r = await api(`/collections/${id}/ask`, { method: "POST", body: JSON.stringify({ question, fresh }) });
      let fu: string[] = (r.followups || []).map((s: string) => s.replace(/\s*\[K\s*\d+(?:\s*[,;]\s*K?\s*\d+)*\]/g, "").trim()).filter(Boolean);
      if (!fu.length && sugg?.groups?.length) {
        // Model devam sorusu vermediyse: henuz sorulmamis onerilerden 3 tane (ek kota yok)
        const asked = new Set([...thread.map((x) => x.q), question]);
        fu = sugg.groups.flatMap((g) => g.questions.map((x) => x.q)).filter((x) => !asked.has(x)).slice(0, 3);
      }
      const item = { q: question, answer: r.answer, sources: r.sources || [], followups: fu,
                     cached: !!r.cached, cachedQ: r.cached_question };
      // "Yeniden sor": ayni sorunun kayitli cevabini tazesiyle degistir
      setThread((t) => fresh && t.length && t[t.length - 1].q === question ? [...t.slice(0, -1), item] : [...t, item]);
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
      const r = await refreshWithBudget("glossary", (force) =>
        api(`/collections/${id}/glossary${force ? "?force=1" : ""}`, { method: "POST" }));
      if (!r) return;
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
  const VOICE_KEY = "lecture.voice";
  // Ses onbellegi sese gore ayrisir: kadin sesini degistirince eski kayit calmaz.
  const [voice, setVoice] = useState("");
  const [voiceList, setVoiceList] = useState<{ id: string; label: string }[]>([]);
  const AUDIO_KEY = "/typdf-audio/lecture/" + id + (voice ? "/" + voice : "");

  function stopAudio() {
    try { if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = ""; } } catch {}
    setAudioUrl(""); setPlaying(false);
  }
  useEffect(() => () => { stopAudio(); }, []);

  // ders metni ve ses onbellegini yukle (sayfaya donunce yeniden uretmeye gerek yok)
  useEffect(() => {
    try { const t = localStorage.getItem(LEC_KEY); if (t) setLecture(t); } catch {}
    try { const v = localStorage.getItem(VOICE_KEY); if (v) setVoice(v); } catch {}
    (async () => {
      try { const r = await api("/tts/voices"); setVoiceList(r.voices || []); setVoice((v) => v || r.default || ""); }
      catch {}
    })();
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        if (!("caches" in window)) { setAudioReady(false); return; }
        const c = await caches.open("typdf-audio");
        setAudioReady(!!(await c.match(AUDIO_KEY)));
      } catch { setAudioReady(false); }
    })();
  }, [AUDIO_KEY]);

  async function makeLecture(refresh = false) {
    if (refresh) {
      const ok = await confirm({
        title: "Özet sıfırdan yeniden yazılsın mı?",
        description: "Şu anki ders metni yerine yepyeni bir metin yazılır.",
        losses: ["Kayıtlı ders metni değişir",
                 "Üretilmiş ses geçersiz olur; dinlemek için yeniden üretilmesi gerekir (kota harcar)"],
        confirmLabel: "Yeniden yaz",
      });
      if (!ok) return;
    }
    setLecBusy(true); setLecErr(""); setLecture(""); stopAudio();
    setUseBrowserVoice(false); setQuotaOut(false);
    if (refresh) setAudioReady(false);
    try {
      const path = `/collections/${id}/lecture` + (refresh ? "?refresh=1" : "");
      let r: any = null, lastErr: any = null;
      for (let attempt = 0; attempt < 3 && !r; attempt++) {
        try { if (attempt > 0) { setLecErr(`Sunucu uyanıyor, tekrar deniyorum… (${attempt + 1}/3)`); await new Promise((x) => setTimeout(x, 4000 * attempt)); }
              r = await api(path, { method: "POST" }); }
        catch (e: any) { lastErr = e; if (!/fetch|bağlan|network|502|503|504/i.test(String(e?.message))) break; }
      }
      if (!r) throw lastErr || new Error("Özet oluşturulamadı.");
      setLecErr("");
      const s = r.script || "";
      setLecture(s);
      try { localStorage.setItem(LEC_KEY, s); } catch {}
      // Metin gercekten degistiyse eski ses gecersiz; ayni metinse ses korunur.
      if (refresh) {
        try { localStorage.removeItem("lecture.pos." + id); } catch {}
        try { if ("caches" in window) { const c = await caches.open("typdf-audio"); await c.delete(AUDIO_KEY); } } catch {}
      }
    } catch (e: any) {
      setLecErr(e?.message || "Ders oluşturulamadı.");
    } finally { setLecBusy(false); }
  }

  const [audioPct, setAudioPct] = useState(0);
  const [audioNote, setAudioNote] = useState("");
  const [quotaOut, setQuotaOut] = useState(false);   // kota doldu -> tarayici sesi
  const [useBrowserVoice, setUseBrowserVoice] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);   // sunucu/istemci farki olmasin
  useEffect(() => { setCanSpeak(browserVoiceSupported()); }, []);

  // Ses ornegi: tek cumle, kisa uctan; onbelleklendigi icin ikinci kez bedava.
  const [sampling, setSampling] = useState("");
  const sampleRef = useRef<HTMLAudioElement | null>(null);
  async function sampleVoice(v: string) {
    setSampling(v); setLecErr("");
    // Ne olursa olsun buton 45 sn icinde serbest kalsin.
    const guard = setTimeout(() => setSampling(""), 45000);
    const ac = new AbortController();
    const netTimer = setTimeout(() => ac.abort(), 40000);
    try {
      const res = await fetch(`${API}/tts`, {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({ text: "Merhaba, bu defterdeki kaynakları sana bu sesle anlatacağım.", voice: v }),
      });
      clearTimeout(netTimer);
      if (!res.ok) {
        let m = "Örnek dinlenemedi.";
        try { const j = await res.json(); m = j?.error?.user_message || j?.detail || m; } catch {}
        if (res.status === 429) setQuotaOut(true);
        throw new Error(m);
      }
      const blob = await res.blob();
      if (blob.size < 1000) throw new Error("Ses verisi boş geldi; tekrar dene.");
      const url = URL.createObjectURL(blob);
      try { sampleRef.current?.pause(); } catch {}
      const a = new Audio(url); sampleRef.current = a;
      a.onended = () => URL.revokeObjectURL(url);
      // play() bazi tarayicilarda ne cozulur ne reddedilir; beklemiyoruz.
      a.play().catch(() => setLecErr("Tarayıcı sesi engelledi; sayfaya bir kez tıklayıp tekrar dene."));
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "Örnek zaman aşımına uğradı; tekrar dene."
                                           : (e?.message || "Örnek dinlenemedi.");
      setLecErr(msg);
    } finally {
      clearTimeout(netTimer); clearTimeout(guard); setSampling("");
    }
  }
  useEffect(() => () => { try { sampleRef.current?.pause(); } catch {} }, []);

  async function playLecture() {
    if (!lecture) return;
    setAudioBusy(true); setLecErr(""); setAudioPct(0); setAudioNote("");
    setQuotaOut(false); stopAudio();
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
      // 2) arka plan isi: parca parca uretilir, ilerleme gosterilir
      if (!blob) {
        const job = await api("/tts/jobs", {
          method: "POST",
          body: JSON.stringify({ text: lecture.slice(0, 12000), voice: voice || undefined }),
        });
        const jid = job.job_id;
        let st: any = job.cached ? { status: "ready", done: job.total, total: job.total } : null;
        for (let i = 0; i < 240 && (!st || st.status === "running"); i++) {   // kota beklemesiyle ~8 dk
          await new Promise((r) => setTimeout(r, 2000));
          st = await api(`/tts/jobs/${jid}`);
          if (st.total) setAudioPct(Math.round((st.done / st.total) * 100));
          setAudioNote(st.note || "");
          if (st.status === "ready") break;
          if (st.status === "error") {
            if (st.quota) setQuotaOut(true);
            const err: any = new Error(st.error || "Seslendirme başarısız.");
            err.quota = !!st.quota;
            throw err;
          }
        }
        if (!st || st.status !== "ready") throw new Error("Seslendirme çok uzun sürdü; metni kısaltıp tekrar dene.");
        const res = await fetch(`${API}/tts/jobs/${jid}/audio`, { headers: { Authorization: "Bearer " + getToken() } });
        if (!res.ok) throw new Error("Ses indirilemedi.");
        blob = await res.blob();
        try {
          if ("caches" in window) {
            const c = await caches.open("typdf-audio");
            await c.put(AUDIO_KEY, new Response(blob, { headers: { "Content-Type": blob.type || "audio/wav" } }));
            setAudioReady(true);
          }
        } catch {}
      }
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      setAudioUrl(url); setPlaying(true);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (e?.quota || /kota/i.test(msg)) setQuotaOut(true);
      setLecErr(msg || "Seslendirme yapılamadı.");
    } finally { setAudioBusy(false); setAudioPct(0); setAudioNote(""); }
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
            const losses = ["Defterin sohbeti, sözlüğü, haritası ve zaman çizelgesi silinir"];
            if (st.draft_words) losses.unshift(`Taslağındaki ${st.draft_words} kelime silinir`);
            const ok = await confirm({
              title: `"${col.title}" defteri silinsin mi?`,
              description: "Defter kalıcı olarak silinir; bu işlem geri alınamaz.",
              losses,
              keeps: n > 0 ? [`İçindeki ${n} kaynak silinmez; Kütüphane'de deftersiz kalır`] : undefined,
              confirmLabel: "Defteri sil", danger: true,
              typeToConfirm: (n > 0 || st.draft_words) ? col.title : undefined,
            });
            if (!ok) return;
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
          {docs.some((d) => d.status === "ready") && (
            <NotebookSearch collectionId={id} readyCount={docs.filter((d) => d.status === "ready").length} />
          )}
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
                        <div className={cx("mt-0.5 h-10 w-1.5 shrink-0 rounded-full bg-current opacity-70",
                          sourceColor((d as any).source_type))} />
                        <div className="min-w-0 flex-1">
                          <h3 className="flex items-center gap-1.5 truncate pr-6 text-sm font-medium">
                            {(d as any).source_type && (d as any).source_type !== "pdf" && <SourceIcon kind={(d as any).source_type} size={15} />}
                            <span className="truncate">{d.title}</span>
                          </h3>
                          {d.short_summary && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{d.short_summary}</p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className={cx("rounded-full px-2 py-0.5",
                              d.status === "ready" ? "bg-green-100 text-green-700"
                                : d.status === "failed" ? "bg-red-100 text-red-700"
                                : "bg-accent-purple/10 text-accent-purple")}>
                              {stageInfo(d).label}
                            </span>
                            {d.page_count ? (
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-text-secondary">
                                {d.page_count} sayfa
                              </span>
                            ) : null}
                          </div>
                          {d.status !== "ready" && d.status !== "failed" && (() => {
                            const st = stageInfo(d);
                            return (
                              <div className="mt-2">
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                                  <div className="h-full rounded-full bg-accent-purple transition-all" style={{ width: (st.pct ?? 15) + "%" }} />
                                </div>
                                <p className="mt-1 text-[11px] text-text-secondary">{st.pct !== null ? `%${st.pct} · ` : ""}{st.label}</p>
                              </div>
                            );
                          })()}
                          {d.status === "failed" && (
                            <div className="mt-2 text-[11px] text-red-700">
                              <p className="line-clamp-2">{(d as any).error_message || "İşleme başarısız."}</p>
                              <button onClick={(e) => { e.stopPropagation(); reprocessDoc(d.id); }}
                                      className="mt-1 flex items-center gap-1 rounded-md border border-red-300 px-2 py-0.5 hover:bg-red-50">
                                <RefreshCw size={11} /> Yeniden işle
                              </button>
                            </div>
                          )}
                          {d.status === "ready" && p && p.pct > 0 && (
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

          {/* Yonlendirici sorular: bos sohbette acik, sonra katlanir */}
          {(thread.length === 0 || suggOpen) && (
            <div className="mb-5 rounded-2xl border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Sparkles size={14} className="text-accent-purple" /> Nereden başlamalı?
                  </p>
                  {sugg?.theme && <p className="mt-0.5 text-xs text-text-secondary">{sugg.theme}</p>}
                </div>
                {thread.length > 0 && (
                  <button onClick={() => setSuggOpen(false)} aria-label="Kapat"
                          className="rounded-md p-1 text-text-secondary hover:bg-surface-muted"><X size={14} /></button>
                )}
              </div>

              {suggBusy && !sugg?.groups?.length ? (
                <div className="mt-3 space-y-2">
                  {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-surface-muted" />)}
                  <p className="text-[11px] text-text-secondary">Kaynak özetlerinden sorular hazırlanıyor…</p>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {(sugg?.groups || []).map((g) => (
                    <div key={g.kind}>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{g.label}</p>
                      <div className="flex flex-col gap-1.5">
                        {g.questions.map((s, k) => (
                          <button key={k} onClick={() => ask(s.q)} disabled={asking}
                                  title={s.why}
                                  className="group flex items-start gap-2 rounded-xl border bg-surface px-3 py-2 text-left text-sm transition hover:border-accent-purple/50 hover:bg-accent-purple/5 disabled:opacity-60">
                            <Send size={12} className="mt-1 shrink-0 text-text-secondary group-hover:text-accent-purple" />
                            <span className="min-w-0 flex-1">
                              {s.q}
                              {s.why && <span className="ml-1.5 text-[11px] text-text-secondary">· {s.why}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5 text-[11px] text-text-secondary">
                {sugg?.source === "sablon" ? (
                  <span>Yapay zekâ kotası şu an dolu; genel şablon sorular gösteriliyor.</span>
                ) : (
                  <span>Kaynak özetlerinden üretildi · kaynak ekleyince kendiliğinden yenilenir</span>
                )}
                <button onClick={() => loadSuggestions(true)} disabled={suggBusy}
                        className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-muted disabled:opacity-60">
                  {suggBusy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Başka öneriler <span className="opacity-60">(1 istek)</span>
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {thread.map((t, i) => (
              <div key={i} className="fade-in">
                <p className="mb-1.5 text-sm font-medium">{t.q}</p>
                <div className="rounded-2xl border bg-surface p-4">
                  {t.cached && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-green-500/10 px-2.5 py-1.5 text-[11px] text-green-800">
                      <span>Kayıtlı cevap · kota harcanmadı{t.cachedQ && t.cachedQ !== t.q ? ` · benzer soru: “${t.cachedQ}”` : ""}</span>
                      {i === thread.length - 1 && (
                        <button onClick={() => ask(t.q, true)} disabled={asking}
                                className="ml-auto rounded-md border border-green-700/30 px-2 py-0.5 hover:bg-green-500/10 disabled:opacity-60">
                          Yeniden sor (1 istek)
                        </button>
                      )}
                    </div>
                  )}
                  <CitedText text={t.answer} sources={t.sources}
                             onCite={(n, s) => { if (s?.document_id) router.push("/documents/" + s.document_id + (s.page ? "?page=" + s.page : "")); }} />
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                    {t.sources.map((s: any, j: number) => (
                      <button key={j} onClick={() => router.push("/documents/" + s.document_id + (s.page ? "?page=" + s.page : ""))}
                              title={`${s.title} · ${citeLoc(s)} — ${s.kind === "youtube" ? "videoda o ana git" : s.kind ? "kaynakta aç" : "PDF'te aç"}`}
                              className="rounded-full border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                        K{j + 1} · {s.title} · {citeLoc(s)}
                      </button>
                    ))}
                    <button onClick={() => answerToDraft(t)}
                            className="ml-auto flex items-center gap-1 rounded-full border border-accent-purple/40 bg-accent-purple/5 px-2.5 py-1 text-xs text-accent-purple">
                      <PenLine size={12} /> Taslağa ekle
                    </button>
                  </div>
                </div>
                {/* Devam sorulari: ayni cevapla gelir, ek kota yok */}
                {!!t.followups?.length && i === thread.length - 1 && (
                  <div className="mt-2 flex flex-col gap-1.5 pl-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">Daha derine in</p>
                    {t.followups.map((f, k) => (
                      <button key={k} onClick={() => ask(f)} disabled={asking}
                              className="group flex items-start gap-2 self-start rounded-xl border border-dashed bg-surface px-3 py-1.5 text-left text-sm text-text-secondary transition hover:border-accent-purple/50 hover:text-text-primary disabled:opacity-60">
                        <Send size={12} className="mt-1 shrink-0 group-hover:text-accent-purple" /> {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {asking && <p className="text-sm text-text-secondary">Kaynaklar taranıyor…</p>}
          </div>
          <div className="sticky bottom-20 mt-5 flex gap-2 md:bottom-4">
            {thread.length > 0 && !suggOpen && (
              <button onClick={() => { setSuggOpen(true); if (!sugg) loadSuggestions(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      title="Soru önerilerini göster" aria-label="Soru önerileri"
                      className="flex items-center justify-center rounded-xl border bg-surface px-3 text-accent-purple shadow-sm hover:border-accent-purple/50">
                <Sparkles size={16} />
              </button>
            )}
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                   placeholder={thread.length ? "Devam et…" : "Örn: Bu kaynaklar Enver Paşa'nın Anadolu'ya girişini nasıl anlatıyor?"}
                   className="flex-1 rounded-xl border bg-surface px-3 py-2.5 text-sm shadow-sm outline-none focus:border-accent-purple" />
            <button onClick={() => ask()} disabled={asking}
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
                <RefreshBtn kind="glossary" busy={gBusy} onClick={buildGlossary} />
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
                <RefreshBtn kind="relations" busy={cmBusy} onClick={buildMap} small />
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
                  <span className="ml-auto"><RefreshBtn kind="timeline" busy={tBusy} onClick={buildTimeline} small /></span>
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
            <button onClick={() => makeLecture(!!lecture)} disabled={lecBusy}
                    title={lecture ? "Özeti sıfırdan yeniden yazar; ses de yeniden üretilir." : ""}
                    className="flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2.5 text-sm text-white disabled:opacity-60">
              {lecBusy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
              {lecBusy ? "Özet hazırlanıyor…" : lecture ? "Yeniden hazırla" : "Özeti hazırla"}
            </button>
            {lecture && !audioUrl && (
              <button onClick={playLecture} disabled={audioBusy}
                      className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm hover:bg-black/5 disabled:opacity-60">
                {audioBusy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
                {audioBusy ? (audioPct > 0 ? `Ses hazırlanıyor… %${audioPct}` : "Ses hazırlanıyor…") : (audioReady ? "Dinle (hazır)" : "Dinle")}
              </button>
            )}
          </div>

          {/* Anlatıcı sesi — hepsi kadın, Türkçe */}
          {lecture && voiceList.length > 0 && (
            <div className="mt-4 rounded-2xl border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Anlatıcı sesi</span>
                <span className="text-xs text-text-secondary">· hepsi kadın sesi, doğal tonlama</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {voiceList.map((v) => (
                  <button key={v.id} onClick={() => { setVoice(v.id); try { localStorage.setItem(VOICE_KEY, v.id); } catch {} stopAudio(); }}
                          className={"rounded-xl border px-3 py-1.5 text-xs " +
                            (voice === v.id ? "border-accent-purple bg-accent-purple/10 text-accent-purple" : "hover:bg-black/5")}>
                    {v.label}
                    <span className="ml-1 opacity-60">{v.id}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => sampleVoice(voice)} disabled={!voice || !!sampling}
                        className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-60">
                  {sampling ? <Loader2 size={13} className="animate-spin" /> : <Volume2 size={13} />}
                  {sampling ? "Örnek hazırlanıyor…" : "Bu sesi dinle"}
                </button>
                <span className="text-[11px] text-text-secondary">
                  Sesi değiştirirsen ders o sesle yeniden seslendirilir; her ses ayrı saklanır.
                </span>
              </div>
            </div>
          )}

          {/* Yedek: cihazın kendi sesi. Kalitesi düşük, sadece kota bitince anlamlı. */}
          {lecture && canSpeak && !useBrowserVoice && (
            <button onClick={() => { stopAudio(); setUseBrowserVoice(true); }}
                    className="mt-3 text-xs text-text-secondary underline underline-offset-4 hover:text-text">
              Kota bittiyse cihazının kendi sesiyle dinle (robotik yedek)
            </button>
          )}
          {audioBusy && audioNote && <p className="mt-3 text-sm text-text-secondary">{audioNote}</p>}
          {lecErr && (
            <div className={"mt-3 rounded-xl px-4 py-3 text-sm " + (quotaOut ? "border border-warning/40 bg-warning/10" : "")}>
              <p className={quotaOut ? "" : "text-danger"}>{lecErr}</p>
              {quotaOut && canSpeak && (
                <button onClick={() => { setLecErr(""); setUseBrowserVoice(true); }}
                        className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent-purple px-3 py-1.5 text-white">
                  <Volume2 size={14} /> Tarayıcı sesiyle dinle
                </button>
              )}
            </div>
          )}
          {useBrowserVoice && lecture && (
            <div className="mt-4">
              <BrowserVoice text={lecture} onClose={() => setUseBrowserVoice(false)} />
            </div>
          )}
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
              <h3 className="font-medium">Kaynak ekle</h3>
              <button onClick={() => !upBusy && setPicker(false)} aria-label="Kapat"
                      className="rounded-md p-1 text-text-secondary hover:bg-surface-muted">
                <X size={18} />
              </button>
            </div>

            {/* 1) Bilgisayardan yukle -> dogrudan bu deftere */}
            <div className="border-b px-4 py-3">
              <input ref={upRef} type="file" accept={ACCEPT} multiple hidden
                     onChange={(e) => { uploadHere(e.target.files); if (upRef.current) upRef.current.value = ""; }} />
              <div onClick={() => !upBusy && upRef.current?.click()}
                   onDragOver={(e) => { e.preventDefault(); setUpDrag(true); }}
                   onDragLeave={() => setUpDrag(false)}
                   onDrop={(e) => { e.preventDefault(); setUpDrag(false); uploadHere(e.dataTransfer.files); }}
                   className={cx("flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 transition",
                     upDrag ? "border-accent-purple bg-accent-purple/10" : "border-accent-purple/40 hover:bg-accent-purple/5")}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-purple/10 text-accent-purple">
                  {upBusy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {upBusy ? `Yükleniyor… ${upBusy.done}/${upBusy.total}` : "Bilgisayardan dosya yükle"}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {upBusy ? "Dosyalar bu deftere düşer, işleme arka planda başlar." : TYPES_HINT + " · sürükle-bırak, çoklu seçim"}
                  </p>
                </div>
              </div>
            </div>

            {/* 1b) Link (YouTube / web / PDF linki), metin yapistir, web'de kaynak bul */}
            <div className="space-y-3 border-b px-4 py-3">
              <YoutubeAdd collectionId={id} onAdded={() => load()} />
              <TextAdd collectionId={id} onAdded={() => load()} />
              <DiscoverPanel collectionId={id} onAdded={() => load()} />
            </div>

            {/* 2) Kutuphaneden sec */}
            <div className="border-b px-4 py-2.5">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">ya da kütüphaneden seç</p>
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
      {confirmDialog}
    </div>
  );
}
