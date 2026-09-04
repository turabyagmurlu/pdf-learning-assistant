"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API, getToken } from "@/lib/api";
import {
  BookOpen, Sparkles, GraduationCap, FileText, ArrowLeft,
  Loader2, Send, Pencil, Check, Mic, Headphones,
} from "lucide-react";

type Doc = {
  id: string; title: string; status: string; page_count?: number | null;
  short_summary?: string | null; category?: string | null;
};
type Prog = { page: number; numPages: number; pct: number };

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}
function pctOf(n: number, total: number) {
  if (!total) return 0;
  return Math.round(((n || 0) / total) * 100);
}
function Legend({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cx("h-2 w-2 shrink-0 rounded-full", color)} />
      <span className="flex-1 text-text-secondary">{label}</span>
      <span className="font-medium">{n || 0}</span>
    </div>
  );
}
function Ring({ pct }: { pct: number }) {
  const r = 26, c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7"
              className="stroke-surface-muted" />
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
              className="stroke-accent-purple transition-all"
              strokeDasharray={c} strokeDashoffset={off} />
    </svg>
  );
}

export default function CollectionPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"raf" | "sor" | "anlat" | "ders" | "kart">("raf");

  // Anlat Bakalim (Feynman)
  const [fConcept, setFConcept] = useState("");
  const [fText, setFText] = useState("");
  const [fBusy, setFBusy] = useState(false);
  const [fResult, setFResult] = useState<{ review: string; sources: any[] } | null>(null);

  // Sesli ders
  const [lecBusy, setLecBusy] = useState(false);
  const [lecture, setLecture] = useState("");
  const [lecErr, setLecErr] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string>("");
  const [prog, setProg] = useState<Record<string, Prog>>({});

  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  // konuya sor
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; sources: any[] } | null>(null);

  // kartlar
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState("");

  async function load() {
    try {
      const d = await api(`/collections/${id}`);
      setData(d);
      setNewTitle(d?.collection?.title || "");
    } catch (e: any) {
      setErr(e?.message || "Çalışma kitabı açılamadı.");
    }
  }
  useEffect(() => { load(); }, [id]);

  // okuma ilerlemesi (reader localStorage'a yazar)
  useEffect(() => {
    const docs: Doc[] = data?.documents || [];
    if (!docs.length) return;
    const out: Record<string, Prog> = {};
    for (const d of docs) {
      try {
        const raw = localStorage.getItem("reader.prog." + d.id);
        if (raw) {
          const p = JSON.parse(raw);
          if (p && typeof p.pct === "number") out[d.id] = p;
        }
      } catch {}
    }
    setProg(out);
  }, [data]);

  async function ask() {
    const question = q.trim();
    if (question.length < 3) return;
    setAsking(true); setAnswer(null);
    try {
      const r = await api(`/collections/${id}/ask`, {
        method: "POST", body: JSON.stringify({ question }),
      });
      setAnswer(r);
    } catch (e: any) {
      setAnswer({ answer: e?.message || "Cevap alınamadı.", sources: [] });
    } finally { setAsking(false); }
  }

  async function generate(type: string) {
    setGenBusy(true); setGenMsg("");
    try {
      const r = await api(`/collections/${id}/study/generate`, {
        method: "POST", body: JSON.stringify({ type, count: 10 }),
      });
      setGenMsg(`${r.created} kart üretildi. Öğrenme sayfasından çalışabilirsin.`);
      load();
    } catch (e: any) {
      setGenMsg(e?.message || "Üretilemedi.");
    } finally { setGenBusy(false); }
  }

  async function sendFeynman() {
    if (fConcept.trim().length < 2 || fText.trim().length < 20) return;
    setFBusy(true); setFResult(null);
    try {
      const r = await api(`/collections/${id}/feynman`, {
        method: "POST",
        body: JSON.stringify({ concept: fConcept.trim(), explanation: fText.trim() }),
      });
      setFResult(r);
    } catch (e: any) {
      setFResult({ review: e?.message || "Değerlendirilemedi.", sources: [] });
    } finally { setFBusy(false); }
  }

  function stopAudio() {
    try {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = ""; }
    } catch {}
    setPlaying(false);
  }
  useEffect(() => () => { stopAudio(); }, []);

  async function makeLecture() {
    setLecBusy(true); setLecErr(""); setLecture(""); stopAudio();
    try {
      const r = await api(`/collections/${id}/lecture`, { method: "POST" });
      setLecture(r.script || "");
    } catch (e: any) {
      setLecErr(e?.message || "Ders oluşturulamadı.");
    } finally { setLecBusy(false); }
  }

  async function playLecture() {
    if (!lecture) return;
    setAudioBusy(true); setLecErr(""); stopAudio();
    try {
      const res = await fetch(`${API}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({ text: lecture.slice(0, 5500) }),
      });
      if (!res.ok) throw new Error("Seslendirme yapılamadı.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const a = new Audio(url);
      a.onended = () => setPlaying(false);
      audioRef.current = a;
      await a.play();
      setPlaying(true);
    } catch (e: any) {
      setLecErr(e?.message || "Seslendirme yapılamadı.");
    } finally { setAudioBusy(false); }
  }

  async function saveTitle() {
    const t = newTitle.trim();
    if (!t) { setRenaming(false); return; }
    try {
      await api(`/collections/${id}`, { method: "PATCH", body: JSON.stringify({ title: t }) });
      setRenaming(false); load();
    } catch { setRenaming(false); }
  }

  if (err) return <div className="p-8 text-danger">{err}</div>;
  if (!data) return <div className="p-8 text-text-secondary">Yükleniyor…</div>;

  const col = data.collection;
  const docs: Doc[] = data.documents || [];
  const st = data.stats || {};
  const read = docs.filter((d) => (prog[d.id]?.pct || 0) >= 95).length;
  const overall = docs.length
    ? Math.round(docs.reduce((s, d) => s + (prog[d.id]?.pct || 0), 0) / docs.length)
    : 0;
  // kalan sayfa ve tahmini süre (~1.5 dk/sayfa)
  const remainingPages = docs.reduce((s, d) => {
    const total = d.page_count || 0;
    const done = Math.round((total * (prog[d.id]?.pct || 0)) / 100);
    return s + Math.max(0, total - done);
  }, 0);
  const mins = Math.round(remainingPages * 1.5);
  const etaText = mins >= 60 ? `${Math.round(mins / 60)} saat` : `${mins} dk`;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <button onClick={() => router.push("/library")}
              className="mb-4 flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent-purple">
        <ArrowLeft size={15} /> Kütüphane
      </button>

      {/* başlık */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen size={22} className="shrink-0 text-accent-purple" />
            {renaming ? (
              <div className="flex items-center gap-1.5">
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); }}
                       autoFocus
                       className="rounded-lg border bg-surface px-2 py-1 font-heading text-2xl outline-none" />
                <button onClick={saveTitle} aria-label="Kaydet"
                        className="rounded-md bg-accent-purple p-1.5 text-white"><Check size={15} /></button>
              </div>
            ) : (
              <h1 className="truncate font-heading text-3xl">{col.title}</h1>
            )}
            {!renaming && (
              <button onClick={() => setRenaming(true)} aria-label="Yeniden adlandır"
                      className="rounded-md p-1 text-text-secondary hover:bg-black/5"><Pencil size={14} /></button>
            )}
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            {st.documents} belge · {st.pages || 0} sayfa · {st.cards || 0} kart
          </p>
        </div>
      </div>

      {/* DASHBOARD */}
      {docs.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* okuma halkası */}
          <div className="rounded-2xl border bg-surface p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Okuma</p>
            <div className="flex items-center gap-4">
              <Ring pct={overall} />
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-none">%{overall}</p>
                <p className="mt-1 text-xs text-text-secondary">{read}/{docs.length} belge bitti</p>
                {remainingPages > 0 && (
                  <p className="mt-1.5 text-xs text-text-secondary">
                    ~{remainingPages} sayfa kaldı · yaklaşık {etaText}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* kart sağlığı */}
          <div className="rounded-2xl border bg-surface p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Kart sağlığı</p>
            {st.cards > 0 ? (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full bg-green-500" style={{ width: pctOf(st.mastered, st.cards) + "%" }} />
                  <div className="h-full bg-accent-purple" style={{ width: pctOf(st.review, st.cards) + "%" }} />
                  <div className="h-full bg-accent-amber" style={{ width: pctOf(st.learning, st.cards) + "%" }} />
                </div>
                <div className="mt-3 space-y-1 text-xs">
                  <Legend color="bg-green-500" label="Öğrenildi" n={st.mastered} />
                  <Legend color="bg-accent-purple" label="Tekrar aşamasında" n={st.review} />
                  <Legend color="bg-accent-amber" label="Yeni / zorlanıyor" n={st.learning} />
                </div>
              </>
            ) : (
              <p className="text-sm text-text-secondary">Henüz kart yok. Kartlar sekmesinden üret.</p>
            )}
          </div>

          {/* bugün + notlar */}
          <div className="rounded-2xl border bg-surface p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Bugün</p>
            <div className="flex items-baseline gap-2">
              <span className={cx("text-3xl font-semibold", st.due > 0 ? "text-accent-purple" : "")}>{st.due || 0}</span>
              <span className="text-sm text-text-secondary">kart tekrar bekliyor</span>
            </div>
            {st.due > 0 ? (
              <button onClick={() => router.push("/study")}
                      className="mt-3 w-full rounded-xl bg-accent-purple px-3 py-2 text-sm text-white">
                Tekrara başla
              </button>
            ) : (
              <p className="mt-2 text-xs text-text-secondary">Bugünlük tekrar yok, iyi gidiyorsun.</p>
            )}
            <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-text-secondary">
              <span>{st.notes || 0} not / vurgu</span>
              <span>{st.pages || 0} sayfa</span>
            </div>
          </div>
        </div>
      )}

      {/* sekmeler */}
      <div className="mt-6 flex gap-1 border-b">
        {([["raf", "Raf", FileText], ["sor", "Konuya sor", Sparkles], ["anlat", "Anlat bakalım", Mic],
           ["ders", "Sesli ders", Headphones], ["kart", "Kartlar", GraduationCap]] as const).map(
          ([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k as any)}
                    className={cx("flex items-center gap-1.5 px-4 py-2.5 text-sm",
                      tab === k ? "border-b-2 border-accent-purple text-accent-purple" : "text-text-secondary")}>
              <Icon size={15} /> {label}
            </button>
          ))}
      </div>

      {/* RAF */}
      {tab === "raf" && (
        <div className="mt-5">
          {docs.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center">
              <p className="text-text-secondary">
                Bu çalışma kitabı boş. Kütüphaneden bir belgeyi düzenleyip bu kitaba ekleyebilirsin.
              </p>
              <button onClick={() => router.push("/library")}
                      className="mt-3 rounded-xl bg-accent-purple px-4 py-2 text-sm text-white">
                Kütüphaneye git
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border bg-surface-muted/40 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {docs.map((d) => {
                  const p = prog[d.id];
                  return (
                    <div key={d.id} role="button" tabIndex={0}
                         onClick={() => router.push("/documents/" + d.id)}
                         onKeyDown={(e) => { if (e.key === "Enter") router.push("/documents/" + d.id); }}
                         className="group cursor-pointer rounded-xl border bg-surface p-3 transition hover:border-accent-purple/50 hover:shadow-sm">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 h-10 w-1.5 shrink-0 rounded-full bg-accent-purple/70" />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-medium">{d.title}</h3>
                          {d.short_summary && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{d.short_summary}</p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className={cx("rounded-full px-2 py-0.5",
                              d.status === "ready" ? "bg-green-100 text-green-700" : "bg-surface-muted text-text-secondary")}>
                              {d.status === "ready" ? "Hazır" : "İşleniyor"}
                            </span>
                            {d.page_count ? (
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-text-secondary">
                                {d.page_count} sayfa
                              </span>
                            ) : null}
                          </div>
                          {p && p.pct > 0 && (
                            <div className="mt-2">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                                <div className="h-full rounded-full bg-accent-purple" style={{ width: p.pct + "%" }} />
                              </div>
                              <p className="mt-1 text-[11px] text-text-secondary">
                                %{p.pct} · s.{p.page}/{p.numPages}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* KONUYA SOR */}
      {tab === "sor" && (
        <div className="mt-5">
          <p className="mb-3 text-sm text-text-secondary">
            Soru sor, <b>{col.title}</b> kitabındaki {st.documents} belgenin tamamında arayıp cevaplayayım.
          </p>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                   placeholder="Örn: Bu konudaki temel kavramlar neler?"
                   className="flex-1 rounded-xl border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent-purple" />
            <button onClick={ask} disabled={asking}
                    className="flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2.5 text-sm text-white disabled:opacity-60">
              {asking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Sor
            </button>
          </div>

          {asking && <p className="mt-4 text-sm text-text-secondary">Belgeler taranıyor…</p>}

          {answer && (
            <div className="mt-5 rounded-2xl border bg-surface p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.answer}</p>
              {answer.sources?.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Kaynaklar</p>
                  <div className="flex flex-wrap gap-1.5">
                    {answer.sources.map((s: any, i: number) => (
                      <button key={i} onClick={() => router.push("/documents/" + s.document_id)}
                              className="rounded-full border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-purple/50">
                        [K{i + 1}] {s.title} · s.{s.page}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ANLAT BAKALIM (Feynman) */}
      {tab === "anlat" && (
        <div className="mt-5 max-w-3xl">
          <div className="rounded-2xl border border-accent-purple/30 bg-accent-purple/5 p-4">
            <p className="text-sm leading-relaxed">
              Bir kavramı <b>kendi cümlelerinle</b> anlat. Kaynakla karşılaştırıp neyi doğru
              kavradığını, nerede eksiğin olduğunu göstereyim. Bir şeyi gerçekten anlayıp
              anlamadığın, ancak anlatmaya çalışınca ortaya çıkar.
            </p>
          </div>

          <input value={fConcept} onChange={(e) => setFConcept(e.target.value)}
                 placeholder="Hangi kavram? Örn: süperkompanzasyon"
                 className="mt-4 w-full rounded-xl border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent-purple" />
          <textarea value={fText} onChange={(e) => setFText(e.target.value)} rows={7}
                    placeholder="Şimdi anlat… Kitaptaki cümleleri kopyalama, kendi kelimelerinle söyle. Bir arkadaşına anlatır gibi."
                    className="mt-2 w-full rounded-xl border bg-surface p-3 text-sm leading-relaxed outline-none focus:border-accent-purple" />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-text-secondary">{fText.trim().length} karakter</span>
            <button onClick={sendFeynman} disabled={fBusy || fText.trim().length < 20}
                    className="flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2 text-sm text-white disabled:opacity-50">
              {fBusy ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
              {fBusy ? "Değerlendiriliyor…" : "Anlatımımı değerlendir"}
            </button>
          </div>

          {fResult && (
            <div className="mt-5 rounded-2xl border bg-surface p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{fResult.review}</p>
              {fResult.sources?.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Kaynaklar</p>
                  <div className="flex flex-wrap gap-1.5">
                    {fResult.sources.map((s: any, i: number) => (
                      <button key={i} onClick={() => router.push("/documents/" + s.document_id)}
                              className="rounded-full border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-purple/50">
                        {s.title} · s.{s.page}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SESLI DERS */}
      {tab === "ders" && (
        <div className="mt-5 max-w-3xl">
          <p className="text-sm text-text-secondary">
            Bu çalışma kitabındaki {st.ready || st.documents} belgeyi tek bir akıcı derse çeviririm;
            yolda, sporda dinlersin.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={makeLecture} disabled={lecBusy}
                    className="flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2.5 text-sm text-white disabled:opacity-60">
              {lecBusy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
              {lecBusy ? "Ders hazırlanıyor…" : lecture ? "Yeniden hazırla" : "Dersi hazırla"}
            </button>
            {lecture && (
              <>
                <button onClick={playLecture} disabled={audioBusy}
                        className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm hover:bg-black/5 disabled:opacity-60">
                  {audioBusy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
                  {audioBusy ? "Ses hazırlanıyor…" : "Dinle"}
                </button>
                {playing && (
                  <button onClick={stopAudio} className="rounded-xl border px-4 py-2.5 text-sm hover:bg-black/5">
                    Durdur
                  </button>
                )}
              </>
            )}
          </div>
          {lecErr && <p className="mt-3 text-sm text-danger">{lecErr}</p>}
          {lecture && (
            <div className="mt-4 rounded-2xl border bg-surface p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{lecture}</p>
            </div>
          )}
        </div>
      )}

      {/* KARTLAR */}
      {tab === "kart" && (
        <div className="mt-5">
          <p className="mb-3 text-sm text-text-secondary">
            Bu kitaptaki tüm belgelerden karışık çalışma materyali üret.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => generate("flashcard")} disabled={genBusy}
                    className="flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2.5 text-sm text-white disabled:opacity-60">
              {genBusy ? <Loader2 size={15} className="animate-spin" /> : <GraduationCap size={15} />} Bilgi kartı üret
            </button>
            <button onClick={() => generate("quiz")} disabled={genBusy}
                    className="rounded-xl border px-4 py-2.5 text-sm hover:bg-black/5 disabled:opacity-60">
              Quiz üret
            </button>
            <button onClick={() => router.push("/study")}
                    className="rounded-xl border px-4 py-2.5 text-sm hover:bg-black/5">
              Öğrenme sayfasına git
            </button>
          </div>
          {genMsg && <p className="mt-3 text-sm text-accent-purple">{genMsg}</p>}
          <p className="mt-4 text-sm text-text-secondary">
            Şu an bu kitapta <b>{st.cards || 0}</b> kart var.
          </p>
        </div>
      )}
    </div>
  );
}
