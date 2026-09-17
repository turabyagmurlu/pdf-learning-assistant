"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ArrowUp, ArrowDown, X, Plus, ExternalLink, Sparkles, Quote, RefreshCw, Heading2, Wand2, Loader2, Check } from "lucide-react";

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
  const [blocks, setBlocks] = useState<Block[]>(() => parseDraft(initial));
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [matQ, setMatQ] = useState("");
  const [flash, setFlash] = useState("");
  const timer = useRef<any>(null);
  const dirty = useRef(false);

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
    } catch (e: any) { setAssist({ idx, action, busy: false, error: e?.message || "Olmadı." }); }
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

  // otomatik kayit
  useEffect(() => {
    if (!dirty.current) return;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const ser = serializeDraft(blocks); await api(`/collections/${notebookId}`, { method: "PATCH", body: JSON.stringify({ draft: ser }) }); setStatus("saved"); setSavedAt(new Date()); onSaved?.(ser); }
      catch { setStatus("error"); }
    }, 1000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [blocks, notebookId]);

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
          <span className={status === "error" ? "text-danger" : ""}>
            {status === "saving" ? "defterde kaydediliyor…" : status === "saved" && savedAt ? `defterde kaydedildi · ${savedAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : status === "error" ? "kaydedilemedi — bağlantıyı kontrol et" : "değişiklik yok"}
          </span>
          {flash && <span className="text-accent-purple">{flash}</span>}
          <span className="ml-auto flex gap-1.5">
            <button onClick={() => download("md")} className="rounded-lg border bg-surface px-2.5 py-1 hover:border-accent-purple/50">Markdown</button>
            <button onClick={() => download("doc")} className="rounded-lg border bg-surface px-2.5 py-1 hover:border-accent-purple/50">Word</button>
          </span>
        </div>

        <div className="rounded-2xl border bg-surface p-4 md:p-6">
          {blocks.map((b, i) => (
            <div key={b.id} className="group relative" onFocus={() => setFocusIdx(i)} onClick={() => setFocusIdx(i)}>
              {/* AI menusu (sag ust) */}
              {(b.type === "p" || b.type === "h" || b.type === "quote") && (
                <div className="absolute right-0 top-1 z-10 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); setAssist(assist?.idx === i && assist.menu ? null : { idx: i, action: "", busy: false, menu: true }); }}
                          title="AI ile düzenle" className="flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                    <Wand2 size={11} /> AI
                  </button>
                  {assist?.idx === i && assist.menu && (
                    <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-7 w-64 overflow-hidden rounded-xl border bg-surface shadow-lg">
                      {(b.type === "quote"
                        ? [["paraphrase", "Kendi cümlemle yeniden yaz", "Parafraz; alıntının altına paragraf olarak girer"]]
                        : ACTIONS).map(([k, label, desc]) => (
                        <button key={k} onClick={() => { if (k === "custom") setAssist({ idx: i, action: "custom", busy: false, menu: false }); else runAssist(i, k); }}
                                className="block w-full px-3 py-2 text-left hover:bg-surface-muted">
                          <span className="block text-sm">{label}</span>
                          <span className="block text-[11px] text-text-secondary">{desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* blok araclari */}
              <div className="absolute -left-1 top-1 hidden -translate-x-full flex-col gap-0.5 pr-2 group-hover:flex md:flex md:opacity-0 md:group-hover:opacity-100">
                <button onClick={() => move(i, -1)} aria-label="Yukarı" className="rounded p-0.5 text-text-secondary hover:bg-surface-muted"><ArrowUp size={12} /></button>
                <button onClick={() => move(i, 1)} aria-label="Aşağı" className="rounded p-0.5 text-text-secondary hover:bg-surface-muted"><ArrowDown size={12} /></button>
                <button onClick={() => removeAt(i)} aria-label="Kaldır" className="rounded p-0.5 text-text-secondary hover:bg-surface-muted hover:text-danger"><X size={12} /></button>
              </div>

              {b.type === "p" && (
                <AutoTextarea value={b.text} focus={focusIdx === i}
                              onChange={(v) => setText(i, v)}
                              onEnterNew={() => addParagraph(i)}
                              placeholder={i === 0 && blocks.length === 1 ? "Buraya yaz. Sağdaki alıntıları tıklayarak araya kart olarak ekle; Ctrl+Enter yeni paragraf." : "Yaz…"}
                              className="w-full resize-none bg-transparent py-1.5 text-[15px] leading-[1.8] outline-none placeholder:text-text-secondary/60" />
              )}
              {b.type === "h" && (
                <AutoTextarea value={b.text} focus={focusIdx === i} onChange={(v) => setText(i, v)} onEnterNew={() => addParagraph(i)}
                              placeholder="Başlık" className="w-full resize-none bg-transparent py-2 font-heading text-2xl leading-tight outline-none placeholder:text-text-secondary/60" />
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
                      <input autoFocus value={customInstr} onChange={(e) => setCustomInstr(e.target.value)}
                             onKeyDown={(e) => { if (e.key === "Enter" && customInstr.trim()) runAssist(i, "custom", customInstr.trim()); if (e.key === "Escape") setAssist(null); }}
                             placeholder="Örn: iki cümleye indir ve daha net bir iddiayla başla"
                             className="flex-1 rounded-lg border bg-surface px-3 py-1.5 outline-none focus:border-accent-purple" />
                      <button onClick={() => customInstr.trim() && runAssist(i, "custom", customInstr.trim())} className="rounded-lg bg-accent-purple px-3 py-1.5 text-white">Uygula</button>
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
                        <button onClick={() => runAssist(i, assist.action, customInstr.trim() || undefined)} className="rounded-lg border px-3 py-1.5 text-text-secondary">Tekrar dene</button>
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
                              <p className="mt-0.5 text-[10px] text-text-secondary">{sg.document_title}{sg.page ? " · s." + sg.page : ""} · uyum %{Math.round((sg.score || 0) * 100)}</p>
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

              {/* araya ekle */}
              <div className="flex h-3 items-center justify-center opacity-0 transition group-hover:opacity-100">
                <button onClick={() => addParagraph(i)} title="Paragraf ekle" className="rounded-full border bg-surface p-0.5 text-text-secondary hover:text-accent-purple"><Plus size={11} /></button>
                <button onClick={() => addParagraph(i, "h")} title="Başlık ekle" className="ml-1 rounded-full border bg-surface p-0.5 text-text-secondary hover:text-accent-purple"><Heading2 size={11} /></button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-secondary">
          Düz metin senin; renkli kenarlı kartlar PDF'ten alıntı, mor kartlar sohbet cevabı. Kartların içine yazılmaz; altına paragraf açılır. Blok üstüne gelince ↑ ↓ ✕.
        </p>
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border bg-surface p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">PDF vurguların</p>
            <button onClick={onReloadMaterial} title="Yenile" className="rounded-md p-1 text-text-secondary hover:bg-surface-muted"><RefreshCw size={13} /></button>
          </div>
          <input value={matQ} onChange={(e) => setMatQ(e.target.value)} placeholder="Vurgularda ara…"
                 className="mb-2 w-full rounded-lg border bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent-purple" />
          <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
            {material === null ? (
              <p className="p-3 text-xs text-text-secondary">Yükleniyor…</p>
            ) : mats.length === 0 ? (
              <p className="p-3 text-xs text-text-secondary">Bu defterin kaynaklarında vurgu yok. PDF'te metin seç, renk ver — burada belirir.</p>
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
                  <p className="mt-1 text-[10px] text-text-secondary">{n.document_title}{n.page_number ? " · s." + n.page_number : ""}{inUse ? " · taslakta" : ""}</p>
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
