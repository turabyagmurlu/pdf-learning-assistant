"use client";
/**
 * Defter sohbeti: kaynaklarin tamaminda atifli cevap. Sohbetler sunucuda saklanir;
 * acik sohbet adreste (&chat=) tutulur, geri tusuyla ayni sohbete donulur.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Plus, X, Trash2, Sparkles, RefreshCw, PenLine, Scale, Copy, Check, MessageSquare, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import CitedText, { citeLoc } from "@/components/CitedText";
import SourceIcon, { sourceTint } from "@/components/SourceIcon";
import { Cost, costTitle, ErrNote, Err, toErr } from "@/components/CostBadge";

export type SGroup = { kind: string; label: string; questions: { q: string; why: string }[] };
export type Sugg = { theme: string; groups: SGroup[]; source: string };
export type Turn = { q: string; answer: string; sources: any[]; followups?: string[]; cached?: boolean; cachedQ?: string };

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const scrollTop = () => {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
};

function toThread(msgs: any[]): Turn[] {
  return (msgs || []).map((m: any) => ({ q: m.q, answer: m.answer || "", sources: m.sources || [],
    followups: m.followups || [], cached: !!m.cached, cachedQ: m.cached_question }));
}

export default function ChatTab({ id, colTitle, readyN, active, chatId, setChatUrl, sugg, suggBusy, loadSuggestions,
  pendingAsk, onPendingDone, onToDraft, onCompare, onAsked }: {
  id: string; colTitle: string; readyN: number; active: boolean;
  chatId: string | null; setChatUrl: (cid: string | null) => void;
  sugg: Sugg | null; suggBusy: boolean; loadSuggestions: (refresh?: boolean) => void;
  pendingAsk: string | null; onPendingDone: () => void;
  onToDraft: (t: Turn) => void; onCompare: (q: string) => void; onAsked: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState<(NonNullable<Err> & { q: string }) | null>(null);
  const [thread, setThread] = useState<Turn[]>([]);
  const [chats, setChats] = useState<{ id: string; title: string; updated_at: string; n: number }[] | null>(null);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [suggOpen, setSuggOpen] = useState(true);
  const [openSrc, setOpenSrc] = useState<Record<number, boolean>>({});
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const current = useRef<string | null>(null);     // ekranda acik olan sohbet
  const inited = useRef(false);

  async function loadChats(openLatest = false) {
    try {
      const list = await api(`/collections/${id}/chats`, {}, 1);
      setChats(list);
      if (openLatest && list.length && current.current === null) await openChat(list[0].id);
    } catch { setChats([]); }
  }
  async function openChat(cid: string) {
    try {
      const r = await api(`/collections/${id}/chats/${cid}`, {}, 1);
      setThread(toThread(r.messages)); current.current = cid; setChatUrl(cid);
      setChatsOpen(false); setSuggOpen(false); setAskErr(null);
    } catch { if (current.current === cid) current.current = null; }
  }
  function newChat() {
    setThread([]); current.current = null; setChatUrl(null); setChatsOpen(false); setSuggOpen(true); setAskErr(null);
  }
  async function deleteChat(cid: string) {
    try { await api(`/collections/${id}/chats/${cid}`, { method: "DELETE" }, 1); } catch {}
    if (cid === current.current) newChat();
    loadChats();
  }

  // Ilk acilis: adreste sohbet varsa onu, yoksa son sohbeti ac (bekleyen ilk soru varsa bos sohbette kal)
  useEffect(() => {
    if (!active) return;
    if (!inited.current) {
      inited.current = true;
      if (chatId) { openChat(chatId); loadChats(); }
      else loadChats(!pendingAsk);
      return;
    }
    // Geri/ileri tusu: adresteki sohbet degistiyse onu ac
    if (chatId && chatId !== current.current) openChat(chatId);
    else if (!chatId && current.current) { setThread([]); current.current = null; setSuggOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, chatId]);

  // "Sıradaki adım" ya da baska sekmeden gelen tek tikla soru
  useEffect(() => {
    if (!active || !pendingAsk || asking) return;
    const text = pendingAsk;
    onPendingDone();
    ask(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pendingAsk]);

  useEffect(() => {
    if (!chatsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setChatsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatsOpen]);

  async function ask(text?: string, fresh = false) {
    const question = (text ?? q).trim();
    if (question.length < 3 || asking) return;
    setAsking(true); setQ(""); setSuggOpen(false); setAskErr(null); setAnnounce("Kaynaklar taranıyor…");
    try {
      const r = await api(`/collections/${id}/ask`, { method: "POST", body: JSON.stringify({ question, fresh, chat_id: current.current }) }, 1);
      let fu: string[] = (r.followups || []).map((s: string) => s.replace(/\s*\[K\s*\d+(?:\s*[,;]\s*K?\s*\d+)*\]/g, "").trim()).filter(Boolean);
      if (!fu.length && sugg?.groups?.length) {
        // Devam sorusu gelmediyse: henuz sorulmamis onerilerden 3 tane (ek maliyet yok)
        const asked = new Set([...thread.map((x) => x.q), question]);
        fu = sugg.groups.flatMap((g) => g.questions.map((x) => x.q)).filter((x) => !asked.has(x)).slice(0, 3);
      }
      if (r.chat_id && r.chat_id !== current.current) { current.current = r.chat_id; setChatUrl(r.chat_id); loadChats(); }
      const item: Turn = { q: question, answer: r.answer, sources: r.sources || [], followups: fu, cached: !!r.cached, cachedQ: r.cached_question };
      setThread((t) => fresh && t.length && t[t.length - 1].q === question ? [...t.slice(0, -1), item] : [...t, item]);
      setAnnounce("Cevap geldi.");
      onAsked();
    } catch (e) {
      // Hata cevap balonu olarak gosterilmez; soru kutuya geri konur, "Tekrar dene" sunulur.
      const er = toErr(e, "Cevap alınamadı; birazdan tekrar dene.");
      if (er) setAskErr({ ...er, q: question });
      setQ((cur) => cur || question);
      setAnnounce(er?.text || "");
    } finally { setAsking(false); }
  }

  const firstQ = sugg?.groups?.[0]?.questions?.[0]?.q || "";
  const hasSugg = !!sugg?.groups?.length;
  const current_title = current.current ? (chats?.find((c) => c.id === current.current)?.title || "Bu sohbet") : "Yeni sohbet";

  return (
    <div className="max-w-3xl">
      <p aria-live="polite" className="sr-only">{announce}</p>
      {/* Sohbet gecmisi */}
      <div className="relative mb-3 flex items-center gap-2">
        <button onClick={() => { setChatsOpen((o) => !o); if (!chatsOpen) loadChats(); }} aria-expanded={chatsOpen} aria-haspopup="listbox"
                className="flex min-h-[40px] min-w-0 items-center gap-1.5 rounded-lg border bg-surface px-3 text-sm hover:border-accent-purple/40">
          <MessageSquare size={14} className="shrink-0 text-accent-purple" />
          <span className="truncate">{current_title}</span>
          <span className="shrink-0 text-xs text-text-secondary">· {chats?.length || 0} kayıtlı</span>
        </button>
        {thread.length > 0 && (
          <button onClick={newChat} className="flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg px-2.5 text-sm text-accent-purple hover:bg-accent-purple/10">
            <Plus size={14} /> Yeni sohbet
          </button>
        )}
        {chatsOpen && (
          <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-full max-w-md overflow-y-auto rounded-xl border bg-surface p-1.5 shadow-lg">
            {!chats?.length ? (
              <p className="p-3 text-sm text-text-secondary">Henüz kayıtlı sohbet yok. Sorduğun her şey burada saklanacak.</p>
            ) : chats.map((c) => (
              <div key={c.id} className={cx("group flex items-center gap-2 rounded-lg px-2.5 py-1 text-sm hover:bg-surface-muted",
                                              c.id === current.current && "bg-accent-purple/10")}>
                <button onClick={() => openChat(c.id)} className="min-h-[40px] min-w-0 flex-1 text-left">
                  <span className="block truncate">{c.title || "Sohbet"}</span>
                  <span className="block text-xs text-text-secondary">
                    {c.n} soru · {new Date(c.updated_at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
                <button onClick={() => deleteChat(c.id)} aria-label={`Sohbeti sil: ${c.title || "Sohbet"}`} title="Sohbeti sil"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-text-secondary transition hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {thread.length === 0 && !asking && (
        <p className="mb-3 text-sm text-text-secondary">
          Soru sor; <b>{colTitle}</b> defterindeki {readyN} hazır kaynağın tamamında arayıp atıflı cevaplayayım.
          Beğendiğin cevabı tek dokunuşla taslağa alırsın.
        </p>
      )}

      {/* Yonlendirici sorular: bos sohbette acik, sonra katlanir */}
      {(thread.length === 0 || suggOpen) && (hasSugg || suggBusy || sugg?.source === "sablon") && (
        <div className="mb-5 rounded-2xl border bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles size={14} className="text-accent-purple" /> Nereden başlamalı?</p>
              {sugg?.theme && <p className="mt-0.5 text-xs text-text-secondary">{sugg.theme}</p>}
            </div>
            {thread.length > 0 && (
              <button onClick={() => setSuggOpen(false)} aria-label="Soru önerilerini kapat"
                      className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted"><X size={15} /></button>
            )}
          </div>
          {suggBusy && !hasSugg ? (
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-surface-muted" />)}
              <p className="text-xs text-text-secondary">Kaynak özetlerinden sorular hazırlanıyor…</p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {(sugg?.groups || []).map((g) => (
                <div key={g.kind}>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">{g.label}</p>
                  <div className="flex flex-col gap-1.5">
                    {g.questions.map((s, k) => (
                      <button key={k} onClick={() => ask(s.q)} disabled={asking} title={s.why}
                              className="group flex min-h-[40px] items-start gap-2 rounded-xl border bg-surface px-3 py-2 text-left text-sm transition hover:border-accent-purple/50 hover:bg-accent-purple/5 disabled:opacity-60">
                        <Send size={12} className="mt-1 shrink-0 text-text-secondary group-hover:text-accent-purple" />
                        <span className="min-w-0 flex-1">
                          {s.q}
                          {s.why && <span className="ml-1.5 text-xs text-text-secondary">· {s.why}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5 text-xs text-text-secondary">
            {sugg?.source === "sablon" ? (
              <span>Yapay zekâ şu an yoğun; genel örnek sorular gösteriliyor.</span>
            ) : (
              <span>Kaynak özetlerinden üretildi · her yeni soru 1 kullanım harcar, kayıtlı cevaplar ücretsiz</span>
            )}
            <button onClick={() => loadSuggestions(true)} disabled={suggBusy} title={costTitle(1)}
                    className="ml-auto flex min-h-[36px] items-center gap-1 rounded-md px-2 hover:bg-surface-muted disabled:opacity-60">
              {suggBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Başka öneriler <Cost n={1} />
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {thread.map((t, i) => (
          <div key={i} className="fade-in">
            <div className="mb-2 flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md border bg-surface px-3.5 py-2 text-sm">{t.q}</p>
            </div>
            <div className="rounded-2xl border bg-surface p-4 md:p-5">
              {t.cached && (
                <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-800 dark:text-green-300">
                  <span>Kayıtlı cevap · ücretsiz{t.cachedQ && t.cachedQ !== t.q ? ` · benzer soru: “${t.cachedQ}”` : ""}</span>
                  {i === thread.length - 1 && (
                    <button onClick={() => ask(t.q, true)} disabled={asking} title={costTitle(1)}
                            className="ml-auto flex min-h-[32px] items-center rounded-md border border-green-700/30 px-2 hover:bg-green-500/10 disabled:opacity-60">
                      Yeniden sor <Cost n={1} />
                    </button>
                  )}
                </div>
              )}
              <CitedText text={t.answer} sources={t.sources}
                         className="whitespace-pre-wrap font-heading text-[15.5px] leading-7"
                         onCite={(_n, s) => { if (s?.document_id) router.push("/documents/" + s.document_id + (s.page ? "?page=" + s.page : "")); }} />
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                {(() => {
                  const uniq = Array.from(new Map(t.sources.map((s: any) => [s.document_id, s])).values()) as any[];
                  const open = !!openSrc[i];
                  return (
                    <div className="w-full">
                      <button onClick={() => setOpenSrc((o) => ({ ...o, [i]: !open }))} aria-expanded={open}
                              className="flex min-h-[40px] w-full items-center gap-2.5 rounded-lg py-1 text-left text-xs text-text-secondary hover:text-text-primary">
                        <span className="flex" aria-hidden>
                          {uniq.slice(0, 4).map((s: any, j: number) => (
                            <span key={j} className={cx("flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface", sourceTint(s.kind), j > 0 && "-ml-1.5")}>
                              <SourceIcon kind={s.kind || "pdf"} size={12} />
                            </span>
                          ))}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <b className="font-medium text-text-primary">{t.sources.length} alıntı · {uniq.length} kaynak</b>
                          <span className="hidden sm:inline"> · {uniq.slice(0, 2).map((s: any) => (s.title || "").slice(0, 28)).join(" · ")}{uniq.length > 2 ? ` · +${uniq.length - 2}` : ""}</span>
                        </span>
                        <span className="shrink-0 text-accent-purple">{open ? "Gizle" : "Göster"}</span>
                      </button>
                      {open && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {t.sources.map((s: any, j: number) => (
                            <button key={j} onClick={() => router.push("/documents/" + s.document_id + (s.page ? "?page=" + s.page : ""))}
                                    title={s.snippet || s.title}
                                    className="min-h-[36px] rounded-full border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                              K{j + 1} · {(s.title || "").slice(0, 40)} · {citeLoc(s)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <span className="ml-auto flex flex-wrap gap-1.5">
                  <button onClick={() => onToDraft(t)}
                          className="flex min-h-[36px] items-center gap-1 rounded-full border border-accent-purple/40 bg-accent-purple/5 px-3 text-xs font-medium text-text-primary hover:bg-accent-purple/10">
                    <PenLine size={12} /> Taslağa ekle
                  </button>
                  {readyN >= 2 && (
                    <button onClick={() => onCompare(t.q)}
                            className="flex min-h-[36px] items-center gap-1 rounded-full border px-3 text-xs text-text-secondary hover:border-accent-purple/40 hover:text-accent-purple">
                      <Scale size={12} /> Karşılaştır
                    </button>
                  )}
                  <button onClick={async () => { try { await navigator.clipboard.writeText(t.answer.replace(/\[K[\d,;\s K]+\]/g, "").trim()); setCopiedIdx(i); setTimeout(() => setCopiedIdx(null), 1500); } catch {} }}
                          className="flex min-h-[36px] items-center gap-1 rounded-full border px-3 text-xs text-text-secondary hover:border-accent-purple/40 hover:text-accent-purple">
                    {copiedIdx === i ? <Check size={12} /> : <Copy size={12} />} {copiedIdx === i ? "Kopyalandı" : "Kopyala"}
                  </button>
                </span>
              </div>
            </div>
            {/* Devam sorulari: ayni cevapla gelir */}
            {!!t.followups?.length && i === thread.length - 1 && (
              <div className="mt-2 flex flex-col gap-1.5 pl-1">
                <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Daha derine in</p>
                {t.followups.map((f, k) => (
                  <button key={k} onClick={() => ask(f)} disabled={asking}
                          className="group flex min-h-[40px] items-start gap-2 self-start rounded-xl border border-dashed bg-surface px-3 py-1.5 text-left text-sm text-text-secondary transition hover:border-accent-purple/50 hover:text-text-primary disabled:opacity-60">
                    <Send size={12} className="mt-1 shrink-0 group-hover:text-accent-purple" /> {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {asking && <p className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" /> Kaynaklar taranıyor…</p>}
        {askErr && !asking && (
          <div className="rounded-xl border border-dashed p-3">
            <ErrNote err={askErr} />
            {!askErr.limit && (
              <button onClick={() => ask(askErr.q)} title={costTitle(1)}
                      className="mt-2 flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:border-accent-purple/50">
                <RotateCcw size={14} /> Tekrar dene <Cost n={1} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Giris kutusu: mobilde alt menunun ustunde (--bottom-nav, B) */}
      <div className="sticky bottom-[calc(var(--bottom-nav,64px)+8px)] z-10 mt-5 flex gap-2 md:bottom-4">
        {thread.length > 0 && !suggOpen && (
          <button onClick={() => { setSuggOpen(true); if (!sugg) loadSuggestions(); scrollTop(); }}
                  title="Soru önerilerini göster" aria-label="Soru önerilerini göster"
                  className="flex min-h-[44px] items-center justify-center rounded-xl border bg-surface px-3 text-accent-purple shadow-sm hover:border-accent-purple/50">
            <Sparkles size={16} />
          </button>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
               aria-label="Kaynaklarına soru sor"
               placeholder={thread.length ? "Devam et ya da yeni bir soru sor…" : firstQ ? `Örn: ${firstQ}` : "Kaynaklarına bir soru sor…"}
               className="min-h-[44px] min-w-0 flex-1 rounded-xl border bg-surface px-3 py-2.5 text-sm shadow-sm outline-none focus:border-accent-purple" />
        <button onClick={() => ask()} disabled={asking} title={costTitle(1) + " (kayıtlı cevaplar ücretsiz)"}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm font-medium text-white disabled:opacity-60">
          {asking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Sor <Cost n={1} className="bg-white/20" />
        </button>
      </div>
    </div>
  );
}
