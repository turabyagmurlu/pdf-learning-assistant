"use client";
/**
 * Parçalı ses kuyruğu: birden çok ses parçasını tek bir kayıt gibi çalar.
 * - İki <audio> öğesi dönüşümlü kullanılır: biri çalarken sıradaki önceden yüklenir (kesintisiz geçiş).
 * - Toplam ilerleme = parça sürelerinin toplamı; süresi bilinmeyen parçalar karakter sayısından tahmin edilir.
 * - ±15 sn ve ilerleme çubuğu parça sınırlarını aşar (genel zamana göre arar).
 * - Henüz hazır olmayan parçaya gelince "bekliyor" durumuna geçer, parça gelince kendiliğinden devam eder.
 * - iOS/Android ses kilidi: `primeAudio()` ya da `unlock()` tıklama anında (SENKRON) çağrılırsa
 *   iki <audio> öğesi sessiz WAV ile bir kez çalınır; ses çok sonra gelse de aynı öğeler çalabilir.
 * - `reset()`: yeni bir kayda geçerken (kalıcı oynatıcı, AudioProvider) öğeleri bırakır; bir sonraki parça
 *   `primeAudio()` ile ısıtılmış yeni öğeleri kullanır. Ayrıca `useMediaSession` ve `useQueueAutostart` yardımcıları.
 * - V3 (T5-ses): parça geçişinde 150 ms nefes payı (sunucu parça sonuna 500 ms sessizlik ekler);
 *   bölümler (paragraf bazlı, kota 0) + `nextChapter/prevChapter`; uyku zamanlayıcısı
 *   (15/30/45 dk ya da bölüm sonunda; 10 sn yumuşak kısılma, 30 sn geri alma).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deriveChapters, type Chapter, type SleepMode } from "@/lib/audio";

export type QueueChunk = {
  text: string;          // parçanın metni (cümle vurgusu ve süre tahmini için)
  url?: string;          // hazırsa ses adresi (blob: ya da http)
  duration?: number;     // saniye; bilinmiyorsa tahmin edilir
};

export const DEFAULT_CPS = 15.5;   // Türkçe konuşma ≈ 15–16 karakter/sn
export const CHUNK_GAP_MS = 150;   // parça geçişinde nefes payı (çakışmayı da önler)
export const SLEEP_FADE_MS = 10000;
export const SLEEP_REWIND_SEC = 30;

export type SleepState = { mode: SleepMode; endsAt: number | null; chapter: number | null };

// Boş veri bloklu WAV (24 kHz, mono, 16 bit): tıklama anında kilidi açmak için
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAAAAA=";

// Tıklama anında önceden "ısıtılmış" öğeler: oynatıcı sonradan (ağ bekledikten sonra) bağlansa da kilit açık kalır.
let primed: HTMLAudioElement[] = [];

/** Tıklama işleyicisinde SENKRON çağır (await'ten ÖNCE). Oynatıcı daha sonra bağlanınca bu öğeleri kullanır. */
export function primeAudio() {
  if (typeof window === "undefined") return;
  primed = [0, 1].map(() => {
    const a = new Audio();
    a.preload = "auto";
    try { a.src = SILENT_WAV; a.play().catch(() => {}); } catch {}
    return a;
  });
}

export function estimateDurations(chunks: QueueChunk[]): number[] {
  let kc = 0, ks = 0;
  for (const c of chunks) if (c.duration && c.duration > 0) { kc += c.text.length; ks += c.duration; }
  const cps = kc > 0 && ks > 0 ? kc / ks : DEFAULT_CPS;
  return chunks.map((c) => (c.duration && c.duration > 0 ? c.duration : c.text.length / cps));
}

