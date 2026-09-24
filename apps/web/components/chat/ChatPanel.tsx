"use client";
/**
 * Okuyucu sohbeti (tek kaynak). Sohbetler sunucuda saklanir: acilinca bu kaynagin
 * son sohbeti yuklenir, "Yeni sohbet" ile temiz sayfa acilir, eskilere donulebilir.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useChatStream, Citation } from "@/hooks/useChatStream";
import { Send, Loader2, Plus, History } from "lucide-react";
import CitedText from "@/components/CitedText";

const MODES = [
  ["default", "Genel"], ["summary", "Özet"], ["teacher", "Öğretmen"], ["socratic", "Sokratik"],
  ["exam", "Sınav"], ["academic", "Akademik"], ["critical", "Eleştirel"],
];

type Turn = { q: string; a: string; citations: Citation[]; cached?: boolean };
type Sess = { id: string; mode: string; title?: string; created_at: string; first_q?: string };

function Answer({ text, citations, onGoPage, cached }: { text: string; citations: Citation[]; onGoPage?: (p: number) => void; cached?: boolean }) {
  return (
    <div className="rounded-xl border bg-surface px-3.5 py-3 text-sm">
      {cached && (
        <span className="mb-2 inline-block rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-700 dark:text-green-400">kayıtlı cevap · 0 kota</span>
      )}
      <CitedText text={text}
                 sources={(() => { const arr: any[] = []; citations.forEach((c) => { arr[c.n - 1] = { page: c.page, title: c.section || "Bu belge" }; }); return arr; })()}
                 onCite={(n, s) => { const c = citations.find((x) => x.n === n); const pg = c?.page ?? s?.page; if (pg && onGoPage) onGoPage(pg); }}
                 className="whitespace-pre-wrap font-heading text-[15px] leading-7" />
      {citations.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-text-secondary">Kaynaklar ({citations.length}) · tıkla, o yere git</summary>
          <div className="mt-2 space-y-2">
            {citations.map((c) => (
              <button key={c.n} type="button" onClick={() => c.page && onGoPage?.(c.page)}
                      className="block w-full rounded-md border bg-surface-muted px-3 py-2 text-left font-mono text-xs hover:border-accent-purple/50">
                <span className="text-accent-purple">[K{c.n}]</span> {c.page}{c.section ? ` · ${c.section}` : ""}
                <p className="mt-1 line-clamp-2 text-text-secondary">{c.snippet}</p>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function ChatPanel({ documentId, onGoPage, video, generic }: { documentId: string; onGoPage?: (page: number) => void; video?: boolean; generic?: boolean }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState("default");
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [showHist, setShowHist] = useState(false);
  const { answer, citations, loading, cached, ask } = useChatStream(sessionId || "");
  const bottom = useRef<HTMLDivElement>(null);

  async function createSession(m: string) {
    const r = await api("/chat/sessions", { method: "POST", body: JSON.stringify({ document_id: documentId, mode: m }) });
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

  // akan cevap bitince sohbete ekle
  useEffect(() => {
    if (!loading && pending !== null) {
      setTurns((t) => [...t, { q: pending, a: answer, citations, cached }]);
      setPending(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns.length, pending, answer]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || loading) return;
    const sid = sessionId || await createSession(mode);
    const question = q; setQ("");
    setPending(question);
    await ask(question, sid);
  }

  async function changeMode(m: string) {
    // mod degisince yeni oturum (eski sohbet gecmiste kalir)
    setMode(m);
    if (turns.length) { setTurns([]); setSessionId(null); }
    else if (sessionId) { setSessionId(null); }
  }
  async function newChat() {
    setTurns([]); setPending(null); setSessionId(null);
    try { setSessions(await api(`/chat/sessions?document_id=${documentId}&nonempty=1`, {}, 1)); } catch {}
  }

  const suggestions = video
    ? ["Bu videonun ana fikri nedir?", "Videoda öne sürülen iddiaları ve dayanaklarını listele.",
       "Bu videoyu 5 maddede özetle (zamanlarıyla).", "En önemli kavramları çıkar."]
    : [generic ? "Bu kaynağın ana fikri nedir?" : "Bu PDF'in ana fikri nedir?", "Bu konuyu bana yeni başlayan biri gibi anlat.",
       "Bu belgeden 10 sınav sorusu hazırla.", "En önemli 10 kavramı çıkar."];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        {MODES.map(([v, l]) => (
          <button key={v} onClick={() => changeMode(v)}
            className={`rounded-full px-3 py-1 text-xs ${mode === v ? "bg-accent-purple text-white" : "bg-surface-muted"}`}>
            {l}
          </button>
        ))}
        <div className="relative ml-auto flex items-center gap-1">
          <button onClick={async () => { setShowHist((v) => !v); try { setSessions(await api(`/chat/sessions?document_id=${documentId}&nonempty=1`, {}, 1)); } catch {} }} title="Önceki sohbetler"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-surface-muted">
            <History size={13} /> {sessions.length}
          </button>
          <button onClick={newChat} title="Yeni sohbet" className="rounded-md p-1 text-accent-purple hover:bg-accent-purple/10">
            <Plus size={15} />
          </button>
          {showHist && (
            <div className="absolute right-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border bg-surface p-1 shadow-lg">
              {!sessions.length ? <p className="p-3 text-xs text-text-secondary">Kayıtlı sohbet yok.</p> : sessions.map((s) => (
                <button key={s.id} onClick={() => loadSession(s)}
                        className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-surface-muted ${s.id === sessionId ? "bg-accent-purple/10" : ""}`}>
                  <span className="block truncate">{s.first_q || "Sohbet"}</span>
                  <span className="text-text-secondary">{new Date(s.created_at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {MODES.find((m) => m[0] === s.mode)?.[1] || s.mode}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        {turns.length === 0 && pending === null && (
          <div className="text-sm text-text-secondary">
            <p className="mb-2">Bu kaynak hakkında soru sorabilirsin. Örneğin:</p>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => { setQ(s); }}
                  className="rounded-md border bg-surface-muted px-3 py-2 text-left hover:border-accent-purple">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-accent-purple/10 px-3 py-2 text-sm">{t.q}</div>
            {t.a && <Answer text={t.a} citations={t.citations} onGoPage={onGoPage} cached={t.cached} />}
          </div>
        ))}
        {pending !== null && (
          <div className="space-y-2">
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-accent-purple/10 px-3 py-2 text-sm">{pending}</div>
            {answer && <Answer text={answer} citations={citations} onGoPage={onGoPage} />}
          </div>
        )}
        {loading && <Loader2 className="animate-spin text-accent-purple" size={18} />}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bu kaynağa soru sor…"
               className="flex-1 rounded-md border bg-surface-muted px-3 py-2 text-sm" />
        <button disabled={loading} className="rounded-md bg-accent-purple px-3 text-white disabled:opacity-60"><Send size={16} /></button>
      </form>
    </div>
  );
}
