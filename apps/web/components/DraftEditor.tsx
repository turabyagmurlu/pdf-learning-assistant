"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API, getToken } from "@/lib/api";
import { ArrowUp, ArrowDown, X, Plus, ExternalLink, Sparkles, Quote, RefreshCw, Heading2, Wand2, Loader2, Check, ShieldCheck, Copy, AlertTriangle } from "lucide-react";
import { Cost, costTitle, isUsageLimit } from "@/components/CostBadge";
import { toast } from "@/components/Toast";

/* ---------- blok modeli ---------- */
export type Block =
  | { id: string; type: "p"; text: string }
  | { id: string; type: "h"; text: string }
  | { id: string; type: "quote"; text: string; note?: string; color?: string | null; source: string; page: number | null; document_id: string }
  | { id: string; type: "answer"; q: string; text: string; sources: { title: string; page?: number | null; document_id: string }[] };

const uid = () => Math.random().toString(36).slice(2, 10);
const cx = (...a: any[]) => a.filter(Boolean).join(" ");

export function parseDraft(raw: string | null | undefined): Block[] {
  if (!raw || !raw.trim()) return [{ id: uid(), type: "p", text: "" }];
  try {
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.blocks)) return j.blocks.length ? j.blocks : [{ id: uid(), type: "p", text: "" }];
  } catch {}
  // eski duz metin taslak → paragraflar
  return raw.split(/\n{2,}/).map((t) => ({ id: uid(), type: "p", text: t.trim() } as Block)).filter((b) => (b as any).text);
}
export function serializeDraft(blocks: Block[]) { return JSON.stringify({ v: 1, blocks }); }

function cite(b: Extract<Block, { type: "quote" }>) { return `${b.source}${b.page ? ", s. " + b.page : ""}`; }

export function toMarkdown(title: string, blocks: Block[]) {
  const out: string[] = [`# ${title}`, ""];
  for (const b of blocks) {
    if (b.type === "h") out.push(`## ${b.text.trim()}`, "");
    else if (b.type === "p") { if (b.text.trim()) out.push(b.text.trim(), ""); }
    else if (b.type === "quote") { out.push(`> ${b.text.trim().replace(/\n+/g, " ")}`, `> — ${cite(b)}`, ""); if (b.note) out.push(`_${b.note.trim()}_`, ""); }
    else if (b.type === "answer") out.push(`**${b.q}**`, "", b.text.trim(), "", `_Kaynaklar: ${b.sources.map((s, i) => `[K${i + 1}] ${s.title}${s.page ? ", s. " + s.page : ""}`).join("; ")}_`, "");
  }
  return out.join("\n");
}
export function toWordHtml(title: string, blocks: Block[]) {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const inl = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/_(.+?)_/g, "<i>$1</i>").replace(/\n/g, "<br>");
  const body = blocks.map((b) => {
    if (b.type === "h") return `<h2>${esc(b.text)}</h2>`;
    if (b.type === "p") return b.text.trim() ? `<p>${inl(b.text)}</p>` : "";
    if (b.type === "quote") return `<blockquote style="margin:6pt 0 10pt 18pt;padding-left:10pt;border-left:3pt solid ${b.color || "#E0A233"};color:#333">${esc(b.text)}<br><span style="font-size:9pt;color:#666">— ${esc(cite(b))}</span></blockquote>${b.note ? `<p><i>${inl(b.note)}</i></p>` : ""}`;
    return `<p><b>${esc(b.q)}</b></p><p>${inl(b.text)}</p><p style="font-size:9pt;color:#666"><i>Kaynaklar: ${b.sources.map((s, i) => `[K${i + 1}] ${esc(s.title)}${s.page ? ", s. " + s.page : ""}`).join("; ")}</i></p>`;
  }).join("\n");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.5}h1{font-size:20pt}h2{font-size:15pt}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}
/**
 * Sunucudaki taslakla birlestirme (3 yollu, blok kimligine gore):
 * sunucuda olup yerelde OLMAYAN ve son esitlenen surumde de (base) OLMAYAN bloklar
 * baska yerden eklenmistir (okuyucudan "Taslağa ekle", baska sekme) -> yerel taslagin SONUNA eklenir.
 * Yerelde silinen bloklar (base'de var, yerelde yok) geri gelmez. Ayni metinli blok tekrar eklenmez
 * (eski duz metin taslaklarda kimlikler her okumada degisir).
 */
export function mergeRemote(local: Block[], remote: Block[], base: Set<string>): { blocks: Block[]; added: number } {
  const ids = new Set(local.map((b) => b.id));
  const sig = (b: Block) => b.type + "|" + ((b as { text?: string }).text || "").trim();
  const sigs = new Set(local.map(sig));
  const extra = remote.filter((b) => !ids.has(b.id) && !base.has(b.id) && !sigs.has(sig(b))
    && !(b.type === "p" && !b.text.trim()));
  if (!extra.length) return { blocks: local, added: 0 };
  const next = [...local];
  while (next.length && next[next.length - 1].type === "p" && !(next[next.length - 1] as { text: string }).text.trim()) next.pop();
  next.push(...extra, { id: uid(), type: "p", text: "" });
  return { blocks: next, added: extra.length };
}

/** "%35'i", "%20'si", "%40'ı" gibi Turkce iyelik eki. */
function pctPoss(n: number) {
  const last = n % 10;
  const ONES = ["", "i", "si", "ü", "ü", "i", "sı", "si", "i", "u"];
  if (n === 0) return "ı";
  if (n === 100) return "ü";
  if (last) return ONES[last];
  const TENS: Record<number, string> = { 1: "u", 2: "si", 3: "u", 4: "ı", 5: "si", 6: "ı", 7: "i", 8: "i", 9: "ı" };
  return TENS[Math.floor(n / 10) % 10] || "i";
}
const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export function ownWords(blocks: Block[]) {
  return blocks.filter((b) => b.type === "p" || b.type === "h").map((b: any) => b.text.trim()).filter(Boolean).join(" ").split(/\s+/).filter(Boolean).length;
}

