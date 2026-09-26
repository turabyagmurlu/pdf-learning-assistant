"use client";
/**
 * Sesli özet: defterdeki hazır kaynaklar tek akıcı metne (ya da Ayşe–Kerem sohbetine) çevrilir, dinlenir.
 * - Metin AKIŞLA gelir; ilk iki paragraf gelince ilk ses parçası arkada hazırlanmaya başlar (ön parça).
 * - Ses parça parça gelir: ilk parça hazır olunca çalma başlar, kalanlar arkada üretilir.
 * - Tamamlanınca parçalar cihaz önbelleğine (typdf-audio) yazılır; ikinci dinleme ücretsiz ve anında.
 * - Sunucu yenilenip iş kaybolursa "Yeniden başlat" önerilir (parçalar sunucu önbelleğinde kalır, hızlı biter).
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Headphones, Volume2, RefreshCw, X } from "lucide-react";
import { api, API, getToken } from "@/lib/api";
import AudioQueuePlayer from "@/components/AudioQueuePlayer";
import { primeAudio, type QueueChunk } from "@/hooks/useAudioQueue";
import BrowserVoice, { browserVoiceSupported } from "@/components/BrowserVoice";
import { Cost, costTitle, isUsageLimit } from "@/components/CostBadge";
import type { ConfirmOptions } from "@/components/Confirm";

type Voice = { id: string; label: string };
type Fmt = "solo" | "dialog";
type JobState = {
  job_id: string; status: "running" | "ready" | "error"; done: number; total: number;
  ready_chunks: number[]; durations: Record<string, number>; texts: string[]; mime: string;
  error?: string | null; quota?: boolean; note?: string; waiting?: number; cached?: boolean; resumed?: boolean;
};
type Manifest = { v: 2; n: number; texts: string[]; durations: number[]; mime: string };

const SPEAKER_LINE = /^\s*(Ayşe|Ayse|Kerem)\s*:/i;
function isDialogText(t: string): boolean {
  const lines = t.split("\n").filter((l) => l.trim());
  const hits = lines.filter((l) => SPEAKER_LINE.test(l)).length;
  return lines.length >= 4 && hits >= 4 && hits * 2 >= lines.length;
}

/** Akan metnin başından ön parça seç: en az 2 paragraf (sohbette 4 replik), 500–2000 karakter, sınırda biter. */
function pickHead(text: string, dialog: boolean): string | null {
  const parts = dialog ? text.split("\n").filter((l) => l.trim()) : text.split(/\n\s*\n/).filter((p) => p.trim());
  const minParts = dialog ? 4 : 2;
  if (parts.length <= minParts) return null;             // son parça henüz akıyor olabilir; onu alma
  let head = "";
  for (let i = 0; i < parts.length - 1; i++) {
    const next = (head ? head + "\n" + (dialog ? "" : "\n") : "") + parts[i].trim();
    if (next.length > 2000) break;
    head = next;
  }
  const cnt = head ? (dialog ? head.split("\n").length : head.split(/\n\s*\n/).length) : 0;
  return head.length >= 500 && cnt >= minParts ? head : null;
}

