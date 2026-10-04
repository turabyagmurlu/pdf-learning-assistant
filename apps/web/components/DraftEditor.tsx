"use client";
/**
 * Taslak editörü — iki kapsam, tek editör (SPEC-v2 "DraftEditor sözleşmesi"):
 *   <DraftEditor scope={{ kind: "collection" | "document", id }} title compact? onOpenPage? />
 * - Verisini kapsamına göre kendisi çeker (components/draft/scope.ts).
 * - Otomatik kayıt (1 sn), koşullu yazım (draft_rev); çakışmada (defter 200+conflict, belge 409) tazeler,
 *   yerel değişikliği korur (mergeRemote). Kaydedilemeyen son hâl cihazda yedeklenir.
 * - Sekme odaklanınca ve 5 sn'de bir sunucu sürümüne (draft_rev) bakar; okuyucu bir vurgu kaydedince
 *   (`hooks/useAnnotations` → window "typdf:draft-changed") anında bakar. Sunucudan gelen yeni bloklar
 *   yerel değişiklik beklerken de (mergeRemote ile sona eklenerek) hemen listeye girer; kendiliğinden
 *   biriken (auto) vurgular `.gilded` altın parıltıyla belirir.
 * - ref (DraftEditorHandle): `openExport()` dışa aktarma menüsünü açar (defter "Daha fazla → Dışa aktar"),
 *   `refresh()` sunucu sürümünü hemen sorgular.
 * - 3.0 "Çalışma notu → Biriktirdiklerin": sade araç çubuğu (Vurguları getir · Sayfa sırasına diz · Dışa aktar · ⋯ [Önceki sürümler]).
 *   AI düzenle menüsü ve "Atölyede çalış" KALKTI. Her alıntının yanında "Sor": window "typdf:ask" olayı
 *   ({text, page, document_id}) → Sor paneli/sekmesi alıntıyı soruya ekler.
 * - compact: okuyucu yan paneli — tek sütun, küçük araç çubuğu.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardedRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, API, getToken, errorMessage } from "@/lib/api";
import { docHref } from "@/lib/links";
import { mdToPlain, mdToHtml, mdNormalize } from "@/lib/markdown";
import { pigmentName } from "@/lib/reader";
import type { InkStroke } from "@/lib/ink";
import {
  ArrowUp, ArrowDown, X, Plus, Sparkles, RefreshCw, Heading2, Loader2,
  Download, ChevronDown, History, Share2, TextCursorInput, ListOrdered, BookOpen, MoreHorizontal,
} from "lucide-react";
import { toast } from "@/components/Toast";
import CitedText from "@/components/CitedText";
import Modal from "@/components/Modal";
import { Skeleton } from "@/components/Skeleton";
import { Fleuron, DropCap } from "@/components/art";
import QuoteCard, { quotePigment } from "@/components/draft/QuoteCard";
import EmptyDraft from "@/components/draft/EmptyDraft";
import { sortQuoteRuns } from "@/components/draft/order";
import {
  type DraftScope, fetchDraft, saveDraft, beaconSave, backupKey, baseKey, importUrl,
} from "@/components/draft/scope";

/* ---------- blok modeli ---------- */
export type Block =
  | { id: string; type: "p"; text: string }
  | { id: string; type: "h"; text: string }
  | { id: string; type: "quote"; text: string; note?: string; color?: string | null; source: string; page: number | null; document_id: string;
      /** kaynağı olan vurgu (notes.id) */ note_id?: string;
      style?: "highlight" | "underline" | "sticky" | "ink";
      /** El yazısı notu (style "ink"): darbeler + kutu (lib/ink) */ ink?: { strokes: InkStroke[]; box: [number, number, number, number] };
      /** kendiliğinden biriken */ auto?: boolean;
      /** ISO zaman */ at?: string }
  | { id: string; type: "answer"; q: string; text: string; sources: { title: string; page?: number | null; document_id: string }[] };

export type { DraftScope };

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

/** Cevap kartındaki [K#] → "(Kaynak adı, s. N)" (Word/Markdown/metne dönüştürme için). */
function citeText(sources: { title: string; page?: number | null }[]) {
  return (ns: number[], raw: string) => {
    const parts = ns.map((n) => { const s = sources[n - 1]; return s ? `${s.title}${s.page ? ", s. " + s.page : ""}` : ""; }).filter(Boolean);
    return parts.length ? " (" + parts.join("; ") + ")" : raw;
  };
}

export function toMarkdown(title: string, blocks: Block[]) {
  const out: string[] = [`# ${title}`, ""];
  for (const b of blocks) {
    if (b.type === "h") out.push(`## ${b.text.trim()}`, "");
    else if (b.type === "p") { if (b.text.trim()) out.push(mdNormalize(b.text.trim()), ""); }
    else if (b.type === "quote") {
      if (b.text.trim()) out.push(`> ${b.text.trim().replace(/\n+/g, " ")}`, `> — ${cite(b)}`, "");
      else out.push(b.style === "ink" ? `_El yazısı notu — ${cite(b)}_` : `_— ${cite(b)}_`, "");
      if (b.note) out.push(`_${b.note.trim()}_`, "");
    }
    else if (b.type === "answer") out.push(`**${b.q}**`, "", mdNormalize(b.text.trim()), "", `_Kaynaklar: ${b.sources.map((s, i) => `[K${i + 1}] ${s.title}${s.page ? ", s. " + s.page : ""}`).join("; ")}_`, "");
  }
  return out.join("\n");
}
/** Word için HTML (.doc yedek yolu; defterde asıl yol sunucuda gerçek .docx üretir). Aynı markdown işleyiciden beslenir. */
export function toWordHtml(title: string, blocks: Block[]) {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const body = blocks.map((b) => {
    if (b.type === "h") return `<h2>${esc(b.text)}</h2>`;
    if (b.type === "p") return b.text.trim() ? mdToHtml(b.text) : "";
    if (b.type === "quote") return `<blockquote style="margin:6pt 0 10pt 18pt;padding-left:10pt;border-left:3pt solid ${quotePigment(b)};color:#333;font-style:italic">${esc(b.text)}<br><span style="font-size:9pt;color:#666;font-style:normal">— ${esc(cite(b))}</span></blockquote>${b.note ? `<p><i>${esc(b.note)}</i></p>` : ""}`;
    return `<p><b>${esc(b.q)}</b></p>${mdToHtml(b.text)}<p style="font-size:9pt;color:#666"><i>Kaynaklar: ${b.sources.map((s, i) => `[K${i + 1}] ${esc(s.title)}${s.page ? ", s. " + s.page : ""}`).join("; ")}</i></p>`;
  }).join("\n");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.5}h1{font-size:20pt}h2{font-size:15pt}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}
