"use client";
/**
 * Okuyucu sohbeti ("Bu kaynağa sor"): yalniz acik kaynaktan cevap verir.
 * Defter sohbetinden farki baslikta ve yer tutucuda yazar; defter biliniyorsa
 * "Tüm deftere sor" baglantisi verilir.
 * Sohbetler sunucuda saklanir: acilinca bu kaynagin son sohbeti yuklenir, "Yeni sohbet"
 * ile temiz sayfa acilir, eskilere donulebilir.
 * TO-4: her cevabin altinda "Taslağa ekle" (POST /collections/{cid}/draft/blocks, answer blogu) ve
 * "Tüm deftere sor" (soruyu `?tab=sohbet&q=` ile defter sohbetine tasir). Defter: notebookId >
 * notebookHref > ?from= > kaynagin ilk defteri.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import { useChatStream, Citation } from "@/hooks/useChatStream";
import { Send, Loader2, Plus, History, AlertCircle, X, PenLine, BookOpen, Check } from "lucide-react";
import CitedText from "@/components/CitedText";
import { toast } from "@/components/Toast";

/** Okuyucu sohbetinin bagli oldugu defter: `notebookId` > `notebookHref` icindeki id > `?from=` > kaynagin ilk defteri. */
function notebookIdFromHref(href?: string | null): string | null {
  if (!href) return null;
  const m = href.match(/\/collections\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
function notebookTitleOf(cid: string | null): string | null {
  if (!cid) return null;
  try { return sessionStorage.getItem("typdf.colTitle." + cid); } catch { return null; }
}
/** `/collections/{cid}?tab=sohbet&q=…` — "Tüm deftere sor" soruyu da tasir. */
export function notebookAskHref(cid: string, question?: string | null): string {
  const q = (question || "").trim();
  return `/collections/${encodeURIComponent(cid)}?tab=sohbet${q ? "&q=" + encodeURIComponent(q.slice(0, 1000)) : ""}`;
}

const MODES: [string, string, string][] = [
  ["default", "Genel", "Dengeli, açık bir cevap"],
  ["summary", "Özet", "Kısa, maddeli özet"],
  ["teacher", "Öğretmen", "Yeni başlayan birine anlatır gibi, örneklerle"],
  ["socratic", "Sokratik", "Cevap yerine seni düşündüren sorular sorar"],
  ["exam", "Sınav", "Sınav sorusu ve cevap anahtarı hazırlar"],
  ["academic", "Akademik", "Resmî, kaynak odaklı akademik dil"],
  ["critical", "Eleştirel", "Güçlü ve zayıf yanları, karşı görüşleri tartar"],
];

type Turn = { q: string; a: string; citations: Citation[]; cached?: boolean; error?: string };
type Sess = { id: string; mode: string; title?: string; created_at: string; first_q?: string };

type AnswerActions = {
  /** cevabi defterin taslagina ekler; "done" -> eklendi, "none" -> defter yok */
  onAddToDraft?: (q: string, text: string, citations: Citation[]) => Promise<"done" | "none" | "error">;
  /** ayni soruyu defterin tamamina sormak icin bagalanti */
  askAllHref?: (q: string) => string | null;
};

function Answer({ q, text, citations, onGoPage, cached, actions }: {
  q?: string; text: string; citations: Citation[]; onGoPage?: (p: number) => void; cached?: boolean; actions?: AnswerActions;
}) {
  const [adding, setAdding] = useState<"idle" | "busy" | "done">("idle");
  const allHref = actions?.askAllHref && q ? actions.askAllHref(q) : null;
  async function add() {
    if (!actions?.onAddToDraft || adding !== "idle") return;
    setAdding("busy");
    const r = await actions.onAddToDraft(q || "", text, citations);
    setAdding(r === "done" ? "done" : "idle");
  }
  return (
    <div className="rounded-xl border bg-surface px-3.5 py-3 text-sm">
      {cached && (
        <span className="mb-2 inline-block rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-800 dark:text-green-300"
              title="Bu soruya daha önce cevap verilmişti; yapay zekâ kullanımından düşmedi.">
          ücretsiz · kayıtlı cevap
        </span>
      )}
      <CitedText text={text}
                 sources={(() => { const arr: any[] = []; citations.forEach((c) => { arr[c.n - 1] = { page: c.page, title: c.section || "Bu kaynak", snippet: c.snippet }; }); return arr; })()}
                 onCite={(n, s) => { const c = citations.find((x) => x.n === n); const pg = c?.page ?? s?.page; if (pg && onGoPage) onGoPage(pg); }}
                 className="whitespace-pre-wrap font-heading text-[15px] leading-7" />
      {(actions?.onAddToDraft || allHref) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Cevap işlemleri">
          {actions?.onAddToDraft && (
            <button type="button" onClick={add} disabled={adding !== "idle"}
                    aria-label={adding === "done" ? "Taslağa eklendi" : "Bu cevabı defterin taslağına ekle (ücretsiz)"}
                    title={adding === "done" ? "Taslağa eklendi" : "Bu cevabı defterin taslağına ekle · ücretsiz"}
                    className={`flex min-h-[40px] items-center gap-1 rounded-lg border px-2.5 text-xs font-medium ${adding === "done" ? "border-green-600/40 text-green-800 dark:text-green-300" : "text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple"} disabled:opacity-70`}>
              {adding === "done" ? <Check size={13} aria-hidden /> : adding === "busy" ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <PenLine size={13} aria-hidden />}
              {adding === "done" ? "Taslağa eklendi" : "Taslağa ekle"}
            </button>
          )}
          {allHref && (
            <Link href={allHref} title="Aynı soruyu defterdeki tüm kaynaklara sor"
                  className="flex min-h-[40px] items-center gap-1 rounded-lg border px-2.5 text-xs font-medium text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
              <BookOpen size={13} aria-hidden /> Tüm deftere sor
            </Link>
          )}
        </div>
      )}
      {citations.length > 0 && (
        <details className="mt-3">
          <summary className="flex min-h-[40px] cursor-pointer items-center text-xs text-text-secondary">Kaynaklar ({citations.length}) · dokun, o yere git</summary>
          <div className="mt-2 space-y-2">
            {citations.map((c) => (
              <button key={c.n} type="button" onClick={() => c.page && onGoPage?.(c.page)}
                      className="block w-full rounded-md border bg-surface-muted px-3 py-2 text-left font-mono text-xs hover:border-accent-purple/50">
                <span className="text-accent-purple">[K{c.n}]</span> s.{c.page}{c.section ? ` · ${c.section}` : ""}
                <p className="mt-1 line-clamp-2 text-text-secondary">{c.snippet}</p>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span className="flex-1">{text}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="-my-1 min-h-[40px] shrink-0 rounded-lg px-2 text-sm font-medium underline-offset-2 hover:underline">
          Tekrar sor
        </button>
      )}
    </div>
  );
}

export function ChatPanel({ documentId, onGoPage, video, generic, prefill, notebookHref, notebookId, docTitle, onClose }: {
  documentId: string; onGoPage?: (page: number) => void; video?: boolean; generic?: boolean;
  /** Okuyucudaki secim balonundan "Sor": soru kutusuna hazir metin (key her seferinde degisir) */
  prefill?: { text: string; key: number } | null;
  /** Kaynagin bagli oldugu defterin sayfasi ("Tüm deftere sor" icin; id buradan da okunur) */
  notebookHref?: string | null;
  /** Defter kimligi (verilmezse notebookHref, ?from= ya da kaynagin ilk defteri) */
  notebookId?: string | null;
  /** Kaynak adi (taslaktaki cevap kartinin kaynak satiri icin; yoksa sunucudan alinir) */
  docTitle?: string | null;
  /** Alttan acilan tabakada: baslikta kapat dugmesi */
  onClose?: () => void;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState("default");
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [showHist, setShowHist] = useState(false);
  const { answer, citations, loading, ask } = useChatStream(sessionId || "");
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const histWrap = useRef<HTMLDivElement>(null);

  /* ---------- defter baglami (TO-4) ---------- */
  const [cid, setCid] = useState<string | null>(() => notebookId || notebookIdFromHref(notebookHref));
  const docInfo = useRef<{ title: string | null; cid: string | null } | null>(docTitle ? { title: docTitle, cid: null } : null);
  const resolveDoc = useCallback(async () => {
    if (docInfo.current?.title && (docInfo.current.cid || cid)) return docInfo.current;
    try {
      const d: any = await api(`/documents/${encodeURIComponent(documentId)}`, {}, 1);
      const first = d?.collections?.[0]?.id || d?.collection_ids?.[0] || d?.collection_id || null;
      docInfo.current = { title: d?.title || docTitle || null, cid: first ? String(first) : null };
      if (d?.collections?.[0]?.title && first) { try { sessionStorage.setItem("typdf.colTitle." + String(first), d.collections[0].title); } catch {} }
    } catch {
      docInfo.current = docInfo.current || { title: docTitle || null, cid: null };
    }
    return docInfo.current;
  }, [documentId, docTitle, cid]);
  useEffect(() => {
    const given = notebookId || notebookIdFromHref(notebookHref);
    if (given) { setCid(given); return; }
    let from: string | null = null;
    try { from = new URLSearchParams(window.location.search).get("from"); } catch {}
    if (from) { setCid(from); return; }
    let alive = true;
    resolveDoc().then((d) => { if (alive && d?.cid) setCid(d.cid); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, notebookId, notebookHref]);

  const addToDraft = useCallback(async (question: string, text: string, cites: Citation[]): Promise<"done" | "none" | "error"> => {
    if (!text.trim()) return "error";
    let target = cid;
    const d = await resolveDoc();
    if (!target) target = d?.cid || null;
    if (!target) {
      toast.error("Bu kaynak henüz bir defterde değil. Önce Kütüphane'den bir deftere ekle, sonra cevabı taslağa alabilirsin.");
      return "none";
    }
    const title = d?.title || docTitle || "Bu kaynak";
    // DraftEditor Block "answer": {type, q, text, sources:[{title, page, document_id}]} — [K#] atiflari bu sirayla eslesir
    const sources = [...cites].sort((a, b) => a.n - b.n)
      .map((c) => ({ title: c.section ? `${title} · ${c.section}` : title, page: c.page ?? null, document_id: documentId }));
    try {
      await api(`/collections/${encodeURIComponent(target)}/draft/blocks`, {
        method: "POST",
        body: JSON.stringify({ blocks: [{ type: "answer", q: question, text: text.trim(), sources }] }),
      });
      const name = notebookTitleOf(target);
      const href = `/collections/${encodeURIComponent(target)}?tab=taslak`;
      toast(`Taslağa eklendi${name ? " · " + name : ""}`, { action: { label: "Taslağı aç", run: () => router.push(href) } });
      return "done";
    } catch (e) {
      toast.error(errorMessage(e, "Taslağa eklenemedi; birazdan tekrar dene."));
      return "error";
    }
  }, [cid, resolveDoc, docTitle, documentId, router]);
  const answerActions: AnswerActions = {
    onAddToDraft: addToDraft,
    askAllHref: (question) => (cid ? notebookAskHref(cid, question) : null),
  };
  // basliktaki "Tüm deftere sor": yazilmakta olan soru, yoksa son sorulan
  const askAllTop = cid ? notebookAskHref(cid, q.trim() || pending || turns[turns.length - 1]?.q || "") : (notebookHref || null);

  async function createSession(m: string) {
    const r = await api("/chat/sessions", { method: "POST", body: JSON.stringify({ document_id: documentId, mode: m }) }, 1);
    setSessionId(r.id); return r.id as string;
  }
  async function loadSession(s: Sess) {
    try {
      const msgs: any[] = await api(`/chat/sessions/${s.id}/messages`, {}, 1);
      const out: Turn[] = [];
      for (const m of msgs) {
        if (m.role === "user") out.push({ q: m.content, a: "", citations: [] });
        else if (out.length) { out[out.length - 1].a = m.content; out[out.length - 1].citations = m.citations || []; }
      }
      setTurns(out); setSessionId(s.id); setMode(s.mode || "default"); setShowHist(false);
    } catch {}
  }
  // acilista: bu kaynagin son (dolu) sohbetini getir; bos oturum acilmaz, ilk soruda acilir
  useEffect(() => {
    (async () => {
      try {
        const list: Sess[] = await api(`/chat/sessions?document_id=${documentId}&nonempty=1`, {}, 1);
        setSessions(list);
        if (list.length) await loadSession(list[0]);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // secim balonundan gelen soru taslagi
  useEffect(() => {
    if (!prefill?.text) return;
    setQ(prefill.text);
    const t = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
    }, 60);
    return () => clearTimeout(t);
  }, [prefill?.key, prefill?.text]);

  // gecmis menusu: disari dokununca / Esc ile kapansin
  useEffect(() => {
    if (!showHist) return;
    const onDown = (e: PointerEvent) => { if (!histWrap.current?.contains(e.target as Node)) setShowHist(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setShowHist(false); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [showHist]);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    bottom.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [turns.length, pending, answer]);

  async function send(question: string) {
    if (!question.trim() || loading) return;
    let sid = sessionId;
    setPending(question);
    if (!sid) {
      try { sid = await createSession(mode); }
      catch (e: any) {
        setTurns((t) => [...t, { q: question, a: "", citations: [], error: e?.message || "Sohbet başlatılamadı; tekrar dene." }]);
        setPending(null);
        return;
      }
    }
    const r = await ask(question, sid);
    setTurns((t) => [...t, { q: question, a: r.answer, citations: r.citations, cached: r.cached, error: r.error?.message }]);
    setPending(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || loading) return;
    const question = q; setQ("");
    await send(question);
  }

  function changeMode(m: string) {
    // mod degisince yeni oturum (eski sohbet gecmiste kalir)
    setMode(m);
    if (turns.length) { setTurns([]); setSessionId(null); }
    else if (sessionId) { setSessionId(null); }
  }
  async function newChat() {
    setTurns([]); setPending(null); setSessionId(null);
    try { setSessions(await api(`/chat/sessions?document_id=${documentId}&nonempty=1`, {}, 1)); } catch {}
    inputRef.current?.focus();
  }

  const suggestions = video
    ? ["Bu videonun ana fikri nedir?", "Videoda öne sürülen iddiaları ve dayanaklarını listele.",
       "Bu videoyu 5 maddede özetle (zamanlarıyla).", "En önemli kavramları çıkar."]
    : [generic ? "Bu kaynağın ana fikri nedir?" : "Bu PDF'in ana fikri nedir?", "Bu konuyu bana yeni başlayan biri gibi anlat.",
       "Bu kaynaktan 10 sınav sorusu hazırla.", "En önemli 10 kavramı çıkar."];

  return (
    <div className="flex h-full flex-col">
      {/* baslik: kapsam */}
      <div className="border-b px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text-primary">Bu kaynağa sor</h2>
            <p className="text-xs text-text-secondary">
              Cevaplar yalnız bu kaynaktan gelir.
              {askAllTop && (<> <Link href={askAllTop} className="font-medium text-accent-purple underline-offset-2 hover:underline">Tüm deftere sor →</Link></>)}
            </p>
          </div>
          <div ref={histWrap} className="relative flex items-center gap-0.5">
            <button type="button" aria-haspopup="menu" aria-expanded={showHist}
                    aria-label={`Önceki sohbetler (${sessions.length})`} title="Önceki sohbetler"
                    onClick={async () => { setShowHist((v) => !v); try { setSessions(await api(`/chat/sessions?document_id=${documentId}&nonempty=1`, {}, 1)); } catch {} }}
                    className="flex h-10 min-w-[40px] items-center justify-center gap-1 rounded-lg px-2 text-xs text-text-secondary hover:bg-surface-muted">
              <History size={15} aria-hidden /> {sessions.length}
            </button>
            <button type="button" onClick={newChat} aria-label="Yeni sohbet" title="Yeni sohbet"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-accent-purple hover:bg-accent-purple/10">
              <Plus size={17} aria-hidden />
            </button>
            {showHist && (
              <div role="menu" aria-label="Önceki sohbetler"
                   className="absolute right-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border bg-surface p-1 shadow-lg">
                {!sessions.length ? <p className="p-3 text-xs text-text-secondary">Bu kaynakta kayıtlı sohbet yok.</p> : sessions.map((s) => (
                  <button key={s.id} type="button" role="menuitem" onClick={() => loadSession(s)}
                          className={`block min-h-[44px] w-full rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-surface-muted ${s.id === sessionId ? "bg-accent-purple/10" : ""}`}>
                    <span className="block truncate">{s.first_q || "Sohbet"}</span>
                    <span className="text-text-secondary">{new Date(s.created_at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {MODES.find((m) => m[0] === s.mode)?.[1] || s.mode}</span>
                  </button>
                ))}
              </div>
            )}
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Kapat" title="Kapat"
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
                <X size={18} aria-hidden />
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor={`chat-mode-${documentId}`} className="shrink-0 text-xs text-text-secondary">Cevap tarzı</label>
          <select id={`chat-mode-${documentId}`} value={mode} onChange={(e) => changeMode(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-lg border bg-surface-muted px-2 text-sm">
            {MODES.map(([v, l, d]) => <option key={v} value={v}>{l} — {d}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4" aria-busy={loading}>
        {turns.length === 0 && pending === null && (
          <div className="text-sm text-text-secondary">
            <p className="mb-2">Bu kaynak hakkında soru sorabilirsin. Örneğin:</p>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => { setQ(s); inputRef.current?.focus(); }}
                  className="min-h-[44px] rounded-md border bg-surface-muted px-3 py-2 text-left hover:border-accent-purple">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-purple/10 px-3 py-2 text-sm">{t.q}</div>
            {t.a && <Answer q={t.q} text={t.a} citations={t.citations} onGoPage={onGoPage} cached={t.cached} actions={answerActions} />}
            {t.error && <ErrorNote text={t.error} onRetry={i === turns.length - 1 && !loading ? () => send(t.q) : undefined} />}
          </div>
        ))}
        {pending !== null && (
          <div className="space-y-2">
            <div className="ml-auto w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-purple/10 px-3 py-2 text-sm">{pending}</div>
            {answer && <Answer text={answer} citations={citations} onGoPage={onGoPage} />}
          </div>
        )}
        {loading && (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="animate-spin text-accent-purple" size={18} aria-hidden /> Kaynak taranıyor…
          </p>
        )}
        <p className="sr-only" aria-live="polite">{loading ? "Cevap hazırlanıyor" : turns.length ? "Cevap hazır" : ""}</p>
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t p-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <textarea ref={inputRef} value={q} rows={1} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); } }}
                  placeholder="Bu kaynağa soru sor (defterin tamamı değil)…" aria-label="Bu kaynağa soru sor"
                  className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border bg-surface-muted px-3 py-2.5 text-sm" />
        <button type="submit" disabled={loading || !q.trim()}
                aria-label="Gönder (yapay zekâ kullanımından 1 düşer)" title="Gönder · yapay zekâ kullanımından 1 düşer"
                className="flex h-11 shrink-0 items-center gap-1 rounded-lg bg-accent-purple px-3 text-white disabled:opacity-60">
          <Send size={16} aria-hidden />
          <span aria-hidden className="text-xs font-medium">⚡1</span>
        </button>
      </form>
    </div>
  );
}
