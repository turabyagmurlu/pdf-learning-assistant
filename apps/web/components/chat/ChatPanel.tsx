"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useChatStream } from "@/hooks/useChatStream";
import { Send, Loader2 } from "lucide-react";

const MODES = [
  ["default", "Genel"], ["summary", "Özet"], ["teacher", "Öğretmen"], ["socratic", "Sokratik"],
  ["exam", "Sınav"], ["academic", "Akademik"], ["critical", "Eleştirel"],
];

export function ChatPanel({ documentId }: { documentId: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState("default");
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<{ role: string; text: string }[]>([]);
  const { answer, citations, loading, ask } = useChatStream(sessionId || "");

  async function ensureSession(m: string) {
    const r = await api("/chat/sessions", { method: "POST", body: JSON.stringify({ document_id: documentId, mode: m }) });
    setSessionId(r.id); return r.id;
  }
  useEffect(() => { ensureSession(mode); /* eslint-disable-next-line */ }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    let sid = sessionId;
    if (!sid) sid = await ensureSession(mode);
    const question = q; setQ("");
    setHistory((h) => [...h, { role: "user", text: question }]);
    await ask(question);
  }

  async function changeMode(m: string) { setMode(m); await ensureSession(m); }

  const suggestions = ["Bu PDF'in ana fikri nedir?", "Bu konuyu bana yeni başlayan biri gibi anlat.",
    "Bu belgeden 10 sınav sorusu hazırla.", "En önemli 10 kavramı çıkar."];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-2 flex flex-wrap gap-1">
        {MODES.map(([v, l]) => (
          <button key={v} onClick={() => changeMode(v)}
            className={`rounded-full px-3 py-1 text-xs ${mode === v ? "bg-accent-purple text-white" : "bg-surface-muted"}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {history.length === 0 && !answer && (
          <div className="text-sm text-text-secondary">
            <p className="mb-2">Bu belge hakkında soru sorabilirsin. Örneğin:</p>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => { setQ(s); }}
                  className="text-left rounded-md border bg-surface-muted px-3 py-2 hover:border-accent-purple">{s}</button>
              ))}
            </div>
          </div>
        )}
        {history.map((h, i) => (
          <div key={i} className="rounded-lg bg-accent-purple/10 px-3 py-2 text-sm">{h.text}</div>
        ))}
        {answer && (
          <div className="rounded-lg border bg-surface px-3 py-3 text-sm whitespace-pre-wrap">
            {answer}
            {citations.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-text-secondary">Kaynaklar</p>
                {citations.map((c) => (
                  <div key={c.n} className="rounded-md border bg-surface-muted px-3 py-2 font-mono text-xs">
                    <span className="text-accent-purple">[K{c.n}]</span> s.{c.page}
                    {c.section ? ` · ${c.section}` : ""}
                    <p className="mt-1 text-text-secondary line-clamp-2">{c.snippet}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {loading && <Loader2 className="animate-spin text-accent-purple" size={18} />}
      </div>

      <form onSubmit={submit} className="border-t p-3 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Belgeye soru sor…"
               className="flex-1 rounded-md border bg-surface-muted px-3 py-2 text-sm" />
        <button className="rounded-md bg-accent-purple px-3 text-white"><Send size={16} /></button>
      </form>
    </div>
  );
}