/** Taslağın düz metni (paylaşım, pano). */
export function toPlainText(title: string, blocks: Block[]) {
  const out: string[] = [title, ""];
  for (const b of blocks) {
    if (b.type === "h") out.push(b.text.trim().toUpperCase(), "");
    else if (b.type === "p") { if (b.text.trim()) out.push(mdToPlain(b.text.trim()), ""); }
    else if (b.type === "quote") { out.push(b.text.trim() ? `“${b.text.trim()}” — ${cite(b)}` : `${b.style === "ink" ? "El yazısı notu " : ""}— ${cite(b)}`, ""); if (b.note) out.push(b.note.trim(), ""); }
    else if (b.type === "answer") out.push(b.q, "", mdToPlain(b.text.trim(), citeText(b.sources)), "");
  }
  return out.join("\n").trim();
}
/**
 * Sunucudaki taslakla birleştirme (3 yollu, blok kimliğine göre):
 * - Sunucuda olup yerelde OLMAYAN ve son eşitlenen sürümde de (base) OLMAYAN bloklar başka yerden
 *   eklenmiştir (kendiliğinden biriken vurgu, okuyucudan "Taslağa ekle", başka sekme) → yerel taslağın SONUNA.
 * - Vurgudan gelen alıntılar (note_id): sunucudaki güncel hâli (renk/yorum/stil) alınır; base'de olup
 *   sunucuda artık olmayanlar (vurgu çöpe gitti) yerelde de kalkar. Alıntı kartları yerelde düzenlenemez.
 * - Yerelde silinen bloklar (base'de var, yerelde yok) geri gelmez. Aynı metinli / aynı vurgulu blok tekrar eklenmez.
 */
export function mergeRemote(local: Block[], remote: Block[], base: Set<string>): { blocks: Block[]; added: number; addedIds: string[]; changed: number } {
  const rById = new Map(remote.map((b) => [b.id, b]));
  let changed = 0;
  const cur: Block[] = [];
  for (const b of local) {
    if (b.type !== "quote" || !b.note_id) { cur.push(b); continue; }
    const r = rById.get(b.id);
    if (r && r.type === "quote") {
      if (JSON.stringify(r) !== JSON.stringify(b)) { changed++; cur.push(r); } else cur.push(b);
    } else if (base.has(b.id)) { changed++; }            // sunucuda kaldirilmis (vurgu silindi)
    else cur.push(b);
  }
  const ids = new Set(cur.map((b) => b.id));
  const sig = (b: Block) => b.type + "|" + ((b as { text?: string }).text || "").trim();
  const sigs = new Set(cur.filter((b) => !(b.type === "quote" && !b.text.trim())).map(sig));
  const noteIds = new Set(cur.flatMap((b) => (b.type === "quote" && b.note_id ? [b.note_id] : [])));
  const extra = remote.filter((b) => !ids.has(b.id) && !base.has(b.id)
    && !(b.type === "quote" && b.note_id && noteIds.has(b.note_id))
    && !(b.type === "quote" ? b.text.trim() && sigs.has(sig(b)) : sigs.has(sig(b)))
    && !(b.type === "p" && !b.text.trim()));
  if (!extra.length) return { blocks: changed ? cur : local, added: 0, addedIds: [], changed };
  const next = [...cur];
  while (next.length && next[next.length - 1].type === "p" && !(next[next.length - 1] as { text: string }).text.trim()) next.pop();
  next.push(...extra, { id: uid(), type: "p", text: "" });
  return { blocks: next, added: extra.length, addedIds: extra.map((b) => b.id), changed };
}

export function ownWords(blocks: Block[]) {
  return blocks.filter((b) => b.type === "p" || b.type === "h").map((b: any) => b.text.trim()).filter(Boolean).join(" ").split(/\s+/).filter(Boolean).length;
}

type Version = { rev: number; created_at: string; block_count: number; preview: string };