export default function LectureTab({ id, title, readyN, confirm }: {
  id: string; title: string; readyN: number;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
}) {
  const LEC_KEY = "lecture.text." + id;
  const [lecBusy, setLecBusy] = useState(false);
  const [lecture, setLecture] = useState("");
  const [lecErr, setLecErr] = useState("");
  const [lecNote, setLecNote] = useState("");
  const [fmt, setFmt] = useState<Fmt>("solo");
  const [voice, setVoice] = useState("");
  const [voice2, setVoice2] = useState("");
  const [voiceList, setVoiceList] = useState<Voice[]>([]);
  const [studentList, setStudentList] = useState<Voice[]>([]);
  const [autoAudio, setAutoAudio] = useState(true);
  const [quotaOut, setQuotaOut] = useState(false);
  const [useBrowserVoice, setUseBrowserVoice] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);

  // Ses işi
  const [audioBusy, setAudioBusy] = useState(false);
  const [chunks, setChunks] = useState<QueueChunk[] | null>(null);
  const [jobTotal, setJobTotal] = useState(0);
  const [audioNote, setAudioNote] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const [jobLost, setJobLost] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const runId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const urlsRef = useRef<string[]>([]);
  const headRef = useRef<string>("");
  const [headOn, setHeadOn] = useState(false);     // M5: metin yazılırken ilk ses parçası hazırlanıyor

  const lectureIsDialog = isDialogText(lecture);
  // Ses biçimi metnin kendisinden: tek anlatıcı metni sohbet sesiyle (ya da tersi) seslendirilmez
  const dialogAudio = lecture ? lectureIsDialog : fmt === "dialog";
  const voiceKey = voice + (dialogAudio ? "+" + voice2 : "");
  const AUDIO_KEY = "/typdf-audio/lecture/" + id + (voiceKey ? "/" + voiceKey : "");
  const ttsParts = Math.max(1, Math.ceil(Math.min(lecture.length, 12000) / 2600));
  const fmtMismatch = !!lecture && (lectureIsDialog !== (fmt === "dialog"));

  useEffect(() => { setCanSpeak(browserVoiceSupported()); }, []);
  useEffect(() => {
    try { const t = localStorage.getItem(LEC_KEY); if (t) setLecture(t); } catch {}
    try { const v = localStorage.getItem("lecture.voice"); if (v) setVoice(v); } catch {}
    try { const v = localStorage.getItem("lecture.voice2"); if (v) setVoice2(v); } catch {}
    try { const f = localStorage.getItem("lecture.format"); if (f === "dialog" || f === "solo") setFmt(f); } catch {}
    try { const a = localStorage.getItem("lecture.autoAudio"); if (a === "0") setAutoAudio(false); } catch {}
    (async () => {
      try {
        const r = await api("/lecture/voices");
        setVoiceList(r.voices || []); setStudentList(r.student_voices || []);
        setVoice((v) => v || r.default || ""); setVoice2((v) => v || r.default_student || "");
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Cihazda hazır mı?
  useEffect(() => {
    (async () => {
      try {
        if (!("caches" in window)) { setAudioReady(false); return; }
        const c = await caches.open("typdf-audio");
        setAudioReady(!!(await c.match(AUDIO_KEY)));
      } catch { setAudioReady(false); }
    })();
  }, [AUDIO_KEY]);

  function stopAudio() {
    runId.current++;
    try { abortRef.current?.abort(); } catch {}
    urlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
    urlsRef.current = [];
    setChunks(null); setShowPlayer(false); setAudioBusy(false); setAudioNote(""); setJobLost(false); setJobTotal(0); setHeadOn(false);
  }
  useEffect(() => () => { stopAudio(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Metin: akışla hazırla ------------------------------------------------------------------
  async function makeLecture(refresh = false) {
    if (refresh) {
      const ok = await confirm({
        title: fmtMismatch ? (fmt === "dialog" ? "Özet sohbet olarak yeniden yazılsın mı?" : "Özet tek anlatıcıyla yeniden yazılsın mı?")
                           : "Özet sıfırdan yeniden yazılsın mı?",
        description: "Şu anki özet metni yerine yepyeni bir metin yazılır. Bu 1 yapay zekâ kullanımı harcar.",
        losses: ["Kayıtlı özet metni değişir",
                 "Hazırlanan ses geçersiz olur; dinlemek için yeniden hazırlanması gerekir (⚡)"],
        confirmLabel: "Yeniden yaz",
      });
      if (!ok) return;
    }
    setLecBusy(true); setLecErr(""); setLecNote(""); stopAudio();
    setUseBrowserVoice(false); setQuotaOut(false);
    headRef.current = "";
    const myRun = ++runId.current;
    const ac = new AbortController(); abortRef.current = ac;
    let full = "", finalText = "";
    try {
      const res = await fetch(`${API}/collections/${id}/lecture/stream?format=${fmt}${refresh ? "&refresh=1" : ""}`, {
        method: "POST", signal: ac.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
      });
      if (!res.ok || !res.body) {
        let code = "", msg = "Sesli özet hazırlanamadı; birazdan tekrar dene.";
        try { const j = await res.json(); code = j?.error?.code || ""; if (typeof j?.error?.user_message === "string") msg = j.error.user_message; } catch {}
        if (code === "USAGE_LIMIT" || res.status === 429 || res.status === 503) setQuotaOut(true);
        throw new Error(msg);
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      let headStarted = false, isCached = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n"); buf = events.pop() || "";
        for (const ev of events) {
          const lines = ev.split("\n");
          const type = lines.find((l) => l.startsWith("event: "))?.slice(7);
          const dataLine = lines.find((l) => l.startsWith("data: "))?.slice(6);
          if (!dataLine) continue;
          let data: any; try { data = JSON.parse(dataLine); } catch { continue; }
          if (type === "token") {
            full += data.text || ""; setLecture(full);
            // Ön parça: ilk paragraflar gelince ilk ses parçasını hemen başlat (kullanıcı okurken ses hazırlanır)
            // (Kayıtlı metin tekrar gönderiliyorsa ön parça yok: ses büyük olasılıkla zaten hazır.)
            if (autoAudio && !headStarted && !isCached && runId.current === myRun) {
              const head = pickHead(full, fmt === "dialog");
              if (head) { headStarted = true; headRef.current = head; setHeadOn(true); void startHeadJob(head); }
            }
          } else if (type === "meta") { isCached = !!data.cached; }
          else if (type === "done") { finalText = data.script || full; }
          else if (type === "note") { setLecNote(typeof data.message === "string" ? data.message : ""); }
          else if (type === "error") {
            if (data.code === "USAGE_LIMIT" || data.code === "AI_BUSY") setQuotaOut(true);
            throw new Error(typeof data.message === "string" ? data.message : "Sesli özet hazırlanamadı; birazdan tekrar dene.");
          }
        }
      }
      if (runId.current !== myRun) return;
      const s = (finalText || full).trim();
      if (!s) throw new Error("Sesli özet hazırlanamadı; birazdan tekrar dene.");
      setLecture(s);
      try { localStorage.setItem(LEC_KEY, s); } catch {}
      if (refresh) {
        setAudioReady(false);
        try { localStorage.removeItem("lecture.pos." + id); } catch {}
        try { if ("caches" in window) { const c = await caches.open("typdf-audio"); await clearCached(c); } } catch {}
      }
      setLecBusy(false);
      if (autoAudio) void playLecture(s, headRef.current);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      if (isUsageLimit(e)) setQuotaOut(true);
      setLecErr(e?.message || "Sesli özet hazırlanamadı; birazdan tekrar dene.");
    } finally { if (runId.current === myRun) setLecBusy(false); }
  }

  /** Ön parça: yalnız ilk parçanın sesini sunucuda üretir (sonuç sunucu önbelleğine düşer);
   *  metin bitince başlayan tam iş bu parçayı aynen kullanır, ilk ses anında gelir. */
  async function startHeadJob(head: string) {
    try {
      await api(`/collections/${id}/lecture/tts`, {
        method: "POST", body: JSON.stringify({ text: head, voice: voice || undefined, voice2: voice2 || undefined, format: fmt, head }),
      }, 1);
    } catch { /* ön parça başarısızsa tam iş zaten üretecek */ }
  }

  async function clearCached(c: Cache) {
    const m = await c.match(AUDIO_KEY);
    if (m) {
      try { if ((m.headers.get("Content-Type") || "").includes("json")) { const man = (await m.json()) as Manifest; for (let i = 0; i < man.n; i++) await c.delete(AUDIO_KEY + "/" + i); } } catch {}
      await c.delete(AUDIO_KEY);
    }
  }

  // ---- Ses: cihaz önbelleği ya da parçalı iş -----------------------------------------------------
  async function fromCache(): Promise<QueueChunk[] | null> {
    try {
      if (!("caches" in window)) return null;
      const c = await caches.open("typdf-audio");
      const hit = await c.match(AUDIO_KEY);
      if (!hit) return null;
      if ((hit.headers.get("Content-Type") || "").includes("json")) {
        const man = (await hit.json()) as Manifest;
        const out: QueueChunk[] = [];
        for (let i = 0; i < man.n; i++) {
          const r = await c.match(AUDIO_KEY + "/" + i); if (!r) return null;
          const u = URL.createObjectURL(await r.blob()); urlsRef.current.push(u);
          out.push({ text: man.texts[i] || "", url: u, duration: man.durations[i] });
        }
        return out;
      }
      const u = URL.createObjectURL(await hit.blob()); urlsRef.current.push(u);   // eski tek dosya
      return [{ text: lecture, url: u }];
    } catch { return null; }
  }

  async function playLecture(text = lecture, head = "") {
    if (!text) return;
    stopAudio();
    const myRun = ++runId.current;
    setAudioBusy(true); setLecErr(""); setAudioNote(""); setQuotaOut(false); setShowPlayer(true);
    try {
      const cached = await fromCache();
      if (runId.current !== myRun) return;
      if (cached) { setChunks(cached); setJobTotal(cached.length); setAudioBusy(false); return; }
      const job: JobState = await api(`/collections/${id}/lecture/tts`, {
        method: "POST",
        body: JSON.stringify({ text: text.slice(0, 12000), voice: voice || undefined, voice2: voice2 || undefined,
                               format: isDialogText(text) ? "dialog" : "solo", head: head || undefined }),
      }, 1);
      await followJob(job, myRun);
    } catch (e: any) {
      if (runId.current !== myRun) return;
      if (e?.quota || isUsageLimit(e) || e?.code === "AI_BUSY") setQuotaOut(true);
      setLecErr(String(e?.message || "") || "Seslendirme yapılamadı; biraz sonra tekrar dene.");
      setShowPlayer(false); setAudioBusy(false);
    }
  }

  async function followJob(first: JobState, myRun: number) {
    const jid = first.job_id;
    const total = first.total || first.texts.length;
    setJobTotal(total);
    const list: QueueChunk[] = first.texts.map((t) => ({ text: t }));
    setChunks([...list]);
    const fetched = new Set<number>();
    const blobs: (Blob | null)[] = new Array(total).fill(null);
    let st: JobState = first;
    const ac = new AbortController(); abortRef.current = ac;

    async function pull(n: number) {
      if (fetched.has(n)) return; fetched.add(n);
      const res = await fetch(`${API}/tts/jobs/${jid}/chunks/${n}`, { headers: { Authorization: "Bearer " + getToken() }, signal: ac.signal });
      if (!res.ok) { fetched.delete(n); return; }
      const b = await res.blob();
      if (b.size < 500) { fetched.delete(n); return; }
      if (runId.current !== myRun) return;
      blobs[n] = b;
      const u = URL.createObjectURL(b); urlsRef.current.push(u);
      list[n] = { text: list[n].text, url: u, duration: st.durations?.[String(n)] };
      setChunks([...list]);
      if (n === 0) setAudioBusy(false);
    }

    for (let i = 0; i < 600 && runId.current === myRun; i++) {
      for (const n of st.ready_chunks || []) await pull(n);
      setAudioNote(st.note || "");
      if (st.status === "error") {
        const err: any = new Error(st.error || "Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.");
        err.quota = !!st.quota; throw err;
      }
      if (st.status === "ready" && fetched.size >= total) break;
      await new Promise((r) => setTimeout(r, 2000));
      if (runId.current !== myRun) return;
      try { st = await api(`/tts/jobs/${jid}/chunks`); }
      catch (e: any) {
        if (e?.status === 404) { setJobLost(true); setAudioBusy(false); setAudioNote(""); return; }
        // geçici ağ hatası: yoklamaya devam
      }
    }
    if (runId.current !== myRun) return;
    setAudioBusy(false);
    // Tamamı hazır: cihaz önbelleğine yaz (ikinci dinleme ücretsiz, çevrimdışı)
    if (blobs.every((b) => !!b)) {
      try {
        if ("caches" in window) {
          const c = await caches.open("typdf-audio");
          for (let n = 0; n < total; n++) await c.put(AUDIO_KEY + "/" + n, new Response(blobs[n] as Blob, { headers: { "Content-Type": (blobs[n] as Blob).type || st.mime || "audio/mpeg" } }));
          const man: Manifest = { v: 2, n: total, texts: list.map((c) => c.text), durations: list.map((c) => c.duration || 0), mime: st.mime };
          await c.put(AUDIO_KEY, new Response(JSON.stringify(man), { headers: { "Content-Type": "application/json" } }));
          setAudioReady(true);
        }
      } catch {}
    }
  }

  function cancelAll() {
    stopAudio(); setLecBusy(false);
  }

  // ---- Ses örneği (H6: sunucuda sabit örnek, ilk dinleme 1 kullanım) --------------------------------
  const [sampling, setSampling] = useState("");
  const sampleRef = useRef<HTMLAudioElement | null>(null);
  async function sampleVoice(v: string) {
    setSampling(v); setLecErr("");
    const ac = new AbortController();
    const netTimer = setTimeout(() => ac.abort(), 40000);
    try {
      const res = await fetch(`${API}/tts/voices/${encodeURIComponent(v)}/sample`, { signal: ac.signal, headers: { Authorization: "Bearer " + getToken() } });
      if (!res.ok) {
        let m = "Örnek dinlenemedi; birazdan tekrar dene.";
        try { const j = await res.json(); if (typeof j?.error?.user_message === "string") m = j.error.user_message; } catch {}
        if (res.status === 429 || res.status === 503) setQuotaOut(true);
        throw new Error(m);
      }
      const blob = await res.blob();
      if (blob.size < 500) throw new Error("Ses boş geldi; tekrar dene.");
      const url = URL.createObjectURL(blob);
      try { sampleRef.current?.pause(); } catch {}
      const a = new Audio(url); sampleRef.current = a;
      a.onended = () => URL.revokeObjectURL(url);
      a.play().catch(() => setLecErr("Tarayıcı sesi engelledi; sayfaya bir kez dokunup tekrar dene."));
    } catch (e: any) {
      setLecErr(e?.name === "AbortError" ? "Örnek zaman aşımına uğradı; tekrar dene." : (e?.message || "Örnek dinlenemedi."));
    } finally { clearTimeout(netTimer); setSampling(""); }
  }
  useEffect(() => () => { try { sampleRef.current?.pause(); } catch {} }, []);

  const readyCount = chunks ? chunks.filter((c) => !!c.url).length : 0;
  const nextEta = chunks && jobTotal > readyCount ? Math.round(((chunks[readyCount]?.text.length || 2600) / 100) + 2) : undefined;

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-text-secondary">
        Bu defterdeki {readyN} hazır kaynağı tek bir sesli özete çeviririm; yolda dinlersin.
        Özeti hazırlamak 1, seslendirmek metin uzunluğuna göre birkaç yapay zekâ kullanımı harcar; hazır olan ses cihazında saklanır.
      </p>

      {/* Biçim: tek anlatıcı | sohbet */}
      <div role="radiogroup" aria-label="Özet biçimi" className="mt-3 inline-flex rounded-xl border p-0.5 text-sm">
        {([["solo", "Tek anlatıcı"], ["dialog", "Sohbet (Ayşe · Kerem)"]] as [Fmt, string][]).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={fmt === k} disabled={lecBusy}
                  onClick={() => { setFmt(k); try { localStorage.setItem("lecture.format", k); } catch {} stopAudio(); }}
                  className={"min-h-[40px] rounded-lg px-3 " + (fmt === k ? "bg-accent-purple text-white" : "hover:bg-black/5")}>
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-text-secondary">
        {fmt === "dialog" ? "Öğretmen Ayşe anlatır, meraklı öğrenci Kerem sorar; iki ayrı sesle. Seslendirme maliyeti aynı."
                          : "Tek bir anlatıcı, seçtiğin sesle."}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => { if (autoAudio) primeAudio(); void makeLecture(!!lecture); }} disabled={lecBusy} title={costTitle(1)}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm text-white disabled:opacity-60">
          {lecBusy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
          {lecBusy ? "Özet yazılıyor…" : !lecture ? "Özeti hazırla" : fmtMismatch ? (fmt === "dialog" ? "Sohbet olarak hazırla" : "Tek anlatıcıyla hazırla") : "Yeniden hazırla"}
          {!lecBusy && <Cost n={1} className="bg-white/20" />}
        </button>
        {lecture && !lecBusy && !showPlayer && (
          <button onClick={() => { primeAudio(); void playLecture(); }} disabled={audioBusy} title={audioReady ? "Ses cihazında hazır · ücretsiz" : costTitle(ttsParts)}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-xl border px-4 text-sm hover:bg-black/5 disabled:opacity-60">
            <Headphones size={15} />
            {audioReady ? "Dinle · hazır" : <>Dinle <Cost n={ttsParts} /></>}
          </button>
        )}
        {(lecBusy || audioBusy) && (
          <button onClick={cancelAll} className="flex min-h-[44px] items-center gap-1 rounded-xl border px-3 text-sm text-text-secondary hover:bg-black/5">
            <X size={14} /> Vazgeç
          </button>
        )}
      </div>
      <label className="mt-2 flex min-h-[40px] cursor-pointer items-center gap-2 text-xs text-text-secondary">
        <input type="checkbox" checked={autoAudio} onChange={(e) => { setAutoAudio(e.target.checked); try { localStorage.setItem("lecture.autoAudio", e.target.checked ? "1" : "0"); } catch {} }} />
        Metin yazılırken sesi de kendiliğinden hazırla {lecture && <Cost n={ttsParts} />}
        <span className="opacity-70">· ilk paragraflar gelir gelmez başlar, sen okurken ses hazır olur</span>
      </label>

      {lecture && voiceList.length > 0 && (
        <div className="mt-4 rounded-2xl border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{fmt === "dialog" ? "Ayşe'nin sesi (öğretmen)" : "Anlatıcı sesi"}</span>
            <span className="text-xs text-text-secondary">· kadın sesleri, doğal tonlama</span>
          </div>
          <div role="radiogroup" aria-label="Anlatıcı sesi" className="mt-3 flex flex-wrap gap-1.5">
            {voiceList.map((v) => (
              <button key={v.id} role="radio" aria-checked={voice === v.id}
                      onClick={() => { setVoice(v.id); try { localStorage.setItem("lecture.voice", v.id); } catch {} stopAudio(); }}
                      className={"min-h-[40px] rounded-xl border px-3 py-1.5 text-xs " +
                        (voice === v.id ? "border-accent-purple bg-accent-purple/10 font-semibold text-text-primary" : "hover:bg-black/5")}>
                {v.label}
              </button>
            ))}
          </div>
          {fmt === "dialog" && studentList.length > 0 && (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Kerem'in sesi (öğrenci)</span>
                <span className="text-xs text-text-secondary">· erkek sesleri</span>
              </div>
              <div role="radiogroup" aria-label="Öğrenci sesi" className="mt-3 flex flex-wrap gap-1.5">
                {studentList.map((v) => (
                  <button key={v.id} role="radio" aria-checked={voice2 === v.id}
                          onClick={() => { setVoice2(v.id); try { localStorage.setItem("lecture.voice2", v.id); } catch {} stopAudio(); }}
                          className={"min-h-[40px] rounded-xl border px-3 py-1.5 text-xs " +
                            (voice2 === v.id ? "border-accent-purple bg-accent-purple/10 font-semibold text-text-primary" : "hover:bg-black/5")}>
                    {v.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => sampleVoice(voice)} disabled={!voice || !!sampling} title={costTitle(1) + " (aynı örnek ikinci kez ücretsiz)"}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-60">
              {sampling ? <Loader2 size={13} className="animate-spin" /> : <Volume2 size={13} />}
              {sampling ? "Örnek hazırlanıyor…" : <>Bu sesi dinle <Cost n={1} /></>}
            </button>
            <span className="text-xs text-text-secondary">
              Sesi değiştirirsen özet o sesle yeniden seslendirilir; her ses ayrı saklanır.
            </span>
          </div>
        </div>
      )}

      {lecture && canSpeak && !useBrowserVoice && (
        <button onClick={() => { stopAudio(); setUseBrowserVoice(true); }}
                className="mt-3 min-h-[40px] text-xs text-text-secondary underline underline-offset-4 hover:text-text-primary">
          {audioBusy ? "Beklemeden cihazının sesiyle başla (ücretsiz, daha robotik)" : "Cihazının kendi sesiyle dinle (ücretsiz, daha robotik)"}
        </button>
      )}
      {lecBusy && headOn && (
        <p role="status" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent-purple/10 px-3 py-1 text-xs text-accent-purple">
          <Loader2 size={12} className="animate-spin" /> Metin yazılırken ilk ses parçası hazırlanıyor; metin bitince hemen dinleyebilirsin.
        </p>
      )}
      {lecNote && <p role="status" className="mt-3 text-sm text-text-secondary">{lecNote}</p>}
      {jobLost && (
        <div role="status" className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <p>Ses hazırlığı yarıda kaldı (sunucu yenilenmiş olabilir). Hazır olan parçalar saklandı; yeniden başlatınca hızlı tamamlanır.</p>
          <button onClick={() => { primeAudio(); void playLecture(); }} className="mt-2 flex min-h-[40px] items-center gap-1.5 rounded-lg bg-accent-purple px-3 text-white">
            <RefreshCw size={14} /> Yeniden başlat
          </button>
        </div>
      )}
      {lecErr && (
        <div role={quotaOut ? "status" : "alert"} className={"mt-3 rounded-xl px-4 py-3 text-sm " + (quotaOut ? "border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "")}>
          <p className={quotaOut ? "" : "text-danger"}>{lecErr}</p>
          {quotaOut && canSpeak && lecture && (
            <button onClick={() => { setLecErr(""); setUseBrowserVoice(true); }}
                    className="mt-2 flex min-h-[40px] items-center gap-1.5 rounded-lg bg-accent-purple px-3 text-white">
              <Volume2 size={14} /> Cihaz sesiyle dinle (ücretsiz)
            </button>
          )}
        </div>
      )}
      {useBrowserVoice && lecture && (
        <div className="mt-4"><BrowserVoice text={lecture} onClose={() => setUseBrowserVoice(false)} /></div>
      )}

      {showPlayer && chunks && (
        <div className="mt-4">
          <AudioQueuePlayer chunks={chunks} total={jobTotal || chunks.length} title={title}
                            subtitle={`Sesli özet · ${readyN} kaynak${dialogAudio ? " · Ayşe & Kerem" : ""}`}
                            artwork="/icon" storageKey={"lecture.pos." + id} autoPlay
                            note={audioNote || undefined} preparingEta={nextEta} />
          <p className="mt-2 text-xs text-text-secondary">
            Ekran kilitliyken kulaklık/bildirim tuşlarıyla kontrol edebilirsin. Kaldığın yer hatırlanır; tamamlanan ses cihazda saklanır, tekrar hazırlanmaz.
            Çalan cümle metinde vurgulanır; bir cümleye dokununca oraya atlar.
          </p>
        </div>
      )}
      {showPlayer && !chunks && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" /> Ses işi başlatılıyor…</p>
      )}

      {lecture && (
        <details className="mt-4 rounded-2xl border bg-surface p-4" open={!showPlayer}>
          <summary className="cursor-pointer text-sm font-medium">Özet metni{lecBusy ? " (yazılıyor…)" : ""}</summary>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
            {lectureIsDialog
              ? lecture.split("\n").filter((l) => l.trim()).map((l, i) => {
                  const m = l.match(SPEAKER_LINE);
                  return <p key={i} className="mb-2">{m && <span className="mr-1 font-semibold text-accent-purple">{m[1]}:</span>}{m ? l.slice(m[0].length).trim() : l}</p>;
                })
              : lecture}
            {lecBusy && <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded bg-accent-purple align-middle" aria-hidden />}
          </div>
        </details>
      )}
    </div>
  );
}
