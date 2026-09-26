"use client";
/**
 * Kutuphane (T-1 telefon ilk ekrani):
 * - Telefonda hero yok: duz baslik + "+ Kaynak ekle"; satirda yalniz arama + "Süz (N)" + "Seç".
 *   Siralama, favoriler, tur, kategori ve etiket suzgecleri alttan acilan "Süz" tabakasinda.
 * - Defter suzgeci lg altinda listenin USTUNDE yatay cip seridi (TB-5); lg'de sag panel.
 * - Yukleme alanlari yerine tek "+ Kaynak ekle" -> components/AddSourceDialog (TK-6).
 *   Bir defter suzgeci acikken eklenen kaynak o deftere baglanir.
 * - Kartta en fazla 1 renkli rozet (hazirlaniyor / hata); "Hazır" rozeti gosterilmez.
 * - Okuma yuzdesi: GET /documents `progress_pct` varsa o (TO-1, cihazlar arasi), yoksa localStorage.
 */
import { toast } from "@/components/Toast";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import { CardSkeleton } from "@/components/Skeleton";
import PageHeader from "@/components/PageHeader";
import { etaText, stageInfo } from "@/lib/docstage";
import SourceIcon, { sourceLabel } from "@/components/SourceIcon";
import Modal from "@/components/Modal";
import AddSourceDialog, { AddSegment } from "@/components/AddSourceDialog";
import { rejectReason } from "@/lib/sources";
import { usePrivacyGate } from "@/lib/privacy";
import { useRefreshOn } from "@/components/Wake";
import { useConfirm } from "@/components/Confirm";
import { usePoll } from "@/hooks/usePoll";
import Link from "next/link";
import {
  UploadCloud, Search, Star, Trash2, Pencil, LayoutGrid, List, MoreVertical, Notebook, BookMarked, Plus, Check,
  BookOpen, RefreshCw, CheckSquare, Square, X, Loader2, SlidersHorizontal,
} from "lucide-react";

type Doc = {
  id: string; title: string; status: string; processing_stage?: string | null; source_type?: string | null;
  page_count?: number | null; short_summary?: string | null; difficulty_level?: string | null;
  key_concepts?: unknown; category?: string | null; tags?: unknown; is_favorite?: boolean;
  collection_id?: string | null; collection_ids?: string[] | null; created_at?: string;
  progress_done?: number | null; progress_total?: number | null; error_message?: string | null;
  /** TO-1: sunucudaki okuma ilerlemesi (cihazlar arasi) */
  progress_pct?: number | null;
  reading?: { page?: number | null; pct?: number | null; updated_at?: string | null } | null;
};
type Col = { id: string; title: string };
type Prog = { page: number | null; numPages: number | null; pct: number };

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const KIND_GROUP: Record<string, string> = {
  pdf: "PDF", youtube: "Video", audio: "Ses", docx: "Belge", pptx: "Belge", epub: "Belge", rtf: "Belge",
  xlsx: "Tablo", csv: "Tablo", web: "Web", html: "Web", text: "Metin", md: "Metin", txt: "Metin", image: "Görsel",
};
const KIND_ORDER = ["PDF", "Video", "Ses", "Web", "Belge", "Tablo", "Metin", "Görsel"];
type Sort = "recent" | "title" | "fav";
const SORT_LABEL: Record<Sort, string> = { recent: "En yeni", title: "Başlık (A-Z)", fav: "Favoriler önce" };

function toArr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}
/** Kaynagin bagli oldugu defterler (API: collection_ids; eski yanitta collection_id). */
function colIds(d: Doc): string[] {
  if (Array.isArray(d.collection_ids)) return d.collection_ids;
  return d.collection_id ? [d.collection_id] : [];
}
const isProcessing = (d: Doc) => d.status !== "ready" && d.status !== "failed";

/** Silme onayinda kaynak turune gore kaybolacaklar */
function deleteLosses(d?: Doc): string {
  const k = d?.source_type || "pdf";
  if (k === "youtube") return "Video dökümü, notların, vurguların ve sohbet geçmişi silinir";
  if (k === "audio") return "Ses kaydı, dökümü, notların ve sohbet geçmişi silinir";
  if (k === "web" || k === "html") return "Kaydedilen sayfa metni, notların, vurguların ve sohbet geçmişi silinir";
  if (k === "text") return "Yapıştırdığın metin, notların, vurguların ve sohbet geçmişi silinir";
  if (k === "pdf") return "PDF dosyası, vurguların, kenar notların ve sohbet geçmişi silinir";
  return "Dosya, vurguların, notların ve sohbet geçmişi silinir";
}

const VIEW_KEY = "lib.view", DENS_KEY = "lib.density", SORT_KEY = "lib.sort";

