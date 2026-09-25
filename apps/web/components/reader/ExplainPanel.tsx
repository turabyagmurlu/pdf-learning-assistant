"use client";
/**
 * Okuyucu "Anlat" paneli: acik sayfayi sade dille anlatir ve sesli okur.
 * Sesli okuma:
 *  - kisa metin (<= 2600 karakter, sunucudaki tek parca siniri) dogrudan /tts;
 *  - daha uzun metin /tts/jobs is kuyrugu (parca parca, ilerleme yuzdeli);
 *  - basarisizlikta "Cihaz sesiyle dinle" (BrowserVoice, ucretsiz) yedegi.
 */
import { useEffect, useRef, useState } from "react";
import { api, API, getToken } from "@/lib/api";
import BrowserVoice, { browserVoiceSupported } from "@/components/BrowserVoice";
import { Sparkles, Play, Pause, Square, Volume2, Loader2, RotateCcw } from "lucide-react";

type Voice = { id: string; label: string };
const DIRECT_MAX = 2600;           // api/study.py /tts siniri ile ayni
const CHUNK = 2600;                // tts_service.split_for_tts parca boyu (maliyet tahmini)

/** Seslendirme hatasi: kullaniciya gosterilecek metin + hata turu. */
class TtsError extends Error {
  kind: "limit" | "daily" | "busy" | "timeout" | "offline" | "other";
  constructor(msg: string, kind: TtsError["kind"] = "other") { super(msg); this.kind = kind; }
}

