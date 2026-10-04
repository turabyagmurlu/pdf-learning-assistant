"use client";
/**
 * Defter sayfasi. Sekme ve acik sohbet adreste tutulur (?tab=, &chat=); geri tusu sekmeler arasinda calisir.
 * 3 sekme: Kaynaklar · Sor · Çalışma notu; "Daha fazla ▾" (≤5): Sözlük, Sesli özet, [Konuya göre grupla ⚡1 — ≥3 kaynak], Dışa aktar, Defteri sil.
 * Kapağı düzenle: başlıktaki kapak rozetine tıkla.
 * Parcalar: tabs.tsx (sekme seridi + kilitler + Daha fazla), ChatTab (Ajan S), components/studynote/StudyNote (Ajan N),
 * ExtractTabs (Sözlük), LectureTab (Sesli özet, Ajan V), useUploader, components/AddSourceDialog.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { StudyNoteProps } from "@/components/studynote/StudyNote";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen, Loader2, Pencil, Check, Plus, X, Trash2, Download, Palette,
  RefreshCw, Tags, Link2, MessageSquare, StickyNote, Library,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { docHref } from "@/lib/links";
import { topicColor } from "@/lib/palette";
import { ACCEPT, LIMIT_HINT } from "@/lib/sources";
import { YoutubeIcon } from "@/components/YoutubeAdd";
import SourceIcon, { sourceTint, sourceLabel } from "@/components/SourceIcon";
import { useRefreshOn } from "@/components/Wake";
import { useConfirm } from "@/components/Confirm";
import { toast } from "@/components/Toast";
import NotebookSearch from "@/components/NotebookSearch";
import CoverPicker, { CoverBadge } from "@/components/CoverPicker";
import { Skeleton, CardSkeleton } from "@/components/Skeleton";
import AddSourceDialog, { AddSegment, PRIVACY_NOTE } from "@/components/AddSourceDialog";
import { ErrNote, Err, toErr } from "@/components/CostBadge";
import { usePoll } from "@/hooks/usePoll";
import { TabBar, LockedPanel, TabKey, MoreAction, parseTab, lockReason } from "./tabs";
import ChatTab, { Sugg, Turn } from "./ChatTab";
import { GlossaryTab } from "./ExtractTabs";
import LectureTab from "./LectureTab";
import { useUploader } from "./useUploader";
import { waitInfo } from "./stage";

const Loading = () => <Skeleton className="h-64 w-full rounded-2xl" />;
// Çalışma notu (Ajan N): <StudyNote scope={{kind:"collection", id}} />
const StudyNote = dynamic<StudyNoteProps>(() => import("@/components/studynote/StudyNote"), { ssr: false, loading: Loading });

type Doc = {
  id: string; title: string; status: string; page_count?: number | null;
  short_summary?: string | null; category?: string | null; source_type?: string | null;
  processing_stage?: string | null; progress_done?: number | null; progress_total?: number | null;
  error_message?: string | null;
};
type Prog = { page: number; numPages: number; pct: number };

// Konu rengi lib/palette.ts'den (TS-6): topicColor(i) → { bar, tint }. Tur rengi yalniz ikon/etikette (SourceIcon).

function cx(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(" "); }
const isProc = (d: Doc) => d.status !== "ready" && d.status !== "failed";
function scrollTop() {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}

function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-8">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-9 w-56" />
      <Skeleton className="mt-2 h-3 w-40" />
      <div className="mt-6"><CardSkeleton n={3} /></div>
    </div>
  );
}

export default function Page({ params }: { params: { id: string } }) {
  return <Suspense fallback={<PageSkeleton />}><CollectionPage id={params.id} /></Suspense>;
}

function CollectionPage({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname() || `/collections/${id}`;
  const sp = useSearchParams();
  const tab: TabKey = parseTab(sp?.get("tab"));
  const chatId = sp?.get("chat") || null;
  // Okuyucudan "Tüm deftere sor" (?tab=sor&q=...): soru kutusuna on-dolgu; adresten hemen silinir
  const [prefillQ, setPrefillQ] = useState<string | null>(() => sp?.get("q") || null);

  const [data, setData] = useState<any>(null);
  const [loadErr, setLoadErr] = useState("");
  const { confirm, dialog: confirmDialog, wasChecked } = useConfirm();

  /* ---------- adres: sekme + sohbet ---------- */
  function urlWith(mut: (p: URLSearchParams) => void) {
    const p = new URLSearchParams(sp?.toString() || "");
    mut(p);
    const qs = p.toString();
    return pathname + (qs ? "?" + qs : "");
  }
  function setTab(k: TabKey) {
    if (k === tab) return;
    router.push(urlWith((p) => { if (k === "kaynaklar") p.delete("tab"); else p.set("tab", k); }), { scroll: false });
  }
  const setTabRef = useRef(setTab);
  setTabRef.current = setTab;
  function setChatUrl(cid: string | null) {
    if ((cid || null) === chatId) return;
    router.replace(urlWith((p) => { if (cid) p.set("chat", cid); else p.delete("chat"); }), { scroll: false });
  }
  const [visited, setVisited] = useState<Set<TabKey>>(() => new Set([tab]));
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);
  useEffect(() => {
    if (sp?.get("q")) router.replace(urlWith((p) => p.delete("q")), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- veri ---------- */
  const prevStatus = useRef<Record<string, string> | null>(null);
  const hasData = useRef(false);
  async function load(): Promise<any> {
    try {
      const d = await api(`/collections/${id}`);
      // Hazir olan / hazirlanamayan kaynak icin bildirim (ilk yuklemede degil)
      const prev = prevStatus.current;
      const next: Record<string, string> = {};
      for (const x of (d?.documents || []) as Doc[]) {
        next[x.id] = x.status;
        const was = prev?.[x.id];
        if (prev && was && was !== "ready" && was !== "failed") {
          const t = (x.title || "Kaynak").slice(0, 50);
          if (x.status === "ready") toast(`“${t}” hazır — soru sorabilirsin`, { action: { label: "Soru sor", run: () => setTabRef.current("sor") } });
          else if (x.status === "failed") toast.error(`“${t}” hazırlanamadı; kartındaki “Yeniden işle” ile tekrar dene.`);
        }
      }
      prevStatus.current = next;
      hasData.current = true;
      setData(d);
      setLoadErr("");
      return d;
    } catch (e: any) {
      // Veri zaten ekrandaysa sayfayi silme; yalniz ilk acilista hata goster
      if (!hasData.current) setLoadErr(e?.message || "Defter açılamadı; bağlantını kontrol edip tekrar dene.");
      throw e;
    }
  }
  useEffect(() => { load().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  useRefreshOn(() => { load().catch(() => {}); });

  const docs: Doc[] = data?.documents || [];
  const readyN = docs.filter((d) => d.status === "ready").length;
  const processingN = docs.filter(isProc).length;
  const readyKey = docs.filter((d) => d.status === "ready").map((d) => d.id).sort().join(",");

  // Islenen kaynak varken durum yoklamasi (sekme gizliyken/cevrimdisiyken durur, aralik uzar)
  usePoll(async () => {
    const d = await load();
    return !((d?.documents || []) as Doc[]).some(isProc);
  }, { active: processingN > 0, base: 3000, max: 15000 });

  // Sekme başlığı: ?tab= / &chat= değişiminde Next kök başlığa dönebiliyor → her adres değişiminde yeniden yaz
  useEffect(() => {
    if (!data?.collection?.title) return;
    const t = `${data.collection.title} · TY PDF`;
    document.title = t;
    const h = setTimeout(() => { if (document.title !== t) document.title = t; }, 60);
    return () => clearTimeout(h);
  }, [data?.collection?.title, tab, chatId]);

  /* ---------- yukleme + kaynak ekleme ---------- */
  const uploader = useUploader(id, async () => { await load().catch(() => {}); });
  const [addOpen, setAddOpen] = useState(false);
  const [addSeg, setAddSeg] = useState<AddSegment>("dosya");
  const openAdd = (s: AddSegment = "dosya") => { setAddSeg(s); setAddOpen(true); };
  const emptyUpRef = useRef<HTMLInputElement>(null);
  const [upDrag, setUpDrag] = useState(false);

  async function reprocessDoc(docId: string) {
    try { await api("/documents/" + docId + "/reprocess", { method: "POST" }, 1); toast("Yeniden işleniyor"); }
    catch (e: any) { toast.error(e?.message || "Yeniden işlenemedi; tekrar dene."); }
    load().catch(() => {});
  }
  async function removeFromCollection(docId: string) {
    // Kaynak silinmez (Kütüphane'de ve diger defterlerde kalir); onay yerine "Geri al".
    const d = docs.find((x) => x.id === docId);
    try {
      await api(`/collections/${id}/documents/${docId}`, { method: "DELETE" }, 1);
      await load().catch(() => {});
      toast(`“${(d?.title || "Kaynak").slice(0, 40)}” bu defterden çıkarıldı; Kütüphane'de duruyor`, {
        action: { label: "Geri al", run: async () => {
          try { await api(`/collections/${id}/documents`, { method: "POST", body: JSON.stringify({ document_ids: [docId] }) }, 1); await load().catch(() => {}); toast("Geri alındı"); }
          catch { toast.error("Geri alınamadı; kaynağı “Kaynak ekle › Kütüphaneden seç” ile yeniden ekleyebilirsin."); }
        } },
      });
    } catch (e: any) { toast.error(e?.message || "Kaynak defterden çıkarılamadı; tekrar dene."); }
  }

  /* ---------- sohbet onerileri (Sor) ---------- */
  const [sugg, setSugg] = useState<Sugg | null>(null);
  const [suggBusy, setSuggBusy] = useState(false);
  const suggKey = useRef("");
  async function loadSuggestions(refresh = false) {
    setSuggBusy(true);
    suggKey.current = readyKey;
    try {
      const r = await api(`/collections/${id}/suggestions${refresh ? "?refresh=1" : ""}`);
      setSugg({ theme: r.theme || "", groups: r.groups || [], source: r.source || "ai" });
    } catch (e) {
      const er = toErr(e, "Soru önerileri alınamadı.");
      if (er?.limit) toast.info(er.text);
      setSugg((s) => s || { theme: "", groups: [], source: "hata" });
    } finally { setSuggBusy(false); }
  }
  useEffect(() => {
    if (readyN === 0 || suggBusy) return;
    if (tab !== "sor") return;
    if (sugg === null || suggKey.current !== readyKey) loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, readyKey]);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);

  /* ---------- çalışma notu ---------- */
  // Sohbet cevabı → çalışma notunun sonuna (sunucuda atomik); sekme açılınca StudyNote güncel notu çeker.
  async function answerToDraft(t: Turn) {
    try {
      await api(`/collections/${id}/draft/blocks`, { method: "POST", body: JSON.stringify({ blocks: [{ type: "answer", q: t.q, text: t.answer.trim(),
        sources: (t.sources || []).map((s: any) => ({ title: s.title, page: s.page ?? null, document_id: s.document_id })) }] }) }, 1);
      setTab("not");
      toast("Cevap çalışma notunun sonuna eklendi");
    } catch (e) {
      toast.error(errorMessage(e, "Çalışma notuna eklenemedi. Birkaç saniye sonra tekrar dene."));
    }
  }
  // "Karşılaştır" artık ayrı sekme değil: Sor'da hazır soru olarak sorulur.
  const compareAsk = (q: string) => { setPendingAsk(`Kaynaklarım şu konuda ne diyor; nerede uyuşuyor, nerede çelişiyor? ${q}`.trim()); setTab("sor"); scrollTop(); };

  /* ---------- konu gruplari ---------- */
  type TopicGroup = { label: string; description: string; docs: string[] };
  const [topics, setTopics] = useState<{ groups: TopicGroup[] } | null>(null);
  const [grouped, setGrouped] = useState(false);
  const [topicsBusy, setTopicsBusy] = useState(false);
  const [topicsErr, setTopicsErr] = useState<Err>(null);
  useEffect(() => { try { setGrouped(localStorage.getItem("typdf-group") === "1"); } catch {} }, []);
  async function loadTopics(refresh = false) {
    setTopicsBusy(true); setTopicsErr(null);
    try { setTopics(await api(`/collections/${id}/topics${refresh ? "?refresh=1" : ""}`)); }
    catch (e) { setTopicsErr(toErr(e, "Kaynaklar gruplanamadı; birazdan tekrar dene.")); }
    finally { setTopicsBusy(false); }
  }
  useEffect(() => {
    if (tab === "kaynaklar" && grouped && readyKey.split(",").filter(Boolean).length >= 3 && !topicsBusy) loadTopics();
    /* eslint-disable-line */ }, [tab, grouped, readyKey]);

  /* ---------- okuma ilerlemesi (okuyucu localStorage'a yazar) ---------- */
  const [prog, setProg] = useState<Record<string, Prog>>({});
  useEffect(() => {
    const out: Record<string, Prog> = {};
    for (const d of docs) {
      try { const raw = localStorage.getItem("reader.prog." + d.id); if (raw) { const p = JSON.parse(raw); if (p && typeof p.pct === "number") out[d.id] = p; } } catch {}
    }
    setProg(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /* ---------- baslik ---------- */
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  async function saveTitle() {
    const t = newTitle.trim();
    if (!t || t === data?.collection?.title) { setRenaming(false); return; }
    try {
      await api(`/collections/${id}`, { method: "PATCH", body: JSON.stringify({ title: t }) }, 1);
      setRenaming(false); load().catch(() => {});
    } catch (e: any) { toast.error(e?.message || "Defter adı değiştirilemedi; tekrar dene."); }
  }
  const [coverOpen, setCoverOpen] = useState(false);

  /* ---------- yapiskan sekme seridi ---------- */
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const check = () => { const el = tabBarRef.current; setStuck(!!el && el.getBoundingClientRect().bottom < 0); };
    check();
    window.addEventListener("scroll", check, { passive: true, capture: true });
    window.addEventListener("resize", check);
    return () => { window.removeEventListener("scroll", check, { capture: true } as any); window.removeEventListener("resize", check); };
  }, [!!data]);

  if (loadErr && !data) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12 text-center">
        <p className="text-danger" role="alert">{loadErr}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={() => { setLoadErr(""); load().catch(() => {}); }} className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm text-white">
            <RefreshCw size={15} /> Tekrar dene
          </button>
          <Link href="/notebooks" className="flex min-h-[44px] items-center rounded-xl border px-4 text-sm">Defterlere dön</Link>
        </div>
      </div>
    );
  }
  if (!data) return <PageSkeleton />;

  const col = data.collection;
  const st = data.stats || {};
  const overall = docs.length ? Math.round(docs.reduce((s, d) => s + (prog[d.id]?.pct || 0), 0) / docs.length) : 0;
  const why = lockReason(tab, readyN, processingN);

  async function deleteNotebook() {
    const n = docs.length;
    const losses = ["Defter; sohbetleri, sözlüğü ve sesli özetiyle çöp kutusuna gider"];
    if (st.draft_words) losses.unshift(`Çalışma notundaki ${st.draft_words} kelime de defterle birlikte taşınır`);
    const ok = await confirm({
      title: `“${col.title}” defteri silinsin mi?`,
      description: "Çöp kutusuna taşınır; 30 gün içinde geri alabilirsin. Sonra kalıcı olarak silinir.",
      losses,
      keeps: n > 0 ? [`Kutuyu işaretlemezsen ${n} kaynağın silinmez; Kütüphane'de ve varsa diğer defterlerinde kalır`] : undefined,
      checkbox: n > 0 ? "Yalnız bu deftere ait kaynakları da çöp kutusuna taşı. Başka defterlerde de olan kaynaklar korunur." : undefined,
      confirmLabel: "Çöp kutusuna taşı", danger: true,
    });
    if (!ok) return;
    const withSources = n > 0 && wasChecked();
    try { await api("/collections/" + id + (withSources ? "?with_sources=1" : ""), { method: "DELETE" }, 1); toast("Defter çöp kutusuna taşındı", { action: { label: "Geri al", run: () => { api("/trash/collection/" + id + "/restore", { method: "POST" }, 1).then(() => { window.dispatchEvent(new Event("typdf:trash-changed")); router.push("/collections/" + id); }).catch(() => toast.error("Geri alınamadı")); } } }); window.dispatchEvent(new Event("typdf:trash-changed")); router.push("/notebooks"); }
    catch (e: any) { toast.error(e?.message || "Defter silinemedi; tekrar dene."); }
  }

  /* ---------- "Daha fazla ▾" eylemleri (Sözlük · Sesli özet görünümleri + en çok 3 eylem = ≤5 madde) ----------
   * Konuya göre grupla: sunucu konu gruplarını kaynak kümesi değişmedikçe saklar → ⚡1 yalnız ilk üretimde;
   * sonrası ücretsiz aç/kapa. 3'ten az hazır kaynakta madde hiç gösterilmez (pasif madde kalabalığı yok).
   * Kapağı düzenle: başlıktaki kapak rozetine tıklanır (menüde değil). */
  const toggleGroup = () => { const v = !grouped; setGrouped(v); try { localStorage.setItem("typdf-group", v ? "1" : "0"); } catch {} if (v && !topics) loadTopics(); };
  const savedTopics = (() => { try { const t = typeof col.topics === "string" ? JSON.parse(col.topics) : col.topics; return Array.isArray(t?.groups) ? t.groups.length : 0; } catch { return 0; } })();
  const topicsReady = !!(topics?.groups?.length || savedTopics);
  const moreActions: MoreAction[] = [
    ...(readyN >= 3 ? [{
      key: "group", label: grouped ? "Konu gruplarını gizle" : "Konuya göre grupla", Icon: Tags,
      cost: !topicsReady && !grouped ? 1 : undefined,
      hint: !topicsReady && !grouped ? "⚡1 · yalnız ilk kez; kaynaklar değişmedikçe bir daha harcamaz" : "Ücretsiz · kaynak kartları konu rengine göre dizilir",
      run: toggleGroup,
    } as MoreAction] : []),
    { key: "export", label: "Dışa aktar", Icon: Download,
      hint: st.draft_words || st.notes ? "Çalışma notunu Markdown / Word olarak indir" : "Çalışma notu henüz boş; önce bir vurgu ya da not ekle",
      run: () => { (window as unknown as { __typdfExportAt?: number }).__typdfExportAt = Date.now(); setTab("not"); setTimeout(() => window.dispatchEvent(new CustomEvent("typdf:studynote-export")), 350); } },
    { key: "delete", label: "Defteri sil", Icon: Trash2, danger: true, run: deleteNotebook },
  ];

  /* ---------- kaynak karti ---------- */
  const topicOf: Record<string, { label: string; i: number }> = {};
  (topics?.groups || []).forEach((g, i) => g.docs.forEach((x) => { topicOf[x] = { label: g.label, i }; }));
  const renderCard = (d: Doc) => {
    const p = prog[d.id];
    const kind = d.source_type || "pdf";
    const tp = topicOf[d.id];
    const w = isProc(d) ? waitInfo(d) : null;
    return (
      <div key={d.id} className="lift group relative flex flex-col overflow-hidden rounded-xl border bg-surface hover:border-accent-purple/40 focus-within:border-accent-purple/60">
        {/* Kartin tamami tek dugme (ic ice etkilesimli oge yok); diger dugmeler ustte */}
        <button type="button" onClick={() => router.push(docHref(d.id, { from: id }))} aria-label={`${d.title} · aç`}
                className="absolute inset-0 z-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-purple" />
        <div className={cx("pointer-events-none relative flex h-16 items-end justify-between px-3 pb-2", tp ? topicColor(tp.i).tint : sourceTint(kind))}>
          <SourceIcon kind={kind} size={30} className="absolute right-3 top-2.5 opacity-25" />
          <span className="flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-xs font-medium text-text-primary">
            <SourceIcon kind={kind} size={12} /> {sourceLabel(kind, d.page_count)}
          </span>
          {d.status === "failed" ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-500/15 dark:text-red-300">hazırlanamadı</span>
          ) : w ? (
            <span className="rounded-full bg-surface/90 px-2 py-0.5 text-xs text-text-primary">{w.pct !== null ? `%${w.pct}` : "hazırlanıyor"}</span>
          ) : p && p.pct >= 95 ? (
            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-800 dark:text-green-300">okundu</span>
          ) : null}
        </div>
        <button onClick={() => removeFromCollection(d.id)}
                aria-label={`“${d.title}” kaynağını bu defterden çıkar`} title="Bu defterden çıkar (Kütüphane'de kalır)"
                className="absolute right-1 top-1 z-10 flex h-10 w-10 items-center justify-center rounded-lg bg-surface/85 text-text-secondary transition hover:text-danger md:h-8 md:w-8 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
          <X size={15} />
        </button>
        <div className="pointer-events-none relative flex flex-1 flex-col px-3 pb-3 pt-2.5">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug">{d.title}</h3>
          {tp ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary">
              <span className={cx("h-1.5 w-1.5 rounded-full", topicColor(tp.i).bar)} />{tp.label}
            </p>
          ) : d.short_summary ? (
            <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{d.short_summary}</p>
          ) : null}
          {w && <p className="mt-1.5 text-xs text-text-secondary">{w.label}{w.eta ? ` · ${w.eta}` : ""}</p>}
          {d.status === "failed" && (
            <div className="mt-1.5 text-xs text-red-800 dark:text-red-300">
              <p className="line-clamp-2">{d.error_message || "Bu kaynak hazırlanamadı."}</p>
              <button onClick={() => reprocessDoc(d.id)}
                      className="pointer-events-auto relative z-10 mt-1 flex min-h-[36px] items-center gap-1 rounded-md border border-red-300 px-2 hover:bg-red-50 dark:border-red-500/40 dark:hover:bg-red-500/10">
                <RefreshCw size={12} /> Yeniden işle
              </button>
            </div>
          )}
          <div className="mt-auto pt-2.5">
            <div className="h-1 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className={cx("h-full rounded-full transition-all", w ? "bg-accent-purple/60" : tp ? topicColor(tp.i).bar : "bg-accent-purple")}
                   style={{ width: (w ? (w.pct ?? 15) : (p?.pct || 0)) + "%" }} />
            </div>
            {!w && p && p.pct > 0 && p.pct < 95 && <p className="mt-1 text-xs text-text-secondary">%{p.pct} · s.{p.page}/{p.numPages}</p>}
          </div>
        </div>
      </div>
    );
  };
  const grid = (list: Doc[]) => <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map(renderCard)}</div>;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-8">
      {/* Tek "Geri": ust cubuk/menudeki BackButton (layout). Sayfa ici ikinci "← Defterler" kaldirildi (T-3). */}

      {/* başlık */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {/* Kapak rozeti = "Kapağı düzenle" (Daha fazla menüsünde değil; üzerine gelince kalem belirir) */}
            <button type="button" onClick={() => setCoverOpen(true)} aria-label="Kapağı düzenle: renk ve simge" title="Kapağı düzenle"
                    className="group/cover relative shrink-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-purple">
              <CoverBadge id={col.id} color={col.cover_color} icon={col.cover_icon} size={40} className="md:h-12 md:w-12" />
              <span aria-hidden className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border bg-surface text-text-secondary shadow-soft transition md:opacity-0 md:group-hover/cover:opacity-100 md:group-focus-visible/cover:opacity-100">
                <Palette size={11} />
              </span>
            </button>
            {renaming ? (
              <div className="flex items-center gap-1.5">
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} aria-label="Defter adı"
                       onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setRenaming(false); }}
                       autoFocus className="min-w-0 rounded-lg border bg-surface px-2 py-1 font-heading text-2xl outline-none focus:border-accent-purple" />
                <button onClick={saveTitle} aria-label="Adı kaydet"
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-strong/60 bg-surface text-text-primary hover:bg-surface-hover"><Check size={16} /></button>
              </div>
            ) : (
              <h1 className="line-clamp-2 min-w-0 break-words font-heading text-[28px] leading-[1.08] tracking-tight sm:text-[30px] md:text-[40px] md:leading-[1.05]">{col.title}</h1>
            )}
            {!renaming && (
              <button onClick={() => { setNewTitle(col.title || ""); setRenaming(true); }} aria-label="Defteri yeniden adlandır"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-black/5"><Pencil size={15} /></button>
            )}
          </div>
          {/* Tek satır bilgi (şerit, istatistik kartları ve "Sıradaki adım" 3.0'da kalktı) */}
          <p className="mt-1 text-sm text-text-secondary">
            {st.documents ?? docs.length} kaynak{topics?.groups?.length ? ` · ${topics.groups.length} konu` : ""} · {st.pages || 0} sayfa
            {docs.length > 0 ? ` · %${overall} okundu` : ""}{st.notes ? ` · ${st.notes} vurgu` : ""}
            {processingN > 0 ? ` · ${processingN} kaynak hazırlanıyor` : ""}
          </p>
        </div>
        <CoverPicker open={coverOpen} onClose={() => setCoverOpen(false)} id={String(col.id)} title={col.title || ""}
                     color={col.cover_color} icon={col.cover_icon}
                     onSaved={(c, i) => setData((d: any) => d ? { ...d, collection: { ...d.collection, cover_color: c, cover_icon: i } } : d)} />
      </div>

      {/* sekmeler; kaydirinca ustte sabit ince serit */}
      <div ref={tabBarRef} className="mt-6">
        <TabBar tab={tab} onTab={setTab} readyN={readyN} processing={processingN} moreActions={moreActions} />
      </div>
      {stuck && (
        <div className="fixed inset-x-0 top-[calc(max(env(safe-area-inset-top),8px)+53px)] z-20 border-b bg-surface/95 backdrop-blur md:left-[var(--sidebar-w,224px)] md:top-0">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 md:px-6">
            <button onClick={scrollTop} className="hidden shrink-0 truncate font-heading text-lg md:block md:max-w-[220px]" title="Başa dön">{col.title}</button>
            <div className="min-w-0 flex-1">
              <TabBar compact tab={tab} onTab={setTab} readyN={readyN} processing={processingN} moreActions={moreActions} />
            </div>
          </div>
        </div>
      )}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-4">
        {why ? (
          <LockedPanel reason={why} onAdd={() => openAdd("dosya")}>
            {processingN > 0 && (
              <ul className="mt-3 space-y-1 text-left text-xs text-text-secondary">
                {docs.filter(isProc).slice(0, 3).map((d) => { const w = waitInfo(d); return (
                  <li key={d.id} className="truncate">• “{d.title}”: {w.label}{w.eta ? ` · ${w.eta}` : ""}</li>
                ); })}
              </ul>
            )}
          </LockedPanel>
        ) : null}

        {/* KAYNAKLAR */}
        {tab === "kaynaklar" && (
          <div>
            {readyN > 0 && <NotebookSearch collectionId={id} readyCount={readyN} />}
            {docs.length === 0 ? (
              <div onDragOver={(e) => { e.preventDefault(); setUpDrag(true); }} onDragLeave={() => setUpDrag(false)}
                   onDrop={(e) => { e.preventDefault(); setUpDrag(false); uploader.upload(e.dataTransfer.files); }}
                   className={cx("rounded-2xl border-2 border-dashed px-5 py-10 text-center transition", upDrag ? "border-accent-purple bg-accent-purple/5" : "border-border")}>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-purple/10 text-accent-purple">
                  {uploader.busy ? <Loader2 size={22} className="animate-spin" /> : <BookOpen size={22} />}
                </div>
                <h3 className="mt-3 font-heading text-xl" aria-live="polite">{uploader.busy ? `Yükleniyor… ${uploader.busy.done}/${uploader.busy.total}` : "İlk kaynağını ekle"}</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm text-text-secondary">
                  Dosyayı buraya bırak ya da bir link yapıştır. Hazır olunca ona soru sorabilirsin.
                </p>
                <input ref={emptyUpRef} type="file" accept={ACCEPT} multiple hidden
                       onChange={(e) => { uploader.upload(e.target.files); if (emptyUpRef.current) emptyUpRef.current.value = ""; }} />
                <div className="mx-auto mt-5 grid max-w-md grid-cols-3 gap-2.5">
                  {([
                    ["Dosya", "PDF, Word, Excel…", Plus, () => emptyUpRef.current?.click()],
                    ["Link", "Web sayfası, PDF linki", Link2, () => openAdd("link")],
                    ["YouTube", "Video dökümü", YoutubeIcon, () => openAdd("link")],
                  ] as const).map(([t, d, Icon, fn]) => (
                    <button key={t} onClick={fn} disabled={!!uploader.busy && t === "Dosya"}
                            className="lift flex min-h-[88px] flex-col items-center gap-1 rounded-xl border bg-surface px-2 py-3.5 hover:border-accent-purple/50 disabled:opacity-60">
                      <Icon size={19} className="text-accent-purple" />
                      <span className="text-sm font-medium">{t}</span>
                      <span className="text-xs text-text-secondary">{d}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
                  <button onClick={() => openAdd("metin")} className="flex min-h-[40px] items-center gap-1 text-text-secondary underline-offset-2 hover:text-accent-purple hover:underline">
                    <StickyNote size={14} /> Metin yapıştır
                  </button>
                  <button onClick={() => openAdd("kutuphane")} className="flex min-h-[40px] items-center gap-1 text-text-secondary underline-offset-2 hover:text-accent-purple hover:underline">
                    <Library size={14} /> Kütüphane'den seç
                  </button>
                </div>
                <p className="mx-auto mt-2 max-w-md text-xs text-text-secondary">{LIMIT_HINT}. {PRIVACY_NOTE}</p>
                {uploader.error && (
                  <div className="mx-auto mt-3 max-w-md rounded-xl border border-danger/30 bg-danger/5 p-3 text-left text-sm">
                    <p role="alert" className="text-danger">{uploader.error.text}</p>
                    <div className="mt-2 flex gap-2">
                      {uploader.error.retry.length > 0 && (
                        <button onClick={() => { const r = uploader.error?.retry || []; uploader.upload(r); }}
                                className="min-h-[36px] rounded-lg border px-3 hover:bg-surface-muted">Tekrar dene</button>
                      )}
                      <button onClick={uploader.clearError} className="min-h-[36px] rounded-lg px-3 text-text-secondary hover:bg-surface-muted">Kapat</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border bg-surface-muted/40 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-text-secondary">{docs.length} kaynak{uploader.busy ? ` · yükleniyor ${uploader.busy.done}/${uploader.busy.total}` : ""}</p>
                  <button onClick={() => openAdd("dosya")}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border bg-surface px-3 text-sm font-medium text-text-primary hover:border-accent-purple/50">
                    <Plus size={15} className="text-accent-purple" /> Kaynak ekle
                  </button>
                </div>
                {uploader.error && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm">
                    <p role="alert" className="min-w-0 flex-1 text-danger">{uploader.error.text}</p>
                    {uploader.error.retry.length > 0 && (
                      <button onClick={() => { const r = uploader.error?.retry || []; uploader.upload(r); }} className="min-h-[36px] rounded-lg border px-3 hover:bg-surface-muted">Tekrar dene</button>
                    )}
                    <button onClick={uploader.clearError} aria-label="Hata mesajını kapat" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted"><X size={15} /></button>
                  </div>
                )}
                {/* Konu gruplama (⚡ yalnız ilk kez): düğme "Daha fazla ▾" menüsünde; burada yalnız durum/hata */}
                {readyN >= 3 && grouped && (topicsBusy || topicsErr) && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    {topicsBusy && <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden /> Kaynaklar konulara ayrılıyor…</span>}
                    <ErrNote err={topicsErr} className="w-full text-xs" />
                  </div>
                )}
                {(() => {
                  if (!grouped || !topics?.groups?.length) {
                    return <>{grouped && topicsBusy && <p className="mb-2 text-xs text-text-secondary">Kaynaklar konulara ayrılıyor…</p>}{grid(docs)}</>;
                  }
                  const byId: Record<string, Doc> = Object.fromEntries(docs.map((d) => [d.id, d]));
                  const used = new Set<string>();
                  const sections = topics.groups.map((g) => {
                    const list = g.docs.map((x) => byId[x]).filter(Boolean);
                    list.forEach((d) => used.add(d.id));
                    return { ...g, list };
                  }).filter((g) => g.list.length);
                  const rest = docs.filter((d) => !used.has(d.id));
                  if (rest.length) sections.push({ label: "Yeni / gruplanmamış", description: "Son gruplamadan sonra eklenenler ya da hazır olmayanlar", docs: [], list: rest });
                  return (
                    <div className="space-y-5">
                      {sections.map((g, gi) => (
                        <section key={gi} aria-label={g.label}>
                          <div className="mb-2 flex flex-wrap items-baseline gap-2">
                            <h4 className="text-sm font-semibold text-text-primary">{g.label}</h4>
                            <span className="text-xs text-text-secondary">{g.list.length} kaynak{g.description ? " · " + g.description : ""}</span>
                          </div>
                          {grid(g.list)}
                        </section>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* SOR: bir kez acildiktan sonra bagli kalir (gecmis, yazilan soru korunur). Icerik Ajan S'nin (ChatTab). */}
        {visited.has("sor") && readyN > 0 && (
          <div hidden={tab !== "sor"}>
            <ChatTab id={id} colTitle={col.title} readyN={readyN} active={tab === "sor"}
                     chatId={chatId} setChatUrl={setChatUrl}
                     sugg={sugg} suggBusy={suggBusy} loadSuggestions={loadSuggestions}
                     pendingAsk={pendingAsk} onPendingDone={() => setPendingAsk(null)}
                     prefill={prefillQ} onPrefillDone={() => setPrefillQ(null)}
                     onToDraft={answerToDraft} onAsked={() => {}}
                     onCompare={compareAsk} />
          </div>
        )}

        {/* ÇALIŞMA NOTU (Ajan N): ders notu + biriktirilenler; defter kapsamı */}
        {tab === "not" && (
          <StudyNote scope={{ kind: "collection", id }} onOpenPage={(docId: string, page?: number | null) => router.push(docHref(docId, { page: page ?? null, from: id }))} />
        )}

        {/* Daha fazla ▾ → Sözlük */}
        {tab === "sozluk" && !why && <GlossaryTab id={id} readyN={readyN} confirm={confirm} />}

        {/* Daha fazla ▾ → SESLİ ÖZET (Ajan V): bir kez acildiktan sonra bagli kalir (ses baska sekmede de calmaya devam eder) */}
        {visited.has("sesli") && readyN > 0 && (
          <div hidden={tab !== "sesli"}>
            <LectureTab id={id} title={col.title} readyN={readyN} confirm={confirm} />
          </div>
        )}
      </div>

      {/* Mobil: yuzen "Sor" dugmesi (alt menunun ustunde; bildirimler bunun da ustunde) */}
      {tab !== "sor" && readyN > 0 && (
        <button onClick={() => { setTab("sor"); scrollTop(); }} aria-label="Kaynaklarına sor"
                className="fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent-purple text-white shadow-medium active:scale-95 md:hidden"
                style={{ bottom: "calc(var(--bottom-nav, 64px) + var(--mini-player-h, 0px) + 12px)" }}>
          <MessageSquare size={22} />
        </button>
      )}

      <AddSourceDialog open={addOpen} onClose={() => setAddOpen(false)} collectionId={id}
                       segment={addSeg} onSegment={setAddSeg} existingIds={docs.map((d) => d.id)}
                       onAdded={async () => { await load().catch(() => {}); }}
                       onUpload={uploader.upload} upBusy={uploader.busy} />
      {confirmDialog}
    </div>
  );
}