export default function LibraryPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [tag, setTag] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [kind, setKind] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [sort, setSort] = useState<Sort>("recent");
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [collections, setCollections] = useState<Col[]>([]);
  const [prog, setProg] = useState<Record<string, Prog>>({});
  const [nb, setNb] = useState("");                     // defter filtresi ("" tumu, "__none__" deftersiz)
  const [creatingNb, setCreatingNb] = useState(false);
  const [newNb, setNewNb] = useState("");
  const [nbBusy, setNbBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [nbMenu, setNbMenu] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linkFor, setLinkFor] = useState<string[] | null>(null);      // "Deftere ekle" penceresi: kaynak kimlikleri
  const [filterOpen, setFilterOpen] = useState(false);                // telefon: "Süz" tabakasi
  const [addOpen, setAddOpen] = useState(false);                      // "+ Kaynak ekle" penceresi
  const [addSeg, setAddSeg] = useState<AddSegment>("dosya");
  const [isLg, setIsLg] = useState(false);                             // >=1024: defter paneli sagda
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { gate, dialog: privacyDialog } = usePrivacyGate();
  const ids = useId();

  const colName = useMemo(() => {
    const m: Record<string, string> = {};
    collections.forEach((c) => { m[c.id] = c.title; });
    return m;
  }, [collections]);

  const reloadDocs = useCallback(async (): Promise<Doc[] | null> => {
    try {
      const d = (await api("/documents")) as Doc[];
      setDocs(d); setLoadErr("");
      return d;
    } catch (e) { setLoadErr(errorMessage(e)); return null; }
  }, []);
  const reloadCols = useCallback(async () => {
    try {
      const cs = await api("/collections");
      setCollections(((Array.isArray(cs) ? cs : []) as Col[]).map((c) => ({ id: c.id, title: c.title })));
    } catch { /* defter listesi gelmezse kenar cubugu bos kalir; kaynaklar yine gorunur */ }
  }, []);
  const reload = useCallback(async () => {
    await Promise.all([reloadDocs(), reloadCols()]);
    setLoading(false);
  }, [reloadDocs, reloadCols]);

  useEffect(() => { reload(); }, [reload]);
  useRefreshOn(reload);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsLg(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // manifest kisayolu / paylasim: /library?add=1 pencereyi acar
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("add") === "1") { setAddOpen(true); window.history.replaceState(null, "", "/library"); }
    } catch { /* yok say */ }
  }, []);

  // Islenen kaynak varken durum yoklamasi (sekme gizliyken / cevrimdisiyken durur, aralik uzar)
  const anyProc = docs.some(isProcessing);
  usePoll(async () => {
    const d = await reloadDocs();
    return !!d && !d.some(isProcessing);
  }, { active: anyProc, base: 3000, max: 15000 });

  // okuma ilerlemesi: sunucu (progress_pct / reading) once, yoksa okuyucunun localStorage kaydi
  useEffect(() => {
    if (!docs.length) return;
    const out: Record<string, Prog> = {};
    for (const d of docs) {
      let local: Prog | null = null;
      try {
        const raw = localStorage.getItem("reader.prog." + d.id);
        if (raw) {
          const p = JSON.parse(raw);
          if (p && typeof p.pct === "number") local = { page: p.page ?? null, numPages: p.numPages ?? null, pct: p.pct };
        }
      } catch { /* bozuk kayit yok sayilir */ }
      const srvPct = typeof d.progress_pct === "number" ? d.progress_pct : typeof d.reading?.pct === "number" ? d.reading.pct : null;
      if (srvPct !== null && (!local || srvPct >= local.pct)) {
        out[d.id] = { page: d.reading?.page ?? local?.page ?? null, numPages: d.page_count ?? local?.numPages ?? null, pct: Math.round(srvPct) };
      } else if (local) out[d.id] = local;
    }
    setProg(out);
  }, [docs]);
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY); if (v === "grid" || v === "list") setView(v);
      const de = localStorage.getItem(DENS_KEY); if (de === "comfortable" || de === "compact") setDensity(de);
      const s = localStorage.getItem(SORT_KEY); if (s === "recent" || s === "title" || s === "fav") setSort(s);
    } catch { /* localStorage kapali */ }
  }, []);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* yok say */ } }, [view]);
  useEffect(() => { try { localStorage.setItem(DENS_KEY, density); } catch { /* yok say */ } }, [density]);
  useEffect(() => { try { localStorage.setItem(SORT_KEY, sort); } catch { /* yok say */ } }, [sort]);

  const categories = useMemo(() => { const s = new Set<string>(); docs.forEach((d) => { if (d.category) s.add(d.category); }); return Array.from(s).sort(); }, [docs]);
  const allTags = useMemo(() => { const s = new Set<string>(); docs.forEach((d) => toArr(d.tags).forEach((t) => s.add(String(t)))); return Array.from(s).sort(); }, [docs]);
  const looseCount = useMemo(() => docs.filter((d) => colIds(d).length === 0).length, [docs]);

  const filtered = useMemo(() => {
    let list = [...docs];
    if (favOnly) list = list.filter((d) => d.is_favorite);
    if (kind) list = list.filter((d) => KIND_GROUP[d.source_type || "pdf"] === kind);
    if (cat) list = list.filter((d) => d.category === cat);
    if (tag) list = list.filter((d) => toArr(d.tags).map(String).includes(tag));
    if (nb === "__none__") list = list.filter((d) => colIds(d).length === 0);
    else if (nb) list = list.filter((d) => colIds(d).includes(nb));
    if (q.trim()) {
      const s = q.toLocaleLowerCase("tr");
      list = list.filter((d) => (d.title || "").toLocaleLowerCase("tr").includes(s) || (d.short_summary || "").toLocaleLowerCase("tr").includes(s) || toArr(d.tags).some((t) => String(t).toLocaleLowerCase("tr").includes(s)));
    }
    if (sort === "title") list.sort((a, b) => (a.title || "").localeCompare(b.title || "", "tr"));
    else if (sort === "fav") list.sort((a, b) => Number(!!b.is_favorite) - Number(!!a.is_favorite));
    return list;
  }, [docs, favOnly, cat, tag, q, sort, nb, kind]);
  const kindCounts = useMemo(() => {
    const m: Record<string, number> = {};
    docs.forEach((d) => { const g = KIND_GROUP[d.source_type || "pdf"] || "Metin"; m[g] = (m[g] || 0) + 1; });
    return m;
  }, [docs]);
  // "Süz (N)": etkin suzgec sayisi (defter suzgeci ayri seritte, sayilmaz)
  const activeFilters = Number(!!favOnly) + Number(!!kind) + Number(!!cat) + Number(!!tag) + Number(sort !== "recent");
  const clearFilters = () => { setQ(""); setCat(""); setTag(""); setKind(""); setFavOnly(false); setSort("recent"); };
  // suzgec acikken eklenen kaynak o deftere baglanir
  const targetNb = nb && nb !== "__none__" ? nb : "";

  /** Dosya yukleme; basarili sayiyi dondurur (AddSourceDialog onUpload sozlesmesi). */
  async function upload(files: File[]): Promise<number> {
    const ok: string[] = [];
    let linked = 0;
    setUploading({ done: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const fd = new FormData(); fd.append("file", f);
      if (targetNb) fd.append("collection_id", targetNb);
      try {
        const r = (await api("/documents", { method: "POST", body: fd })) as { id?: string; linked_existing?: boolean } | null;
        if (r?.id) ok.push(r.id);
        if (r?.linked_existing) linked++;
      } catch (e) {
        toast.error(`“${f.name}” yüklenemedi. ${errorMessage(e)}`);
      }
      setUploading({ done: i + 1, total: files.length });
    }
    setUploading(null);
    reload();
    if (ok.length) {
      const msg = linked === ok.length
        ? (ok.length === 1 ? "Bu dosya zaten Kütüphane'nde; yeniden yüklenmedi." : `${ok.length} dosya zaten Kütüphane'nde; yeniden yüklenmedi.`)
        : targetNb
          ? `${ok.length} kaynak «${colName[targetNb] || "defter"}» defterine eklendi; hazırlanıyor.`
          : `${ok.length} kaynak eklendi; hazırlanıyor. Soru sormak için bir deftere ekle.`;
      toast(msg, targetNb ? undefined : { action: { label: "Deftere ekle", run: () => setLinkFor(ok) } });
    }
    return ok.length;
  }
  /** Tur/boyut denetimi + gizlilik notu; AddSourceDialog ve surukle-birak bunu kullanir. */
  function onFiles(list: FileList | File[] | null): Promise<number> {
    if (!list) return Promise.resolve(0);
    const files: File[] = [];
    for (const f of Array.from(list)) {
      const why = rejectReason(f);
      if (why) toast.error(why); else files.push(f);
    }
    if (!files.length || uploading) return Promise.resolve(0);
    let p: Promise<number> = Promise.resolve(0);
    gate(() => { p = upload(files); });
    return p;
  }

  async function patchDoc(id: string, body: Partial<Doc>) {
    const prevDocs = docs;
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...body } : d)));
    try { await api("/documents/" + id, { method: "PATCH", body: JSON.stringify(body) }); }
    catch (e) { setDocs(prevDocs); toast.error("Değişiklik kaydedilemedi. " + errorMessage(e)); }
  }
  async function reprocess(id: string) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, status: "uploaded", error_message: null } : d)));
    try { await api("/documents/" + id + "/reprocess", { method: "POST" }); }
    catch (e) { toast.error("Yeniden hazırlama başlatılamadı. " + errorMessage(e)); }
    reload();
  }
  async function removeDoc(id: string) {
    const d = docs.find((x) => x.id === id);
    const inNbs = d ? colIds(d).map((c) => colName[c]).filter(Boolean) : [];
    const ok = await confirm({
      title: `“${d?.title || "Bu kaynak"}” çöp kutusuna taşınsın mı?`,
      description: "Çöp kutusuna taşınır; 30 gün içinde geri alabilirsin. Sonra kendiliğinden kalıcı silinir.",
      losses: [deleteLosses(d).replace(/silinir$/, "çöpe gider"),
               ...(inNbs.length ? [inNbs.length === 1 ? `«${inNbs[0]}» defterinden çıkar (geri getirince döner)` : `Bağlı olduğu ${inNbs.length} defterden çıkar (${inNbs.join(", ")}); geri getirince döner`] : [])],
      keeps: ["Çöp kutusundan geri getirebilirsin (sol menü › Çöp kutusu)"],
      confirmLabel: "Çöp kutusuna taşı", danger: true,
    });
    if (!ok) return;
    const prevDocs = docs;
    setDocs((prev) => prev.filter((x) => x.id !== id));
    try {
      await api("/documents/" + id, { method: "DELETE" });
      window.dispatchEvent(new Event("typdf:trash-changed"));
      toast("Kaynak çöp kutusuna taşındı.", { action: { label: "Geri al", run: () => {
        void api(`/trash/document/${id}/restore`, { method: "POST" })
          .then(() => { window.dispatchEvent(new Event("typdf:trash-changed")); return reload(); })
          .catch((e) => toast.error("Geri getirilemedi. " + errorMessage(e)));
      } } });
    }
    catch (e) { setDocs(prevDocs); toast.error("Kaynak çöp kutusuna taşınamadı. " + errorMessage(e)); }
  }

  async function renameNb(id: string) {
    const t = renameVal.trim();
    setRenamingId(null);
    if (!t) return;
    setCollections((cs) => cs.map((c) => (c.id === id ? { ...c, title: t } : c)));
    try { await api("/collections/" + id, { method: "PATCH", body: JSON.stringify({ title: t }) }); }
    catch (e) { toast.error("Defterin adı değiştirilemedi. " + errorMessage(e)); reload(); }
  }
  async function deleteNb(id: string, title: string) {
    const n = docs.filter((d) => colIds(d).includes(id)).length;
    const ok = await confirm({
      title: `“${title}” defteri çöp kutusuna taşınsın mı?`,
      description: "Çöp kutusuna taşınır; 30 gün içinde geri alabilirsin. Sonra kendiliğinden kalıcı silinir.",
      losses: ["Defterin sohbeti, taslağı, sözlüğü, haritası ve zaman çizelgesi defterle birlikte çöpe gider"],
      keeps: [
        ...(n > 0 ? [`İçindeki ${n} kaynak silinmez; Kütüphane'de ve bağlı olduğu diğer defterlerde kalır (geri getirince deftere döner)`] : []),
        "Çöp kutusundan geri getirebilirsin (sol menü › Çöp kutusu)",
      ],
      confirmLabel: "Çöp kutusuna taşı", danger: true,
    });
    if (!ok) return;
    setNbMenu(null);
    if (nb === id) setNb("");
    const prevCols = collections, prevDocs = docs;
    setCollections((cs) => cs.filter((c) => c.id !== id));
    setDocs((ds) => ds.map((d) => (colIds(d).includes(id) ? { ...d, collection_ids: colIds(d).filter((x) => x !== id), collection_id: null } : d)));
    try {
      await api("/collections/" + id, { method: "DELETE" });
      window.dispatchEvent(new Event("typdf:trash-changed"));
      toast("Defter çöp kutusuna taşındı; kaynaklar Kütüphane'de duruyor.", { action: { label: "Geri al", run: () => {
        void api(`/trash/collection/${id}/restore`, { method: "POST" })
          .then(() => { window.dispatchEvent(new Event("typdf:trash-changed")); return reload(); })
          .catch((e) => toast.error("Geri getirilemedi. " + errorMessage(e)));
      } } });
    }
    catch (e) { setCollections(prevCols); setDocs(prevDocs); toast.error("Defter çöp kutusuna taşınamadı. " + errorMessage(e)); }
  }
  async function createNb() {
    const t = newNb.trim();
    if (!t) { setCreatingNb(false); return; }
    if (nbBusy) return;
    setNbBusy(true);
    try {
      const j = (await api("/collections", { method: "POST", body: JSON.stringify({ title: t }) })) as { id?: string } | null;
      setNewNb(""); setCreatingNb(false);
      if (j?.id) router.push("/collections/" + j.id); else reload();
    } catch (e) {
      toast.error("Defter oluşturulamadı. " + errorMessage(e));
    } finally { setNbBusy(false); }
  }

  /** Defterden cikar: yalniz bagi koparir, kaynak Kutuphane'de kalir. */
  async function unlink(docId: string, cid: string) {
    const prevDocs = docs;
    setDocs((ds) => ds.map((d) => (d.id === docId ? { ...d, collection_ids: colIds(d).filter((x) => x !== cid) } : d)));
    try {
      await api(`/collections/${cid}/documents/${docId}`, { method: "DELETE" });
      toast(`«${colName[cid] || "Defter"}» defterinden çıkarıldı; kaynak Kütüphane'de duruyor.`, {
        action: { label: "Geri al", run: () => { void linkDocs(cid, [docId]).then(() => reloadDocs()); } },
      });
    } catch (e) { setDocs(prevDocs); toast.error("Defterden çıkarılamadı. " + errorMessage(e)); }
  }
  async function linkDocs(cid: string, docIds: string[]) {
    await api(`/collections/${cid}/documents`, { method: "POST", body: JSON.stringify({ document_ids: docIds }) });
  }

  function toggleSel(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function endSelect() { setSelecting(false); setSelected(new Set()); }

  const gap = density === "compact" ? "gap-2" : "gap-5";
  const pad = density === "compact" ? "p-3" : "p-5";
  const chip = (on: boolean) => cx("shrink-0 min-h-[36px] rounded-full px-3 text-xs", on ? "bg-accent-purple text-on-accent" : "border bg-surface text-text-secondary hover:border-accent-purple/50");
  const ctl = "flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 text-sm";
  const addBtn = (
    <button type="button" onClick={() => { setAddSeg("dosya"); setAddOpen(true); }}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-accent-purple px-3.5 text-sm font-medium text-on-accent md:min-h-[40px]">
      <Plus size={16} aria-hidden="true" /> Kaynak ekle
    </button>
  );
  const nbCreateForm = (
    <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void createNb(); }}>
      <input autoFocus value={newNb} onChange={(e) => setNewNb(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Escape") setCreatingNb(false); }}
             placeholder="Defter adı" aria-label="Yeni defter adı" disabled={nbBusy}
             className="min-w-0 flex-1 rounded-lg border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent-purple md:text-sm" />
      <button type="submit" aria-label="Defteri oluştur" disabled={nbBusy || !newNb.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-purple text-on-accent disabled:opacity-50">
        {nbBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      </button>
    </form>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-3 md:px-6 md:py-8" onClick={() => { setMenuFor(null); setNbMenu(null); }}>
      {/* tablet/masaustu: editoryal baslik; telefon: duz baslik + ekle (ilk kart ilk ekranda) */}
      <div className="hidden md:block">
        <PageHeader hero eyebrow="TY PDF" title="Kütüphane"
                    subtitle="Tüm kaynakların tek yerde. Bir kaynak birden çok defterde olabilir; defterden çıkarmak kaynağı silmez."
                    right={addBtn} />
      </div>
      <div className="flex items-center justify-between gap-3 md:hidden">
        <h1 className="font-heading text-[26px] leading-tight tracking-tight">Kütüphane</h1>
        {addBtn}
      </div>

      {loadErr && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm md:mt-0 md:mb-4">
          <span>Kaynakların yüklenemedi; silinmedi. {loadErr}</span>
          <button type="button" onClick={() => reload()} className="min-h-[40px] rounded-lg bg-accent-purple px-3 text-on-accent">Tekrar dene</button>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-6 md:mt-5 lg:flex-row">
      <div className="min-w-0 flex-1">

      {/* arama + (telefon) Süz + Seç | (sm+) siralama, favoriler, gorunum, yogunluk, Seç */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 sm:min-w-[220px]">
          <Search size={16} className="shrink-0 text-text-secondary" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: başlık, özet, etiket…"
                 aria-label="Kaynakların adında, özetinde ve etiketlerinde ara" enterKeyHint="search" autoCapitalize="none" autoCorrect="off"
                 className="w-full min-w-0 border-0 bg-transparent py-2 text-[16px] outline-none md:text-sm [&::-webkit-search-cancel-button]:appearance-none" />
        </div>
        <button type="button" onClick={() => setFilterOpen(true)} aria-haspopup="dialog" aria-expanded={filterOpen}
                className={cx(ctl, "sm:hidden", activeFilters ? "border-accent-purple text-accent-purple" : "bg-surface text-text-secondary")}>
          <SlidersHorizontal size={15} aria-hidden="true" /> Süz{activeFilters ? ` (${activeFilters})` : ""}
        </button>
        {docs.length > 0 && (
          <button type="button" onClick={() => (selecting ? endSelect() : setSelecting(true))} aria-pressed={selecting}
                  className={cx(ctl, "sm:order-last", selecting ? "border-accent-purple text-accent-purple" : "bg-surface text-text-secondary")}>
            <CheckSquare size={15} aria-hidden="true" /> <span className="hidden sm:inline">{selecting ? "Seçimi bitir" : "Seç"}</span><span className="sm:hidden">{selecting ? "Bitir" : "Seç"}</span>
          </button>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sırala" className="hidden min-h-[40px] rounded-xl border bg-surface px-3 text-sm sm:block">
          {(Object.keys(SORT_LABEL) as Sort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
        </select>
        <button type="button" onClick={() => setFavOnly((v) => !v)} aria-pressed={favOnly} className={cx(ctl, "hidden sm:flex", favOnly ? "border-accent-purple text-accent-purple" : "bg-surface text-text-secondary")}>
          <Star size={15} className={favOnly ? "fill-current" : ""} aria-hidden="true" /> Favoriler
        </button>
        <div className="hidden items-center rounded-xl border bg-surface sm:flex" role="group" aria-label="Görünüm">
          <button type="button" onClick={() => setView("grid")} aria-label="Izgara görünümü" aria-pressed={view === "grid"} className={cx("flex h-10 w-10 items-center justify-center rounded-l-xl", view === "grid" ? "text-accent-purple" : "text-text-secondary")}><LayoutGrid size={16} /></button>
          <button type="button" onClick={() => setView("list")} aria-label="Liste görünümü" aria-pressed={view === "list"} className={cx("flex h-10 w-10 items-center justify-center rounded-r-xl", view === "list" ? "text-accent-purple" : "text-text-secondary")}><List size={16} /></button>
        </div>
        <button type="button" onClick={() => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"))}
                aria-label={density === "comfortable" ? "Sık görünüme geç" : "Ferah görünüme geç"}
                className="hidden min-h-[40px] rounded-xl border bg-surface px-3 text-sm text-text-secondary sm:block">
          {density === "comfortable" ? "Sık" : "Ferah"}
        </button>
      </div>

      {/* telefon: yalniz etkin suzgecler (kaldirilabilir) */}
      {activeFilters > 0 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Etkin süzgeçler">
          {kind && <button type="button" onClick={() => setKind("")} aria-label={`Tür süzgecini kaldır: ${kind}`} className={chip(true)}>{kind} ✕</button>}
          {favOnly && <button type="button" onClick={() => setFavOnly(false)} aria-label="Favoriler süzgecini kaldır" className={chip(true)}>Favoriler ✕</button>}
          {cat && <button type="button" onClick={() => setCat("")} aria-label={`Kategori süzgecini kaldır: ${cat}`} className={chip(true)}>{cat} ✕</button>}
          {tag && <button type="button" onClick={() => setTag("")} aria-label={`Etiket süzgecini kaldır: ${tag}`} className={chip(true)}>#{tag} ✕</button>}
          {sort !== "recent" && <button type="button" onClick={() => setSort("recent")} aria-label="Sıralamayı varsayılana döndür" className={chip(true)}>{SORT_LABEL[sort]} ✕</button>}
        </div>
      )}

      {/* sm+: tur cipleri */}
      {Object.keys(kindCounts).length > 1 && (
        <div className="mt-3 hidden gap-1.5 overflow-x-auto pb-0.5 sm:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Türe göre süz">
          <button type="button" onClick={() => setKind("")} aria-pressed={!kind} className={chip(!kind)}>
            Tüm kaynaklar <span className="opacity-80">{docs.length}</span>
          </button>
          {KIND_ORDER.filter((k) => kindCounts[k]).map((k) => (
            <button type="button" key={k} onClick={() => setKind(kind === k ? "" : k)} aria-pressed={kind === k} className={chip(kind === k)}>
              {k} <span className="opacity-80">{kindCounts[k]}</span>
            </button>
          ))}
        </div>
      )}

      {/* sm+: kategori ve etiket cipleri */}
      {(categories.length > 0 || allTags.length > 0) && (
        <div className="mt-3 hidden flex-wrap items-center gap-1.5 sm:flex">
          {cat && <button type="button" onClick={() => setCat("")} aria-label={`Kategori süzgecini kaldır: ${cat}`} className="min-h-[32px] rounded-full bg-accent-purple/15 px-2.5 text-xs text-accent-purple">kategori: {cat} ✕</button>}
          {!cat && categories.map((c) => (
            <button type="button" key={c} onClick={() => setCat(c)} className="min-h-[32px] rounded-full border bg-surface px-2.5 text-xs text-text-secondary hover:border-accent-purple/50">{c}</button>
          ))}
          {tag && <button type="button" onClick={() => setTag("")} aria-label={`Etiket süzgecini kaldır: ${tag}`} className="min-h-[32px] rounded-full bg-accent-purple/15 px-2.5 text-xs text-accent-purple">#{tag} ✕</button>}
          {!tag && allTags.slice(0, 12).map((t) => (
            <button type="button" key={t} onClick={() => setTag(t)} className="min-h-[32px] rounded-full border bg-surface px-2.5 text-xs text-text-secondary hover:border-accent-purple/50">#{t}</button>
          ))}
        </div>
      )}

      {/* lg altinda: defter suzgeci yatay cip seridi (TB-5) */}
      {(collections.length > 0 || looseCount > 0) && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Deftere göre süz">
          <button type="button" onClick={() => setNb("")} aria-pressed={nb === ""} className={cx(chip(nb === ""), "flex items-center gap-1")}>
            <Notebook size={12} aria-hidden="true" /> Tümü <span className="opacity-80">{docs.length}</span>
          </button>
          {collections.map((c) => {
            const n = docs.filter((d) => colIds(d).includes(c.id)).length;
            return (
              <button type="button" key={c.id} onClick={() => setNb(nb === c.id ? "" : c.id)} aria-pressed={nb === c.id}
                      aria-label={`${c.title} defterindeki kaynakları göster (${n})`} className={cx(chip(nb === c.id), "max-w-[180px]")}>
                <span className="truncate">{c.title}</span> <span className="opacity-80">{n}</span>
              </button>
            );
          })}
          {looseCount > 0 && (
            <button type="button" onClick={() => setNb(nb === "__none__" ? "" : "__none__")} aria-pressed={nb === "__none__"} className={chip(nb === "__none__")}>
              Deftersiz <span className="opacity-80">{looseCount}</span>
            </button>
          )}
          <button type="button" onClick={() => setCreatingNb(true)} className={cx(chip(false), "flex items-center gap-1")} aria-label="Yeni defter oluştur">
            <Plus size={12} aria-hidden="true" /> Defter
          </button>
        </div>
      )}

      {/* md+: surukle-birak seridi (tiklayinca pencere) */}
      <button type="button"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void onFiles(e.dataTransfer.files); }}
        onClick={() => { setAddSeg("dosya"); setAddOpen(true); }}
        disabled={!!uploading}
        className={cx("mt-4 hidden w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-3 text-sm transition disabled:cursor-wait md:flex",
          drag ? "border-accent-purple bg-accent-purple/5 text-accent-purple" : "border-border-strong text-text-secondary hover:border-accent-purple/50")}
      >
        {uploading ? <Loader2 size={18} className="animate-spin text-accent-purple" aria-hidden="true" /> : <UploadCloud size={18} className="text-accent-purple" aria-hidden="true" />}
        <span role="status">
          {uploading ? `Yükleniyor… ${uploading.done}/${uploading.total}` : <>Dosyaları buraya sürükle ya da <b className="font-medium text-text-primary">Kaynak ekle</b> ile dosya, link, metin ekle{targetNb ? ` — «${colName[targetNb] || "defter"}» defterine bağlanır` : ""}</>}
        </span>
      </button>
      {uploading && (
        <p className="mt-2 text-xs text-text-secondary md:hidden" role="status">
          <Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden="true" /> Yükleniyor… {uploading.done}/{uploading.total}
        </p>
      )}

      {loading ? (
        <div className="mt-4 md:mt-6"><CardSkeleton n={3} /></div>
      ) : filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl border bg-surface p-8 text-center text-sm text-text-secondary md:mt-6 md:p-10">
          {docs.length === 0
            ? <>Henüz kaynak eklemedin. PDF, Word, Excel, sunum, link ya da metin ekle; senin için özetleyeyim ve soru sorabileceğin hâle getireyim. <button type="button" onClick={() => setAddOpen(true)} className="text-accent-purple underline underline-offset-2">Kaynak ekle</button></>
            : <>Süzgeçle eşleşen kaynak yok. <button type="button" onClick={() => { clearFilters(); setNb(""); }} className="text-accent-purple underline underline-offset-2">Süzgeçleri temizle</button></>}
        </div>
      ) : (
        <ul className={(view === "grid" ? "mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 md:mt-6 " : "mt-4 flex flex-col md:mt-6 ") + gap} aria-label="Kaynaklar">
          {filtered.map((d) => {
            const cids = colIds(d);
            const isSel = selected.has(d.id);
            const st = stageInfo(d);
            const p = prog[d.id];
            return (
            <li key={d.id}
                className={cx("lift group relative rounded-2xl border bg-surface", pad, "hover:border-accent-purple/40", isSel && "border-accent-purple ring-1 ring-accent-purple")}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {selecting && (
                    <button type="button" onClick={() => toggleSel(d.id)} role="checkbox" aria-checked={isSel}
                            aria-label={`Seç: ${d.title}`} className="relative z-10 -ml-1 flex h-10 w-10 shrink-0 items-center justify-center text-accent-purple">
                      {isSel ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                  )}
                  <SourceIcon kind={d.source_type} size={16} />
                  <h3 className="min-w-0 truncate font-medium text-text-primary">
                    {selecting ? (
                      <span>{d.title}</span>
                    ) : (
                      <Link href={"/documents/" + d.id} className="after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none"
                            aria-label={`${d.title} (${sourceLabel(d.source_type, d.page_count)}) aç`}>
                        {d.title}
                      </Link>
                    )}
                  </h3>
                </div>
                <div className="relative z-10 flex shrink-0 items-center gap-0.5">
                  <button type="button" onClick={(e) => { e.stopPropagation(); patchDoc(d.id, { is_favorite: !d.is_favorite }); }} aria-pressed={!!d.is_favorite}
                          aria-label={d.is_favorite ? `Favoriden çıkar: ${d.title}` : `Favori yap: ${d.title}`}
                          className={cx("flex h-10 w-10 items-center justify-center rounded-md md:h-8 md:w-8", d.is_favorite ? "text-accent-amber" : "text-text-secondary hover:text-accent-amber")}>
                    <Star size={15} className={d.is_favorite ? "fill-current" : ""} />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === d.id ? null : d.id); }}
                          aria-label={`Kaynak seçenekleri: ${d.title}`} aria-haspopup="menu" aria-expanded={menuFor === d.id}
                          className="flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted hover:text-text-primary md:h-8 md:w-8">
                    <MoreVertical size={15} />
                  </button>
                </div>
              </div>
              {d.short_summary && <p className="mt-1.5 line-clamp-2 text-sm text-text-secondary">{d.short_summary}</p>}
              {/* rozetler: en fazla 1 renkli (durum); "Hazır" gosterilmez, gerisi notr */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                {d.status !== "ready" && (
                  <span className={cx("rounded-full px-2 py-0.5", d.status === "failed" ? "bg-danger-bg text-danger" : "bg-accent-purple/10 text-accent-purple")}>{st.label}</span>
                )}
                {d.category && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-text-secondary">{d.category}</span>}
                {d.page_count ? <span className="rounded-full bg-surface-muted px-2 py-0.5 text-text-secondary">{d.page_count} sayfa</span> : null}
                {d.difficulty_level && <span className="hidden rounded-full bg-surface-muted px-2 py-0.5 text-text-secondary sm:inline">{d.difficulty_level}</span>}
                {toArr(d.tags).slice(0, 3).map((t, i) => <span key={i} className="rounded-full bg-surface-muted px-2 py-0.5 text-text-secondary">#{String(t)}</span>)}
              </div>
              {cids.length > 0 && (
                <div className="relative z-10 mt-2 flex flex-wrap items-center gap-1" aria-label="Bağlı olduğu defterler">
                  {cids.slice(0, 3).map((c) => (
                    <button type="button" key={c} onClick={() => setNb(nb === c ? "" : c)} title="Bu defterdeki kaynakları göster"
                            className="flex min-h-[28px] max-w-[160px] items-center gap-1 rounded-full border px-2 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                      <Notebook size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{colName[c] || "Defter"}</span>
                    </button>
                  ))}
                  {cids.length > 3 && <span className="text-xs text-text-secondary">+{cids.length - 3} defter</span>}
                </div>
              )}
              {isProcessing(d) && (
                <div className="mt-2.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                       aria-valuenow={st.pct ?? undefined} aria-label={`${d.title}: ${st.label}`}>
                    <div className="h-full rounded-full bg-accent-purple transition-all" style={{ width: (st.pct ?? 15) + "%" }} />
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">
                    {st.pct !== null ? `%${st.pct} · ` : ""}{st.label}
                    {etaText(d) ? ` · tahmini ${etaText(d)}` : ""}
                    {d.status === "uploaded" ? " · sırada (en fazla 2 kaynak aynı anda hazırlanır)" : ""}
                  </p>
                </div>
              )}
              {d.status === "failed" && (
                <div className="relative z-10 mt-2.5 rounded-lg bg-danger-bg px-2.5 py-2 text-xs text-danger">
                  <p>{d.error_message || "Bu kaynak hazırlanamadı. Yeniden dene; olmazsa dosyayı farklı biçimde kaydedip yükle."}</p>
                  <button type="button" onClick={(e) => { e.stopPropagation(); reprocess(d.id); }}
                          className="mt-1.5 flex min-h-[36px] items-center gap-1 rounded-md border border-danger/40 px-2 text-danger hover:bg-danger/10">
                    <RefreshCw size={12} aria-hidden="true" /> Yeniden hazırla
                  </button>
                </div>
              )}
              {d.status === "ready" && p && p.pct > 0 && (
                <div className="mt-2.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                    <div className="h-full rounded-full bg-accent-purple transition-all" style={{ width: Math.min(100, p.pct) + "%" }} />
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">
                    %{p.pct} okundu{p.page && p.numPages ? ` · s.${p.page}/${p.numPages}` : ""} · kaldığın yerden devam et
                  </p>
                </div>
              )}
              {menuFor === d.id && (
                <div onClick={(e) => e.stopPropagation()} role="menu" aria-label={`Kaynak seçenekleri: ${d.title}`}
                     className="absolute right-3 top-12 z-20 w-56 overflow-hidden rounded-xl border bg-surface shadow-lg"
                     onKeyDown={(e) => { if (e.key === "Escape") setMenuFor(null); }}>
                  <button type="button" role="menuitem" autoFocus onClick={() => { setEditing(d); setMenuFor(null); }} className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-muted"><Pencil size={14} aria-hidden="true" /> Düzenle</button>
                  <button type="button" role="menuitem" onClick={() => { setLinkFor([d.id]); setMenuFor(null); }} className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-muted"><BookMarked size={14} aria-hidden="true" /> Defterlere ekle / çıkar</button>
                  {cids.map((c) => (
                    <button type="button" role="menuitem" key={c} onClick={() => { setMenuFor(null); void unlink(d.id, c); }}
                            className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-muted">
                      <X size={14} aria-hidden="true" /> <span className="truncate">«{colName[c] || "Defter"}» defterinden çıkar</span>
                    </button>
                  ))}
                  <button type="button" role="menuitem" onClick={() => { removeDoc(d.id); setMenuFor(null); }} className="flex min-h-[44px] w-full items-center gap-2 border-t px-3 text-left text-sm text-danger hover:bg-surface-muted"><Trash2 size={14} aria-hidden="true" /> Kaynağı sil</button>
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}

      </div>

      {/* Defterler: yalniz lg ve ustunde sag panel (altinda ustteki cip seridi) */}
      <aside className="hidden w-full shrink-0 lg:block lg:w-64" aria-labelledby={ids + "-nbs"}>
        <div className="rounded-2xl border bg-surface p-3">
          <h2 id={ids + "-nbs"} className="mb-2 flex items-center gap-1.5 px-1 text-sm font-medium text-text-primary">
            <Notebook size={15} className="text-accent-purple" aria-hidden="true" /> Defterler
          </h2>

          <button type="button" onClick={() => setNb("")} aria-pressed={nb === ""}
                  className={cx("flex min-h-[40px] w-full items-center justify-between rounded-lg px-2.5 text-sm",
                    nb === "" ? "bg-accent-purple/10 text-accent-purple" : "text-text-secondary hover:bg-surface-muted")}>
            <span>Tüm kaynaklar</span>
            <span className="text-xs">{docs.length}</span>
          </button>

          <div className="mt-1 space-y-0.5">
            {collections.map((c) => {
              const n = docs.filter((d) => colIds(d).includes(c.id)).length;
              const on = nb === c.id;
              if (renamingId === c.id) {
                return (
                  <div key={c.id} className="flex items-center gap-1 px-1 py-1">
                    <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                           onKeyDown={(e) => { if (e.key === "Enter") renameNb(c.id); if (e.key === "Escape") setRenamingId(null); }}
                           onBlur={() => renameNb(c.id)}
                           aria-label="Defter adı"
                           className="min-w-0 flex-1 rounded-lg border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent-purple" />
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => renameNb(c.id)}
                            aria-label="Adı kaydet" className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-purple text-on-accent"><Check size={14} /></button>
                  </div>
                );
              }
              return (
                <div key={c.id}
                     className={cx("group relative flex items-center rounded-lg", on ? "bg-accent-purple/10" : "hover:bg-surface-muted")}>
                  <button type="button" onClick={() => setNb(on ? "" : c.id)} aria-pressed={on}
                          aria-label={`${c.title} defterindeki kaynakları göster (${n})`}
                          className={cx("flex min-h-[40px] min-w-0 flex-1 items-center gap-2 px-2.5 text-left text-sm",
                            on ? "text-accent-purple" : "text-text-secondary")}>
                    <Notebook size={14} className="shrink-0 opacity-70" aria-hidden="true" />
                    <span className="truncate">{c.title}</span>
                    <span className="ml-auto pl-1 text-xs">{n}</span>
                  </button>
                  <button type="button" onClick={() => router.push("/collections/" + c.id)}
                          aria-label={c.title + " defterini aç"}
                          className="flex h-10 w-9 items-center justify-center rounded-md text-text-secondary hover:text-accent-purple">
                    <BookOpen size={14} />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setNbMenu(nbMenu === c.id ? null : c.id); }}
                          aria-label={`Defter seçenekleri: ${c.title}`} aria-haspopup="menu" aria-expanded={nbMenu === c.id}
                          className="flex h-10 w-9 items-center justify-center rounded-md text-text-secondary hover:text-text-primary">
                    <MoreVertical size={14} />
                  </button>
                  {nbMenu === c.id && (
                    <div onClick={(e) => e.stopPropagation()} role="menu" aria-label={`Defter seçenekleri: ${c.title}`}
                         onKeyDown={(e) => { if (e.key === "Escape") setNbMenu(null); }}
                         className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-xl border bg-surface shadow-lg">
                      <button type="button" role="menuitem" autoFocus onClick={() => { setNbMenu(null); setRenameVal(c.title); setRenamingId(c.id); }}
                              className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-muted">
                        <Pencil size={14} aria-hidden="true" /> Adını değiştir
                      </button>
                      <button type="button" role="menuitem" onClick={() => { setNbMenu(null); router.push("/collections/" + c.id); }}
                              className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-muted">
                        <BookOpen size={14} aria-hidden="true" /> Defteri aç
                      </button>
                      <button type="button" role="menuitem" onClick={() => deleteNb(c.id, c.title)}
                              className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm text-danger hover:bg-surface-muted">
                        <Trash2 size={14} aria-hidden="true" /> Defteri sil
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {looseCount > 0 && (
            <button type="button" onClick={() => setNb(nb === "__none__" ? "" : "__none__")} aria-pressed={nb === "__none__"}
                    className={cx("mt-1 flex min-h-[40px] w-full items-center justify-between rounded-lg px-2.5 text-sm",
                      nb === "__none__" ? "bg-accent-purple/10 text-accent-purple" : "text-text-secondary hover:bg-surface-muted")}>
              <span className="flex items-center gap-2"><Notebook size={14} className="opacity-50" aria-hidden="true" /> Deftersiz</span>
              <span className="text-xs">{looseCount}</span>
            </button>
          )}

          <div className="mt-2 border-t pt-2">
            {creatingNb ? nbCreateForm : (
              <button type="button" onClick={() => setCreatingNb(true)}
                      className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2.5 text-sm text-text-secondary hover:bg-surface-muted hover:text-accent-purple">
                <Plus size={14} aria-hidden="true" /> Yeni defter
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 px-1 text-xs leading-relaxed text-text-secondary">
          Bir kaynağı deftere eklemek için kartındaki <b>⋮</b> menüsünden <b>Defterlere ekle</b>&apos;yi seç ya da <b>Seç</b> ile birden çok kaynağı birlikte ekle.
          Bir kaynak birden çok defterde olabilir.
        </p>
      </aside>
      </div>

      {/* lg altinda "Yeni defter": kucuk pencere (lg'de sag paneldeki satir ici form) */}
      <Modal open={creatingNb && !isLg} onClose={() => setCreatingNb(false)} title="Yeni defter" size="sm">
        {nbCreateForm}
      </Modal>

      {/* telefon: "Süz" tabakasi */}
      <Modal open={filterOpen} onClose={() => setFilterOpen(false)} title="Süz ve sırala" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor={ids + "-sort"} className="mb-1 block text-xs font-medium text-text-secondary">Sıralama</label>
            <select id={ids + "-sort"} value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-[44px] w-full rounded-xl border bg-surface px-3 text-[16px]">
              {(Object.keys(SORT_LABEL) as Sort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
            </select>
          </div>
          <label className="flex min-h-[44px] items-center gap-3 text-sm">
            <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} className="h-5 w-5 accent-[var(--accent-purple)]" />
            <Star size={15} className={favOnly ? "fill-current text-accent-amber" : "text-text-secondary"} aria-hidden="true" /> Yalnız favoriler
          </label>
          {Object.keys(kindCounts).length > 1 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-text-secondary">Tür</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Türe göre süz">
                <button type="button" onClick={() => setKind("")} aria-pressed={!kind} className={chip(!kind)}>Tümü <span className="opacity-80">{docs.length}</span></button>
                {KIND_ORDER.filter((k) => kindCounts[k]).map((k) => (
                  <button type="button" key={k} onClick={() => setKind(kind === k ? "" : k)} aria-pressed={kind === k} className={chip(kind === k)}>
                    {k} <span className="opacity-80">{kindCounts[k]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {categories.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-text-secondary">Kategori</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kategoriye göre süz">
                {categories.map((c) => (
                  <button type="button" key={c} onClick={() => setCat(cat === c ? "" : c)} aria-pressed={cat === c} className={chip(cat === c)}>{c}</button>
                ))}
              </div>
            </div>
          )}
          {allTags.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-text-secondary">Etiket</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Etikete göre süz">
                {allTags.slice(0, 30).map((t) => (
                  <button type="button" key={t} onClick={() => setTag(tag === t ? "" : t)} aria-pressed={tag === t} className={chip(tag === t)}>#{t}</button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <button type="button" onClick={clearFilters} disabled={!activeFilters && !q} className="min-h-[44px] rounded-xl px-3 text-sm text-text-secondary hover:bg-surface-muted disabled:opacity-50">Temizle</button>
            <button type="button" onClick={() => setFilterOpen(false)} className="min-h-[44px] rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent">
              {filtered.length} kaynağı göster
            </button>
          </div>
        </div>
      </Modal>

      {selecting && (
        <div className="fixed inset-x-0 z-40 flex justify-center px-3"
             style={{ bottom: "calc(var(--bottom-nav, 0px) + 12px)" }}>
          <div className="flex w-full max-w-lg items-center gap-2 rounded-2xl border bg-surface p-2 pl-4 shadow-medium" role="region" aria-label="Seçili kaynaklar">
            <span className="flex-1 text-sm" role="status">{selected.size} kaynak seçildi</span>
            <button type="button" onClick={endSelect} className="min-h-[44px] rounded-xl border px-3 text-sm hover:bg-surface-muted">Vazgeç</button>
            <button type="button" disabled={!selected.size} onClick={() => setLinkFor(Array.from(selected))}
                    className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-3 text-sm font-medium text-on-accent disabled:opacity-50">
              <BookMarked size={15} aria-hidden="true" /> Deftere ekle
            </button>
          </div>
        </div>
      )}

      {/* Tek "Kaynak ekle" penceresi. collectionId: defter suzgeci acikken o defter, yoksa "" (TS notu: opsiyonel olsun). */}
      <AddSourceDialog open={addOpen} onClose={() => setAddOpen(false)} collectionId={targetNb}
                       segment={addSeg} onSegment={setAddSeg}
                       existingIds={targetNb ? docs.filter((d) => colIds(d).includes(targetNb)).map((d) => d.id) : docs.map((d) => d.id)}
                       onAdded={async () => { await reload(); }}
                       onUpload={(files) => onFiles(files)} upBusy={uploading} />

      <EditModal doc={editing} onClose={() => setEditing(null)}
                 onSave={(b) => { if (editing) patchDoc(editing.id, b); setEditing(null); }}
                 onNotebooks={() => { if (editing) { const id = editing.id; setEditing(null); setLinkFor([id]); } }}
                 notebookNames={editing ? colIds(editing).map((c) => colName[c]).filter(Boolean) : []} />

      <LinkDialog docIds={linkFor} docs={docs} collections={collections}
                  onClose={() => setLinkFor(null)}
                  onDone={(msg) => { setLinkFor(null); endSelect(); reload(); if (msg) toast(msg); }}
                  onCreated={(c) => setCollections((cs) => [...cs, c])} />

      {confirmDialog}
      {privacyDialog}
    </div>
  );
}

/** Kaynak(lar)i defterlere ekle / defterlerden cikar. Kaynak birden cok defterde olabilir. */
function LinkDialog({ docIds, docs, collections, onClose, onDone, onCreated }: {
  docIds: string[] | null; docs: Doc[]; collections: Col[];
  onClose: () => void; onDone: (msg?: string) => void; onCreated: (c: Col) => void;
}) {
  const open = !!docIds && docIds.length > 0;
  const targets = useMemo(() => docs.filter((d) => docIds?.includes(d.id)), [docs, docIds]);
  // baslangic: secili kaynaklarin hepsinin bagli oldugu defterler isaretli
  const initial = useMemo(() => {
    const s = new Set<string>();
    if (!targets.length) return s;
    collections.forEach((c) => { if (targets.every((d) => colIds(d).includes(c.id))) s.add(c.id); });
    return s;
  }, [targets, collections]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const fid = useId();

  useEffect(() => { if (open) { setChecked(new Set(initial)); setErr(""); setNewTitle(""); } }, [open, initial]);

  async function createAndCheck() {
    const t = newTitle.trim();
    if (!t || creating) return;
    setCreating(true); setErr("");
    try {
      const j = (await api("/collections", { method: "POST", body: JSON.stringify({ title: t }) })) as { id?: string } | null;
      if (j?.id) { onCreated({ id: j.id, title: t }); setChecked((s) => new Set(s).add(j.id as string)); setNewTitle(""); }
    } catch (e) { setErr("Defter oluşturulamadı. " + errorMessage(e)); }
    finally { setCreating(false); }
  }

  async function save() {
    if (busy) return;
    const add = Array.from(checked).filter((c) => !initial.has(c));
    const remove = Array.from(initial).filter((c) => !checked.has(c));
    if (!add.length && !remove.length) { onClose(); return; }
    setBusy(true); setErr("");
    try {
      for (const c of add) {
        const need = targets.filter((d) => !colIds(d).includes(c)).map((d) => d.id);
        if (need.length) await api(`/collections/${c}/documents`, { method: "POST", body: JSON.stringify({ document_ids: need }) });
      }
      for (const c of remove) {
        for (const d of targets) {
          if (colIds(d).includes(c)) await api(`/collections/${c}/documents/${d.id}`, { method: "DELETE" });
        }
      }
      const parts: string[] = [];
      if (add.length) parts.push(`${add.length} deftere eklendi`);
      if (remove.length) parts.push(`${remove.length} defterden çıkarıldı`);
      onDone(`${targets.length === 1 ? "Kaynak" : targets.length + " kaynak"} ${parts.join(", ")}.`);
    } catch (e) {
      setErr("Defterler güncellenemedi. " + errorMessage(e));
    } finally { setBusy(false); }
  }

  const title = targets.length === 1 ? "Defterlere ekle" : `${targets.length} kaynağı defterlere ekle`;
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={title} size="md">
      {targets.length === 1 && <p className="-mt-1 mb-2 truncate text-sm text-text-secondary">{targets[0].title}</p>}
      <p className="text-xs text-text-secondary">Bir kaynak birden çok defterde olabilir. İşareti kaldırmak kaynağı yalnız o defterden çıkarır; Kütüphane&apos;den silmez.</p>
      <fieldset className="mt-3">
        <legend className="sr-only">Defterler</legend>
        {collections.length === 0 && <p className="text-sm text-text-secondary">Henüz defterin yok; aşağıdan bir tane oluştur.</p>}
        <div className="max-h-[40vh] space-y-0.5 overflow-y-auto">
          {collections.map((c) => {
            const on = checked.has(c.id);
            const partial = !initial.has(c.id) && targets.some((d) => colIds(d).includes(c.id));
            return (
              <label key={c.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-surface-muted">
                <input type="checkbox" checked={on} className="h-5 w-5 shrink-0 accent-[var(--accent-purple)]"
                       onChange={(e) => setChecked((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                {partial && <span className="shrink-0 text-xs text-text-secondary">bazıları ekli</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
      <form className="mt-3 flex items-center gap-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); void createAndCheck(); }}>
        <label htmlFor={fid} className="sr-only">Yeni defter adı</label>
        <input id={fid} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Yeni defter adı"
               className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-[16px] outline-none focus:border-accent-purple md:text-sm" />
        <button type="submit" disabled={!newTitle.trim() || creating}
                className="flex min-h-[40px] items-center gap-1 rounded-lg border px-3 text-sm hover:border-accent-purple/50 disabled:opacity-50">
          {creating ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Oluştur
        </button>
      </form>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} disabled={busy} className="min-h-[44px] rounded-xl border px-4 text-sm hover:bg-surface-muted sm:min-h-[40px]">Vazgeç</button>
        <button type="button" onClick={save} disabled={busy}
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent disabled:opacity-60 sm:min-h-[40px]">
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Kaydet
        </button>
      </div>
    </Modal>
  );
}

function EditModal({ doc, onClose, onSave, onNotebooks, notebookNames }: {
  doc: Doc | null; onClose: () => void; onSave: (b: Partial<Doc>) => void; onNotebooks: () => void; notebookNames: string[];
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [tagsStr, setTagsStr] = useState("");
  const [fav, setFav] = useState(false);
  const fid = useId();
  useEffect(() => {
    if (!doc) return;
    setTitle(doc.title || ""); setCategory(doc.category || "");
    setTagsStr(toArr(doc.tags).join(", ")); setFav(!!doc.is_favorite);
  }, [doc]);

  const input = "mb-3 w-full rounded-lg border bg-surface px-3 py-2 text-[16px] outline-none focus:border-accent-purple md:text-sm";
  return (
    <Modal open={!!doc} onClose={onClose} title="Kaynağı düzenle" size="md">
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!doc) return;
        onSave({ title: title.trim() || doc.title, category: category.trim(), tags: tagsStr.split(",").map((s) => s.trim()).filter(Boolean), is_favorite: fav });
      }}>
        <label htmlFor={fid + "-t"} className="mb-1 block text-xs font-medium text-text-secondary">Başlık</label>
        <input id={fid + "-t"} data-autofocus="" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        <label htmlFor={fid + "-c"} className="mb-1 block text-xs font-medium text-text-secondary">Kategori</label>
        <input id={fid + "-c"} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="ör. Tarih, Makale, Ders" className={input} />
        <label htmlFor={fid + "-g"} className="mb-1 block text-xs font-medium text-text-secondary">Etiketler (virgülle ayır)</label>
        <input id={fid + "-g"} value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} placeholder="ör. sınav, önemli" className={input} />
        <div className="mb-3 rounded-lg border px-3 py-2">
          <p className="text-xs font-medium text-text-secondary">Defterler</p>
          <p className="mt-0.5 text-sm">{notebookNames.length ? notebookNames.join(" · ") : "Hiçbir deftere ekli değil"}</p>
          <button type="button" onClick={onNotebooks} className="mt-1 min-h-[36px] text-sm text-accent-purple underline underline-offset-2">Defterlere ekle / çıkar</button>
        </div>
        <label className="mb-4 flex min-h-[40px] items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} className="h-5 w-5" /> Favori
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-xl border px-4 text-sm hover:bg-surface-muted sm:min-h-[40px]">Vazgeç</button>
          <button type="submit" className="min-h-[44px] rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent sm:min-h-[40px]">Kaydet</button>
        </div>
      </form>
    </Modal>
  );
}
