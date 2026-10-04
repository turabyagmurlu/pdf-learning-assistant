"use client";
/**
 * ListenDock (V3): "Sesli dinle" için tek oynatıcı. ExplainPanel'in çıplak <audio>'su yerine geçer.
 *
 *  - `window` üzerinde `typdf:listen` olayını dinler: `requestListen({ text, title })` (lib/audio) ya da
 *    `window.dispatchEvent(new CustomEvent("typdf:listen", { detail: { text, title } }))`. Tıklama içinde
 *    çağrılmalı (iOS ses kilidi burada `primeAudio()` ile açılır).
 *  - Metin sunucuda `tts_prepare`'den geçer: kısa metin (≤ 600 kr) POST /tts (tek parça), uzun metin
 *    POST /tts/jobs/chunked (paragraf hizalı parçalar, hazır oldukça çalar). Gösterilen metin = seslendirilen metin.
 *  - AudioProvider oturumu (`kind: "listen"`) kullanılır: başka sayfaya geçince ses sürer, dock kapatılırsa
 *    MiniPlayer devralır; `AudioQueuePlayer` (global kip) bölümler, uyku zamanlayıcısı, indir, cümle vurgusu verir.
 *  - "Cihaz sesi" seçeneği: kota yok; metin `ttsPrepareClient` ile hazırlanır, BrowserVoice okur.
 *  AudioProvider içinde bir kez bağlanır ((app) layout'a dokunulmaz).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Headphones, Loader2, Smartphone, Volume2, X } from "lucide-react";
import { api, API, getToken } from "@/lib/api";
import { LISTEN_EVENT, ttsPrepareClient, type ListenRequest } from "@/lib/audio";
import { primeAudio, type QueueChunk } from "@/hooks/useAudioQueue";
import { useAudioSession } from "@/components/audio/AudioProvider";
import AudioQueuePlayer from "@/components/AudioQueuePlayer";
import BrowserVoice, { browserVoiceSupported } from "@/components/BrowserVoice";

const SHORT_MAX = 600;          // bu uzunluğa kadar tek çağrı (/tts); üstü parçalı iş
type Voice = { id: string; label: string };
type JobState = {
  job_id: string; status: "running" | "ready" | "error"; total: number; ready_chunks: number[];
  durations: Record<string, number>; texts: string[]; mime: string; error?: string | null; quota?: boolean; note?: string;
};

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function isQuota(e: any) {
  return !!e && (e.quota || e.code === "TTS_QUOTA" || e.code === "USAGE_LIMIT" || e.code === "AI_BUSY" || e.status === 429);
}

export default function ListenDock() {
  const audio = useAudioSession();
  const session = audio.session?.kind === "listen" ? audio.session : null;
  const [req, setReq] = useState<ListenRequest | null>(null);
  const [device, setDevice] = useState(false);
  const [deviceText, setDeviceText] = useState("");
  const [err, setErr] = useState("");
  const [quota, setQuota] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("");
  const [canSpeak, setCanSpeak] = useState(false);
  const runRef = useRef(0);

  useEffect(() => { setCanSpeak(browserVoiceSupported()); try { setVoice(localStorage.getItem("lecture.voice") || ""); } catch {} }, []);

  // Sesler (4 kadın): dock ilk açıldığında bir kez
  useEffect(() => {
    if (!req || voices.length) return;
    (async () => { try { const r = await api("/tts/voices"); setVoices(r.voices || []); setVoice((v) => v || r.default || ""); } catch {} })();
  }, [req, voices.length]);

  const start = useCallback(async (r: ListenRequest, useDevice: boolean, v: string) => {
    const text = (r.text || "").trim();
    if (text.length < 2) return;
    const myRun = ++runRef.current;
    setErr(""); setQuota(false);
    const title = r.title || "Sesli dinle";
    if (useDevice) {
      audio.stop();
      setDevice(true); setDeviceText(ttsPrepareClient(text));
      return;
    }
    setDevice(false);
    const { key, signal } = audio.play({
      collectionId: "listen", kind: "listen", title, subtitle: r.subtitle || "Dinleme", artwork: "/icon",
      storageKey: "listen.pos." + hash(text), autoPlay: true,
    });
    try {
      if (text.length <= SHORT_MAX) {
        const res = await fetch(`${API}/tts`, {
          method: "POST", signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
          body: JSON.stringify({ text, voice: v || undefined, fmt: "mp3" }),
        });
        if (!res.ok) {
          let code = "", msg = "Seslendirme yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.";
          try { const j = await res.json(); code = j?.error?.code || ""; if (typeof j?.error?.user_message === "string") msg = j.error.user_message; } catch {}
          const e: any = new Error(msg); e.code = code; e.status = res.status; throw e;
        }
        const b = await res.blob();
        if (!audio.isCurrent(key) || runRef.current !== myRun) return;
        const chunks: QueueChunk[] = [{ text: ttsPrepareClient(text), url: URL.createObjectURL(b) }];
        audio.update(key, { chunks, total: 1, busy: false });
        return;
      }
      const job: JobState = await api("/tts/jobs/chunked", {
        method: "POST", body: JSON.stringify({ text: text.slice(0, 12000), voice: v || undefined }),
      }, 1);
      if (!audio.isCurrent(key) || runRef.current !== myRun) return;
      const total = job.total || job.texts.length;
      const list: QueueChunk[] = job.texts.map((t) => ({ text: t }));
      if (!audio.update(key, { chunks: [...list], total })) return;
      const fetched = new Set<number>();
      let st: JobState = job;
      const pull = async (n: number) => {
        if (fetched.has(n)) return; fetched.add(n);
        const res = await fetch(`${API}/tts/jobs/${job.job_id}/chunks/${n}`, { headers: { Authorization: "Bearer " + getToken() }, signal });
        if (!res.ok) { fetched.delete(n); return; }
        const b = await res.blob();
        if (b.size < 500) { fetched.delete(n); return; }
        if (!audio.isCurrent(key)) return;
        const u = URL.createObjectURL(b);
        list[n] = { text: list[n].text, url: u, duration: st.durations?.[String(n)] };
        if (!audio.update(key, n === 0 ? { chunks: [...list], busy: false } : { chunks: [...list] })) URL.revokeObjectURL(u);
      };
      for (let i = 0; i < 600 && audio.isCurrent(key); i++) {
        for (const n of st.ready_chunks || []) await pull(n);
        audio.update(key, { note: st.note || "" });
        if (st.status === "error") { const e: any = new Error(st.error || "Seslendirme yapılamadı."); e.quota = !!st.quota; throw e; }
        if (st.status === "ready" && fetched.size >= total) break;
        await new Promise((res) => setTimeout(res, 2000));
        if (!audio.isCurrent(key)) return;
        try { st = await api(`/tts/jobs/${job.job_id}/chunks`); }
        catch (e: any) { if (e?.status === 404) { audio.update(key, { lost: true, busy: false, note: "" }); return; } }
      }
      if (audio.isCurrent(key)) audio.update(key, { busy: false });
    } catch (e: any) {
      if (e?.name === "AbortError" || !audio.isCurrent(key) || runRef.current !== myRun) return;
      setQuota(isQuota(e));
      setErr(e?.message || "Seslendirme yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.");
      audio.stop();
    }
  }, [audio]);

  // Olay dinleyici: tıklama içinde SENKRON primeAudio
  useEffect(() => {
    const onListen = (ev: Event) => {
      const d = (ev as CustomEvent<ListenRequest>).detail;
      if (!d || !d.text) return;
      primeAudio();
      setReq(d);
      let v = d.voice || voice;
      try { v = v || localStorage.getItem("lecture.voice") || ""; } catch {}
      void start(d, !!d.device, v);
    };
    window.addEventListener(LISTEN_EVENT, onListen);
    return () => window.removeEventListener(LISTEN_EVENT, onListen);
  }, [start, voice]);

  const open = !!req && (device || (!!session && session.dock) || !!err);
  if (!open || !req) return null;

  const close = () => { runRef.current++; audio.stop(); setDevice(false); setErr(""); setReq(null); };
  const collapse = () => { if (session) audio.update(session.key, { dock: false }); else close(); };
  const changeVoice = (v: string) => {
    setVoice(v); try { localStorage.setItem("lecture.voice", v); } catch {}
    if (v === "__device") { void start(req, true, voice); return; }
    primeAudio(); void start(req, false, v);
  };

  return (
    <div role="dialog" aria-label={`Sesli dinle: ${req.title || ""}`}
         className="bottom-nav fixed z-[36] border-t bg-surface/95 shadow-medium backdrop-blur"
         style={{ left: "var(--sidebar-w, 0px)", right: 0, bottom: "var(--bottom-nav, 0px)",
                  paddingBottom: "env(safe-area-inset-bottom, 0px)", maxHeight: "70vh", overflowY: "auto" }}>
      <div className="mx-auto max-w-2xl p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-purple/15 text-accent-purple">
            <Headphones size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{req.title || "Sesli dinle"}</p>
            <p className="truncate text-xs text-text-secondary">{device ? "Cihazının kendi sesi · ücretsiz" : "Anlatıcı sesi"}</p>
          </div>
          <select value={device ? "__device" : voice} onChange={(e) => changeVoice(e.target.value)} aria-label="Ses"
                  className="min-h-[40px] max-w-[11rem] rounded-xl border bg-surface px-2 py-1.5 text-xs">
            {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            {!voices.length && voice && <option value={voice}>Anlatıcı sesi</option>}
            {canSpeak && <option value="__device">Cihaz sesi · ücretsiz</option>}
          </select>
          {!device && (
            <button type="button" onClick={collapse} aria-label="Küçült" title="Küçült (alt çubukta devam eder)"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
              <ChevronDown size={18} />
            </button>
          )}
          <button type="button" onClick={close} aria-label="Dinlemeyi kapat" title="Kapat"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
            <X size={18} />
          </button>
        </div>

        {err && (
          <div role={quota ? "status" : "alert"} className={"mt-3 rounded-xl px-4 py-3 text-sm " + (quota ? "border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "text-danger")}>
            <p>{err}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {canSpeak && (
                <button onClick={() => { setErr(""); void start(req, true, voice); }}
                        className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-accent-purple px-3 text-sm text-white">
                  <Smartphone size={14} /> Cihaz sesiyle dinle (ücretsiz)
                </button>
              )}
              <button onClick={() => { primeAudio(); setErr(""); void start(req, false, voice); }}
                      className="flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-black/5">
                <Volume2 size={14} /> Tekrar dene
              </button>
            </div>
          </div>
        )}

        {device && deviceText && (
          <div className="mt-3"><BrowserVoice key={deviceText} text={deviceText} autoPlay onClose={close} /></div>
        )}

        {!device && !err && session && (
          session.chunks ? <div className="mt-3"><AudioQueuePlayer showText /></div>
            : <p role="status" className="mt-3 flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" /> Ses hazırlanıyor…</p>
        )}
      </div>
    </div>
  );
}
