"use client";
import { useEffect, useMemo, useState } from "react";
import { api, API, getToken } from "@/lib/api";
import { GraduationCap, Layers, Trophy, Clock, Sparkles, RotateCcw, ChevronRight, Check, X, Play, BookOpen } from "lucide-react";

type Doc = { id: string; title: string; status: string };
type Item = {
  id: string; document_id: string; type: string; question: string; answer: string;
  options?: any; source_page?: number | null; difficulty?: string | null;
  review_status?: string | null; ease_factor?: number | null; interval_days?: number | null; due_at?: string | null;
};

const cx = (...a: any[]) => a.filter(Boolean).join(" ");
function toArr(v: any): any[] { if (Array.isArray(v)) return v; if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } } return []; }
const H = () => ({ Authorization: "Bearer " + getToken(), "Content-Type": "application/json" });

export default function StudyPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "cards" | "quiz">("overview");

  async function loadDocs() { try { const d = await api("/documents"); setDocs((d as Doc[]).filter((x) => x.status === "ready")); } catch {} }
  async function loadItems() { try { const r = await fetch(API + "/study/items", { headers: H() }); if (r.ok) setItems(await r.json()); } catch {} setLoading(false); }
  useEffect(() => { loadDocs(); loadItems(); }, []);

  const now = Date.now();
  const flashcards = useMemo(() => items.filter((i) => i.type === "flashcard" || i.type === "open_question"), [items]);
  const quizzes = useMemo(() => items.filter((i) => i.type === "quiz"), [items]);
  const due = useMemo(() => flashcards.filter((i) => !i.due_at || new Date(i.due_at).getTime() <= now), [flashcards, now]);
  const mastered = useMemo(() => flashcards.filter((i) => (i.interval_days || 0) >= 21), [flashcards]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="mb-5">
        <h1 className="font-heading text-3xl">Öğrenme</h1>
        <p className="mt-1 text-sm text-text-secondary">Belgelerinden AI ile flashcard ve quiz üret; aralıklı tekrarla kalıcı öğren.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Clock size={16} />} label="Bugün tekrar" value={due.length} accent />
        <Stat icon={<Layers size={16} />} label="Toplam kart" value={flashcards.length} />
        <Stat icon={<Trophy size={16} />} label="Öğrenilen" value={mastered.length} />
        <Stat icon={<BookOpen size={16} />} label="Quiz sorusu" value={quizzes.length} />
      </div>

      <div className="mt-6 flex w-fit gap-1 rounded-xl border bg-surface p-1">
        {[["overview", "Genel Bakış"], ["cards", "Kart Çalışması"], ["quiz", "Quiz"]].map((t) => (
          <button key={t[0]} onClick={() => setTab(t[0] as any)} className={cx("rounded-lg px-3 py-1.5 text-sm", tab === t[0] ? "bg-accent-purple text-white" : "text-text-secondary hover:bg-surface-muted")}>{t[1]}</button>
        ))}
      </div>

      <div className="mt-5">
        {loading ? (<p className="text-sm text-text-secondary">Yükleniyor…</p>) :
         tab === "overview" ? <Overview docs={docs} items={items} onChanged={loadItems} /> :
         tab === "cards" ? <Cards items={flashcards} due={due} onReview={loadItems} /> :
         <Quiz docs={docs} items={quizzes} />}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: any; label: string; value: number; accent?: boolean }) {
  return (
    <div className={cx("rounded-2xl border p-4", accent ? "border-accent-purple/40 bg-accent-purple/5" : "bg-surface")}>
      <div className="flex items-center gap-1.5 text-text-secondary">{icon}<span className="text-xs">{label}</span></div>
      <div className={cx("mt-1 text-2xl font-semibold", accent ? "text-accent-purple" : "text-text-primary")}>{value}</div>
    </div>
  );
}

