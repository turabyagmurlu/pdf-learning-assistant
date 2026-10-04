"use client";
/**
 * Okuyucu "Sor" paneli: yalniz acik kaynaktan, ders gibi uzun ve atifli cevap (Sor v3).
 *  - Ustte derinlik secici (Kısa · Ayrıntılı · Derin ⚡2; varsayilan Ayrıntılı, saklanir)
 *  - Hazir sorular: "Bu sayfayı anlat" (acik sayfanin metnini baglama ekler; `page` + `getPageText` ile),
 *    Ana fikirleri çıkar, Örnekle
 *  - Cevap SSE ile akar; altinda "Sesli dinle" (typdf:listen olayi), "Çalışma notuna ekle"
 *    (POST /documents/{id}/draft/blocks; kaynak bir defterdeyse "Tüm deftere sor" baglantisi da var),
 *    devam sorulari ve "Sorunu şöyle anladım: …" satiri (tiklayinca duzeltme kutusu).
 * Sohbetler sunucuda saklanir: acilinca bu kaynagin son sohbeti yuklenir, "Yeni sohbet" temiz sayfa acar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, errorMessage } from "@/lib/api";
import { useChatStream, type Citation, type AskMeta } from "@/hooks/useChatStream";
import { Send, Loader2, Plus, History, AlertCircle, X, BookOpen, Sparkles } from "lucide-react";
import CitedText from "@/components/CitedText";
import { Cost, costTitle } from "@/components/CostBadge";
import { toast } from "@/components/Toast";
import DepthPicker from "./DepthPicker";
import { AnswerActions, Understood, Followups, type AddState } from "./AnswerExtras";
import { type Depth, loadDepth, saveDepth, depthCost, quickQuestions } from "./depth";

/** Okuyucu sohbetinin bagli oldugu defter: `notebookId` > `notebookHref` icindeki id > `?from=` > kaynagin ilk defteri. */
function notebookIdFromHref(href?: string | null): string | null {
  if (!href) return null;
  const m = href.match(/\/collections\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
/** `/collections/{cid}?tab=sohbet&q=…` — "Tüm deftere sor" soruyu da tasir. */
export function notebookAskHref(cid: string, question?: string | null): string {
  const q = (question || "").trim();
  return `/collections/${encodeURIComponent(cid)}?tab=sohbet${q ? "&q=" + encodeURIComponent(q.slice(0, 1000)) : ""}`;
}

type Turn = { q: string; a: string; citations: Citation[]; cached?: boolean; error?: string; meta?: AskMeta | null; followups?: string[] };
type Sess = { id: string; mode: string; title?: string; created_at: string; first_q?: string };

function Answer({ q, text, citations, onGoPage, cached, onAddNote, addState, askAllHref, title, streaming }: {
  q?: string; text: string; citations: Citation[]; onGoPage?: (p: number) => void; cached?: boolean;
  onAddNote?: () => Promise<void>; addState?: AddState; askAllHref?: string | null; title: string; streaming?: boolean;
}) {
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
                 className="font-heading text-[15px] leading-7" />
      {!streaming && (
        <div className="mt-3 border-t pt-2.5">
          <AnswerActions text={text} title={q ? `Cevap: ${q.slice(0, 60)}` : title} onAddNote={onAddNote} addState={addState}>
            {askAllHref && (
              <Link href={askAllHref} title="Aynı soruyu defterdeki tüm kaynaklara sor"
                    className="flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">
                <BookOpen size={13} aria-hidden /> Tüm deftere sor
              </Link>
            )}
          </AnswerActions>
        </div>
      )}
      {citations.length > 0 && (
        <details className="mt-3">
          <summary className="flex min-h-[44px] cursor-pointer items-center text-xs text-text-secondary">Kaynaklar ({citations.length}) · dokun, o yere git</summary>
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
        <button type="button" onClick={onRetry} className="-my-1 min-h-[44px] shrink-0 rounded-lg px-2 text-sm font-medium underline-offset-2 hover:underline">
          Tekrar sor
        </button>
      )}
    </div>
  );
}

export function ChatPanel({ documentId, onGoPage, video, generic, prefill, notebookHref, notebookId, docTitle, onClose, page, getPageText }: {
  documentId: string; onGoPage?: (page: number) => void; video?: boolean; generic?: boolean;
  /** Okuyucudaki secim balonundan "Sor": soru kutusuna hazir metin (key her seferinde degisir) */
  prefill?: { text: string; key: number } | null;
  /** Kaynagin bagli oldugu defterin sayfasi ("Tüm deftere sor" icin; id buradan da okunur) */
  notebookHref?: string | null;
  /** Defter kimligi (verilmezse notebookHref, ?from= ya da kaynagin ilk defteri) */
  notebookId?: string | null;
  /** Kaynak adi (calisma notundaki cevap kartinin kaynak satiri icin; yoksa sunucudan alinir) */
  docTitle?: string | null;
  /** Alttan acilan tabakada: baslikta kapat dugmesi */
  onClose?: () => void;
  /** Acik sayfa ve metni: "Bu sayfayı anlat" hazir sorusu bu metni baglama ekler (PDF okuyucu verir) */
  page?: number | null;
  getPageText?: (page: number) => string | null | undefined;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [showHist, setShowHist] = useState(false);
  const [depth, setDepth] = useState<Depth>("ayrintili");
  const [addState, setAddState] = useState<Record<number, AddState>>({});
  const { answer, citations, loading, meta: liveMeta, ask } = useChatStream(sessionId || "");
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const histWrap = useRef<HTMLDivElement>(null);
  useEffect(() => { setDepth(loadDepth()); }, []);
  const changeDepth = (d: Depth) => { setDepth(d); saveDepth(d); };

  /* ---------- defter baglami ---------- */
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

  /** Cevabi bu kaynagin Çalışma notuna ekler (belge taslagi). */
  const addToNote = useCallback(async (i: number, t: Turn) => {
    if (!t.a.trim() || addState[i] === "busy" || addState[i] === "done") return;
    setAddState((s) => ({ ...s, [i]: "busy" }));
    const d = await resolveDoc();
    const title = d?.title || docTitle || "Bu kaynak";
    const sources = [...t.citations].sort((a, b) => a.n - b.n)
      .map((c) => ({ title: c.section ? `${title} · ${c.section}` : title, page: c.page ?? null, document_id: documentId }));
    try {
      await api(`/documents/${encodeURIComponent(documentId)}/draft/blocks`, {
        method: "POST",
        body: JSON.stringify({ blocks: [{ type: "answer", q: t.q, text: t.a.trim(), sources }] }),
      });
      setAddState((s) => ({ ...s, [i]: "done" }));
      toast("Çalışma notuna eklendi");
    } catch (e) {
      setAddState((s) => ({ ...s, [i]: "idle" }));
      toast.error(errorMessage(e, "Çalışma notuna eklenemedi; birazdan tekrar dene."));
    }
  }, [addState, resolveDoc, docTitle, documentId]);

  // basliktaki "Tüm deftere sor": yazilmakta olan soru, yoksa son sorulan
  const askAllTop = cid ? notebookAskHref(cid, q.trim() || pending || turns[turns.length - 1]?.q || "") : (notebookHref || null);

  async function createSession() {
    const r = await api("/chat/sessions", { method: "POST", body: JSON.stringify({ document_id: documentId, mode: "default" }) }, 1);
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
      setTurns(out); setSessionId(s.id); setShowHist(false); setAddState({});
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

  async function send(question: string, opts: { withPage?: boolean; fresh?: boolean } = {}) {
    if (!question.trim() || loading) return;
    let sid = sessionId;
    setPending(question);
    if (!sid) {
      try { sid = await createSession(); }
      catch (e: any) {
        setTurns((t) => [...t, { q: question, a: "", citations: [], error: e?.message || "Sohbet başlatılamadı; tekrar dene." }]);
        setPending(null);
        return;
      }
    }
    const pageText = opts.withPage && page && getPageText ? (getPageText(page) || "").trim().slice(0, 8000) : null;
    const r = await ask(question, sid, { depth, fresh: opts.fresh, page: pageText ? page : null, pageText });
    setTurns((t) => [...t, { q: question, a: r.answer, citations: r.citations, cached: r.cached, error: r.error?.message, meta: r.meta, followups: r.followups }]);
    setPending(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || loading) return;
    const question = q; setQ("");
    await send(question);
  }

  async function newChat() {
    setTurns([]); setPending(null); setSessionId(null); setAddState({});
    try { setSessions(await api(`/chat/sessions?document_id=${documentId}&nonempty=1`, {}, 1)); } catch {}
    inputRef.current?.focus();
  }

  const canPage = !!(page && getPageText && !video && !generic);
  const quick = quickQuestions({ page: canPage ? page : null, scope: "kaynak" });
  const title = docTitle || docInfo.current?.title || "Bu kaynak";
  const cost = depthCost(depth);

  return (
    <div className="flex h-full flex-col">
      {/* baslik: kapsam */}
      <div className="border-b px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text-primary">Bu kaynağa sor</h2>
            <p className="text-xs text-text-secondary">
              Cevaplar bu kaynaktan, ders gibi anlatılır.
              {askAllTop && (<> <Link href={askAllTop} className="font-medium text-accent-purple underline-offset-2 hover:underline">Tüm deftere sor →</Link></>)}
            </p>
          </div>
          <div ref={histWrap} className="relative flex items-center gap-0.5">
            <button type="button" aria-haspopup="menu" aria-expanded={showHist}
                    aria-label={`Önceki sohbetler (${sessions.length})`} title="Önceki sohbetler"
                    onClick={async () => { setShowHist((v) => !v); try { setSessions(await api(`/chat/sessions?document_id=${documentId}&nonempty=1`, {}, 1)); } catch {} }}
                    className="flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-xs text-text-secondary hover:bg-surface-muted">
              <History size={15} aria-hidden /> {sessions.length}
            </button>
            <button type="button" onClick={newChat} aria-label="Yeni sohbet" title="Yeni sohbet"
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-accent-purple hover:bg-accent-purple/10">
              <Plus size={17} aria-hidden />
            </button>
            {showHist && (
              <div role="menu" aria-label="Önceki sohbetler"
                   className="absolute right-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border bg-surface p-1 shadow-lg">
                {!sessions.length ? <p className="p-3 text-xs text-text-secondary">Bu kaynakta kayıtlı sohbet yok.</p> : sessions.map((s) => (
                  <button key={s.id} type="button" role="menuitem" onClick={() => loadSession(s)}
                          className={`block min-h-[44px] w-full rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-surface-muted ${s.id === sessionId ? "bg-surface-muted font-medium text-text-primary" : ""}`}>
                    <span className="block truncate">{s.first_q || "Sohbet"}</span>
                    <span className="text-text-secondary">{new Date(s.created_at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </button>
                ))}
              </div>
            )}
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Kapat" title="Kapat"
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
                <X size={18} aria-hidden />
              </button>
            )}
          </div>
        </div>
        <div className="mt-2">
          <DepthPicker value={depth} onChange={changeDepth} compact disabled={loading} />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4" aria-busy={loading}>
        {/* hazir sorular: bos sohbette liste, sonra tek satir cipler */}
        {turns.length === 0 && pending === null ? (
          <div className="text-sm text-text-secondary">
            <p className="mb-2 flex items-center gap-1.5"><Sparkles size={14} className="text-accent-purple" aria-hidden /> Nereden başlayalım?</p>
            <div className="flex flex-col gap-2">
              {quick.map((s) => (
                <button key={s.label} type="button" onClick={() => send(s.q, { withPage: !!s.page })} disabled={loading}
                        className="min-h-[44px] rounded-xl border bg-surface-muted px-3 py-2 text-left hover:border-accent-purple disabled:opacity-60">
                  <span className="font-medium text-text-primary">{s.label}</span>
                  <span className="block text-xs">{s.q}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs">Ya da kendi sorunu yaz. Her cevap <b>{cost}</b> kullanım harcar; kayıtlı cevaplar ücretsiz.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Hazır sorular">
            {quick.map((s) => (
              <button key={s.label} type="button" onClick={() => send(s.q, { withPage: !!s.page })} disabled={loading}
                      title={s.q}
                      className="min-h-[44px] rounded-full border bg-surface px-3 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple disabled:opacity-60">
                {s.label}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-purple/10 px-3 py-2 text-sm">{t.q}</div>
            {t.a && (
              <>
                <Answer q={t.q} text={t.a} citations={t.citations} onGoPage={onGoPage} cached={t.cached} title={title}
                        onAddNote={() => addToNote(i, t)} addState={addState[i] || "idle"}
                        askAllHref={cid ? notebookAskHref(cid, t.q) : null} />
                {i === turns.length - 1 && (
                  <>
                    <Understood question={t.q} rewritten={t.meta?.rewritten_question} disabled={loading}
                                onCorrect={(fixed) => send(fixed, { fresh: true })} />
                    <Followups items={t.followups || []} onAsk={(f) => send(f)} disabled={loading} />
                  </>
                )}
              </>
            )}
            {t.error && <ErrorNote text={t.error} onRetry={i === turns.length - 1 && !loading ? () => send(t.q) : undefined} />}
          </div>
        ))}
        {pending !== null && (
          <div className="space-y-2">
            <div className="ml-auto w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-purple/10 px-3 py-2 text-sm">{pending}</div>
            {liveMeta?.rewritten_question && !answer && (
              <p className="text-xs text-text-secondary">Sorunu şöyle anladım: <i>“{liveMeta.rewritten_question}”</i> — kaynak taranıyor…</p>
            )}
            {answer && <Answer text={answer} citations={citations} onGoPage={onGoPage} title={title} streaming />}
          </div>
        )}
        {loading && (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="animate-spin text-accent-purple" size={18} aria-hidden /> {answer ? "Yazıyor…" : "Kaynak taranıyor…"}
          </p>
        )}
        <p className="sr-only" aria-live="polite">{loading ? "Cevap hazırlanıyor" : turns.length ? "Cevap hazır" : ""}</p>
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t p-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <textarea ref={inputRef} value={q} rows={1} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); } }}
                  placeholder={turns.length ? "Devam et ya da yeni bir soru sor…" : "Bu kaynağa soru sor…"} aria-label="Bu kaynağa soru sor"
                  className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border bg-surface-muted px-3 py-2.5 text-sm" />
        <button type="submit" disabled={loading || !q.trim()}
                aria-label={`Gönder (${costTitle(cost)})`} title={`Gönder · ${costTitle(cost)} · kayıtlı cevaplar ücretsiz`}
                className="flex h-11 shrink-0 items-center gap-1 rounded-lg bg-accent-purple px-3 text-white disabled:opacity-60">
          <Send size={16} aria-hidden />
          <Cost n={cost} className="bg-white/20" />
        </button>
      </form>
    </div>
  );
}