async function readErr(res: Response): Promise<TtsError> {
  let code: string | undefined, msg: string | undefined;
  try { const j = await res.json(); code = j?.error?.code; msg = typeof j?.error?.user_message === "string" ? j.error.user_message : undefined; } catch {}
  if (code === "USAGE_LIMIT" || (!code && res.status === 429)) {
    return new TtsError(msg || "Bugünkü yapay zekâ kullanımın doldu. Şimdilik cihaz sesiyle dinleyebilirsin.", "limit");
  }
  if (code === "AI_BUSY" || res.status === 503) return new TtsError("Seslendirme şu an yoğun; birazdan tekrar dene ya da cihaz sesiyle dinle.", "busy");
  return new TtsError(msg || "Seslendirme şu an yapılamadı.", "other");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ExplainPanel({
  documentId, page, getPageText,
}: {
  documentId: string;
  page: number;
  getPageText: (n: number) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [explainedPage, setExplainedPage] = useState<number | null>(null);

  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("Sulafat");
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPct, setAudioPct] = useState<number | null>(null);
  const [audioNote, setAudioNote] = useState("");
  const [audioErr, setAudioErr] = useState("");
  const [deviceVoice, setDeviceVoice] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string>("");
  const alive = useRef(true);
  const runId = useRef(0);

  // ses listesini yukle
  useEffect(() => {
    (async () => {
      try {
        const r = await api("/tts/voices");
        if (r?.voices?.length) {
          setVoices(r.voices);
          let pick = r.default || r.voices[0].id;
          try {
            const saved = localStorage.getItem("reader.voiceId");
            if (saved && r.voices.some((v: Voice) => v.id === saved)) pick = saved;
          } catch {}
          setVoice(pick);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => { try { localStorage.setItem("reader.voiceId", voice); } catch {} }, [voice]);
  useEffect(() => { try { const s = parseFloat(localStorage.getItem("reader.rate") || ""); if (!isNaN(s)) setRate(s); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem("reader.rate", String(rate)); } catch {} }, [rate]);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);

  function stopAudio() {
    runId.current++;                  // suren is kuyrugu beklemesini birak
    try {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ""; }
    } catch {}
    audioRef.current = null;
    setPlaying(false); setPaused(false);
  }

  // sayfadan cikinca sesi durdur
  useEffect(() => { alive.current = true; return () => { alive.current = false; stopAudio(); }; }, []);

  async function explain() {
    setErr(""); setAudioErr(""); setDeviceVoice(false); setBusy(true); stopAudio();
    try {
      const pageText = (getPageText(page) || "").trim();
      const r = await api(`/documents/${documentId}/explain-page`, {
        method: "POST",
        body: JSON.stringify({ text: pageText.slice(0, 8000), page }),
      }, 1);
      setText(r.explanation || "");
      setExplainedPage(page);
    } catch (e: any) {
      if (e?.code === "USAGE_LIMIT" || e?.status === 429) setErr(e?.message || "Bugünkü yapay zekâ kullanımın doldu.");
      else if (e?.code === "AI_BUSY") setErr("Yapay zekâ şu an yoğun; birkaç dakika sonra tekrar dene.");
      else if (typeof navigator !== "undefined" && navigator.onLine === false) setErr("İnternet bağlantın yok. Bağlanınca tekrar dene.");
      else setErr(e?.message || "Anlatım hazırlanamadı; birazdan tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  /** Kisa metin: tek istekte WAV. */
  async function directTts(t: string): Promise<Blob> {
    const res = await fetch(`${API}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
      body: JSON.stringify({ text: t, voice }),
    });
    if (!res.ok) throw await readErr(res);
    return res.blob();
  }

  /** Uzun metin: is kuyrugu (defterdeki "Sesli özet" ile ayni akis). */
  async function jobTts(t: string, my: number): Promise<Blob> {
    let job: any;
    try {
      job = await api("/tts/jobs", { method: "POST", body: JSON.stringify({ text: t.slice(0, 12000), voice }) }, 1);
    } catch (e: any) {
      if (e?.code === "USAGE_LIMIT" || e?.status === 429) throw new TtsError(e?.message || "Bugünkü yapay zekâ kullanımın doldu.", "limit");
      throw new TtsError(e?.message || "Seslendirme şu an yapılamadı.");
    }
    const jid = job.job_id;
    let st: any = job.cached ? { status: "ready", done: job.total, total: job.total } : null;
    setAudioPct(0);
    for (let i = 0; i < 240 && (!st || st.status === "running"); i++) {   // bekleme dahil ~8 dk
      await sleep(2000);
      if (!alive.current || runId.current !== my) throw new TtsError("", "other");
      try { st = await api(`/tts/jobs/${jid}`, {}, 1); }
      catch (e: any) {
        if (e?.status === 404) throw new TtsError("Ses hazırlığı yarıda kaldı. \"Sesli oku\"ya yeniden bas.");
        continue;                       // gecici ag hatasi: bir sonraki turda tekrar sor
      }
      if (st.total) setAudioPct(Math.round((st.done / st.total) * 100));
      setAudioNote(st.note || "");
      if (st.status === "ready") break;
      if (st.status === "error") {
        if (st.daily) throw new TtsError("Seslendirme bugünlük doldu, yarın yeniden açılır. Şimdilik cihaz sesiyle dinleyebilirsin.", "daily");
        if (st.quota) throw new TtsError("Seslendirme şu an yoğun; birazdan tekrar dene ya da cihaz sesiyle dinle.", "busy");
        throw new TtsError(st.error || "Seslendirme şu an yapılamadı.");
      }
    }
    if (!st || st.status !== "ready") throw new TtsError("Seslendirme beklenenden uzun sürdü.", "timeout");
    const res = await fetch(`${API}/tts/jobs/${jid}/audio`, { headers: { Authorization: "Bearer " + getToken() } });
    if (!res.ok) throw await readErr(res);
    return res.blob();
  }

  async function speak() {
    if (!text) return;
    setAudioErr(""); setDeviceVoice(false); stopAudio();
    const my = ++runId.current;
    setAudioBusy(true); setAudioPct(null); setAudioNote("");
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new TtsError("İnternet bağlantın yok. Cihaz sesiyle dinleyebilirsin.", "offline");
      const blob = text.length <= DIRECT_MAX ? await directTts(text) : await jobTts(text, my);
      if (!alive.current || runId.current !== my) return;
      if (blob.size < 1000) throw new TtsError("Ses boş geldi; tekrar dene.");
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const a = new Audio(url);
      a.playbackRate = rate;
      a.onended = () => { setPlaying(false); setPaused(false); };
      a.onerror = () => { setPlaying(false); setPaused(false); };
      audioRef.current = a;
      try { await a.play(); setPlaying(true); setPaused(false); }
      catch { setPaused(true); setAudioErr("Tarayıcı sesi otomatik başlatmadı; \"Devam\"a bas."); }
    } catch (e: any) {
      if (!alive.current || runId.current !== my) return;
      const msg = e instanceof TtsError ? e.message : "";
      if (msg) setAudioErr(msg);
      else if (!(e instanceof TtsError)) setAudioErr("Seslendirme şu an yapılamadı.");
    } finally {
      if (alive.current && runId.current === my) { setAudioBusy(false); setAudioPct(null); setAudioNote(""); }
    }
  }

  function toggle() {
    const a = audioRef.current;
    if (!a || !urlRef.current) { speak(); return; }
    if (a.paused) { a.play().catch(() => {}); setPaused(false); setPlaying(true); setAudioErr(""); }
    else { a.pause(); setPaused(true); }
  }

  const stale = explainedPage !== null && explainedPage !== page;
  const cost = Math.max(1, Math.ceil(text.length / CHUNK));
  const canDevice = browserVoiceSupported();
  const long = text.length > DIRECT_MAX;

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <button
        type="button"
        onClick={explain}
        disabled={busy}
        title="Yapay zekâ kullanımından 1 düşer"
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-accent-purple px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
        {busy ? "Hazırlanıyor…" : `Bu sayfayı anlat (s.${page})`}
        {!busy && <span aria-hidden className="ml-1 rounded bg-white/20 px-1.5 text-xs">⚡1</span>}
        <span className="sr-only">, yapay zekâ kullanımından 1 düşer</span>
      </button>

      {stale && !busy && (
        <p className="mt-2 text-center text-xs text-text-secondary">
          Sayfa {explainedPage} anlatıldı. Yeni sayfa için tekrar bas.
        </p>
      )}
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}

      {text && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              disabled={audioBusy}
              title={playing || paused ? undefined : `Yapay zekâ kullanımından ${cost} düşer (daha önce seslendirildiyse ücretsiz)`}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-black/5 disabled:opacity-60"
            >
              {audioBusy ? <Loader2 size={15} className="animate-spin" aria-hidden />
                : playing && !paused ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
              {audioBusy ? `Ses hazırlanıyor…${audioPct !== null ? ` %${audioPct}` : ""}`
                : playing && !paused ? "Duraklat" : paused ? "Devam" : "Sesli oku"}
              {!audioBusy && !playing && !paused && (
                <>
                  <span aria-hidden className="text-xs text-text-secondary">⚡{cost}</span>
                  <span className="sr-only">, yapay zekâ kullanımından {cost} düşer</span>
                </>
              )}
            </button>
            {(playing || paused) && (
              <button type="button" onClick={stopAudio} className="flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-black/5">
                <Square size={14} aria-hidden /> Durdur
              </button>
            )}
            {canDevice && !audioBusy && !playing && !paused && !deviceVoice && (
              <button type="button" onClick={() => { stopAudio(); setDeviceVoice(true); }}
                      className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm text-text-secondary hover:bg-black/5"
                      title="Tarayıcının kendi sesiyle, ücretsiz">
                <Volume2 size={15} aria-hidden /> Cihaz sesiyle dinle
              </button>
            )}
          </div>

          <div aria-live="polite" className="mt-1 min-h-[1rem] text-xs text-text-secondary">
            {audioBusy && (audioNote
              ? audioNote
              : long ? "Anlatım uzun olduğu için parça parça seslendiriliyor; birkaç saniye sürebilir." : "")}
          </div>

          {audioErr && (
            <div role="alert" className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              <p>{audioErr}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={speak}
                        className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-current/30 px-3 text-sm">
                  <RotateCcw size={14} aria-hidden /> Tekrar dene
                </button>
                {canDevice && (
                  <button type="button" onClick={() => { setAudioErr(""); setDeviceVoice(true); }}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-accent-purple px-3 text-sm text-white">
                    <Volume2 size={14} aria-hidden /> Cihaz sesiyle dinle
                  </button>
                )}
              </div>
            </div>
          )}

          {deviceVoice && (
            <div className="mt-3">
              <BrowserVoice key={text} text={text} onClose={() => setDeviceVoice(false)} />
            </div>
          )}

          <div className="mt-3 space-y-2 rounded-xl border bg-surface-muted p-3">
            <label htmlFor="explain-voice" className="flex items-center gap-2 text-xs text-text-secondary">
              <Volume2 size={14} aria-hidden /> Anlatıcı sesi
            </label>
            <select
              id="explain-voice"
              value={voice}
              onChange={(e) => { setVoice(e.target.value); stopAudio(); }}
              className="h-10 w-full rounded-lg border bg-surface px-2 text-sm outline-none"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>{v.label} ({v.id})</option>
              ))}
            </select>
            <p className="text-xs text-text-secondary">
              Ses yapay zekâ ile üretilir; ilk okumada birkaç saniye sürebilir. Aynı metin ikinci kez ücretsiz okunur.
            </p>

            <label htmlFor="explain-rate" className="mt-1 block text-xs text-text-secondary">Hız: {rate.toFixed(2)}x</label>
            <input
              id="explain-rate"
              type="range" min={0.7} max={1.5} step={0.05} value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="h-10 w-full accent-accent-purple"
            />
            <button
              type="button"
              onClick={speak}
              disabled={audioBusy || !text}
              className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-xs text-text-secondary hover:bg-black/5 disabled:opacity-50"
            >
              Bu sesle yeniden oku
            </button>
          </div>

          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        </>
      )}

      {!text && !busy && !err && (
        <p className="mt-6 text-center text-sm text-text-secondary">
          Açık olan sayfayı sade dille anlatır, istersen doğal bir sesle okur.
        </p>
      )}
    </div>
  );
}
