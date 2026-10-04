"use client";
/**
 * Defter "Sor" sekmesi (Sor v3): kaynaklarin tamaminda, ders gibi uzun ve atifli cevap.
 *  - Ustte derinlik secici (Kısa · Ayrıntılı · Derin ⚡2; varsayilan Ayrıntılı, localStorage)
 *  - Hazir sorular: Kaynakları karşılaştır (≥2 kaynak) · Ana fikirleri çıkar · Örnekle
 *  - Cevap SSE ile akar (POST /collections/{id}/ask/stream); eski /ask ucu sunucuda duruyor
 *  - Cevabin altinda: Sesli dinle (typdf:listen), Çalışma notuna ekle (POST /collections/{id}/draft/blocks),
 *    Kopyala; devam sorulari ayri alanda; "Sorunu şöyle anladım: …" gri satiri (tiklayinca duzeltme)
 * Sohbetler sunucuda saklanir; acik sohbet adreste (&chat=) tutulur, geri tusuyla ayni sohbete donulur.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Plus, X, Trash2, Sparkles, RefreshCw, MessageSquare, RotateCcw } from "lucide-react";
import { api, API, getToken, errorMessage } from "@/lib/api";
import { docHref } from "@/lib/links";
import CitedText, { citeLoc } from "@/components/CitedText";
import SourceIcon, { sourceTint } from "@/components/SourceIcon";
import { Cost, costTitle, ErrNote, Err, toErr } from "@/components/CostBadge";
import { toast } from "@/components/Toast";
import { streamSse, type ChatError } from "@/hooks/useChatStream";
import DepthPicker from "@/components/chat/DepthPicker";
import { AnswerActions, Understood, Followups, type AddState } from "@/components/chat/AnswerExtras";
import { type Depth, loadDepth, saveDepth, depthCost, quickQuestions, splitFollowups, stripFollowups, askPrefillText } from "@/components/chat/depth";

/** Sohbet silme 10 sn ertelenir ("Geri al" icin); sekmeden cikilsa da zamanlayici calisir. */
const UNDO_MS = 10000;

/* Çalışma notundaki alıntının yanındaki "Sor" → window "typdf:ask" {text, page, document_id}.
 * Sekme bağlıysa kendisi dinler (aşağıdaki useEffect). Sor sekmesi daha hiç açılmadıysa ChatTab bağlı değildir;
 * o durumda bu modül düzeyindeki dinleyici metni saklar ve adresi ?tab=sor yapar (Next 14.2 native pushState'i
 * izler → sekme bağlanır → saklanan metin kutuya düşer). Okuyucu sayfasında (/documents) devreye girmez. */
