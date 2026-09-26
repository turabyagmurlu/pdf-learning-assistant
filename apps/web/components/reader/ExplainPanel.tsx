"use client";
/**
 * Okuyucu "Anlat" paneli: acik sayfayi sade dille anlatir ve sesli okur.
 *
 * Ses akisi (S1):
 *  - Anlatim metni gelir gelmez ses ARKA PLANDA hazirlanir (on uretim, H1); kullanici
 *    "Sesli oku"ya bastiginda hazirsa aninda calar, degilse gercek ilerleme gosterir.
 *  - "Sesli oku" tiklamasinda ses nesnesi ESZAMANLI yaratilip sessiz bir kayitla kilidi acilir
 *    (H3, iOS/Android otomatik calma kurali); ses gelince ayni nesneye kaynak atanir.
 *  - Bekleme durustce: tahmini sure (metin uzunlugundan, olcumle kalibre), gercek ilerleme,
 *    Iptal, her zaman gorunur "Beklemeden cihaz sesiyle dinle", zaman asimi (H2).
 *  - Ayni sayfaya ikinci "Anlat" sunucudaki kayitli anlatimdan gelir: 0 kullanim (H5).
 *  - Seslendirme dolu/yogun iken dugme dogrudan cihaz sesine yonlendirir (H8).
 *  - Ses MP3 olarak iner (WAV'in 6'da biri, M2); sunucu gerekirse WAV'a duser.
 *  - kisa metin (<= 2600 karakter, sunucudaki tek parca siniri) dogrudan /tts;
 *    daha uzun metin /tts/jobs is kuyrugu (parca parca, ilerleme yuzdeli);
 *    basarisizlikta "Cihaz sesiyle dinle" (BrowserVoice, ucretsiz) yedegi.
 */
import { useEffect, useRef, useState } from "react";
import { api, API, getToken } from "@/lib/api";
import BrowserVoice, { browserVoiceSupported } from "@/components/BrowserVoice";
import { Sparkles, Play, Pause, Square, Volume2, Loader2, RotateCcw, X, Check } from "lucide-react";

type Voice = { id: string; label: string };
type TtsState = { state: "aktif" | "yogun" | "doldu"; retry_min: number | null };
const DIRECT_MAX = 2600;           // api/study.py /tts siniri ile ayni
const CHUNK = 2600;                // tts_service.split_for_tts parca boyu (maliyet tahmini)
const DIRECT_TIMEOUT_MS = 90_000;  // tek parca: 90 sn
const JOB_TIMEOUT_MS = 6 * 60_000; // is kuyrugu: 6 dk
const CALIB_KEY = "reader.ttsSecPer100";

/** 20 ms'lik sessiz WAV: tiklama aninda calinip ses nesnesinin kilidini acar (iOS). */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

/** Seslendirme hatasi: kullaniciya gosterilecek metin + hata turu. */
class TtsError extends Error {
  kind: "limit" | "daily" | "busy" | "timeout" | "offline" | "cancel" | "other";
  constructor(msg: string, kind: TtsError["kind"] = "other") { super(msg); this.kind = kind; }
}

