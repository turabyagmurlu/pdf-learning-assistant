"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Doc = { id: string; title: string; status: string };
type Item = { id: string; type: string; question: string; answer: string; options?: string[]; difficulty?: string };

export default function StudyPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docId, setDocId] = useState("");
  const [type, setType] = useState("flashcard");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  useEffect(() => { api("/documents").then((d) => {
    const ready = d.filter((x: Doc) => x.status === "ready");
    setDocs(ready); if (ready[0]) setDocId(ready[0].id);
  }); }, []);

  async function loadItems(id: string) {
    if (!id) return;
    setItems(await api(`/study/items?document_id=${id}`));
  }
  useEffect(() => { loadItems(docId); }, [docId]);

  async function generate() {
    if (!docId) return;
    setBusy(true);
    try {
      await api(`/documents/${docId}/study/generate`, { method: "POST", body: JSON.stringify({ type, count: 8 }) });
      await loadItems(docId);
    } finally { setBusy(false); }
  }

  async function review(id: string, quality: number) {
    await api(`/study/items/${id}/review`, { method: "POST", body: JSON.stringify({ quality }) });
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="font-heading text-3xl mb-4">Öğrenme</h1>

      <div className="flex flex-wrap gap-2 mb-6 items-center">
        <select value={docId} onChange={(e) => setDocId(e.target.value)}
                className="rounded-md border bg-surface-muted px-3 py-2 text-sm">
          {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}
                className="rounded-md border bg-surface-muted px-3 py-2 text-sm">
          <option value="flashcard">Flashcard</option>
          <option value="quiz">Quiz</option>
          <option value="open_question">Açık uçlu</option>
        </select>
        <button onClick={generate} disabled={busy}
                className="rounded-md bg-accent-purple px-4 py-2 text-white text-sm disabled:opacity-60">
          {busy ? "Üretiliyor…" : "Üret"}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-text-secondary">Henüz materyal yok. Bir belge seç ve "Üret"e bas.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border bg-surface p-4 shadow-soft">
              <p className="text-xs text-accent-teal mb-1">{it.type} · {it.difficulty}</p>
              <p className="font-medium">{it.question}</p>
              {it.type === "quiz" && it.options && (
                <ul className="mt-2 space-y-1 text-sm">
                  {it.options.map((o, i) => <li key={i} className="text-text-secondary">• {o}</li>)}
                </ul>
              )}
              <button onClick={() => setFlipped((f) => ({ ...f, [it.id]: !f[it.id] }))}
                      className="mt-3 text-sm text-accent-purple">
                {flipped[it.id] ? "Cevabı gizle" : "Cevabı göster"}
              </button>
              {flipped[it.id] && <p className="mt-2 rounded-md bg-surface-muted p-2 text-sm">{it.answer}</p>}
              <div className="mt-3 flex gap-1">
                {[["Zor", 2], ["Orta", 3], ["Kolay", 5]].map(([l, q]) => (
                  <button key={l as string} onClick={() => review(it.id, q as number)}
                          className="rounded-md border px-2 py-1 text-xs hover:border-accent-teal">{l}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