export function useAudioQueue(chunks: QueueChunk[], opts: { rate?: number; storageKey?: string; onEnded?: () => void } = {}) {
  const rate = opts.rate ?? 1;
  const optsRef = useRef(opts); optsRef.current = opts;
  const els = useRef<HTMLAudioElement[]>([]);
  const idxRef = useRef(0);
  const playingRef = useRef(false);        // kullanıcı niyeti: çalmaya devam etmek istiyor mu
  const pendingSeek = useRef<{ i: number; off: number } | null>(null);
  const chunksRef = useRef(chunks); chunksRef.current = chunks;
  const rateRef = useRef(rate); rateRef.current = rate;
  const unlocked = useRef(false);

  const [index, setIndex] = useState(0);
  const [chunkTime, setChunkTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [blocked, setBlocked] = useState(false);   // tarayıcı otomatik başlatmayı reddetti
  const [sleep, setSleepState] = useState<SleepState>({ mode: "off", endsAt: null, chapter: null });
  const sleepRef = useRef(sleep); sleepRef.current = sleep;
  const gapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Süresi verilmeyen parçaların gerçek süresi yüklenince ölçülür (loadedmetadata)
  const [measured, setMeasured] = useState<Record<number, number>>({});
  const merged = useMemo(() => chunks.map((c, i) => (c.duration ? c : measured[i] ? { ...c, duration: measured[i] } : c)), [chunks, measured]);
  const durations = useMemo(() => estimateDurations(merged), [merged]);
  const offsets = useMemo(() => { const o: number[] = [0]; for (let i = 0; i < durations.length; i++) o.push(o[i] + durations[i]); return o; }, [durations]);
  const offsetsRef = useRef(offsets); offsetsRef.current = offsets;
  const total = offsets[offsets.length - 1] || 0;
  const allKnown = merged.length > 0 && merged.every((c) => !!c.duration);
  const time = (offsets[index] || 0) + chunkTime;
  const firstReady = !!chunks[0]?.url;

  // Bölümler (paragraf bazlı): başlangıçlar karakter orantılı; parça = paragraf sınırı olduğunda parça başı kesin
  const chapters: Chapter[] = useMemo(() => deriveChapters(merged, durations, offsets), [merged, durations, offsets]);
  const chaptersRef = useRef(chapters); chaptersRef.current = chapters;
  const chapterIndex = useMemo(() => {
    let k = -1;
    for (let i = 0; i < chapters.length; i++) { if (chapters[i].start <= time + 0.2) k = i; else break; }
    return k;
  }, [chapters, time]);

  function active(): HTMLAudioElement | undefined { return els.current[idxRef.current % 2]; }
  // Olaylar yalnız gerçek bir parça yüklü ve etkin öğeden gelirse işlenir (sessiz kilit sesi sayılmaz)
  function live(a: HTMLAudioElement) { return a === active() && !!a.dataset.url; }

  function el(i: number): HTMLAudioElement {
    const k = i % 2;
    if (!els.current[k]) {
      const a = primed.shift() || new Audio();
      if (a.src.startsWith("data:")) unlocked.current = true;
      a.preload = "auto";
      els.current[k] = a;
      a.addEventListener("timeupdate", () => { if (live(a)) onTime(a); });
      a.addEventListener("ended", () => { if (live(a)) onEnded(); });
      a.addEventListener("play", () => { if (live(a)) setPlaying(true); });
      a.addEventListener("pause", () => { if (live(a) && !a.ended) setPlaying(false); });
      a.addEventListener("loadedmetadata", () => {
        const i = parseInt(a.dataset.idx || "-1", 10);
        if (i >= 0 && a.dataset.url && isFinite(a.duration) && a.duration > 0) setMeasured((m) => (m[i] ? m : { ...m, [i]: a.duration }));
      });
    }
    return els.current[k];
  }

  function onTime(a: HTMLAudioElement) {
    setChunkTime(a.currentTime);
    const key = optsRef.current.storageKey;
    if (key) { try { localStorage.setItem(key, String((offsetsRef.current[idxRef.current] || 0) + a.currentTime)); } catch {} }
  }

  function onEnded() {
    const next = idxRef.current + 1;
    if (next < chunksRef.current.length) {
      if (chunksRef.current[next].url) {
        // 150 ms nefes payı: parçalar birbirine yapışmaz, iki öğe çakışmaz
        if (gapTimer.current) clearTimeout(gapTimer.current);
        gapTimer.current = setTimeout(() => { gapTimer.current = null; if (playingRef.current) void playIndex(next, 0, true); }, CHUNK_GAP_MS);
      } else {
        // Sıradaki parça henüz hazır değil: bekle, gelince kendiliğinden devam et
        idxRef.current = next; setIndex(next); setChunkTime(0); setPlaying(false);
        pendingSeek.current = { i: next, off: 0 }; setWaiting(true);
      }
    } else {
      playingRef.current = false; setPlaying(false);
      const key = optsRef.current.storageKey;
      try { if (key) localStorage.removeItem(key); } catch {}
      optsRef.current.onEnded?.();
    }
  }

  function load(i: number): HTMLAudioElement | null {
    const c = chunksRef.current[i]; if (!c?.url) return null;
    const a = el(i);
    if (a.dataset.url !== c.url) { a.dataset.url = c.url; a.dataset.idx = String(i); a.src = c.url; a.load(); }
    a.playbackRate = rateRef.current;
    return a;
  }

  async function playIndex(i: number, off: number, wantPlay: boolean) {
    const prev = active();
    const a = load(i);
    if (!a) {
      // Hedef parça hazır değil: çalanı durdur, konumu işaretle, parça gelince oradan devam et
      if (prev) { try { prev.pause(); } catch {} }
      idxRef.current = i; setIndex(i); setChunkTime(off); setPlaying(false);
      pendingSeek.current = { i, off }; setWaiting(true);
      if (wantPlay) playingRef.current = true;
      return;
    }
    if (prev && prev !== a) { try { prev.pause(); } catch {} }
    idxRef.current = i; setIndex(i); setWaiting(false); pendingSeek.current = null;
    const apply = () => { try { a.currentTime = Math.max(0, Math.min(off, (isFinite(a.duration) ? a.duration : off + 1) - 0.2)); } catch {} };
    if (a.readyState >= 1) apply(); else a.addEventListener("loadedmetadata", apply, { once: true });
    setChunkTime(off);
    if (wantPlay) {
      playingRef.current = true;
      try { await a.play(); setBlocked(false); } catch { setBlocked(true); setPlaying(false); }
    }
    // sıradakini önceden yükle
    if (chunksRef.current[i + 1]?.url) load(i + 1);
  }

  // Parça listesi değişince: bekleyen bir arama/geçiş varsa uygula; sıradakini önceden yükle
  useEffect(() => {
    const p = pendingSeek.current;
    if (p && chunks[p.i]?.url) void playIndex(p.i, p.off, playingRef.current);
    else if (!p && chunks[idxRef.current]?.url && chunks[idxRef.current + 1]?.url) load(idxRef.current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks]);

  useEffect(() => { els.current.forEach((a) => { if (a) a.playbackRate = rate; }); }, [rate]);
  useEffect(() => () => {
    if (gapTimer.current) clearTimeout(gapTimer.current);
    if (fadeTimer.current) clearInterval(fadeTimer.current);
    els.current.forEach((a) => { try { a.pause(); a.removeAttribute("src"); a.load(); } catch {} });
  }, []);

  const seek = useCallback((t: number) => {
    const o = offsetsRef.current; const n = chunksRef.current.length;
    if (!n) return;
    t = Math.max(0, Math.min(t, (o[n] || 0) - 0.3));
    let i = 0; while (i < n - 1 && t >= o[i + 1]) i++;
    void playIndex(i, t - o[i], playingRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const skip = useCallback((d: number) => {
    const a = active();
    const cur = a && a.dataset.url && !pendingSeek.current ? a.currentTime : (pendingSeek.current?.off || 0);
    seek((offsetsRef.current[idxRef.current] || 0) + cur + d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek]);

  const play = useCallback(() => {
    playingRef.current = true;
    const p = pendingSeek.current;
    if (p) { if (chunksRef.current[p.i]?.url) void playIndex(p.i, p.off, true); else setWaiting(true); return; }
    const a = active();
    if (a && a.dataset.url && chunksRef.current[idxRef.current]?.url === a.dataset.url) {
      a.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    } else void playIndex(idxRef.current, 0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pause = useCallback(() => {
    playingRef.current = false;
    if (gapTimer.current) { clearTimeout(gapTimer.current); gapTimer.current = null; }
    try { active()?.pause(); } catch {} setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Bölüm atlama ----
  const seekChapter = useCallback((k: number) => {
    const ch = chaptersRef.current; if (!ch.length) return;
    k = Math.max(0, Math.min(ch.length - 1, k));
    seek(ch[k].start + 0.05);
  }, [seek]);
  const nextChapter = useCallback(() => {
    const ch = chaptersRef.current; const t = (offsetsRef.current[idxRef.current] || 0) + (active()?.currentTime || 0);
    const k = ch.findIndex((c) => c.start > t + 0.5);
    if (k >= 0) seekChapter(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekChapter]);
  const prevChapter = useCallback(() => {
    const ch = chaptersRef.current; const t = (offsetsRef.current[idxRef.current] || 0) + (active()?.currentTime || 0);
    let k = -1; for (let i = 0; i < ch.length; i++) { if (ch[i].start <= t - 3) k = i; else break; }   // 3 sn içinde: bir öncekine
    seekChapter(Math.max(0, k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekChapter]);

  // ---- Uyku zamanlayıcısı ----
  const setSleep = useCallback((mode: SleepMode) => {
    if (fadeTimer.current) { clearInterval(fadeTimer.current); fadeTimer.current = null; }
    els.current.forEach((a) => { try { if (a) a.volume = 1; } catch {} });
    if (mode === "off") { setSleepState({ mode, endsAt: null, chapter: null }); return; }
    if (mode === "chapter") {
      const t = (offsetsRef.current[idxRef.current] || 0) + (active()?.currentTime || 0);
      let k = -1; for (let i = 0; i < chaptersRef.current.length; i++) { if (chaptersRef.current[i].start <= t + 0.2) k = i; else break; }
      setSleepState({ mode, endsAt: null, chapter: k });
      return;
    }
    setSleepState({ mode, endsAt: Date.now() + parseInt(mode, 10) * 60000, chapter: null });
  }, []);

  /** Süre dolunca: 10 sn'de yumuşak kısılma (iOS'ta volume salt okunur → doğrudan durdur), sonra duraklat ve 30 sn geri al. */
  function sleepNow() {
    const a = active();
    const finish = () => {
      pause();
      els.current.forEach((x) => { try { if (x) x.volume = 1; } catch {} });
      const t = (offsetsRef.current[idxRef.current] || 0) + (a?.currentTime || 0);
      seek(Math.max(0, t - SLEEP_REWIND_SEC));
      setSleepState({ mode: "off", endsAt: null, chapter: null });
    };
    if (!a) { finish(); return; }
    let canFade = false;
    try { a.volume = 0.99; canFade = a.volume < 1; a.volume = 1; } catch {}
    if (!canFade) { finish(); return; }
    const steps = 20; let i = 0;
    fadeTimer.current = setInterval(() => {
      i++;
      try { a.volume = Math.max(0, 1 - i / steps); } catch {}
      if (i >= steps) { if (fadeTimer.current) clearInterval(fadeTimer.current); fadeTimer.current = null; finish(); }
    }, SLEEP_FADE_MS / steps);
  }
  useEffect(() => {
    const s = sleepRef.current;
    if (s.mode === "off" || !playing) return;
    if (s.endsAt) {
      const left = s.endsAt - Date.now();
      if (left <= 0) { sleepNow(); return; }
      const t = setTimeout(sleepNow, left);
      return () => clearTimeout(t);
    }
    if (s.mode === "chapter" && s.chapter != null && chapterIndex > s.chapter) {
      pause();
      seek(chaptersRef.current[chapterIndex]?.start ?? time);
      setSleepState({ mode: "off", endsAt: null, chapter: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleep, playing, chapterIndex]);
  // Bekleme sırasında (parça yok) "çalıyor" niyeti de oynatma sayılır: dokununca duraklar
  const toggle = useCallback(() => { (playingRef.current && (playing || waiting)) ? pause() : play(); }, [play, pause, playing, waiting]);

  /** Tıklama içinde SENKRON çağır: iOS/Android ses kilidini açar. */
  const unlock = useCallback(() => {
    if (unlocked.current) return;
    unlocked.current = true;
    for (let k = 0; k < 2; k++) {
      const a = el(k);
      if (!a.dataset.url) { try { a.src = SILENT_WAV; a.play().catch(() => {}); } catch {} }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Yeni kayda geçiş: çalanı durdurur, öğeleri bırakır (sonraki parça ısıtılmış öğeleri alır), durumu sıfırlar. */
  const reset = useCallback(() => {
    els.current.forEach((a) => {
      if (!a) return;
      try { a.pause(); a.removeAttribute("src"); delete a.dataset.url; delete a.dataset.idx; a.load(); } catch {}
    });
    els.current = [];
    unlocked.current = false;
    idxRef.current = 0; playingRef.current = false; pendingSeek.current = null;
    if (gapTimer.current) { clearTimeout(gapTimer.current); gapTimer.current = null; }
    if (fadeTimer.current) { clearInterval(fadeTimer.current); fadeTimer.current = null; }
    setIndex(0); setChunkTime(0); setPlaying(false); setWaiting(false); setBlocked(false); setMeasured({});
    setSleepState({ mode: "off", endsAt: null, chapter: null });
  }, []);

  return { index, chunkTime, time, total, allKnown, durations, offsets, playing, waiting, blocked, firstReady,
           chapters, chapterIndex, seekChapter, nextChapter, prevChapter, sleep, setSleep,
           play, pause, toggle, seek, skip, unlock, reset, isUnlocked: () => unlocked.current };
}

export type AudioQueue = ReturnType<typeof useAudioQueue>;
export type MediaMeta = { title: string; subtitle?: string; artwork?: string };

/** Kilit ekranı / kulaklık düğmeleri / bildirim (Media Session). `meta` null ise denetimler bırakılır. */
export function useMediaSession(q: AudioQueue, meta: MediaMeta | null, speed: number, skipSec = 15) {
  const qRef = useRef(q); qRef.current = q;
  const on = !!meta;
  useEffect(() => {
    if (!meta || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = (navigator as any).mediaSession;
    try {
      ms.metadata = new (window as any).MediaMetadata({
        title: meta.title, artist: meta.subtitle || "TY PDF · Sesli özet", album: "TY PDF",
        artwork: meta.artwork ? [{ src: meta.artwork, sizes: "512x512", type: "image/png" }] : [],
      });
      ms.setActionHandler("play", () => qRef.current.play());
      ms.setActionHandler("pause", () => qRef.current.pause());
      ms.setActionHandler("seekbackward", () => qRef.current.skip(-skipSec));
      ms.setActionHandler("seekforward", () => qRef.current.skip(skipSec));
      ms.setActionHandler("seekto", (d: any) => { if (typeof d.seekTime === "number") qRef.current.seek(d.seekTime); });
      // Kilit ekranı ⏮ ⏭ → önceki/sonraki bölüm
      try { ms.setActionHandler("previoustrack", () => qRef.current.prevChapter()); } catch {}
      try { ms.setActionHandler("nexttrack", () => qRef.current.nextChapter()); } catch {}
    } catch {}
    return () => {
      try { ["play", "pause", "seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"].forEach((k) => ms.setActionHandler(k, null)); } catch {}
      try { ms.metadata = null; } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.title, meta?.subtitle, meta?.artwork, skipSec]);
  useEffect(() => {
    if (!on || typeof navigator === "undefined") return;
    const ms = (navigator as any).mediaSession; if (!ms) return;
    try { ms.playbackState = q.playing ? "playing" : "paused"; } catch {}
    try { if (q.total > 0) ms.setPositionState({ duration: q.total, playbackRate: speed, position: Math.min(q.time, q.total) }); } catch {}
  }, [on, q.playing, q.time, q.total, speed]);
}

/** İlk parça hazır olunca (her kayıt için bir kez): kaldığı yerden devam + istenirse otomatik başlat. */
export function useQueueAutostart(q: AudioQueue, key: string | number | null, storageKey: string | undefined, autoPlay: boolean | undefined) {
  const done = useRef<string | number | null>(null);
  useEffect(() => {
    if (key == null || !q.firstReady || done.current === key) return;
    done.current = key;
    let saved = 0;
    try { if (storageKey) saved = parseFloat(localStorage.getItem(storageKey) || "0") || 0; } catch {}
    if (saved > 3 && saved < q.total - 3) q.seek(saved);
    if (autoPlay) q.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, q.firstReady]);
}