async function readErr(res: Response): Promise<TtsError> {
  let code: string | undefined, msg: string | undefined;
  try { const j = await res.json(); code = j?.error?.code; msg = typeof j?.error?.user_message === "string" ? j.error.user_message : undefined; } catch {}
  if (code === "USAGE_LIMIT") {
    return new TtsError(msg || "Bugünkü yapay zekâ kullanımın doldu. Şimdilik cihaz sesiyle dinleyebilirsin.", "limit");
  }
  if (code === "TTS_QUOTA" || res.status === 429) {
    return new TtsError(msg || "Seslendirme şu an yoğun; birazdan tekrar dene ya da cihaz sesiyle dinle.", msg && /bugünlük/i.test(msg) ? "daily" : "busy");
  }
  if (code === "AI_BUSY" || code === "TTS_BUSY" || res.status === 503) return new TtsError(msg || "Seslendirme şu an yoğun; birazdan tekrar dene ya da cihaz sesiyle dinle.", "busy");
  return new TtsError(msg || "Seslendirme şu an yapılamadı.", "other");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadCalib(): number {
  try { const v = parseFloat(localStorage.getItem(CALIB_KEY) || ""); if (!isNaN(v) && v > 0.2 && v < 6) return v; } catch {}
  return 1.0;                        // ~1 sn / 100 karakter (analizdeki olcum)
}
function estimateSec(chars: number, secPer100: number): number {
  return Math.max(3, Math.round((chars / 100) * secPer100) + 2);
}
function fmtSec(s: number): string {
  if (s < 60) return `${s} sn`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} dk ${r} sn` : `${m} dk`;
}

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
  const [textCached, setTextCached] = useState(false);

  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("Sulafat");
  const [ttsState, setTtsState] = useState<TtsState>({ state: "aktif", retry_min: null });

  // On uretim / hazirlik durumu
  const [prep, setPrep] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [prepPct, setPrepPct] = useState<number | null>(null);
  const [prepNote, setPrepNote] = useState("");
  const [prepEta, setPrepEta] = useState(0);
  const [prepElapsed, setPrepElapsed] = useState(0);
  const [prepWaitUntil, setPrepWaitUntil] = useState(0);
  const [audioErr, setAudioErr] = useState("");
  const [wantPlay, setWantPlay] = useState(false);

  const [deviceVoice, setDeviceVoice] = useState(false);
  const [deviceAuto, setDeviceAuto] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobRef = useRef<{ key: string; url: string; blob: Blob } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wantPlayRef = useRef(false);
  const calibRef = useRef(1.0);
  const alive = useRef(true);
  const runId = useRef(0);
  const prepStartRef = useRef(0);
  const prepKeyRef = useRef("");     // suren hazirligin ses+metin anahtari

  // ses listesini + seslendirme durumunu yukle
  async function loadVoices() {
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
      if (r?.state?.state) setTtsState({ state: r.state.state, retry_min: r.state.retry_min ?? null });
    } catch {}
  }
  useEffect(() => { calibRef.current = loadCalib(); loadVoices(); }, []);

  useEffect(() => { try { localStorage.setItem("reader.voiceId", voice); } catch {} }, [voice]);
  useEffect(() => { try { const s = parseFloat(localStorage.getItem("reader.rate") || ""); if (!isNaN(s)) setRate(s); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem("reader.rate", String(rate)); } catch {} }, [rate]);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);

  // Hazirlik sayaci: gecen sure (ve kota beklemesinde geri sayim) her saniye
  useEffect(() => {
    if (prep !== "loading") return;
    const t = setInterval(() => setPrepElapsed(Math.round((Date.now() - prepStartRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [prep]);

  function releaseBlob() {
    if (blobRef.current) { try { URL.revokeObjectURL(blobRef.current.url); } catch {} blobRef.current = null; }
  }

  function stopAudio() {
    try {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.removeAttribute("src"); audioRef.current.load(); }
    } catch {}
    audioRef.current = null;
    setPlaying(false); setPaused(false);
  }

  /** Suren hazirligi (on uretim ya da tiklamayla baslayan) iptal eder. */
  function cancelPrep() {
    runId.current++;
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;
    wantPlayRef.current = false; setWantPlay(false);
    setPrep((p) => (p === "loading" ? "idle" : p));
    setPrepPct(null); setPrepNote(""); setPrepWaitUntil(0);
  }

  // panelden cikinca sesi ve hazirligi durdur
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cancelPrep(); stopAudio(); releaseBlob(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ttsOff = ttsState.state !== "aktif";

  async function explain(force = false) {
    setErr(""); setAudioErr(""); setDeviceVoice(false); setDeviceAuto(false); setBusy(true);
    cancelPrep(); stopAudio(); releaseBlob(); setPrep("idle");
    try {
      const pageText = (getPageText(page) || "").trim();
      const r = await api(`/documents/${documentId}/explain-page`, {
        method: "POST",
        body: JSON.stringify({ text: pageText.slice(0, 8000), page, force }),
      }, 1);
      const t = String(r.explanation || "");
      setText(t);
      setTextCached(!!r.cached);
      setExplainedPage(page);
      // H1: metin gelir gelmez sesi arka planda hazirla (dolu iken bosuna deneme)
      if (t && !ttsOff) void prepare(t, voice);
    } catch (e: any) {
      if (e?.code === "USAGE_LIMIT" || e?.status === 429) setErr(e?.message || "Bugünkü yapay zekâ kullanımın doldu.");
      else if (e?.code === "AI_BUSY") setErr("Yapay zekâ şu an yoğun; birkaç dakika sonra tekrar dene.");
      else if (typeof navigator !== "undefined" && navigator.onLine === false) setErr("İnternet bağlantın yok. Bağlanınca tekrar dene.");
      else setErr(e?.message || "Anlatım hazırlanamadı; birazdan tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  /** Kisa metin: tek istekte MP3 (sunucu gerekirse WAV verir). 90 sn zaman asimi. */
  async function directTts(t: string, v: string, my: number): Promise<Blob> {
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => ac.abort(), DIRECT_TIMEOUT_MS);
    try {
      const res = await fetch(`${API}/tts?fmt=mp3`, {
        method: "POST", signal: ac.signal,
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg, audio/wav", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({ text: t, voice: v, fmt: "mp3" }),
      });
      if (!res.ok) throw await readErr(res);
      return await res.blob();
    } catch (e: any) {
      if (e?.name === "AbortError") {
        if (runId.current !== my) throw new TtsError("", "cancel");
        throw new TtsError("Ses hazırlığı beklenenden uzun sürdü. Tekrar dene ya da cihaz sesiyle dinle.", "timeout");
      }
      throw e;
    } finally { clearTimeout(timer); if (abortRef.current === ac) abortRef.current = null; }
  }

  /** Uzun metin: is kuyrugu (defterdeki "Sesli özet" ile ayni akis). Toplam 6 dk zaman asimi. */
  async function jobTts(t: string, v: string, my: number): Promise<Blob> {
    let job: any;
    try {
      job = await api("/tts/jobs", { method: "POST", body: JSON.stringify({ text: t.slice(0, 12000), voice: v }) }, 1);
    } catch (e: any) {
      if (e?.code === "USAGE_LIMIT" || e?.status === 429) throw new TtsError(e?.message || "Bugünkü yapay zekâ kullanımın doldu.", "limit");
      throw new TtsError(e?.message || "Seslendirme şu an yapılamadı.");
    }
    const jid = job.job_id;
    let st: any = job.cached ? { status: "ready", done: job.total, total: job.total } : null;
    if (typeof job.eta_sec === "number" && job.eta_sec > 0) setPrepEta(Math.round(job.eta_sec * calibRef.current));
    setPrepPct(0);
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    while ((!st || st.status === "running") && Date.now() < deadline) {
      await sleep(2000);
      if (!alive.current || runId.current !== my) throw new TtsError("", "cancel");
      try { st = await api(`/tts/jobs/${jid}`, {}, 1); }
      catch (e: any) {
        if (e?.status === 404) throw new TtsError("Ses hazırlığı yarıda kaldı. \"Sesli oku\"ya yeniden bas.");
        continue;                       // gecici ag hatasi: bir sonraki turda tekrar sor
      }
      if (st.total) setPrepPct(Math.round((st.done / st.total) * 100));
      setPrepNote(st.note || "");
      setPrepWaitUntil(st.waiting ? Date.now() + st.waiting * 1000 : 0);
      if (st.status === "ready") break;
      if (st.status === "error") {
        if (st.daily) throw new TtsError("Seslendirme bugünlük doldu, yarın yeniden açılır. Şimdilik cihaz sesiyle dinleyebilirsin.", "daily");
        if (st.quota) throw new TtsError("Seslendirme şu an yoğun; birazdan tekrar dene ya da cihaz sesiyle dinle.", "busy");
        throw new TtsError(st.error || "Seslendirme şu an yapılamadı.");
      }
    }
    if (!st || st.status !== "ready") throw new TtsError("Ses hazırlığı beklenenden uzun sürdü. Tekrar dene ya da cihaz sesiyle dinle.", "timeout");
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => ac.abort(), DIRECT_TIMEOUT_MS);
    try {
      const res = await fetch(`${API}/tts/jobs/${jid}/audio?fmt=mp3`, {
        signal: ac.signal, headers: { Accept: "audio/mpeg, audio/wav", Authorization: "Bearer " + getToken() },
      });
      if (!res.ok) throw await readErr(res);
      return await res.blob();
    } catch (e: any) {
      if (e?.name === "AbortError") {
        if (runId.current !== my) throw new TtsError("", "cancel");
        throw new TtsError("Ses indirilemedi; bağlantın yavaş olabilir. Tekrar dene ya da cihaz sesiyle dinle.", "timeout");
      }
      throw e;
    } finally { clearTimeout(timer); if (abortRef.current === ac) abortRef.current = null; }
  }

  /** Sesi hazirlar (arka planda ya da tiklamayla). Hazir olunca blobRef'e koyar; istenmisse calar. */
  async function prepare(t: string, v: string) {
    if (!t) return;
    cancelPrep();
    const my = ++runId.current;
    const key = v + "\n" + t;
    if (blobRef.current && blobRef.current.key === key) { setPrep("ready"); return; }
    releaseBlob();
    prepKeyRef.current = key;
    setAudioErr(""); setPrep("loading"); setPrepPct(null); setPrepNote(""); setPrepWaitUntil(0);
    setPrepEta(estimateSec(t.length, calibRef.current)); setPrepElapsed(0);
    prepStartRef.current = Date.now();
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new TtsError("İnternet bağlantın yok. Cihaz sesiyle dinleyebilirsin.", "offline");
      const blob = t.length <= DIRECT_MAX ? await directTts(t, v, my) : await jobTts(t, v, my);
      if (!alive.current || runId.current !== my) return;
      if (blob.size < 1000) throw new TtsError("Ses boş geldi; tekrar dene.");
      // Kalibrasyon: onbellekten gelmediyse (>1,5 sn) olculen hizi hatirla (~sn / 100 karakter)
      const took = (Date.now() - prepStartRef.current) / 1000;
      if (took > 1.5 && t.length <= DIRECT_MAX) {
        const measured = took / (t.length / 100);
        const next = Math.min(6, Math.max(0.2, calibRef.current * 0.6 + measured * 0.4));
        calibRef.current = next;
        try { localStorage.setItem(CALIB_KEY, next.toFixed(2)); } catch {}
      }
      blobRef.current = { key, url: URL.createObjectURL(blob), blob };
      setPrep("ready");
      if (wantPlayRef.current) { wantPlayRef.current = false; setWantPlay(false); playPrepared(); }
    } catch (e: any) {
      if (!alive.current || runId.current !== my) return;
      if (e instanceof TtsError && e.kind === "cancel") { setPrep("idle"); return; }
      setPrep("error");
      const msg = e instanceof TtsError ? e.message : "";
      setAudioErr(msg || "Seslendirme şu an yapılamadı.");
      if (e instanceof TtsError && (e.kind === "daily" || e.kind === "busy" || e.kind === "limit")) void loadVoices();
      // Kullanici zaten "cal" demisti: bekletme, cihaz sesine gec
      if (wantPlayRef.current && canDevice) { wantPlayRef.current = false; setWantPlay(false); setDeviceAuto(true); setDeviceVoice(true); }
    } finally {
      if (alive.current && runId.current === my) { setPrepPct(null); setPrepNote(""); setPrepWaitUntil(0); }
    }
  }

  /** Tiklama aninda (eszamanli) ses nesnesini yaratir ve sessiz kayitla kilidini acar (iOS). */
  function ensureUnlockedAudio(): HTMLAudioElement {
    let a = audioRef.current;
    if (!a) {
      a = new Audio();
      a.preload = "auto";
      a.onended = () => { setPlaying(false); setPaused(false); };
      a.onerror = () => { setPlaying(false); setPaused(false); };
      audioRef.current = a;
    }
    try { a.src = SILENT_WAV; a.play().catch(() => {}); } catch {}
    return a;
  }

  /** Hazir sesi (blobRef) mevcut ses nesnesinde calar. */
  function playPrepared() {
    const b = blobRef.current;
    if (!b) return;
    const a = audioRef.current || ensureUnlockedAudio();
    a.src = b.url;
    a.playbackRate = rate;
    setDeviceVoice(false);
    a.play().then(() => { setPlaying(true); setPaused(false); setAudioErr(""); })
      .catch(() => { setPaused(true); setPlaying(false); setAudioErr("Tarayıcı sesi otomatik başlatmadı; \"Devam\"a bas."); });
  }

  /** "Sesli oku": hazirsa aninda cal; degilse kilidi ac, hazirligi baslat, hazir olunca cal. */
  function speak() {
    if (!text) return;
    setAudioErr(""); setDeviceVoice(false); setDeviceAuto(false);
    const key = voice + "\n" + text;
    ensureUnlockedAudio();
    if (blobRef.current && blobRef.current.key === key) { playPrepared(); return; }
    if (prep === "loading" && prepKeyRef.current === key) { wantPlayRef.current = true; setWantPlay(true); return; }
    void prepare(text, voice);          // prepare() once cancelPrep() cagirir; istek bayragini sonra koy
    wantPlayRef.current = true; setWantPlay(true);
  }

  function toggle() {
    const a = audioRef.current;
    if (!a || !blobRef.current || a.src !== blobRef.current.url) { speak(); return; }
    if (a.paused) { a.play().catch(() => {}); setPaused(false); setPlaying(true); setAudioErr(""); }
    else { a.pause(); setPaused(true); }
  }

  function stopPlayback() { stopAudio(); }

  function startDevice() {
    stopAudio(); setAudioErr(""); setDeviceAuto(true); setDeviceVoice(true);
  }

  const stale = explainedPage !== null && explainedPage !== page;
  const cost = Math.max(1, Math.ceil(text.length / CHUNK));
  const canDevice = browserVoiceSupported();
  const long = text.length > DIRECT_MAX;
  const readyKey = voice + "\n" + text;
  const audioReady = prep === "ready" && !!blobRef.current && blobRef.current.key === readyKey;
  const loading = prep === "loading";
  const samePage = explainedPage === page && !!text;
  const waitLeft = prepWaitUntil ? Math.max(0, Math.round((prepWaitUntil - Date.now()) / 1000)) : 0;
  const pctShown = prepPct !== null ? prepPct : Math.min(95, Math.round((prepElapsed / Math.max(1, prepEta)) * 100));
  const ttsOffLabel = ttsState.state === "doldu"
    ? `Anlatıcı sesi bugünlük dolu${ttsState.retry_min ? `, ~${ttsState.retry_min >= 60 ? Math.round(ttsState.retry_min / 60) + " sa" : ttsState.retry_min + " dk"}` : ""} · cihaz sesiyle dinle`
    : `Anlatıcı sesi yoğun${ttsState.retry_min ? `, ~${ttsState.retry_min} dk` : ""} · cihaz sesiyle dinle`;

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <button
        type="button"
        onClick={() => explain(samePage)}
        disabled={busy}
        title={samePage ? "Yeniden üretir; yapay zekâ kullanımından 1 düşer" : ttsOff ? "Yapay zekâ kullanımından 1 düşer" : "Anlatım 1 + ses 1: yapay zekâ kullanımından 2 düşer (kayıtlıysa ücretsiz)"}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-accent-purple px-4 py-2.5 text-sm font-medium text-on-accent disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : samePage ? <RotateCcw size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />}
        {busy ? "Hazırlanıyor…" : samePage ? `Yeniden anlat (s.${page})` : `Bu sayfayı anlat (s.${page})`}
        {!busy && (
          <span aria-hidden className="ml-1 rounded bg-white/20 px-1.5 text-xs">
            {samePage || ttsOff ? "⚡1" : "⚡1 anlat + ⚡1 ses"}
          </span>
        )}
        <span className="sr-only">
          {samePage || ttsOff ? ", yapay zekâ kullanımından 1 düşer" : ", anlatım için 1, ses için 1 kullanım düşer; kayıtlıysa ücretsiz"}
        </span>
      </button>

      {stale && !busy && (
        <p className="mt-2 text-center text-xs text-text-secondary">
          Sayfa {explainedPage} anlatıldı. Yeni sayfa için tekrar bas.
        </p>
      )}
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}

      {text && (
        <>
          {textCached && !busy && (
            <p className="mt-2 flex items-center gap-1 text-xs text-text-secondary">
              <Check size={13} aria-hidden /> Kayıtlı anlatım · ücretsiz (yeniden üretmek için &quot;Yeniden anlat&quot;)
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {ttsOff && !playing && !paused && !audioReady ? (
              <button
                type="button"
                onClick={startDevice}
                disabled={!canDevice}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-surface-hover disabled:opacity-60"
              >
                <Volume2 size={15} aria-hidden /> {ttsOffLabel}
              </button>
            ) : (
              <button
                type="button"
                onClick={toggle}
                disabled={loading && wantPlay}
                title={playing || paused ? undefined : audioReady ? "Ses hazır; ücretsiz" : `Yapay zekâ kullanımından ${cost} düşer (daha önce seslendirildiyse ücretsiz)`}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-surface-hover disabled:opacity-60"
              >
                {loading && wantPlay ? <Loader2 size={15} className="animate-spin" aria-hidden />
                  : playing && !paused ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
                {loading && wantPlay ? `Ses hazırlanıyor… %${pctShown}`
                  : loading ? "Hazır olunca çal"
                  : playing && !paused ? "Duraklat" : paused ? "Devam" : "Sesli oku"}
                {!loading && !playing && !paused && (
                  audioReady ? (
                    <>
                      <span aria-hidden className="text-xs text-success">· hazır, ücretsiz</span>
                      <span className="sr-only">, ses hazır, ücretsiz</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden className="text-xs text-text-secondary">⚡{cost}</span>
                      <span className="sr-only">, yapay zekâ kullanımından {cost} düşer</span>
                    </>
                  )
                )}
              </button>
            )}
            {(playing || paused) && (
              <button type="button" onClick={stopPlayback} className="flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-surface-hover">
                <Square size={14} aria-hidden /> Durdur
              </button>
            )}
            {loading && (
              <button type="button" onClick={cancelPrep} className="flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-surface-hover">
                <X size={14} aria-hidden /> İptal
              </button>
            )}
            {canDevice && !deviceVoice && !ttsOff && !playing && !paused && (
              <button type="button" onClick={startDevice}
                      className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm text-text-secondary hover:bg-surface-hover"
                      title="Tarayıcının kendi sesiyle, ücretsiz">
                <Volume2 size={15} aria-hidden /> {loading ? "Beklemeden cihaz sesiyle dinle" : "Cihaz sesiyle dinle"}
              </button>
            )}
          </div>

          {loading && (
            <div aria-live="polite" className="mt-2 rounded-xl border bg-surface-muted p-3 text-xs text-text-secondary">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {wantPlay ? "Ses hazırlanıyor" : "Ses arka planda hazırlanıyor"}
                  {prepPct !== null ? ` · %${prepPct}` : ""}
                  {" · tahmini "}{fmtSec(prepEta)}
                  {prepElapsed > 0 ? ` · geçen ${fmtSec(prepElapsed)}` : ""}
                </span>
                {prepElapsed > prepEta && <span>Biraz uzadı; bekleyebilir ya da iptal edebilirsin.</span>}
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctShown}>
                <div className="h-full bg-accent-purple transition-all" style={{ width: pctShown + "%" }} />
              </div>
              <p className="mt-1.5 min-h-[1rem]">
                {waitLeft > 0
                  ? `Seslendirme şu an yoğun; ${waitLeft} saniye sonra kendiliğinden devam edecek…`
                  : prepNote
                    ? prepNote
                    : long ? "Anlatım uzun olduğu için parça parça seslendiriliyor."
                    : "Bu sırada metni okuyabilir ya da beklemeden cihaz sesiyle dinleyebilirsin."}
              </p>
            </div>
          )}

          {audioErr && (
            <div role="alert" className="mt-2 rounded-xl border border-warning/40 bg-warning-bg p-3 text-sm text-warning">
              <p>{audioErr}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={speak}
                        className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-current/30 px-3 text-sm">
                  <RotateCcw size={14} aria-hidden /> Tekrar dene
                </button>
                {canDevice && !deviceVoice && (
                  <button type="button" onClick={() => { setAudioErr(""); setDeviceAuto(false); setDeviceVoice(true); }}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-accent-purple px-3 text-sm text-on-accent">
                    <Volume2 size={14} aria-hidden /> Cihaz sesiyle dinle
                  </button>
                )}
              </div>
            </div>
          )}

          {deviceVoice && (
            <div className="mt-3">
              <BrowserVoice key={text} text={text} autoPlay={deviceAuto} onClose={() => { setDeviceVoice(false); setDeviceAuto(false); }} />
              {loading && (
                <p className="mt-1 text-xs text-text-secondary">Anlatıcı sesi arka planda hazırlanmaya devam ediyor; hazır olunca &quot;Sesli oku&quot;ya basabilirsin.</p>
              )}
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
              Anlatım gelir gelmez ses arka planda hazırlanır (yaklaşık {fmtSec(estimateSec(Math.max(text.length, 400), calibRef.current))}). Aynı metin ve ses ikinci kez ücretsiz.
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
              disabled={loading || !text || ttsOff}
              className="mt-1 min-h-[40px] w-full rounded-lg border px-2 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              Bu sesle yeniden oku{audioReady ? " · ücretsiz" : ` ⚡${cost}`}
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