const ASK_EVENT = "typdf:ask";
const ASK_STASH = "typdf.askPending";
let mountedTabs = 0;
if (typeof window !== "undefined") {
  window.addEventListener(ASK_EVENT, (e: Event) => {
    if (mountedTabs > 0) return;
    if (!/^\/collections\/[^/?#]+/.test(window.location.pathname)) return;
    const d = (e as CustomEvent).detail || {};
    const text = String(d.text || "");
    if (!text.trim()) return;
    try { sessionStorage.setItem(ASK_STASH, askPrefillText(text, d.page)); } catch {}
    const p = new URLSearchParams(window.location.search);
    p.set("tab", "sor");
    window.history.pushState(null, "", `${window.location.pathname}?${p.toString()}`);
  });
}

export type SGroup = { kind: string; label: string; questions: { q: string; why: string }[] };
export type Sugg = { theme: string; groups: SGroup[]; source: string };
export type Turn = { q: string; answer: string; sources: any[]; followups?: string[]; cached?: boolean; cachedQ?: string;
  rewritten?: string | null; depth?: Depth };

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const scrollTop = () => {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
};

function toThread(msgs: any[]): Turn[] {
  return (msgs || []).map((m: any) => {
    // Güvenlik ağı: eski kayıtta gövdeye gömülü kalmış devam bloğu varsa ayır
    const { body, followups } = splitFollowups(m.answer || "");
    return { q: m.q, answer: body, sources: m.sources || [],
      followups: (m.followups && m.followups.length ? m.followups : followups) || [], cached: !!m.cached,
      cachedQ: m.cached_question, rewritten: m.rewritten_question || null, depth: m.depth };
  });
}

export default function ChatTab({ id, colTitle, readyN, active, chatId, setChatUrl, sugg, suggBusy, loadSuggestions,
  pendingAsk, onPendingDone, prefill, onPrefillDone, onAsked }: {
  id: string; colTitle: string; readyN: number; active: boolean;
  chatId: string | null; setChatUrl: (cid: string | null) => void;
  sugg: Sugg | null; suggBusy: boolean; loadSuggestions: (refresh?: boolean) => void;
  pendingAsk: string | null; onPendingDone: () => void;
  /** Soru kutusuna on-dolgu (okuyucudan "Tüm deftere sor", ?q=); sorulmaz, sen gonderirsin */
  prefill?: string | null; onPrefillDone?: () => void;
  /** Eski: cevabi taslaga ekleme/karsilastirma sayfadan geliyordu; artik sekme kendi yapar (uyumluluk icin kalir). */
  onToDraft?: (t: Turn) => void; onCompare?: (q: string) => void; onAsked: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [live, setLive] = useState<{ q: string; text: string; rewritten: string | null } | null>(null);
  const [askErr, setAskErr] = useState<(NonNullable<Err> & { q: string }) | null>(null);
  const [thread, setThread] = useState<Turn[]>([]);
  const [chats, setChats] = useState<{ id: string; title: string; updated_at: string; n: number }[] | null>(null);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [suggOpen, setSuggOpen] = useState(true);
  const [openSrc, setOpenSrc] = useState<Record<number, boolean>>({});
  const [addState, setAddState] = useState<Record<number, AddState>>({});
  const [depth, setDepth] = useState<Depth>("ayrintili");
  const [announce, setAnnounce] = useState("");
  const current = useRef<string | null>(null);     // ekranda acik olan sohbet
  const inited = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  // H-6: silinmesi bekleyen sohbetler (10 sn "Geri al"); listeden hemen gizlenir, sunucuya sonra gider
  const pendingDel = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const focusWanted = useRef(false);
  useEffect(() => { setDepth(loadDepth()); }, []);
  const changeDepth = (d: Depth) => { setDepth(d); saveDepth(d); };

  // Sekme başlığı: Sor açıkken "<defter adı> · Sor · TY PDF" (sayfa 60 ms sonra kendi başlığını yazar; onu bekleyip geçeriz)
  useEffect(() => {
    if (!active || !colTitle) return;
    const t = `${colTitle} · Sor · TY PDF`;
    document.title = t;
    const h = setTimeout(() => { if (document.title !== t) document.title = t; }, 140);
    return () => clearTimeout(h);
  }, [active, colTitle]);

  // typdf:ask (alıntının yanındaki "Sor"): kutuya «alıntı» (s.N) — bunu açıkla; Sor sekmesine geç; odakla
  useEffect(() => { mountedTabs++; return () => { mountedTabs--; }; }, []);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const text = String(d.text || "");
      if (!text.trim()) return;
      setQ(askPrefillText(text, d.page));
      focusWanted.current = true;
      if (active) setTimeout(() => inputRef.current?.focus(), 50);
      else {
        const p = new URLSearchParams(window.location.search);
        p.set("tab", "sor");
        router.push(`${window.location.pathname}?${p.toString()}`, { scroll: false });
      }
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, [active, router]);
  useEffect(() => {
    if (!active) return;
    try {
      const s = sessionStorage.getItem(ASK_STASH);
      if (s) { sessionStorage.removeItem(ASK_STASH); setQ(s); focusWanted.current = true; }
    } catch {}
    if (focusWanted.current) {
      focusWanted.current = false;
      const h = setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch {} } }, 120);
      return () => clearTimeout(h);
    }
  }, [active]);

  async function loadChats(openLatest = false) {
    try {
      const list = await api(`/collections/${id}/chats`, {}, 1);
      setChats(list);
      if (openLatest && list.length && current.current === null) await openChat(list[0].id);
    } catch (e) {
      if (chats === null) setChats([]);
      toast.error(errorMessage(e, "Sohbet listesi alınamadı; bağlantını kontrol edip tekrar dene."));
    }
  }
  async function openChat(cid: string) {
    try {
      const r = await api(`/collections/${id}/chats/${cid}`, {}, 1);
      setThread(toThread(r.messages)); current.current = cid; setChatUrl(cid);
      setChatsOpen(false); setSuggOpen(false); setAskErr(null); setAddState({});
    } catch (e) {
      if (current.current === cid) current.current = null;
      toast.error(errorMessage(e, "Sohbet açılamadı; bağlantını kontrol edip tekrar dene."));
    }
  }
  function newChat() {
    setThread([]); current.current = null; setChatUrl(null); setChatsOpen(false); setSuggOpen(true); setAskErr(null); setAddState({});
  }
  async function commitDelete(cid: string) {
    pendingDel.current.delete(cid);
    try {
      await api(`/collections/${id}/chats/${cid}`, { method: "DELETE" }, 1);
    } catch (e) {
      // Silinemedi: sohbet listeye geri gelir, sebep bildirilir
      setHidden((h) => { const n = new Set(h); n.delete(cid); return n; });
      toast.error(errorMessage(e, "Sohbet silinemedi; bağlantını kontrol edip tekrar dene."));
      return;
    }
    loadChats();
  }
  function deleteChat(cid: string) {
    if (pendingDel.current.has(cid)) return;
    const title = chats?.find((c) => c.id === cid)?.title || "Sohbet";
    const wasCurrent = cid === current.current;
    setHidden((h) => new Set(h).add(cid));
    if (wasCurrent) newChat();
    pendingDel.current.set(cid, setTimeout(() => commitDelete(cid), UNDO_MS));
    toast(`“${title.slice(0, 40)}” silindi`, {
      ms: UNDO_MS,
      action: { label: "Geri al", run: () => {
        const t = pendingDel.current.get(cid);
        if (!t) return;                       // sure dolmus, sunucuya gitmis
        clearTimeout(t); pendingDel.current.delete(cid);
        setHidden((h) => { const n = new Set(h); n.delete(cid); return n; });
        if (wasCurrent) openChat(cid);
        toast("Sohbet geri alındı");
      } },
    });
  }
  // Sayfadan ayrilirken bekleyen silmeler hemen gonderilir (keepalive); bilesen kalkinca da
  useEffect(() => {
    const flush = () => {
      pendingDel.current.forEach((t, cid) => {
        clearTimeout(t);
        try { fetch(`${API}/collections/${id}/chats/${cid}`, { method: "DELETE", keepalive: true, headers: { Authorization: "Bearer " + (getToken() || "") } }); } catch {}
      });
      pendingDel.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  // Okuyucudan tasinan soru: kutuya yazilir, odaklanir; gondermek sana kalir
  useEffect(() => {
    if (!active || !prefill) return;
    setQ(prefill); onPrefillDone?.();
    setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, prefill]);

  useEffect(() => {
    if (!chatsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setChatsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatsOpen]);

  // Akan cevap ekranda kalsin
  useEffect(() => {
    if (!live?.text) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    liveRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [live?.text]);

  async function ask(text?: string, fresh = false) {
    const question = (text ?? q).trim();
    if (question.length < 3 || asking) return;
    setAsking(true); setQ(""); setSuggOpen(false); setAskErr(null); setAnnounce("Kaynaklar taranıyor…");
    setLive({ q: question, text: "", rewritten: null });
    let full = "", sources: any[] = [], followups: string[] = [], rewritten: string | null = null;
    let cached = false, cachedQ: string | undefined, chat: string | null = null;
    const err: ChatError | null = await streamSse(`${API}/collections/${id}/ask/stream?token=${getToken() || ""}`,
      { question, fresh, chat_id: current.current, depth }, {
        onToken: (t) => { full += t; setLive((l) => (l ? { ...l, text: full } : l)); },
        onEvent: (type, data) => {
          if (type === "meta") { rewritten = data.rewritten_question || null; setLive((l) => (l ? { ...l, rewritten } : l)); }
          else if (type === "sources") sources = Array.isArray(data.items) ? data.items : [];
          else if (type === "followups") followups = Array.isArray(data.items) ? data.items : [];
          else if (type === "done") { cached = !!data.cached; cachedQ = data.cached_question || undefined; chat = data.chat_id || null; }
        },
      });
    setLive(null);
    if (err || !full.trim()) {
      // Hata cevap balonu olarak gosterilmez; soru kutuya geri konur, "Tekrar dene" sunulur.
      const er = toErr(err ? { message: err.message, code: err.code } : null, "Cevap alınamadı; birazdan tekrar dene.");
      if (er) setAskErr({ ...er, q: question });
      setQ((cur) => cur || question);
      setAnnounce(er?.text || "");
      setAsking(false);
      return;
    }
    // Güvenlik ağı: sunucudan kaçan bir devam bloğu varsa gövdeden ayır (ekranda ve notta işaret kalmaz)
    const split = splitFollowups(full);
    full = split.body;
    if (!followups.length) followups = split.followups;
    let fu = followups.map((s) => s.replace(/\s*\[K\s*\d+(?:\s*s\.\s*\d+)?(?:\s*[,;]\s*K?\s*\d+(?:\s*s\.\s*\d+)?)*\]/g, "").trim()).filter(Boolean);
    if (!fu.length && sugg?.groups?.length) {
      // Devam sorusu gelmediyse: henuz sorulmamis onerilerden 3 tane (ek maliyet yok)
      const asked = new Set([...thread.map((x) => x.q), question]);
      fu = sugg.groups.flatMap((g) => g.questions.map((x) => x.q)).filter((x) => !asked.has(x)).slice(0, 3);
    }
    if (chat && chat !== current.current) { current.current = chat; setChatUrl(chat); loadChats(); }
    const item: Turn = { q: question, answer: full, sources, followups: fu, cached, cachedQ, rewritten, depth };
    setThread((t) => fresh && t.length && t[t.length - 1].q === question ? [...t.slice(0, -1), item] : [...t, item]);
    setAnnounce("Cevap geldi.");
    setAsking(false);
    onAsked();
  }

  /** Cevabi defterin Çalışma notuna ekler (mevcut taslagin sonuna; ucretsiz). */
  async function addToNote(i: number, t: Turn) {
    if (addState[i] === "busy" || addState[i] === "done" || !t.answer.trim()) return;
    setAddState((s) => ({ ...s, [i]: "busy" }));
    try {
      await api(`/collections/${id}/draft/blocks`, { method: "POST", body: JSON.stringify({ blocks: [{ type: "answer", q: t.q, text: t.answer.trim(),
        sources: (t.sources || []).map((s: any) => ({ title: s.title, page: s.page ?? null, document_id: s.document_id })) }] }) }, 1);
      setAddState((s) => ({ ...s, [i]: "done" }));
      toast("Çalışma notuna eklendi", { action: { label: "Notu aç", run: () => router.push(`/collections/${id}?tab=not`) } });
    } catch (e) {
      setAddState((s) => ({ ...s, [i]: "idle" }));
      toast.error(errorMessage(e, "Çalışma notuna eklenemedi. Birkaç saniye sonra tekrar dene."));
    }
  }

  const firstQ = sugg?.groups?.[0]?.questions?.[0]?.q || "";
  const hasSugg = !!sugg?.groups?.length;
  const current_title = current.current ? (chats?.find((c) => c.id === current.current)?.title || "Bu sohbet") : "Yeni sohbet";
  const quick = quickQuestions({ multi: readyN >= 2, scope: "defter" });
  const cost = depthCost(depth);

  return (
    <div className="max-w-3xl">
      <p aria-live="polite" className="sr-only">{announce}</p>
      {/* Sohbet gecmisi + derinlik */}
      <div className="relative mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => { setChatsOpen((o) => !o); if (!chatsOpen) loadChats(); }} aria-expanded={chatsOpen} aria-haspopup="listbox"
                className="flex min-h-[44px] min-w-0 items-center gap-1.5 rounded-lg border bg-surface px-3 text-sm hover:border-accent-purple/40">
          <MessageSquare size={14} className="shrink-0 text-accent-purple" />
          <span className="truncate">{current_title}</span>
          <span className="shrink-0 text-xs text-text-secondary">· {(chats || []).filter((c) => !hidden.has(c.id)).length} kayıtlı</span>
        </button>
        {thread.length > 0 && (
          <button onClick={newChat} className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg px-2.5 text-sm text-accent-purple hover:bg-accent-purple/10">
            <Plus size={14} /> Yeni sohbet
          </button>
        )}
        <div className="ml-auto w-full sm:w-auto sm:min-w-[300px]">
          <DepthPicker value={depth} onChange={changeDepth} compact disabled={asking} />
        </div>
        {chatsOpen && (
          <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-full max-w-md overflow-y-auto rounded-xl border bg-surface p-1.5 shadow-lg">
            {!chats?.length ? (
              <p className="p-3 text-sm text-text-secondary">Henüz kayıtlı sohbet yok. Sorduğun her şey burada saklanacak.</p>
            ) : chats.filter((c) => !hidden.has(c.id)).map((c) => (
              <div key={c.id} className={cx("group flex items-center gap-2 rounded-lg px-2.5 py-1 text-sm hover:bg-surface-muted",
                                              c.id === current.current && "bg-surface-muted font-medium")}>
                <button onClick={() => openChat(c.id)} className="min-h-[44px] min-w-0 flex-1 text-left">
                  <span className="block truncate">{c.title || "Sohbet"}</span>
                  <span className="block text-xs text-text-secondary">
                    {c.n} soru · {new Date(c.updated_at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
                <button onClick={() => deleteChat(c.id)} aria-label={`Sohbeti sil: ${c.title || "Sohbet"}`} title="Sohbeti sil"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary transition hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {thread.length === 0 && !asking && (
        <p className="mb-3 text-sm text-text-secondary">
          Soru sor; <b>{colTitle}</b> defterindeki {readyN} hazır kaynağın tamamında arayıp ders gibi, atıflı anlatayım.
          Beğendiğin cevabı tek dokunuşla çalışma notuna alırsın.
        </p>
      )}

      {/* Hazir sorular: her zaman tek satir */}
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Hazır sorular">
        {quick.map((s) => (
          <button key={s.label} type="button" onClick={() => ask(s.q)} disabled={asking} title={s.q}
                  className="flex min-h-[44px] items-center gap-1 rounded-full border bg-surface px-3 text-sm text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple disabled:opacity-60">
            <Sparkles size={12} className="text-accent-purple" aria-hidden /> {s.label}
          </button>
        ))}
      </div>

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
                      className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted"><X size={15} /></button>
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
                              className="group flex min-h-[44px] items-start gap-2 rounded-xl border bg-surface px-3 py-2 text-left text-sm transition hover:border-accent-purple/50 hover:bg-accent-purple/5 disabled:opacity-60">
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
              <span>Kaynak özetlerinden üretildi · her yeni soru {cost} kullanım harcar, kayıtlı cevaplar ücretsiz</span>
            )}
            <button onClick={() => loadSuggestions(true)} disabled={suggBusy} title={costTitle(1)}
                    className="ml-auto flex min-h-[44px] items-center gap-1 rounded-md px-2 hover:bg-surface-muted disabled:opacity-60">
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
                    <button onClick={() => ask(t.q, true)} disabled={asking} title={costTitle(cost)}
                            className="ml-auto flex min-h-[36px] items-center rounded-md border border-green-700/30 px-2 hover:bg-green-500/10 disabled:opacity-60">
                      Yeniden sor <Cost n={cost} />
                    </button>
                  )}
                </div>
              )}
              <CitedText text={t.answer} sources={t.sources}
                         className="font-reading"
                         onCite={(_n, s) => { if (s?.document_id) router.push(docHref(s.document_id, { page: s.page, from: id })); }} />
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                {(() => {
                  const uniq = Array.from(new Map(t.sources.map((s: any) => [s.document_id, s])).values()) as any[];
                  const open = !!openSrc[i];
                  return (
                    <div className="w-full">
                      <button onClick={() => setOpenSrc((o) => ({ ...o, [i]: !open }))} aria-expanded={open}
                              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg py-1 text-left text-xs text-text-secondary hover:text-text-primary">
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
                            <button key={j} onClick={() => router.push(docHref(s.document_id, { page: s.page, from: id }))}
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
                <div className="w-full">
                  <AnswerActions text={t.answer} title={`${colTitle}: ${t.q.slice(0, 60)}`}
                                 onAddNote={() => addToNote(i, t)} addState={addState[i] || "idle"} />
                </div>
              </div>
            </div>
            {i === thread.length - 1 && (
              <>
                <Understood question={t.q} rewritten={t.rewritten} disabled={asking} onCorrect={(fixed) => ask(fixed, true)} />
                <Followups items={t.followups || []} onAsk={(f) => ask(f)} disabled={asking} />
              </>
            )}
          </div>
        ))}
        {live && (
          <div ref={liveRef} className="fade-in">
            <div className="mb-2 flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md border bg-surface px-3.5 py-2 text-sm">{live.q}</p>
            </div>
            <div className="rounded-2xl border bg-surface p-4 md:p-5">
              {live.text ? (
                <CitedText text={stripFollowups(live.text)} sources={[]} className="font-reading" onCite={() => {}} />
              ) : (
                <p className="flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 size={14} className="animate-spin" />
                  {live.rewritten ? <>Sorunu şöyle anladım: <i>“{live.rewritten}”</i> — kaynaklar taranıyor…</> : "Sorunu anlıyorum, kaynaklar taranıyor…"}
                </p>
              )}
              {live.text && <p className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary"><Loader2 size={12} className="animate-spin" /> Yazıyor…</p>}
            </div>
          </div>
        )}
        {askErr && !asking && (
          <div className="rounded-xl border border-dashed p-3">
            <ErrNote err={askErr} />
            {!askErr.limit && (
              <button onClick={() => ask(askErr.q)} title={costTitle(cost)}
                      className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:border-accent-purple/50">
                <RotateCcw size={14} /> Tekrar dene <Cost n={cost} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Giris kutusu: mobilde alt menunun ustunde (--bottom-nav, B) */}
      <div className="sticky bottom-[calc(var(--bottom-nav,64px)+var(--mini-player-h,0px)+8px)] z-10 mt-5 flex gap-2 md:bottom-[calc(var(--mini-player-h,0px)+16px)]">
        {thread.length > 0 && !suggOpen && (
          <button onClick={() => { setSuggOpen(true); if (!sugg) loadSuggestions(); scrollTop(); }}
                  title="Soru önerilerini göster" aria-label="Soru önerilerini göster"
                  className="flex min-h-[44px] items-center justify-center rounded-xl border bg-surface px-3 text-accent-purple shadow-sm hover:border-accent-purple/50">
            <Sparkles size={16} />
          </button>
        )}
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
               aria-label="Kaynaklarına soru sor" enterKeyHint="send"
               placeholder={thread.length ? "Devam et ya da yeni bir soru sor…" : firstQ ? `Örn: ${firstQ}` : "Kaynaklarına bir soru sor…"}
               className="min-h-[44px] min-w-0 flex-1 rounded-xl border bg-surface px-3 py-2.5 text-base shadow-sm outline-none focus:border-accent-purple md:text-sm" />
        <button onClick={() => ask()} disabled={asking} title={costTitle(cost) + " (kayıtlı cevaplar ücretsiz)"}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm font-medium text-white disabled:opacity-60">
          {asking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Sor <Cost n={cost} className="bg-white/20" />
        </button>
      </div>
    </div>
  );
}