/* ---------- editor ---------- */
export default function DraftEditor({ notebookId, title, initial, initialRev, material, onReloadMaterial, inbox, onInboxConsumed, onSaved }: {
  notebookId: string; title: string; initial: string | null | undefined;
  /** collections.draft_rev: sunucudaki taslak surumu (yoksa kosulsuz kayit — eski API) */
  initialRev?: number | null;
  material: any[] | null; onReloadMaterial: () => void;
  inbox: Block[]; onInboxConsumed: () => void;
  onSaved?: (serialized: string, rev?: number) => void;
}) {
  const router = useRouter();
  // Kaydedilemeden kalan son surum cihazda yedeklenir; geri gelince oradan devam edilir (veri kaybi olmasin).
  const BACKUP_KEY = "draft.pending." + notebookId;
  const BASE_KEY = "draft.base." + notebookId;          // yedegin dayandigi sunucu bloklari (birlestirme icin)
  const [restored] = useState<string | null>(() => {
    try { const b = localStorage.getItem(BACKUP_KEY); return b && b !== (initial || "") ? b : null; } catch { return null; }
  });
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (!restored) return parseDraft(initial);
    // Yedek geri yuklenirken sunucuya bu arada eklenmis bloklar (okuyucudan "Taslağa ekle") kaybolmasin
    const local = parseDraft(restored);
    let base: string[] | null = null;
    try { base = JSON.parse(localStorage.getItem(BASE_KEY) || "null"); } catch {}
    return mergeRemote(local, parseDraft(initial), new Set(Array.isArray(base) ? base : local.map((b) => b.id))).blocks;
  });
  // Eszamanlilik: sunucudaki surum (draft_rev) ve o surumun blok kimlikleri. Kayit bu surume
  // kosullu gider; arada baska yerden yazildiysa sunucu yazmaz, guncel taslagi dondurur -> birlestirilir.
  const rev = useRef<number>(typeof initialRev === "number" ? initialRev : -1);
  const baseIds = useRef<Set<string>>(new Set(parseDraft(initial).map((b) => b.id)));
  const skipSave = useRef(false);                        // sunucudan gelen tazeleme kayit tetiklemesin
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [retryIn, setRetryIn] = useState(0);            // hata sonrasi otomatik tekrar (sn)
  const [matQ, setMatQ] = useState("");
  const [flash, setFlash] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const latest = useRef<Block[]>(blocks);                // en son icerik (unmount'ta gonderilir)
  const version = useRef(0);                             // her degisiklikte artar
  const savedVersion = useRef(0);                        // sunucuya ulasan son surum
  const failures = useRef(0);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const mounted = useRef(true);
  const inflight = useRef<Promise<boolean> | null>(null);   // kayitlar sirayla gider (eski surum yenisini ezmesin)

  // AI ile duzenle
  type Assist = { idx: number; action: string; busy: boolean; text?: string; suggestions?: any[]; why?: string; error?: string; menu?: boolean };
  const [assist, setAssist] = useState<Assist | null>(null);
  const [customInstr, setCustomInstr] = useState("");
  const ACTIONS: [string, string, string][] = [
    ["shorten", "Kısalt", "Yarı uzunluğa indir, özü koru"],
    ["academic", "Akademik tona çevir", "Nesnel, üçüncü şahıs, ölçülü"],
    ["suggest_sources", "Kaynak öner", "Defterdeki vurgulardan bu paragrafı destekleyenler"],
    ["custom", "Serbest talimat…", "Kendi isteğini yaz"],
  ];
  async function runAssist(idx: number, action: string, instruction?: string) {
    const b = blocks[idx]; if (!b) return;
    const text = b.type === "quote" ? b.text : b.type === "answer" ? b.text : (b as any).text;
    if (!text || text.trim().length < 8) { setAssist({ idx, action, busy: false, error: "Önce biraz metin yaz." }); return; }
    setAssist({ idx, action, busy: true });
    try {
      const r = await api(`/collections/${notebookId}/draft-assist`, { method: "POST", body: JSON.stringify({ action, text, instruction }) });
      setAssist({ idx, action, busy: false, text: r.text, suggestions: r.suggestions, why: r.why || r.note });
    } catch (e: any) {
      setAssist({ idx, action, busy: false, error: isUsageLimit(e) ? (e?.message || "Bugünkü yapay zekâ kullanımın doldu.")
        : (e?.message || "Öneri hazırlanamadı; birazdan tekrar dene.") });
    }
  }
  function applyAssist() {
    if (!assist || !assist.text) return;
    const b = blocks[assist.idx];
    if (b.type === "quote" && assist.action === "paraphrase") {
      // parafraz: alintinin ALTINA senin paragrafin olarak girer; alinti karti kalir (kaynak belli olsun)
      insertAfter(assist.idx, { id: uid(), type: "p", text: assist.text });
    } else if (b.type === "p" || b.type === "h") {
      setText(assist.idx, assist.text);
    }
    setAssist(null);
  }
  function addSuggested(sg: any) {
    if (!assist) return;
    insertAfter(assist.idx, { id: uid(), type: "quote", text: (sg.text || "").trim().replace(/\s+/g, " "), note: sg.note || undefined,
      color: sg.color, source: sg.document_title, page: sg.page ?? null, document_id: sg.document_id });
  }

  // Kaynaklarla dogrula: her iddia cumlesi defterin kaynaklarina karsi
  type VRes = { block_id: string; sentence: string; verdict: "destek" | "kismi" | "yok" | "celiski"; note: string;
    evidence: { document_id: string; title: string; page: number | null; text: string; unit?: string; time?: string } | null };
  const [ver, setVer] = useState<{ busy: boolean; results?: VRes[]; counts?: Record<string, number>; error?: string; cached?: number; open: boolean } | null>(null);
  const VMETA: Record<string, { t: string; c: string; dot: string }> = {
    destek: { t: "Destekleniyor", c: "bg-green-500/10 text-green-800 border-green-600/30", dot: "bg-green-500" },
    kismi: { t: "Kısmen", c: "bg-amber-500/10 text-amber-800 border-amber-600/30", dot: "bg-amber-500" },
    yok: { t: "Kaynakta yok", c: "bg-slate-500/10 text-slate-700 border-slate-500/30", dot: "bg-slate-400" },
    celiski: { t: "Çelişiyor", c: "bg-red-500/10 text-red-800 border-red-600/30", dot: "bg-red-500" },
  };
  const RANK: Record<string, number> = { celiski: 3, yok: 2, kismi: 1, destek: 0 };
  async function runVerify() {
    const items = blocks.filter((b) => b.type === "p" && b.text.trim().split(/\s+/).length >= 6).map((b: any) => ({ block_id: b.id, text: b.text }));
    if (!items.length) { setVer({ busy: false, open: true, error: "Doğrulanacak paragraf yok (kendi yazdığın paragraflar kontrol edilir)." }); return; }
    setVer({ busy: true, open: true });
    try {
      const r = await api(`/collections/${notebookId}/verify`, { method: "POST", body: JSON.stringify({ items }) }, 1);
      setVer({ busy: false, open: true, results: r.results, counts: r.counts, cached: r.from_cache });
    } catch (e: any) { setVer({ busy: false, open: true, error: e?.message || "Doğrulama yapılamadı; birazdan tekrar dene." }); }
  }
  const worst = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of ver?.results || []) if (!m[r.block_id] || RANK[r.verdict] > RANK[m[r.block_id]]) m[r.block_id] = r.verdict;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver?.results]);
  function addEvidence(r: VRes) {
    if (!r.evidence) return;
    const idx = blocks.findIndex((b) => b.id === r.block_id);
    insertAfter(idx, { id: uid(), type: "quote", text: r.evidence.text.trim().replace(/\s+/g, " ").slice(0, 400), source: r.evidence.title,
      page: r.evidence.page ?? null, document_id: r.evidence.document_id, note: undefined, color: "#16a34a" } as Block);
  }

  // Benzerlik (intihal) kontrolu: yapay zekasiz, ucretsiz. Kendi paragraflarinin kaynaklardaki
  // cumlelerle ne kadar ayni oldugunu olcer (Kaynaklarla doğrula ise iddianin desteklenip desteklenmedigine bakar).
  type SRes = { id: string; level: "yuksek" | "orta"; score: number; longest: number; match: string;
    source: { document_id: string; title: string; page: number | null; source_type?: string } };
  const [sim, setSim] = useState<{ busy: boolean; open: boolean; results?: SRes[]; quoted?: string[]; checked?: number;
    note?: string; error?: string; snap?: Record<string, string> } | null>(null);
  const [simHidden, setSimHidden] = useState<Set<string>>(new Set());
  const simCandidates = () => blocks.filter((b) => b.type === "p" && wordCount(b.text) >= 12).slice(0, 60)
    .map((b) => ({ id: b.id, text: (b as { text: string }).text }));
  async function runSimilarity() {
    const paragraphs = simCandidates();
    if (!paragraphs.length) { setSim({ busy: false, open: true, error: "Kontrol edilecek paragraf yok. En az 12 kelimelik kendi paragrafların kontrol edilir." }); return; }
    setSim({ busy: true, open: true }); setSimHidden(new Set());
    try {
      const r = await api(`/collections/${notebookId}/similarity`, { method: "POST", body: JSON.stringify({ paragraphs }) }, 1);
      setSim({ busy: false, open: true, results: r.results || [], quoted: r.quoted || [], checked: r.checked ?? paragraphs.length, note: r.note,
        snap: Object.fromEntries(paragraphs.map((x) => [x.id, x.text])) });
    } catch (e: any) { setSim({ busy: false, open: true, error: e?.message || "Benzerlik kontrolü yapılamadı; birazdan tekrar dene." }); }
  }
  // Etkin isaretler: yoksayilmamis ve paragrafi kontrolden sonra degismemis olanlar
  const simById = useMemo(() => {
    const m: Record<string, SRes> = {};
    for (const r of sim?.results || []) {
      if (simHidden.has(r.id)) continue;
      const b = blocks.find((x) => x.id === r.id);
      if (b && b.type === "p" && sim?.snap?.[r.id] === b.text) m[r.id] = r;
    }
    return m;
  }, [sim, simHidden, blocks]);
  const simActive = Object.values(simById);
  const simHigh = simActive.filter((r) => r.level === "yuksek").length;
  const simMid = simActive.length - simHigh;
  function hideSim(id: string) { setSimHidden((h) => new Set(h).add(id)); }
  function toQuote(idx: number, r: SRes) {
    const b = blocks[idx];
    if (!b || b.type !== "p") return;
    const text = b.text.trim().replace(/^["“«„]+\s*/, "").replace(/\s*["”»]+$/, "").replace(/\s+/g, " ");
    const n = [...blocks];
    n[idx] = { id: b.id, type: "quote", text, source: r.source.title, page: r.source.page ?? null, document_id: r.source.document_id, color: "#E0A233" };
    if (idx + 1 >= n.length || n[idx + 1].type !== "p") n.splice(idx + 1, 0, { id: uid(), type: "p", text: "" });
    update(n); hideSim(r.id);
    setFlash("Alıntıya çevrildi"); setTimeout(() => setFlash(""), 1500);
  }
  function jumpTo(id: string) {
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    setFocusIdx(i);
    document.getElementById("blk-" + id)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const SMETA = {
    yuksek: { t: "Yüksek benzerlik", card: "border-red-600/40 bg-red-500/5", bar: "bg-red-500", ink: "text-red-800 dark:text-red-300" },
    orta: { t: "Orta benzerlik", card: "border-orange-500/40 bg-orange-500/5", bar: "bg-orange-400", ink: "text-orange-800 dark:text-orange-300" },
  } as const;

  // otomatik kayit: 1 sn bekler; sekme degisince/bilesen kalkinca bekleyen kayit IPTAL EDILMEZ, hemen gonderilir.
  function persist(v: number): Promise<boolean> {
    const prev = inflight.current;
    const p = (async () => {
      if (prev) { try { await prev; } catch {} }
      // Beklerken daha yeni bir surum kaydedildiyse bu eski surumu gonderme
      if (savedVersion.current >= v) return true;
      return send(serializeDraft(latest.current), version.current);
    })();
    inflight.current = p;
    p.finally(() => { if (inflight.current === p) inflight.current = null; });
    return p;
  }
  async function send(ser: string, v: number, depth = 0): Promise<boolean> {
    try {
      const payload: { draft: string; draft_rev?: number } = { draft: ser };
      if (rev.current >= 0) payload.draft_rev = rev.current;
      const r = await api(`/collections/${notebookId}`, { method: "PATCH", body: JSON.stringify(payload) }, 1);
      if (r && r.conflict && depth < 3) {
        // Taslak baska yerden guncellenmis: sunucudaki yeni bloklari yerel taslagin sonuna ekle, sonra yeniden kaydet
        const remote = parseDraft(r.draft);
        if (typeof r.draft_rev === "number") rev.current = r.draft_rev;
        const m = mergeRemote(latest.current, remote, baseIds.current);
        baseIds.current = new Set(remote.map((b) => b.id));
        if (m.added) {
          latest.current = m.blocks;
          if (mounted.current) {
            skipSave.current = true;
            setBlocks(m.blocks);
            toast.info(m.added === 1 ? "Taslak başka yerden güncellendi; eklenen alıntı sona kondu." : `Taslak başka yerden güncellendi; eklenen ${m.added} parça sona kondu.`);
          }
        }
        return send(serializeDraft(m.blocks), v, depth + 1);
      }
      if (typeof r?.draft_rev === "number") rev.current = r.draft_rev;
      baseIds.current = new Set(parseDraft(ser).map((b) => b.id));
      if (v > savedVersion.current) savedVersion.current = v;
      failures.current = 0;
      if (savedVersion.current >= version.current) { try { localStorage.removeItem(BACKUP_KEY); localStorage.removeItem(BASE_KEY); } catch {} }
      onSavedRef.current?.(ser, rev.current >= 0 ? rev.current : undefined);
      if (mounted.current) {
        setRetryIn(0);
        if (savedVersion.current >= version.current) { setStatus("saved"); setSavedAt(new Date()); }
      }
      return true;
    } catch {
      failures.current++;
      if (mounted.current) {
        setStatus("error");
        // artan beklemeyle otomatik tekrar: 3, 6, 12, 24, 30 sn
        const wait = Math.min(30, 3 * 2 ** Math.min(4, failures.current - 1));
        setRetryIn(wait);
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { if (savedVersion.current < version.current) saveNow(); }, wait * 1000);
      }
      return false;
    }
  }
  function saveNow() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    if (savedVersion.current >= version.current) return;
    if (mounted.current) { setStatus("saving"); setRetryIn(0); }
    return persist(version.current);
  }
  useEffect(() => {
    latest.current = blocks;
    if (skipSave.current) { skipSave.current = false; return; }
    if (!dirty.current) return;
    version.current++;
    try { localStorage.setItem(BACKUP_KEY, serializeDraft(blocks)); localStorage.setItem(BASE_KEY, JSON.stringify(Array.from(baseIds.current))); } catch {}
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; saveNow(); }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, notebookId]);
  useEffect(() => {
    mounted.current = true;
    if (restored) { dirty.current = true; version.current++; setFlash("Kaydedilmemiş son değişikliklerin geri yüklendi"); saveNow(); }
    else refreshRemote();
    // Sekmeye donunce: taslak baska yerden (okuyucu) guncellendiyse tazele
    const onVisible = () => { if (document.visibilityState === "visible") refreshRemote(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    // Baglanti gelince bekleyen kaydi hemen dene
    const onOnline = () => { if (savedVersion.current < version.current) saveNow(); };
    // Kaydedilmemis degisiklik varken sayfadan cikista tarayici uyarisi + son bir deneme
    const onUnload = (e: BeforeUnloadEvent) => {
      if (savedVersion.current >= version.current) return;
      try {
        fetch(`${API}/collections/${notebookId}`, { method: "PATCH", keepalive: true,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + (getToken() || "") },
          body: JSON.stringify(rev.current >= 0 ? { draft: serializeDraft(latest.current), draft_rev: rev.current } : { draft: serializeDraft(latest.current) }) });
      } catch {}
      e.preventDefault(); e.returnValue = "";
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      mounted.current = false;
      // Sekme degisti / bilesen kalkti: bekleyen kaydi gonder (iptal etme)
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
      if (savedVersion.current < version.current) persist(version.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  // Sunucudaki taslak daha yeniyse ve bekleyen yerel degisiklik yoksa sunucudakini goster.
  // Bekleyen degisiklik varsa bir sey yapma: siradaki kayit kosullu gider ve birlestirir.
  const refreshing = useRef(false);
  async function refreshRemote() {
    if (rev.current < 0 || refreshing.current) return;
    refreshing.current = true;
    try {
      const r = await api(`/collections/${notebookId}/draft`, {}, 1);
      if (!mounted.current || typeof r?.draft_rev !== "number" || r.draft_rev === rev.current) return;
      const idle = savedVersion.current >= version.current && !timer.current && !inflight.current;
      if (!idle) return;
      const remote = parseDraft(r.draft);
      rev.current = r.draft_rev;
      baseIds.current = new Set(remote.map((b) => b.id));
      skipSave.current = true;
      setBlocks(remote);
      onSavedRef.current?.(r.draft || "", r.draft_rev);
      toast.info("Taslak başka yerden güncellendi, yenilendi.");
    } catch { /* sessiz: bir sonraki kayit zaten birlestirir */ }
    finally { refreshing.current = false; }
  }

  function update(next: Block[]) { dirty.current = true; setBlocks(next); }
  function insertAfter(idx: number, b: Block) {
    const at = idx < 0 || idx >= blocks.length ? blocks.length : idx + 1;
    const next = [...blocks]; next.splice(at, 0, b);
    // alinti/cevap kartindan sonra yazmak icin bos paragraf
    if (b.type !== "p" && (at + 1 >= next.length || next[at + 1].type !== "p")) next.splice(at + 1, 0, { id: uid(), type: "p", text: "" });
    update(next); setFocusIdx(at);
    setFlash("Eklendi"); setTimeout(() => setFlash(""), 1200);
  }
  // Sohbet'ten gelenler
  useEffect(() => {
    if (!inbox.length) return;
    let next = [...blocks]; let at = focusIdx >= 0 ? focusIdx + 1 : next.length;
    for (const b of inbox) { next.splice(at, 0, b); at++; if (at >= next.length || next[at].type !== "p") { next.splice(at, 0, { id: uid(), type: "p", text: "" }); } }
    update(next); onInboxConsumed(); setFlash("Sohbet cevabı eklendi"); setTimeout(() => setFlash(""), 1500);
  }, [inbox]);

  function setText(idx: number, text: string) { const n = [...blocks]; (n[idx] as any) = { ...n[idx], text }; update(n); }
  function removeAt(idx: number) { const n = blocks.filter((_, i) => i !== idx); update(n.length ? n : [{ id: uid(), type: "p", text: "" }]); }
  function move(idx: number, d: -1 | 1) { const j = idx + d; if (j < 0 || j >= blocks.length) return; const n = [...blocks]; [n[idx], n[j]] = [n[j], n[idx]]; update(n); setFocusIdx(j); }
  function addParagraph(idx: number, type: "p" | "h" = "p") { insertAfter(idx, { id: uid(), type, text: "" } as Block); }

  function download(kind: "md" | "doc") {
    const blob = kind === "md"
      ? new Blob([toMarkdown(title, blocks)], { type: "text/markdown;charset=utf-8" })
      : new Blob([toWordHtml(title, blocks)], { type: "application/msword" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${title}.${kind}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const words = useMemo(() => ownWords(blocks), [blocks]);
  const verifyN = Math.max(1, blocks.filter((b) => b.type === "p" && b.text.trim().split(/\s+/).length >= 6).length);
  const quotes = blocks.filter((b) => b.type === "quote").length;
  const used = new Set(blocks.filter((b) => b.type === "quote").map((b: any) => b.text.trim()));
  const mats = (material || []).filter((n: any) => !matQ.trim() || (n.selected_text || "").toLowerCase().includes(matQ.toLowerCase()) || (n.note_content || "").toLowerCase().includes(matQ.toLowerCase()));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          <span><b className="text-text-primary">{words}</b> kelime senin</span>
          <span>·</span>
          <span>{quotes} alıntı</span>
          <span>·</span>
          <span role="status" className={status === "error" ? "text-danger" : ""}>
            {status === "saving" ? "defterde kaydediliyor…" : status === "saved" && savedAt ? `defterde kaydedildi · ${savedAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : status === "error" ? `kaydedilemedi — bağlantıyı kontrol et${retryIn ? ` · ${retryIn} sn içinde yeniden denenecek` : ""}` : "değişiklik yok"}
          </span>
          {status === "error" && (
            <button onClick={() => saveNow()} className="min-h-[32px] rounded-lg border border-danger/40 px-2 text-danger hover:bg-danger/5">Şimdi dene</button>
          )}
          {flash && <span className="text-accent-purple">{flash}</span>}
          <span className="ml-auto flex gap-1.5">
            <button onClick={runVerify} disabled={ver?.busy}
                    title={`Yazdığın her iddiayı defterin kaynaklarıyla karşılaştır · ${costTitle(verifyN)} (daha önce kontrol edilen cümleler ücretsiz)`}
                    className="flex min-h-[36px] items-center gap-1 rounded-lg border border-green-600/40 bg-green-500/5 px-2.5 py-1 text-green-800 hover:bg-green-500/10 disabled:opacity-60 dark:text-green-300">
              {ver?.busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Kaynaklarla doğrula <Cost n={verifyN} />
            </button>
            <button onClick={runSimilarity} disabled={sim?.busy}
                    title="Yazdığın paragrafların kaynaklardaki cümlelerle ne kadar aynı olduğuna bakar; alıntı olarak işaretlemen ya da kendi cümlelerinle yazman gereken yerleri gösterir · ücretsiz"
                    className="flex min-h-[40px] items-center gap-1 rounded-lg border border-orange-500/40 bg-orange-500/5 px-2.5 py-1 text-orange-800 hover:bg-orange-500/10 disabled:opacity-60 dark:text-orange-300">
              {sim?.busy ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} aria-hidden />} Benzerlik kontrolü
            </button>
            <button onClick={() => download("md")} className="min-h-[36px] rounded-lg border bg-surface px-2.5 py-1 hover:border-accent-purple/50">Markdown</button>
            <button onClick={() => download("doc")} className="min-h-[36px] rounded-lg border bg-surface px-2.5 py-1 hover:border-accent-purple/50">Word</button>
          </span>
        </div>

        {ver?.open && (
          <div className="mb-3 rounded-2xl border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium"><ShieldCheck size={15} className="text-green-700" /> İddia doğrulama</p>
              {ver.counts && Object.entries(VMETA).map(([k, m]) => (
                <span key={k} className={cx("rounded-full border px-2 py-0.5 text-[11px]", m.c)}>{m.t}: {ver.counts?.[k] || 0}</span>
              ))}
              <button onClick={() => setVer(null)} aria-label="Doğrulama sonuçlarını kapat" className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted"><X size={15} /></button>
            </div>
            {ver.busy && <p className="mt-2 flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" /> Her cümle için kanıt aranıyor…</p>}
            {ver.error && <p className="mt-2 text-sm text-danger">{ver.error}</p>}
            {!!ver.results?.length && (
              <>
                <p className="mt-1 text-[11px] text-text-secondary">
                  Yalnız defterindeki kaynaklara göre değerlendirildi{ver.cached ? ` · ${ver.cached} cümle daha önce kontrol edilmişti (ücretsiz)` : ""}.
                </p>
                <ul className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                  {[...ver.results].sort((a, b) => RANK[b.verdict] - RANK[a.verdict]).map((r, k) => (
                    <li key={k} className={cx("rounded-xl border p-2.5 text-sm", VMETA[r.verdict].c)}>
                      <div className="flex items-start gap-2">
                        <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", VMETA[r.verdict].dot)} />
                        <div className="min-w-0 flex-1">
                          <p className="text-text-primary">{r.sentence}</p>
                          <p className="mt-0.5 text-[12px]"><b>{VMETA[r.verdict].t}</b>{r.note ? " — " + r.note : ""}</p>
                          {r.evidence && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <button onClick={() => router.push("/documents/" + r.evidence!.document_id + (r.evidence!.page ? "?page=" + r.evidence!.page : ""))}
                                      className="flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-[11px] text-text-secondary hover:text-accent-purple">
                                <ExternalLink size={10} /> {r.evidence.title}{r.evidence.time ? " · ▶ " + r.evidence.time : r.evidence.page ? ` · ${r.evidence.unit || "s."} ${r.evidence.page}` : ""}
                              </button>
                              {(r.verdict === "destek" || r.verdict === "kismi") && (
                                <button onClick={() => addEvidence(r)} className="rounded-full border border-green-600/40 bg-surface px-2 py-0.5 text-[11px] text-green-800 hover:bg-green-500/10">
                                  + Kanıtı alıntı olarak ekle
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {sim?.open && (
          <div className="mb-3 rounded-2xl border bg-surface p-4" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium"><Copy size={15} className="text-orange-700" aria-hidden /> Benzerlik kontrolü</p>
              <span className="text-xs text-text-secondary">ücretsiz · yapay zekâ kullanmaz</span>
              <button onClick={() => setSim(null)} aria-label="Benzerlik sonuçlarını kapat" className="ml-auto flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted"><X size={15} /></button>
            </div>
            {sim.busy && <p className="mt-2 flex items-center gap-2 text-sm text-text-secondary" role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> Paragrafların kaynaklarla karşılaştırılıyor…</p>}
            {sim.error && <p className="mt-2 text-sm text-danger">{sim.error}</p>}
            {sim.results && !sim.busy && (
              <>
                <p className="mt-1 text-sm">
                  {simActive.length === 0
                    ? `Belirgin benzerlik bulunmadı (${sim.checked || 0} paragraf kontrol edildi).`
                    : [simHigh ? `${simHigh} paragraf yüksek` : "", simMid ? `${simMid} orta` : ""].filter(Boolean).join(", ") + " benzerlik"}
                  {sim.quoted?.length ? ` · ${sim.quoted.length} paragraf tırnak ve atıf taşıdığı için alıntı sayıldı` : ""}
                </p>
                {sim.note && <p className="mt-1 text-xs text-text-secondary">{sim.note}</p>}
                <p className="mt-1 text-xs text-text-secondary">
                  Yazdığın paragrafların defterindeki kaynaklarla kelimesi kelimesine ne kadar örtüştüğüne bakar. İddiaların kaynakta geçip geçmediğini görmek için “Kaynaklarla doğrula”yı kullan.
                </p>
                {simActive.length > 1 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {simActive.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => jumpTo(r.id)}
                                className={cx("flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-xs", SMETA[r.level].card)}>
                          <span aria-hidden className={cx("h-2 w-2 rounded-full", SMETA[r.level].bar)} />
                          Paragraf {blocks.findIndex((b) => b.id === r.id) + 1} · %{Math.round(r.score * 100)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        <div className="rounded-2xl border bg-surface p-4 md:p-6">
          {blocks.map((b, i) => (
            <div key={b.id} id={"blk-" + b.id} className="group relative" onFocus={() => setFocusIdx(i)} onClick={() => setFocusIdx(i)}>
              {/* Yapay zekayla duzenle (sag ust): odaktaki blokta, dokunmatikte ve klavye odaginda gorunur */}
              {(b.type === "p" || b.type === "h" || b.type === "quote") && (
                <div className={cx("absolute right-0 top-1 z-10 transition",
                  focusIdx === i || (assist?.idx === i && assist.menu) ? "opacity-100"
                    : "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 md:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:opacity-100")}>
                  <button onClick={(e) => { e.stopPropagation(); setAssist(assist?.idx === i && assist.menu ? null : { idx: i, action: "", busy: false, menu: true }); }}
                          aria-haspopup="menu" aria-expanded={assist?.idx === i && !!assist.menu}
                          title={"Yapay zekâyla düzenle · " + costTitle(1)}
                          className="flex min-h-[32px] items-center gap-1 rounded-full border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple focus-visible:opacity-100">
                    <Wand2 size={12} /> Düzenle <Cost n={1} />
                  </button>
                  {assist?.idx === i && assist.menu && (
                    <div role="menu" onClick={(e) => e.stopPropagation()}
                         onKeyDown={(e) => { if (e.key === "Escape") setAssist(null); }}
                         className="absolute right-0 top-9 w-64 overflow-hidden rounded-xl border bg-surface shadow-lg">
                      {(b.type === "quote"
                        ? [["paraphrase", "Kendi cümlemle yeniden yaz", "Parafraz; alıntının altına paragraf olarak girer"]]
                        : ACTIONS).map(([k, label, desc], mi) => (
                        <button key={k} role="menuitem" autoFocus={mi === 0}
                                onClick={() => { if (k === "custom") setAssist({ idx: i, action: "custom", busy: false, menu: false }); else runAssist(i, k); }}
                                title={costTitle(1)}
                                className="block w-full px-3 py-2 text-left hover:bg-surface-muted focus-visible:bg-surface-muted">
                          <span className="flex items-center text-sm">{label} <Cost n={1} /></span>
                          <span className="block text-[11px] text-text-secondary">{desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {b.type === "p" && worst[b.id] && (
                <span title={"Doğrulama: " + VMETA[worst[b.id]].t}
                      className={cx("absolute -left-3 top-2.5 h-[calc(100%-1rem)] w-1 rounded-full", VMETA[worst[b.id]].dot)} />
              )}
              {b.type === "p" && (
                <AutoTextarea value={b.text} focus={focusIdx === i}
                              onChange={(v) => setText(i, v)}
                              onEnterNew={() => addParagraph(i)}
                              placeholder={i === 0 && blocks.length === 1 ? "Buraya yaz. Sağdaki alıntıları tıklayarak araya kart olarak ekle; Ctrl+Enter yeni paragraf." : "Yaz…"}
                              className={cx("w-full resize-none bg-transparent py-1.5 text-[15px] leading-[1.8] outline-none placeholder:text-text-secondary/60", focusIdx === i && "pr-32")} />
              )}
              {b.type === "p" && simById[b.id] && (() => {
                const r = simById[b.id]; const M = SMETA[r.level]; const pct = Math.round(r.score * 100);
                return (
                  <>
                    <span aria-hidden className={cx("absolute -right-2.5 top-2.5 h-[calc(100%-1rem)] w-1 rounded-full", M.bar)} />
                    <div className={cx("my-2 rounded-xl border p-3 text-sm", M.card)} role="group" aria-label={M.t}>
                      <p className={cx("flex items-start gap-1.5 font-medium", M.ink)}>
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {M.t}
                      </p>
                      <p className="mt-1 text-text-primary">
                        Bu paragrafın %{pct}&apos;{pctPoss(pct)} «{r.source.title}»{r.source.page ? ` s.${r.source.page}` : ""} ile aynı
                        {r.longest >= 12 ? `; ${r.longest} kelimelik bir bölüm birebir geçiyor` : ""}.
                      </p>
                      {r.match && <p className="mt-1.5 line-clamp-3 border-l-2 border-black/15 pl-2 text-xs italic text-text-secondary">Kaynakta: {r.match}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => toQuote(i, r)}
                                title="Paragrafı kaynak ve sayfa atıflı alıntı kartına dönüştürür (ücretsiz)"
                                className="flex min-h-[40px] items-center gap-1 rounded-lg border bg-surface px-3 text-text-primary hover:border-accent-purple/50">
                          <Quote size={13} aria-hidden /> Alıntıya çevir
                        </button>
                        <button type="button" onClick={() => runAssist(i, "paraphrase")} title={costTitle(1)}
                                className="flex min-h-[40px] items-center gap-1 rounded-lg border bg-surface px-3 text-text-primary hover:border-accent-purple/50">
                          <Wand2 size={13} aria-hidden /> Kendi cümlelerimle yeniden yaz <Cost n={1} />
                        </button>
                        <button type="button" onClick={() => hideSim(r.id)}
                                className="min-h-[40px] rounded-lg px-3 text-text-secondary hover:bg-surface-muted">
                          Yoksay
                        </button>
                        <button type="button" onClick={() => router.push("/documents/" + r.source.document_id + (r.source.page ? "?page=" + r.source.page : ""))}
                                className="flex min-h-[40px] items-center gap-1 rounded-lg px-3 text-text-secondary hover:bg-surface-muted">
                          <ExternalLink size={13} aria-hidden /> Kaynakta gör
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
              {b.type === "h" && (
                <AutoTextarea value={b.text} focus={focusIdx === i} onChange={(v) => setText(i, v)} onEnterNew={() => addParagraph(i)}
                              placeholder="Başlık" className={cx("w-full resize-none bg-transparent py-2 font-heading text-2xl leading-tight outline-none placeholder:text-text-secondary/60", focusIdx === i && "pr-32")} />
              )}
              {b.type === "quote" && (
                <div className="my-2 rounded-xl border bg-surface-muted/50 p-3" style={{ borderLeft: `4px solid ${b.color || "#E0A233"}` }}>
                  <div className="flex items-start gap-2">
                    <Quote size={14} className="mt-0.5 shrink-0 text-text-secondary" />
                    <p className="text-[14px] leading-relaxed text-text-primary">{b.text}</p>
                  </div>
                  {b.note && <p className="mt-2 pl-6 text-sm italic text-text-secondary">{b.note}</p>}
                  <button onClick={() => router.push("/documents/" + b.document_id + (b.page ? "?page=" + b.page : ""))}
                          className="mt-2 ml-6 flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                    <ExternalLink size={10} /> {cite(b)}
                  </button>
                </div>
              )}
              {b.type === "answer" && (
                <div className="my-2 rounded-xl border border-accent-purple/30 bg-accent-purple/5 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-accent-purple"><Sparkles size={12} /> Sohbet cevabı</div>
                  <p className="mt-1 text-sm font-medium">{b.q}</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed">{b.text}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {b.sources.map((s, j) => (
                      <button key={j} onClick={() => router.push("/documents/" + s.document_id + (s.page ? "?page=" + s.page : ""))}
                              className="rounded-full border bg-surface px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                        [K{j + 1}] {s.title}{s.page ? " · s." + s.page : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* AI onerisi */}
              {assist && assist.idx === i && !assist.menu && (
                <div className="my-2 rounded-xl border border-accent-purple/40 bg-accent-purple/5 p-3 text-sm">
                  {assist.action === "custom" && assist.text === undefined && !assist.busy && (
                    <div className="flex gap-2">
                      <input autoFocus value={customInstr} aria-label="Düzenleme talimatı" onChange={(e) => setCustomInstr(e.target.value)}
                             onKeyDown={(e) => { if (e.key === "Enter" && customInstr.trim()) runAssist(i, "custom", customInstr.trim()); if (e.key === "Escape") setAssist(null); }}
                             placeholder="Örn: iki cümleye indir ve daha net bir iddiayla başla"
                             className="flex-1 rounded-lg border bg-surface px-3 py-1.5 outline-none focus:border-accent-purple" />
                      <button onClick={() => customInstr.trim() && runAssist(i, "custom", customInstr.trim())} title={costTitle(1)} className="flex min-h-[40px] items-center rounded-lg bg-accent-purple px-3 py-1.5 text-white">Uygula <Cost n={1} className="bg-white/20" /></button>
                      <button onClick={() => setAssist(null)} className="rounded-lg border px-2 py-1.5 text-text-secondary">Vazgeç</button>
                    </div>
                  )}
                  {assist.busy && <p className="flex items-center gap-2 text-text-secondary"><Loader2 size={14} className="animate-spin" /> Hazırlanıyor…</p>}
                  {assist.error && <p className="text-danger">{assist.error} <button onClick={() => setAssist(null)} className="ml-2 underline">kapat</button></p>}
                  {assist.text !== undefined && !assist.busy && (
                    <>
                      <p className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-accent-purple"><Sparkles size={11} /> Öneri — {assist.action === "paraphrase" ? "kendi cümlelerinle" : assist.action === "shorten" ? "kısaltılmış" : assist.action === "academic" ? "akademik ton" : "düzenlenmiş"}</p>
                      <p className="whitespace-pre-wrap leading-relaxed">{assist.text}</p>
                      <div className="mt-2 flex gap-2">
                        <button onClick={applyAssist} className="flex items-center gap-1 rounded-lg bg-accent-purple px-3 py-1.5 text-white"><Check size={13} /> {assist.action === "paraphrase" ? (blocks[assist.idx]?.type === "quote" ? "Altına paragraf olarak ekle" : "Paragrafın yerine koy") : "Uygula"}</button>
                        <button onClick={() => runAssist(i, assist.action, customInstr.trim() || undefined)} title={costTitle(1)} className="flex min-h-[40px] items-center rounded-lg border px-3 py-1.5 text-text-secondary">Tekrar dene <Cost n={1} /></button>
                        <button onClick={() => setAssist(null)} className="rounded-lg border px-3 py-1.5 text-text-secondary">Vazgeç</button>
                      </div>
                    </>
                  )}
                  {assist.suggestions && !assist.busy && (
                    <>
                      <p className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-accent-purple"><Sparkles size={11} /> Bu paragrafı destekleyebilecek vurgular</p>
                      {assist.suggestions.length === 0 ? (
                        <p className="text-text-secondary">{assist.why || "Uygun vurgu bulunamadı."}</p>
                      ) : (
                        <div className="space-y-1.5">
                          {assist.suggestions.map((sg: any, k: number) => (
                            <button key={sg.id} onClick={() => addSuggested(sg)} title="Alıntı kartı olarak ekle"
                                    className="block w-full rounded-lg border bg-surface p-2 text-left hover:border-accent-purple/50">
                              <p className="line-clamp-2 text-xs leading-relaxed" style={{ borderLeft: "3px solid " + (sg.color || "#FFE78A"), paddingLeft: 8 }}>[{k + 1}] {sg.text}</p>
                              <p className="mt-0.5 text-[11px] text-text-secondary">{sg.document_title}{sg.page ? " · s." + sg.page : ""} · uyum %{Math.round((sg.score || 0) * 100)}</p>
                            </button>
                          ))}
                          {assist.why && <p className="whitespace-pre-wrap pt-1 text-[11px] text-text-secondary">{assist.why}</p>}
                        </div>
                      )}
                      <button onClick={() => setAssist(null)} className="mt-2 rounded-lg border px-3 py-1.5 text-text-secondary">Kapat</button>
                    </>
                  )}
                </div>
              )}

              {/* blok araclari: odaktaki blokta her zaman; masaustunde uzerine gelince/klavye odaginda */}
              <div className={cx("items-center justify-center gap-1 transition",
                focusIdx === i ? "flex py-1" : "hidden md:flex md:h-3 md:opacity-0 md:group-hover:h-auto md:group-hover:opacity-100 md:group-focus-within:h-auto md:group-focus-within:opacity-100")}>
                {([
                  [() => addParagraph(i), "Altına paragraf ekle", Plus],
                  [() => addParagraph(i, "h"), "Altına başlık ekle", Heading2],
                  [() => move(i, -1), "Bloğu yukarı taşı", ArrowUp],
                  [() => move(i, 1), "Bloğu aşağı taşı", ArrowDown],
                  [() => removeAt(i), "Bloğu kaldır", X],
                ] as const).map(([fn, label, Icon]) => (
                  <button key={label} type="button" onClick={(e) => { e.stopPropagation(); fn(); }} aria-label={label} title={label}
                          className={cx("flex h-10 w-10 items-center justify-center rounded-full border bg-surface text-text-secondary md:h-8 md:w-8",
                            label === "Bloğu kaldır" ? "hover:text-danger" : "hover:text-accent-purple")}>
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-secondary">
          Kendi yazdıkların düz metin olarak görünür. Renkli kenarlı kartlar kaynaklardan alıntı, mor kartlar sohbet cevabıdır; kartların içine yazılmaz, altına paragraf açılır.
          Bir bloğa dokun ya da üzerine gel: taşı, sil, araya paragraf ekle.
        </p>
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border bg-surface p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Vurguların</p>
            <button onClick={onReloadMaterial} title="Vurguları yenile" aria-label="Vurguları yenile" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted"><RefreshCw size={14} /></button>
          </div>
          <input value={matQ} onChange={(e) => setMatQ(e.target.value)} placeholder="Vurgularda ara…" aria-label="Vurgularda ara"
                 className="mb-2 w-full rounded-lg border bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent-purple" />
          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
            {material === null ? (
              <p className="p-3 text-xs text-text-secondary">Yükleniyor…</p>
            ) : mats.length === 0 ? (
              <p className="p-3 text-xs text-text-secondary">Bu defterin kaynaklarında vurgu yok. Bir kaynakta metin seç, renk ver — burada belirir.</p>
            ) : mats.map((n: any) => {
              const inUse = used.has((n.selected_text || "").trim());
              return (
                <button key={n.id}
                        onClick={() => insertAfter(focusIdx, {
                          id: uid(), type: "quote", text: (n.selected_text || n.note_content || "").trim().replace(/\s+/g, " "),
                          note: n.selected_text ? (n.note_content || "").trim() || undefined : undefined,
                          color: n.highlight_color, source: n.document_title, page: n.page_number ?? null, document_id: n.document_id,
                        })}
                        title="Taslağa alıntı kartı olarak ekle"
                        className={cx("block w-full rounded-lg border bg-surface p-2.5 text-left hover:border-accent-purple/50", inUse && "opacity-50")}>
                  {n.selected_text && <p className="line-clamp-3 text-xs leading-relaxed" style={{ borderLeft: "3px solid " + (n.highlight_color || "#FFE78A"), paddingLeft: 8 }}>{n.selected_text}</p>}
                  {n.note_content && <p className="mt-1 line-clamp-2 text-xs italic text-text-secondary">{n.note_content}</p>}
                  <p className="mt-1 text-[11px] text-text-secondary">{n.document_title}{n.page_number ? " · s." + n.page_number : ""}{inUse ? " · taslakta" : ""}</p>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

function AutoTextarea({ value, onChange, onEnterNew, placeholder, className, focus }: {
  value: string; onChange: (v: string) => void; onEnterNew: () => void; placeholder?: string; className?: string; focus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = "0px"; el.style.height = el.scrollHeight + "px"; }, [value]);
  useEffect(() => { if (focus && ref.current && document.activeElement !== ref.current && !value) ref.current.focus(); }, [focus]);
  return (
    <textarea ref={ref} value={value} rows={1} placeholder={placeholder} className={className} spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onEnterNew(); } }} />
  );
}