function fmtWhen(iso: string) {
  try { return new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}
const isBlank = (bs: Block[]) => bs.every((b) => b.type === "p" && !b.text.trim());

export type DraftEditorProps = {
  scope: DraftScope;
  title: string;
  /** okuyucu yan paneli: tek sütun, küçük araç çubuğu, sürüm geçmişi yok */
  compact?: boolean;
  /** alıntının kaynağını aç (okuyucu içinde sayfaya atlamak için); yoksa okuyucu sayfasına gidilir */
  onOpenPage?: (docId: string, page: number | null) => void;
};

/** Dışarıdan tetiklenebilen işlemler (StudyNote: "Dışa aktar" olayı, vurgu sonrası tazeleme). */
export type DraftEditorHandle = {
  /** "Dışa aktar ▾" menüsünü açar (Word / Markdown / Paylaş). */
  openExport: () => void;
  /** Sunucudaki taslağı hemen sorgular; eklenen yeni blok sayısını döndürür. */
  refresh: () => Promise<number>;
};

/** Okuyucu bir vurgu kaydedince yayınlanan olay: detail {document_id}. Editör sunucu sürümünü anında sorgular. */
export const DRAFT_CHANGED_EVENT = "typdf:draft-changed";
/** Sunucu sürümüne bakma aralığı (ms). Vurgu → not akışı canlı kalsın diye 5 sn. */
const POLL_MS = 5000;

/** Bu olay bu kapsamı ilgilendiriyor mu? (belge kapsamı: aynı belge; defter: her belge olabilir) */
function concernsScope(scope: DraftScope, detail: unknown): boolean {
  const d = (detail || {}) as { document_id?: string; scope?: { kind?: string; id?: string } };
  if (d.scope?.kind && d.scope?.id) return d.scope.kind === scope.kind && d.scope.id === scope.id;
  if (scope.kind === "document" && d.document_id) return d.document_id === scope.id;
  return true;
}

/* ---------- dış kabuk: veriyi çeker ---------- */
const DraftEditor = forwardRef<DraftEditorHandle, DraftEditorProps>(function DraftEditor(props, ref) {
  const { scope } = props;
  const [remote, setRemote] = useState<{ draft: string | null; draft_rev: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let off = false;
    setRemote(null); setErr(null);
    fetchDraft(scope)
      .then((r) => { if (!off) setRemote(r); })
      .catch((e) => { if (!off) setErr(errorMessage(e, "Taslak alınamadı. Birkaç saniye sonra tekrar dene.")); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.kind, scope.id, nonce]);

  if (err) {
    let pending = false;
    try { pending = !!localStorage.getItem(backupKey(scope)); } catch {}
    return (
      <div className="rounded-2xl border bg-surface p-5 text-sm" role="alert">
        <p className="text-text-primary">{err}</p>
        {pending && <p className="mt-1 text-text-secondary">Kaydedilmemiş son değişikliklerin bu cihazda duruyor; bağlantı gelince geri yüklenecek.</p>}
        <button type="button" onClick={() => setNonce((n) => n + 1)}
                className="mt-3 flex min-h-[44px] items-center gap-1.5 rounded-xl border bg-surface px-4 hover:border-accent-purple/50">
          <RefreshCw size={14} aria-hidden /> Tekrar dene
        </button>
      </div>
    );
  }
  if (!remote) {
    return (
      <div role="status" aria-label="Taslak yükleniyor" className="space-y-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }
  return <DraftBody key={scope.kind + ":" + scope.id} {...props} handle={ref} initial={remote.draft} initialRev={remote.draft_rev} />;
});
export default DraftEditor;

/* ---------- editör ---------- */
function DraftBody({ scope, title, compact, onOpenPage, initial, initialRev, handle }: DraftEditorProps & {
  initial: string | null; initialRev: number; handle: ForwardedRef<DraftEditorHandle>;
}) {
  const router = useRouter();
  const isCol = scope.kind === "collection";
  const openDoc = (docId: string, page?: number | null) => {
    if (onOpenPage) onOpenPage(docId, page ?? null);
    else router.push(docHref(docId, { page, from: isCol ? scope.id : null }));
  };
  // Kaydedilemeden kalan son sürüm cihazda yedeklenir; geri gelince oradan devam edilir (veri kaybı olmasın).
  const BACKUP_KEY = backupKey(scope);
  const BASE_KEY = baseKey(scope);                          // yedeğin dayandığı sunucu blokları (birleştirme için)
  const SEEN_KEY = "draft.seen." + scope.kind + "." + scope.id;
  const [restored] = useState<string | null>(() => {
    try { const b = localStorage.getItem(BACKUP_KEY); return b && b !== (initial || "") ? b : null; } catch { return null; }
  });
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (!restored) return parseDraft(initial);
    // Yedek geri yüklenirken sunucuya bu arada eklenmiş bloklar (biriken vurgular) kaybolmasın
    const local = parseDraft(restored);
    let base: string[] | null = null;
    try { base = JSON.parse(localStorage.getItem(BASE_KEY) || "null"); } catch {}
    return mergeRemote(local, parseDraft(initial), new Set(Array.isArray(base) ? base : local.map((b) => b.id))).blocks;
  });
  // Eşzamanlılık: sunucudaki sürüm (draft_rev) ve o sürümün blok kimlikleri. Kayıt bu sürüme koşullu gider.
  const rev = useRef<number>(typeof initialRev === "number" ? initialRev : -1);
  const baseIds = useRef<Set<string>>(new Set(parseDraft(initial).map((b) => b.id)));
  const skipSave = useRef(false);                        // sunucudan gelen tazeleme kayıt tetiklemesin
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [retryIn, setRetryIn] = useState(0);            // hata sonrası otomatik tekrar (sn)
  const [flash, setFlash] = useState("");
  const [outlineOpen, setOutlineOpen] = useState(false); // dar ekranda "İçindekiler" tabakası
  const [exportOpen, setExportOpen] = useState(false);  // "Dışa aktar ▾" menüsü
  const [docxBusy, setDocxBusy] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);   // pigment süzgeci (yalnız görünüm)
  const [gild, setGild] = useState<Set<string>>(new Set());     // altın parıltıyla belirecek bloklar
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [docNotes, setDocNotes] = useState<string[] | null>(null); // belge kapsamında vurgu kimlikleri
  const [moreOpen, setMoreOpen] = useState(false);      // "⋯" menüsü (Önceki sürümler, İçindekiler)
  const exportRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const latest = useRef<Block[]>(blocks);                // en son içerik (unmount'ta gönderilir)
  const version = useRef(0);                             // her değişiklikte artar
  const savedVersion = useRef(0);                        // sunucuya ulaşan son sürüm
  const failures = useRef(0);
  const mounted = useRef(true);
  const inflight = useRef<Promise<boolean> | null>(null);   // kayıtlar sırayla gider (eski sürüm yenisini ezmesin)
  const lastInsert = useRef<{ sig: string; at: number }>({ sig: "", at: 0 });  // çift tıklamada iki kart olmasın

  function sayFlash(t: string, ms = 1500) { setFlash(t); setTimeout(() => { if (mounted.current) setFlash(""); }, ms); }
  function markGild(ids: string[]) {
    if (!ids.length) return;
    setGild(new Set(ids));
    if (gildTimer.current) clearTimeout(gildTimer.current);
    gildTimer.current = setTimeout(() => { if (mounted.current) setGild(new Set()); }, 1600);
  }

  /* ---------- "Sor": alıntıyı Sor paneline/sekmesine gönderir (window olayı; dinleyici Sor bileşeninde) ---------- */
  function askQuote(b: Extract<Block, { type: "quote" }>) {
    const text = (b.text || "").trim() || (b.note || "").trim();
    if (!text) { toast.info("Bu notun metni yok; kaynakta sayfayı açıp seçerek sorabilirsin."); return; }
    window.dispatchEvent(new CustomEvent("typdf:ask", { detail: { text, page: b.page, document_id: b.document_id, source: b.source } }));
    sayFlash("Soruya eklendi", 1200);
  }

  /* ---------- kayıt ---------- */
  // otomatik kayıt: 1 sn bekler; sekme değişince/bileşen kalkınca bekleyen kayıt İPTAL EDİLMEZ, hemen gönderilir.
  function persist(v: number): Promise<boolean> {
    const prev = inflight.current;
    const p = (async () => {
      if (prev) { try { await prev; } catch {} }
      // Beklerken daha yeni bir sürüm kaydedildiyse bu eski sürümü gönderme
      if (savedVersion.current >= v) return true;
      return send(serializeDraft(latest.current), version.current);
    })();
    inflight.current = p;
    p.finally(() => { if (inflight.current === p) inflight.current = null; });
    return p;
  }
  async function send(ser: string, v: number, depth = 0): Promise<boolean> {
    try {
      const r = await saveDraft(scope, ser, rev.current);
      if (!r.ok) {
        if (depth >= 3) throw new Error("conflict");
        // Taslak başka yerden güncellenmiş (biriken vurgu, okuyucu, başka sekme): yerel değişiklik korunur,
        // sunucudaki yeni bloklar sona eklenir, sonra yeniden kaydedilir.
        const remote = parseDraft(r.draft);
        rev.current = r.draft_rev;
        const m = mergeRemote(latest.current, remote, baseIds.current);
        baseIds.current = new Set(remote.map((b) => b.id));
        if (m.added || m.changed) {
          latest.current = m.blocks;
          if (mounted.current) {
            skipSave.current = true;
            setBlocks(m.blocks);
            markGild(m.addedIds);
            if (m.added) sayFlash(m.added === 1 ? "1 yeni parça sona eklendi" : `${m.added} yeni parça sona eklendi`, 2500);
          }
        }
        return send(serializeDraft(m.blocks), v, depth + 1);
      }
      if (typeof r.draft_rev === "number") rev.current = r.draft_rev;
      baseIds.current = new Set(parseDraft(ser).map((b) => b.id));
      if (v > savedVersion.current) savedVersion.current = v;
      failures.current = 0;
      if (savedVersion.current >= version.current) { try { localStorage.removeItem(BACKUP_KEY); localStorage.removeItem(BASE_KEY); } catch {} }
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
  }, [blocks]);

  const idleNow = () => savedVersion.current >= version.current && !timer.current && !inflight.current;

  useEffect(() => {
    mounted.current = true;
    if (restored) { dirty.current = true; version.current++; sayFlash("Kaydedilmemiş son değişikliklerin geri yüklendi", 3000); saveNow(); }
    // Son ziyaretten beri kendiliğinden biriken vurgular bir kez altın parıltıyla belirsin
    try {
      const seen = Date.parse(localStorage.getItem(SEEN_KEY) || "");
      if (!Number.isNaN(seen)) {
        markGild(blocks.filter((b) => b.type === "quote" && b.auto && b.at && Date.parse(b.at) > seen).map((b) => b.id));
      }
      localStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {}
    // Sekmeye dönünce ve 5 sn'de bir: taslak başka yerden güncellendiyse tazele
    const onVisible = () => { if (document.visibilityState === "visible") refreshRemote(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const poll = setInterval(() => { if (document.visibilityState === "visible") refreshRemote(); }, POLL_MS);
    // Okuyucu bir vurgu kaydetti (useAnnotations → typdf:draft-changed): sunucu sürümünü hemen sorgula
    const onDraftChanged = (e: Event) => {
      if (!concernsScope(scope, (e as CustomEvent).detail)) return;
      refreshRemote(true);
    };
    window.addEventListener(DRAFT_CHANGED_EVENT, onDraftChanged);
    // Bağlantı gelince bekleyen kaydı hemen dene
    const onOnline = () => { if (savedVersion.current < version.current) saveNow(); };
    // Kaydedilmemiş değişiklik varken sayfadan çıkışta tarayıcı uyarısı + son bir deneme
    const onUnload = (e: BeforeUnloadEvent) => {
      if (savedVersion.current >= version.current) return;
      beaconSave(scope, serializeDraft(latest.current), rev.current);
      e.preventDefault(); e.returnValue = "";
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(poll);
      window.removeEventListener(DRAFT_CHANGED_EVENT, onDraftChanged);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      mounted.current = false;
      try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch {}
      // Sekme değişti / bileşen kalktı: bekleyen kaydı gönder (iptal etme)
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
      if (gildTimer.current) { clearTimeout(gildTimer.current); gildTimer.current = null; }
      if (savedVersion.current < version.current) persist(version.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Belge kapsamı: bu kaynaktaki vurguların kimlikleri ("Mevcut vurgularını getir" gerekli mi?)
  useEffect(() => {
    if (isCol) return;
    let off = false;
    api(`/documents/${scope.id}/notes`, {}, 1)
      .then((list: any[]) => {
        if (off || !Array.isArray(list)) return;
        setDocNotes(list.filter((n) => (n?.selected_text || "").trim() || (n?.note_content || "").trim()).map((n) => String(n.id)));
      })
      .catch(() => { if (!off) setDocNotes(null); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.id, isCol]);

  // "Dışa aktar" ve "⋯" menüleri: dışarı tıklayınca / Esc ile kapanır
  useEffect(() => {
    if (!exportOpen && !moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (exportOpen && !exportRef.current?.contains(e.target as Node)) setExportOpen(false);
      if (moreOpen && !moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setExportOpen(false); setMoreOpen(false); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [exportOpen, moreOpen]);

  // Sunucudaki taslak daha yeniyse:
  //  - bekleyen yerel değişiklik yoksa (idle) sunucudakini olduğu gibi göster;
  //  - bekleyen değişiklik varsa (yazıyor / kayıt yolda) sunucudan gelen YENİ blokları mergeRemote ile yerel
  //    taslağın sonuna ekle (yerel değişiklik korunur); sıradaki kayıt yeni draft_rev ile çakışmasız gider.
  // Eski davranış (idle değilse hiçbir şey yapma) yeni vurguların açık panelde görünmesini engelliyordu.
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  async function refreshRemote(force = false): Promise<number> {
    if (refreshing.current) { refreshAgain.current = refreshAgain.current || force; return 0; }
    refreshing.current = true;
    try {
      // Yolda bir kayıt varsa bitmesini bekle: onun cevabı rev'i günceller, biz güncel hâlin üstüne bakarız.
      if (inflight.current) { try { await inflight.current; } catch {} }
      const r = await fetchDraft(scope);
      if (!mounted.current || (!force && r.draft_rev === rev.current)) return 0;
      const remote = parseDraft(r.draft);
      if (idleNow()) {
        const before = new Set(latest.current.map((b) => b.id));
        const fresh = remote.filter((b) => !before.has(b.id) && !(b.type === "p" && !b.text.trim()));
        rev.current = r.draft_rev;
        baseIds.current = new Set(remote.map((b) => b.id));
        if (serializeDraft(remote) === serializeDraft(latest.current)) return 0;
        skipSave.current = true;
        latest.current = remote;
        setBlocks(remote);
        markGild(fresh.map((b) => b.id));
        announceFresh(fresh, force);
        return fresh.length;
      }
      // Yerel değişiklik bekliyor: yalnız yeni blokları al (3 yollu birleştirme), rev'i ilerlet.
      if (process.env.NODE_ENV !== "production") {
        console.debug("[DraftEditor] boşta değil; sunucu blokları birleştiriliyor", {
          version: version.current, savedVersion: savedVersion.current, timer: !!timer.current, inflight: !!inflight.current,
        });
      }
      const m = mergeRemote(latest.current, remote, baseIds.current);
      rev.current = r.draft_rev;
      baseIds.current = new Set(remote.map((b) => b.id));
      if (!m.added && !m.changed) return 0;
      // skipSave: bu setBlocks sürümü artırmasın; bekleyen kayıt birleşik içeriği (latest) gönderir.
      skipSave.current = true;
      latest.current = m.blocks;
      setBlocks(m.blocks);
      markGild(m.addedIds);
      const fresh = m.blocks.filter((b) => m.addedIds.includes(b.id));
      announceFresh(fresh, force);
      return m.added;
    } catch { return 0; /* sessiz: bir sonraki kayıt zaten birleştirir */ }
    finally {
      refreshing.current = false;
      if (refreshAgain.current) { refreshAgain.current = false; void refreshRemote(true); }
    }
  }
  function announceFresh(fresh: Block[], force: boolean) {
    const autoN = fresh.filter((b) => b.type === "quote" && b.auto).length;
    if (fresh.length && autoN === fresh.length) sayFlash(autoN === 1 ? "Yeni bir vurgu düştü" : `${autoN} yeni vurgu düştü`, 3000);
    else if (!force) toast.info("Notun başka yerden güncellendi, yenilendi.");
  }

  // Dışarıdan: "Dışa aktar" menüsünü aç (defter "Daha fazla → Dışa aktar" olayı) / sunucu sürümünü sorgula
  useImperativeHandle(handle, () => ({
    openExport: () => { setMoreOpen(false); setExportOpen(true); },
    refresh: () => refreshRemote(true),
  }));

  /* ---------- Mevcut vurgularını getir ---------- */
  async function importHighlights() {
    if (importing) return;
    setImporting(true);
    try {
      if (savedVersion.current < version.current) await saveNow();
      const r = await api(importUrl(scope), { method: "POST" }, 1);
      const added = typeof r?.added === "number" ? r.added : 0;
      setImportDone(true);
      if (added > 0) {
        await refreshRemote(true);
        toast(added === 1 ? "1 vurgu notuna getirildi" : `${added} vurgu notuna getirildi`);
      } else {
        toast.info("Bütün vurguların zaten burada.");
      }
    } catch (e) {
      toast.error(errorMessage(e, "Vurgular getirilemedi; birazdan tekrar dene."));
    } finally { if (mounted.current) setImporting(false); }
  }

  /* ---------- Önceki sürümler (yalnız defter) ---------- */
  const [versions, setVersions] = useState<{ open: boolean; list: Version[] | null; error?: string; busy?: number } | null>(null);
  async function openVersions() {
    setMoreOpen(false);
    setVersions({ open: true, list: null });
    try {
      const r = await api(`/collections/${scope.id}/draft/versions`, {}, 1);
      const list: Version[] = Array.isArray(r) ? r : (r?.versions || []);
      setVersions({ open: true, list });
    } catch (e) { setVersions({ open: true, list: [], error: errorMessage(e, "Önceki sürümler alınamadı; birazdan tekrar dene.") }); }
  }
  async function restoreVersion(v: Version) {
    // Bekleyen yerel değişiklik varsa önce onu kaydet; sonra sunucuda geri yükle ve taslağı sunucudan al
    setVersions((s) => (s ? { ...s, busy: v.rev } : s));
    try {
      if (savedVersion.current < version.current) await saveNow();
      const r = await api(`/collections/${scope.id}/draft/versions/${v.rev}/restore`, { method: "POST" }, 1);
      let draft: string | null | undefined = r?.draft;
      let newRev: number | undefined = typeof r?.draft_rev === "number" ? r.draft_rev : undefined;
      if (draft === undefined) {
        const cur = await fetchDraft(scope);
        draft = cur.draft; newRev = cur.draft_rev;
      }
      const remote = parseDraft(draft);
      if (typeof newRev === "number") rev.current = newRev;
      baseIds.current = new Set(remote.map((b) => b.id));
      skipSave.current = true;
      setBlocks(remote);
      setVersions(null);
      toast(`${fmtWhen(v.created_at)} tarihli sürüm geri yüklendi`);
    } catch (e) {
      setVersions((s) => (s ? { ...s, busy: undefined } : s));
      toast.error(errorMessage(e, "Sürüm geri yüklenemedi; birazdan tekrar dene."));
    }
  }

  /* ---------- blok işlemleri ---------- */
  function update(next: Block[]) { dirty.current = true; setBlocks(next); }
  function insertAfter(idx: number, b: Block, base: Block[] = blocks) {
    // Çift tıklama / çift dokunma: aynı kart 800 ms içinde iki kez eklenmesin
    const sig = b.type + "|" + ((b as { text?: string }).text || "").trim();
    const now = Date.now();
    if (b.type !== "p" && lastInsert.current.sig === sig && now - lastInsert.current.at < 800) return;
    lastInsert.current = { sig, at: now };
    const at = idx < 0 || idx >= base.length ? base.length : idx + 1;
    const next = [...base]; next.splice(at, 0, b);
    // alıntı/cevap kartından sonra yazmak için boş paragraf
    if (b.type !== "p" && (at + 1 >= next.length || next[at + 1].type !== "p")) next.splice(at + 1, 0, { id: uid(), type: "p", text: "" });
    update(next); setFocusIdx(at);
    sayFlash("Eklendi", 1200);
  }
  function setText(idx: number, text: string) { const n = [...blocks]; (n[idx] as any) = { ...n[idx], text }; update(n); }
  /** Blok kaldırılınca 10 sn "Geri al" — aynı sırada geri konur ve kaydedilir. */
  function removeAt(idx: number) {
    const removed = blocks[idx];
    if (!removed) return;
    const n = blocks.filter((_, i) => i !== idx);
    const wasEmpty = removed.type === "p" && !removed.text.trim();
    update(n.length ? n : [{ id: uid(), type: "p", text: "" }]);
    if (wasEmpty) return;
    const label = removed.type === "quote" ? "Alıntı" : removed.type === "answer" ? "Sohbet cevabı" : removed.type === "h" ? "Başlık" : "Paragraf";
    toast(`${label} kaldırıldı`, {
      action: { label: "Geri al", run: () => {
        setBlocks((cur) => {
          if (cur.some((b) => b.id === removed.id)) return cur;
          const next = [...cur];
          // Kalan tek boş paragraf yer tutucuysa onun yerine geç
          if (next.length === 1 && next[0].type === "p" && !next[0].text.trim()) return [removed, next[0]];
          next.splice(Math.min(idx, next.length), 0, removed);
          return next;
        });
        dirty.current = true;
        setFocusIdx(idx);
      } },
    });
  }
  function move(idx: number, d: -1 | 1) { const j = idx + d; if (j < 0 || j >= blocks.length) return; const n = [...blocks]; [n[idx], n[j]] = [n[j], n[idx]]; update(n); setFocusIdx(j); }
  /** Yeni blok aç; `cleanText` verilirse önce mevcut bloğun metni onunla değiştirilir (boş satırdaki Enter'ın \n'i kalmasın). */
  function addParagraph(idx: number, type: "p" | "h" = "p", cleanText?: string) {
    const base = cleanText === undefined ? blocks : blocks.map((b, k) => (k === idx ? ({ ...b, text: cleanText } as Block) : b));
    insertAfter(idx, { id: uid(), type, text: "" } as Block, base);
  }
  /** Sohbet cevabı kartını düzenlenebilir paragraflara çevirir; [K#] → "(Kaynak, s. N)". */
  function answerToText(idx: number) {
    const b = blocks[idx];
    if (!b || b.type !== "answer") return;
    const plain = mdToPlain(b.text, citeText(b.sources));
    const paras = plain.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
    if (!paras.length) return;
    const n = [...blocks];
    const fresh: Block[] = paras.map((t) => ({ id: uid(), type: "p", text: t }));
    n.splice(idx, 1, ...fresh);
    update(n); setFocusIdx(idx);
    toast(`Cevap ${paras.length} paragrafa dönüştürüldü; artık düzenleyebilirsin`, {
      action: { label: "Geri al", run: () => {
        setBlocks((cur) => {
          const ids = new Set(fresh.map((f) => f.id));
          const first = cur.findIndex((x) => ids.has(x.id));
          if (first < 0) return cur;
          const rest = cur.filter((x) => !ids.has(x.id));
          rest.splice(first, 0, b);
          return rest;
        });
        dirty.current = true;
      } },
    });
  }
  /** Sayfa sırasına diz: ardışık alıntı gruplarını belge + sayfa sırasına koyar; paragraflar yerinde kalır. */
  function sortByPage() {
    const prev = blocks;
    const r = sortQuoteRuns(blocks);
    if (!r.changed) { toast.info("Alıntılar zaten sayfa sırasında."); return; }
    update(r.blocks);
    toast("Alıntılar sayfa sırasına dizildi", {
      action: { label: "Geri al", run: () => { dirty.current = true; setBlocks(prev); } },
    });
  }
  function jumpTo(id: string) {
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    setFilter(null); setOutlineOpen(false); setFocusIdx(i);
    setTimeout(() => document.getElementById("blk-" + id)?.scrollIntoView({ block: "center", behavior: "smooth" }), 30);
  }

  /* ---------- dışa aktarım ---------- */
  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const safeName = () => (title || "taslak").replace(/[\\/:*?"<>|]+/g, " ").trim() || "taslak";
  function downloadMd() { saveBlob(new Blob([toMarkdown(title, blocks)], { type: "text/markdown;charset=utf-8" }), `${safeName()}.md`); setExportOpen(false); }
  async function downloadDocx() {
    setExportOpen(false);
    if (!isCol) {   // belge taslağında sunucu ucu yok: Word'ün açtığı biçim (.doc)
      saveBlob(new Blob([toWordHtml(title, blocks)], { type: "application/msword" }), `${safeName()}.doc`);
      return;
    }
    setDocxBusy(true);
    try {
      const res = await fetch(`${API}/collections/${scope.id}/export/docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (getToken() || "") },
        body: JSON.stringify({ title, blocks, sources: blocks.flatMap((b) => b.type === "answer" ? b.sources : b.type === "quote" ? [{ title: b.source, page: b.page, document_id: b.document_id }] : []) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      saveBlob(await res.blob(), `${safeName()}.docx`);
    } catch {
      // Sunucu Word dosyası üretemezse eski yol: Word'ün açtığı HTML (.doc)
      saveBlob(new Blob([toWordHtml(title, blocks)], { type: "application/msword" }), `${safeName()}.doc`);
      toast.info("Word dosyası şimdilik basit biçimde indirildi; sunucu yanıt vermedi.");
    } finally { setDocxBusy(false); }
  }
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function shareDraft() {
    setExportOpen(false);
    const text = toPlainText(title, blocks);
    try {
      const file = typeof File !== "undefined" ? new File([toMarkdown(title, blocks)], `${safeName()}.md`, { type: "text/markdown" }) : null;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (file && nav.canShare && nav.canShare({ files: [file] })) await navigator.share({ title, files: [file] });
      else await navigator.share({ title, text });
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error("Paylaşılamadı; Markdown olarak indirip paylaşabilirsin.");
    }
  }

  /* ---------- türetilmiş ---------- */
  const words = useMemo(() => ownWords(blocks), [blocks]);
  const quoteBlocks = useMemo(() => blocks.filter((b): b is Extract<Block, { type: "quote" }> => b.type === "quote"), [blocks]);
  const pigments = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quoteBlocks) { const p = quotePigment(q); m.set(p, (m.get(p) || 0) + 1); }
    return Array.from(m.entries());
  }, [quoteBlocks]);
  const multiDoc = useMemo(() => new Set(quoteBlocks.map((q) => q.document_id)).size > 1, [quoteBlocks]);
  const firstP = blocks.findIndex((b) => b.type === "p" && !!b.text.trim());
  const blank = isBlank(blocks);
  const missingDocNotes = useMemo(() => {
    if (!docNotes) return 0;
    const have = new Set(quoteBlocks.flatMap((q) => (q.note_id ? [q.note_id] : [])));
    return docNotes.filter((id) => !have.has(id)).length;
  }, [docNotes, quoteBlocks]);
  const canImport = isCol ? !importDone : missingDocNotes > 0;
  const visible = (b: Block) => !filter || (b.type === "quote" && quotePigment(b) === filter);
  const outline = useMemo(() => {
    const m = new Map<string, { title: string; n: number; first: string; pages: number[] }>();
    for (const q of quoteBlocks) {
      const e = m.get(q.document_id) || { title: q.source || "Kaynak", n: 0, first: q.id, pages: [] };
      e.n++; if (q.page && !e.pages.includes(q.page)) e.pages.push(q.page);
      m.set(q.document_id, e);
    }
    return Array.from(m.values());
  }, [quoteBlocks]);

  const tbtn = "flex min-h-[40px] items-center gap-1.5 rounded-xl border bg-surface px-3 text-sm text-text-primary hover:border-accent-purple/50 disabled:opacity-60";

  const filterChips = pigments.length > 1 && (
    <div role="group" aria-label="Renge göre süz" className="flex items-center gap-1">
      {pigments.map(([p, n]) => {
        const on = filter === p;
        return (
          <button key={p} type="button" onClick={() => setFilter(on ? null : p)} aria-pressed={on}
                  title={`${pigmentName(p) || "Renk"} · ${n} alıntı`} aria-label={`${pigmentName(p) || "Renk"} alıntıları göster (${n})`}
                  className={cx("flex h-10 w-10 items-center justify-center rounded-full transition", on ? "bg-surface-muted ring-2 ring-accent-purple/50" : "hover:bg-surface-muted")}>
            <span aria-hidden className="h-5 w-5 rounded-full border border-black/10" style={{ background: p }} />
          </button>
        );
      })}
    </div>
  );

  const importBtn = canImport && !blank && (
    <button type="button" onClick={importHighlights} disabled={importing} className={tbtn}
            title="Okurken yaptığın ama taslakta olmayan vurguları sayfa sırasıyla getirir">
      {importing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
      {compact ? "Vurguları getir" : "Mevcut vurgularını getir"}{!isCol && missingDocNotes > 0 ? ` (${missingDocNotes})` : ""}
    </button>
  );

  const statusText = status === "saving" ? "kaydediliyor…"
    : status === "saved" && savedAt ? `kaydedildi · ${savedAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
    : status === "error" ? `kaydedilemedi — bağlantını kontrol et${retryIn ? ` · ${retryIn} sn içinde yeniden denenecek` : ""}`
    : "";

  const outlinePanel = (
    <div className="vellum rounded-2xl border p-4">
      <p className="eyebrow">Bu notta</p>
      <p className="mt-1 text-sm text-text-secondary">
        <b className="text-text-primary">{quoteBlocks.length}</b> alıntı · <b className="text-text-primary">{words}</b> kelime senin
      </p>
      {outline.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {outline.map((o) => (
            <li key={o.first}>
              <button type="button" onClick={() => jumpTo(o.first)}
                      className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-muted">
                <span className="min-w-0 flex-1 truncate font-reading">{o.title}</span>
                <span className="shrink-0 text-xs text-text-secondary">{o.n} alıntı</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-text-secondary">Henüz alıntı yok.</p>
      )}
      <div className="rule-gold my-4" aria-hidden />
      <p className="text-xs leading-relaxed text-text-secondary">
        Okurken yaptığın her vurgu, alt çizgi ve kenar notu buraya kendiliğinden düşer. Aralarına kendi cümlelerini yaz;
        boş satırda Enter yeni paragraf açar. Bir alıntının yanındaki “Sor” onu soruya ekler. Kaldırdığın bloğu 10 saniye içinde “Geri al” ile geri getirebilirsin.
      </p>
    </div>
  );

  let lastDoc: string | null = null;

  return (
    <div className={cx("grid grid-cols-1 gap-5", !compact && "md:grid-cols-[1fr_260px] lg:grid-cols-[1fr_300px]")}>
      <div className="min-w-0">
        {/* araç çubuğu: Vurguları getir · Sayfa sırasına diz · renk süzgeci · Dışa aktar ▾ · ⋯ */}
        <div className={cx("mb-3 flex flex-wrap items-center gap-2", compact && "gap-1.5")}>
          {importBtn}
          {quoteBlocks.length > 1 && (
            <button type="button" onClick={sortByPage} className={tbtn} title="Ardışık alıntıları kaynak ve sayfa sırasına dizer; paragrafların yerinde kalır">
              <ListOrdered size={14} aria-hidden /> {compact ? "Sırala" : "Sayfa sırasına diz"}
            </button>
          )}
          {filterChips}
          <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <div ref={exportRef} className="relative">
              <button type="button" onClick={() => setExportOpen((o) => !o)} aria-haspopup="menu" aria-expanded={exportOpen} disabled={docxBusy} className={tbtn}>
                {docxBusy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />} Dışa aktar <ChevronDown size={14} aria-hidden />
              </button>
              {exportOpen && (
                <div role="menu" aria-label="Dışa aktar" className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border bg-surface p-1 text-sm text-text-primary shadow-medium">
                  <button role="menuitem" onClick={downloadDocx} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-surface-muted">
                    <Download size={14} className="text-text-secondary" aria-hidden /> Word ({isCol ? ".docx" : ".doc"})
                  </button>
                  <button role="menuitem" onClick={downloadMd} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-surface-muted">
                    <Download size={14} className="text-text-secondary" aria-hidden /> Markdown (.md)
                  </button>
                  {canShare && (
                    <button role="menuitem" onClick={shareDraft} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-surface-muted">
                      <Share2 size={14} className="text-text-secondary" aria-hidden /> Paylaş…
                    </button>
                  )}
                </div>
              )}
            </div>
            {(isCol || !compact) && (
              <div ref={moreRef} className="relative">
                <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-haspopup="menu" aria-expanded={moreOpen} aria-label="Diğer işlemler" title="Diğer işlemler"
                        className="flex h-10 w-10 items-center justify-center rounded-xl border bg-surface text-text-secondary hover:border-accent-purple/50 hover:text-text-primary">
                  <MoreHorizontal size={16} aria-hidden />
                </button>
                {moreOpen && (
                  <div role="menu" aria-label="Diğer işlemler" className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border bg-surface p-1 text-sm text-text-primary shadow-medium">
                    {isCol && (
                      <button role="menuitem" onClick={openVersions} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-surface-muted">
                        <History size={14} className="text-text-secondary" aria-hidden /> Önceki sürümler
                      </button>
                    )}
                    {!compact && (
                      <button role="menuitem" onClick={() => { setMoreOpen(false); setOutlineOpen(true); }} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-surface-muted md:hidden">
                        <BookOpen size={14} className="text-text-secondary" aria-hidden /> İçindekiler
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </span>
        </div>

        {/* durum satırı */}
        <div className="mb-2 flex min-h-[20px] flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
          {!compact && <span><b className="text-text-primary">{words}</b> kelime senin · {quoteBlocks.length} alıntı</span>}
          {statusText && <span role="status" className={status === "error" ? "text-danger" : ""}>{!compact && "· "}{statusText}</span>}
          {status === "error" && (
            <button type="button" onClick={() => saveNow()} className="min-h-[32px] rounded-lg border border-danger/40 px-2 text-danger hover:bg-danger/5">Şimdi dene</button>
          )}
          {flash && <span className="text-accent-purple" role="status">{flash}</span>}
        </div>

        {filter && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-surface-muted px-3 py-1.5 text-sm">
            <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: filter }} />
            Yalnız {pigmentName(filter) ? `“${pigmentName(filter)}”` : "bu renkteki"} alıntılar gösteriliyor
            <button type="button" onClick={() => setFilter(null)} className="ml-auto min-h-[36px] rounded-lg px-2 text-accent-purple hover:bg-surface">Hepsini göster</button>
          </div>
        )}

        {versions?.open && (
          <div className="mb-3 rounded-2xl border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium"><History size={15} className="text-accent-purple" aria-hidden /> Önceki sürümler</p>
              <span className="text-xs text-text-secondary">son 20 kayıt · geri yüklersen bugünkü hâli de bir sürüm olarak kalır</span>
              <button onClick={() => setVersions(null)} aria-label="Önceki sürümleri kapat" className="ml-auto flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted"><X size={15} /></button>
            </div>
            {versions.list === null && <p className="mt-2 flex items-center gap-2 text-sm text-text-secondary" role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> Sürümler alınıyor…</p>}
            {versions.error && <p className="mt-2 text-sm text-danger">{versions.error}</p>}
            {versions.list && !versions.error && versions.list.length === 0 && <p className="mt-2 text-sm text-text-secondary">Henüz kayıtlı sürüm yok; taslak her kaydedildiğinde bir sürüm oluşur.</p>}
            {!!versions.list?.length && (
              <ul className="mt-3 max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
                {versions.list.map((v) => (
                  <li key={v.rev} className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="text-text-primary">{fmtWhen(v.created_at)} <span className="text-xs text-text-secondary">· {v.block_count} blok</span></p>
                      {v.preview && <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{v.preview}</p>}
                    </div>
                    <button onClick={() => restoreVersion(v)} disabled={versions.busy !== undefined}
                            className="flex min-h-[40px] items-center gap-1 rounded-lg border bg-surface px-3 hover:border-accent-purple/50 disabled:opacity-60">
                      {versions.busy === v.rev ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <RefreshCw size={13} aria-hidden />} Bu sürümü geri yükle
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className={cx("vellum rounded-2xl border", compact ? "p-3" : "p-4 md:p-8")}>
          {blank && (
            <EmptyDraft kind={scope.kind} compact={compact} canImport={canImport} importing={importing} onImport={importHighlights} />
          )}
          {blocks.map((b, i) => {
            if (!visible(b)) return null;
            // Defter taslağında belge değişince araya süs + belge başlığı
            let divider: ReactNode = null;
            if (b.type === "quote") {
              if (isCol && multiDoc && !filter && b.document_id !== lastDoc) divider = (
                <div className="mb-3 mt-8 text-center first:mt-2">
                  <Fleuron />
                  <p className="mt-2 font-heading text-lg italic text-text-primary">{b.source || "Kaynak"}</p>
                </div>
              );
              lastDoc = b.document_id;
            }
            const dropCap = i === firstP && focusIdx !== i && b.type === "p";
            return (
              <div key={b.id}>
                {divider}
                <div id={"blk-" + b.id} className="group relative" onFocus={() => setFocusIdx(i)} onClick={() => setFocusIdx(i)}>
                  {b.type === "p" && (dropCap ? (
                    <div role="textbox" tabIndex={0} aria-label="İlk paragraf (düzenlemek için dokun)" aria-multiline
                         className="cursor-text py-1.5 font-reading text-[16px] leading-[1.85] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/30">
                      <DropCap text={b.text} as="div" className="whitespace-pre-wrap" />
                    </div>
                  ) : (
                    <AutoTextarea value={b.text} focus={focusIdx === i} grab={i === firstP}
                                  onChange={(v) => setText(i, v)}
                                  onEnterNew={(clean) => addParagraph(i, "p", clean)}
                                  placeholder={i === 0 && blocks.length === 1 ? "Kendi cümlelerini buraya yaz… Boş satırda Enter yeni paragraf açar." : "Yaz…"}
                                  className={cx("w-full resize-none bg-transparent py-1.5 font-reading text-[16px] leading-[1.85] outline-none placeholder:text-text-secondary/60")} />
                  ))}
                  {b.type === "h" && (
                    <AutoTextarea value={b.text} focus={focusIdx === i} onChange={(v) => setText(i, v)} onEnterNew={(clean) => addParagraph(i, "p", clean)}
                                  placeholder="Başlık" className={cx("w-full resize-none bg-transparent pb-1 pt-4 font-heading text-2xl leading-tight outline-none placeholder:text-text-secondary/60")} />
                  )}
                  {b.type === "quote" && (
                    <QuoteCard b={b} compact={compact} gilded={gild.has(b.id)} onOpen={() => openDoc(b.document_id, b.page)} onAsk={() => askQuote(b)} />
                  )}
                  {b.type === "answer" && (
                    <div className={cx("my-3 rounded-xl border border-accent-purple/30 bg-accent-purple/5 p-3", gild.has(b.id) && "gilded")}>
                      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-accent-purple"><Sparkles size={12} aria-hidden /> Sohbet cevabı</div>
                      <p className="mt-1 text-sm font-medium">{b.q}</p>
                      <CitedText text={b.text} sources={b.sources} className="mt-1.5 text-[14px] leading-relaxed"
                                 onCite={(_n, s) => { if (s?.document_id) openDoc(s.document_id, s.page); }} />
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {b.sources.map((s, j) => (
                          <button key={j} onClick={() => openDoc(s.document_id, s.page)}
                                  className="min-h-[36px] rounded-full border bg-surface px-2 py-0.5 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                            [K{j + 1}] {s.title}{s.page ? " · s." + s.page : ""}
                          </button>
                        ))}
                        <button onClick={(e) => { e.stopPropagation(); answerToText(i); }}
                                title="Kartı düzenlenebilir paragraflara çevirir; atıflar kaynak adı ve sayfa olarak kalır (ücretsiz)"
                                className="ml-auto flex min-h-[40px] items-center gap-1 rounded-full border border-accent-purple/40 bg-surface px-2.5 text-xs font-medium text-text-primary hover:bg-accent-purple/10">
                          <TextCursorInput size={13} aria-hidden /> Metne dönüştür
                        </button>
                      </div>
                    </div>
                  )}

                  {/* blok araçları: odaktaki blokta her zaman; masaüstünde üzerine gelince/klavye odağında */}
                  {!(blank && b.type === "p") && (
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
                                className={cx("flex h-10 w-10 items-center justify-center rounded-full border bg-surface text-text-secondary",
                                  label === "Bloğu kaldır" ? "hover:text-danger" : "hover:text-accent-purple")}>
                          <Icon size={14} aria-hidden />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {blank && (
            <p className="sr-only">Taslak boş. Yazmaya başlamak için yukarıdaki alana yaz.</p>
          )}
        </div>
      </div>

      {/* tablette (md) 260 px, geniş ekranda 300 px yan sütun; daha darda "İçindekiler" düğmesi tabaka açar */}
      {!compact && (
        <>
          <aside className="hidden md:block md:sticky md:top-4 md:self-start">{outlinePanel}</aside>
          <Modal open={outlineOpen} onClose={() => setOutlineOpen(false)} title="İçindekiler" size="md">{outlinePanel}</Modal>
        </>
      )}
    </div>
  );
}

function AutoTextarea({ value, onChange, onEnterNew, placeholder, className, focus, grab }: {
  value: string; onChange: (v: string) => void;
  /** Yeni blok isteği; `cleanText` verilirse mevcut metin önce onunla değiştirilir */
  onEnterNew: (cleanText?: string) => void;
  placeholder?: string; className?: string; focus?: boolean;
  /** odak gelince dolu olsa da imleci içine al (süslü ilk paragraftan düzenlemeye geçiş) */
  grab?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = "0px"; el.style.height = el.scrollHeight + "px"; }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!focus || !el || document.activeElement === el) return;
    if (!value) el.focus();
    else if (grab) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  return (
    <textarea ref={ref} value={value} rows={1} placeholder={placeholder} className={className} spellCheck lang="tr"
              aria-label={placeholder === "Başlık" ? "Başlık" : "Paragraf"}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                // Ctrl/Cmd+Enter: her zaman yeni blok. Düz Enter: imleç metnin sonundaki boş satırdaysa
                // (yani bir kez daha Enter) yeni blok — telefonda Ctrl olmadan da yeni paragraf açılabilsin.
                const el = e.currentTarget;
                const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
                const emptyLine = atEnd && el.value.endsWith("\n");
                if (e.ctrlKey || e.metaKey) { e.preventDefault(); onEnterNew(); return; }
                if (emptyLine) { e.preventDefault(); onEnterNew(el.value.replace(/\n+$/, "")); }
              }} />
  );
}
