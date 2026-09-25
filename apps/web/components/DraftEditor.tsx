"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API, getToken } from "@/lib/api";
import { ArrowUp, ArrowDown, X, Plus, ExternalLink, Sparkles, Quote, RefreshCw, Heading2, Wand2, Loader2, Check, ShieldCheck } from "lucide-react";
import { Cost, costTitle, isUsageLimit } from "@/components/CostBadge";

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
export function ownWords(blocks: Block[]) {
  return blocks.filter((b) => b.type === "p" || b.type === "h").map((b: any) => b.text.trim()).filter(Boolean).join(" ").split(/\s+/).filter(Boolean).length;
}

/* ---------- editor ---------- */
export default function DraftEditor({ notebookId, title, initial, material, onReloadMaterial, inbox, onInboxConsumed, onSaved }: {
  notebookId: string; title: string; initial: string | null | undefined;
  material: any[] | null; onReloadMaterial: () => void;
  inbox: Block[]; onInboxConsumed: () => void;
  onSaved?: (serialized: string) => void;
}) {
  const router = useRouter();
  // Kaydedilemeden kalan son surum cihazda yedeklenir; geri gelince oradan devam edilir (veri kaybi olmasin).
  const BACKUP_KEY = "draft.pending." + notebookId;
  const [restored] = useState<string | null>(() => {
    try { const b = localStorage.getItem(BACKUP_KEY); return b && b !== (initial || "") ? b : null; } catch { return null; }
  });
  const [blocks, setBlocks] = useState<Block[]>(() => parseDraft(restored ?? initial));
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
  async function send(ser: string, v: number): Promise<boolean> {
    try {
      await api(`/collections/${notebookId}`, { method: "PATCH", body: JSON.stringify({ draft: ser }) }, 1);
      if (v > savedVersion.current) savedVersion.current = v;
      failures.current = 0;
      if (savedVersion.current >= version.current) { try { localStorage.removeItem(BACKUP_KEY); } catch {} }
      onSavedRef.current?.(ser);
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
    if (!dirty.current) return;
    version.current++;
    try { localStorage.setItem(BACKUP_KEY, serializeDraft(blocks)); } catch {}
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; saveNow(); }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, notebookId]);
  useEffect(() => {
    mounted.current = true;
    if (restored) { dirty.current = true; version.current++; setFlash("Kaydedilmemiş son değişikliklerin geri yüklendi"); saveNow(); }
    // Baglanti gelince bekleyen kaydi hemen dene
    const onOnline = () => { if (savedVersion.current < version.current) saveNow(); };
    // Kaydedilmemis degisiklik varken sayfadan cikista tarayici uyarisi + son bir deneme
    const onUnload = (e: BeforeUnloadEvent) => {
      if (savedVersion.current >= version.current) return;
      try {
        fetch(`${API}/collections/${notebookId}`, { method: "PATCH", keepalive: true,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + (getToken() || "") },
          body: JSON.stringify({ draft: serializeDraft(latest.current) }) });
      } catch {}
      e.preventDefault(); e.returnValue = "";
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onUnload);
      mounted.current = false;
      // Sekme degisti / bilesen kalkti: bekleyen kaydi gonder (iptal etme)
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
      if (savedVersion.current < version.current) persist(version.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

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

        <div className="rounded-2xl border bg-surface p-4 md:p-6">
          {blocks.map((b, i) => (
            <div key={b.id} className="group relative" onFocus={() => setFocusIdx(i)} onClick={() => setFocusIdx(i)}>
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
                        <button onClick={applyAssist} className="flex items-center gap-1 rounded-lg bg-accent-purple px-3 py-1.5 text-white"><Check size={13} /> {assist.action === "paraphrase" ? "Altına paragraf olarak ekle" : "Uygula"}</button>
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