function Overview({ docs, items, onChanged }: { docs: Doc[]; items: Item[]; onChanged: () => void }) {
  const [docId, setDocId] = useState("");
  const [type, setType] = useState("flashcard");
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (!docId && docs.length) setDocId(docs[0].id); }, [docs, docId]);

  async function generate() {
    if (!docId) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch(API + "/documents/" + docId + "/study/generate", { method: "POST", headers: H(), body: JSON.stringify({ type, count }) });
      const j = await r.json();
      if (r.ok) { setMsg((j.created || 0) + " öğe üretildi."); onChanged(); } else { setMsg("Üretilemedi."); }
    } catch { setMsg("Hata oluştu."); }
    setBusy(false);
  }

  const byDoc = useMemo(() => {
    const m: Record<string, { title: string; total: number; fc: number; qz: number }> = {};
    for (const d of docs) m[d.id] = { title: d.title, total: 0, fc: 0, qz: 0 };
    for (const it of items) { const e = m[it.document_id]; if (!e) continue; e.total++; if (it.type === "quiz") e.qz++; else e.fc++; }
    return Object.values(m).filter((x) => x.total > 0);
  }, [docs, items]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2"><Sparkles size={16} className="text-accent-purple" /><h3 className="font-medium">Yeni materyal üret</h3></div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={docId} onChange={(e) => setDocId(e.target.value)} aria-label="Belge" className="min-w-[180px] rounded-lg border bg-surface-muted px-3 py-2 text-sm">
            {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tür" className="rounded-lg border bg-surface-muted px-3 py-2 text-sm">
            <option value="flashcard">Flashcard</option>
            <option value="quiz">Quiz (çoktan seçmeli)</option>
            <option value="open_question">Açık uçlu</option>
          </select>
          <select value={count} onChange={(e) => setCount(parseInt(e.target.value))} aria-label="Adet" className="rounded-lg border bg-surface-muted px-3 py-2 text-sm">
            {[5, 8, 12, 16].map((n) => <option key={n} value={n}>{n} adet</option>)}
          </select>
          <button onClick={generate} disabled={busy || !docId} className="flex items-center gap-1.5 rounded-lg bg-accent-purple px-4 py-2 text-sm text-white disabled:opacity-50">
            {busy ? "Üretiliyor…" : (<><Sparkles size={15} /> Üret</>)}
          </button>
          {msg && <span className="text-sm text-text-secondary">{msg}</span>}
        </div>
        <p className="mt-2 text-xs text-text-secondary">Materyal belgenin içeriğinden AI ile üretilir; birkaç saniye sürebilir.</p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-text-secondary">Belgelere göre</h3>
        {byDoc.length === 0 ? (
          <div className="rounded-2xl border bg-surface p-8 text-center text-sm text-text-secondary">Henüz materyal yok. Yukarıdan bir belge seçip üret.</div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {byDoc.map((x, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border bg-surface p-3">
                <span className="truncate font-medium text-text-primary">{x.title}</span>
                <span className="shrink-0 text-xs text-text-secondary">{x.fc} kart · {x.qz} quiz</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Cards({ items, due, onReview }: { items: Item[]; due: Item[]; onReview: () => void }) {
  const [mode, setMode] = useState<"due" | "all">("due");
  const [queue, setQueue] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [active, setActive] = useState(false);

  function start(m: "due" | "all") {
    const src = m === "due" ? due : items;
    const shuffled = [...src].sort(() => Math.random() - 0.5);
    setMode(m); setQueue(shuffled); setIdx(0); setFlipped(false); setDone(0); setActive(shuffled.length > 0);
  }

  async function grade(quality: number) {
    const it = queue[idx];
    if (it) { try { await fetch(API + "/study/items/" + it.id + "/review", { method: "POST", headers: H(), body: JSON.stringify({ quality }) }); } catch {} }
    setDone((d) => d + 1);
    if (idx + 1 < queue.length) { setIdx(idx + 1); setFlipped(false); } else { setActive(false); onReview(); }
  }

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); setFlipped((f) => !f); }
      else if (flipped && ["1", "2", "3", "4"].indexOf(e.key) >= 0) grade([1, 3, 4, 5][parseInt(e.key) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, flipped, idx, queue]);

  if (!active) {
    return (
      <div className="rounded-2xl border bg-surface p-8 text-center">
        <GraduationCap size={28} className="mx-auto text-accent-purple" />
        <p className="mt-2 text-sm text-text-secondary">{items.length === 0 ? "Henüz kart yok. Genel Bakış'tan üret." : (done > 0 ? "Oturum tamamlandı! " + done + " kart çalıştın." : "Bugün " + due.length + " kart tekrar için hazır.")}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button onClick={() => start("due")} disabled={due.length === 0} className="flex items-center gap-1.5 rounded-lg bg-accent-purple px-4 py-2 text-sm text-white disabled:opacity-50"><Play size={15} /> Bugünküleri çalış ({due.length})</button>
          <button onClick={() => start("all")} disabled={items.length === 0} className="flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm text-text-secondary disabled:opacity-50"><RotateCcw size={15} /> Tümünü karıştır ({items.length})</button>
        </div>
      </div>
    );
  }

  const it = queue[idx];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-text-secondary">
        <span>{idx + 1} / {queue.length}</span>
        <span>{mode === "due" ? "Bugünkü tekrar" : "Karışık"}</span>
      </div>
      <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-surface-muted"><div className="h-full bg-accent-purple transition-all" style={{ width: (idx / queue.length * 100) + "%" }} /></div>

      <div onClick={() => setFlipped((f) => !f)} className="cursor-pointer" style={{ perspective: 1200 }}>
        <div style={{ position: "relative", transformStyle: "preserve-3d", transition: "transform .5s", transform: flipped ? "rotateY(180deg)" : "none", minHeight: 220 }}>
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border bg-surface p-8 text-center" style={{ backfaceVisibility: "hidden" }}>
            <span className="mb-2 text-xs uppercase tracking-wide text-text-secondary">Soru</span>
            <p className="text-lg text-text-primary">{it.question}</p>
            <span className="mt-4 text-xs text-text-secondary">Çevirmek için tıkla (veya boşluk)</span>
          </div>
          <div className="absolute inset-0 flex min-h-[220px] flex-col items-center justify-center rounded-2xl border bg-accent-purple/5 p-8 text-center" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
            <span className="mb-2 text-xs uppercase tracking-wide text-accent-purple">Cevap</span>
            <p className="text-lg text-text-primary">{it.answer}</p>
            {it.source_page ? <span className="mt-3 text-xs text-text-secondary">Kaynak: s.{it.source_page}</span> : null}
          </div>
        </div>
      </div>

      {flipped ? (
        <div className="mt-5 grid grid-cols-4 gap-2">
          <button onClick={() => grade(1)} className="rounded-lg bg-red-100 px-2 py-2.5 text-sm text-red-700">Tekrar</button>
          <button onClick={() => grade(3)} className="rounded-lg bg-amber-100 px-2 py-2.5 text-sm text-amber-700">Zor</button>
          <button onClick={() => grade(4)} className="rounded-lg bg-green-100 px-2 py-2.5 text-sm text-green-700">İyi</button>
          <button onClick={() => grade(5)} className="rounded-lg bg-emerald-100 px-2 py-2.5 text-sm text-emerald-700">Kolay</button>
        </div>
      ) : (
        <button onClick={() => setFlipped(true)} className="mt-5 w-full rounded-lg border py-2.5 text-sm text-text-secondary hover:bg-surface-muted">Cevabı göster</button>
      )}
    </div>
  );
}

function Quiz({ docs, items }: { docs: Doc[]; items: Item[] }) {
  const [docId, setDocId] = useState("");
  const [session, setSession] = useState<Item[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<{ q: Item; choice: string; correct: boolean }[]>([]);
  useEffect(() => { if (!docId && docs.length) setDocId(docs[0].id); }, [docs, docId]);

  const pool = useMemo(() => docId ? items.filter((i) => i.document_id === docId) : items, [items, docId]);

  function start() { const s = [...pool].sort(() => Math.random() - 0.5).slice(0, 10); setSession(s); setIdx(0); setPicked(null); setAnswers([]); }

  function choose(opt: string) {
    if (picked !== null || !session) return;
    const q = session[idx];
    const correct = (opt || "").trim() === (q.answer || "").trim();
    setPicked(opt);
    setAnswers((a) => [...a, { q, choice: opt, correct }]);
  }
  function next() { setIdx(idx + 1); setPicked(null); }

  if (!session) {
    return (
      <div className="rounded-2xl border bg-surface p-6">
        <h3 className="mb-3 font-medium">Quiz başlat</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select value={docId} onChange={(e) => setDocId(e.target.value)} aria-label="Belge" className="min-w-[180px] rounded-lg border bg-surface-muted px-3 py-2 text-sm">
            {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <button onClick={start} disabled={pool.length === 0} className="flex items-center gap-1.5 rounded-lg bg-accent-purple px-4 py-2 text-sm text-white disabled:opacity-50"><Play size={15} /> Başla ({pool.length})</button>
        </div>
        {pool.length === 0 && <p className="mt-3 text-sm text-text-secondary">Bu belge için quiz sorusu yok. Genel Bakış'tan "Quiz" üret.</p>}
      </div>
    );
  }

  if (idx >= session.length) {
    const score = answers.filter((a) => a.correct).length;
    const wrong = answers.filter((a) => !a.correct);
    return (
      <div className="rounded-2xl border bg-surface p-6 text-center">
        <Trophy size={28} className="mx-auto text-accent-purple" />
        <p className="mt-2 text-2xl font-semibold text-text-primary">{score} / {session.length}</p>
        <p className="text-sm text-text-secondary">doğru cevap</p>
        {wrong.length > 0 && (
          <div className="mt-5 space-y-2 text-left">
            {wrong.map((a, i) => (
              <div key={i} className="rounded-xl border p-3">
                <p className="text-sm font-medium text-text-primary">{a.q.question}</p>
                <p className="mt-1 text-xs text-red-600">Senin: {a.choice}</p>
                <p className="text-xs text-green-700">Doğru: {a.q.answer}</p>
                {a.q.source_page ? <p className="mt-1 text-xs text-text-secondary">Kaynak: s.{a.q.source_page}</p> : null}
              </div>
            ))}
          </div>
        )}
        <button onClick={() => setSession(null)} className="mt-5 rounded-lg border px-4 py-2 text-sm text-text-secondary">Yeni quiz</button>
      </div>
    );
  }

  const q = session[idx];
  const opts = toArr(q.options);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-text-secondary"><span>Soru {idx + 1} / {session.length}</span><span>Doğru: {answers.filter((a) => a.correct).length}</span></div>
      <div className="rounded-2xl border bg-surface p-6">
        <p className="text-lg text-text-primary">{q.question}</p>
        <div className="mt-4 space-y-2">
          {opts.map((o: any, i: number) => {
            const val = String(o);
            const isCorrect = val.trim() === (q.answer || "").trim();
            const isPicked = picked === val;
            const show = picked !== null;
            return (
              <button key={i} onClick={() => choose(val)} disabled={show} className={cx("flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm", show && isCorrect ? "border-green-400 bg-green-50 text-green-800" : show && isPicked ? "border-red-400 bg-red-50 text-red-800" : "bg-surface hover:border-accent-purple/50")}>
                <span>{val}</span>
                {show && isCorrect ? <Check size={16} /> : (show && isPicked ? <X size={16} /> : null)}
              </button>
            );
          })}
        </div>
        {picked !== null && (
          <button onClick={next} className="mt-4 flex items-center gap-1.5 rounded-lg bg-accent-purple px-4 py-2 text-sm text-white">{idx + 1 < session.length ? "Sonraki" : "Bitir"} <ChevronRight size={15} /></button>
        )}
      </div>
    </div>
  );
}
