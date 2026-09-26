"use client";
/**
 * Parçalı ses kuyruğu: birden çok ses parçasını tek bir kayıt gibi çalar.
 * - İki <audio> öğesi dönüşümlü kullanılır: biri çalarken sıradaki önceden yüklenir (kesintisiz geçiş).
 * - Toplam ilerleme = parça sürelerinin toplamı; süresi bilinmeyen parçalar karakter sayısından tahmin edilir.
 * - ±15 sn ve ilerleme çubuğu parça sınırlarını aşar (genel zamana göre arar).
 * - Henüz hazır olmayan parçaya gelince "bekliyor" durumuna geçer, parça gelince kendiliğinden devam eder.
 * - iOS/Android ses kilidi: `primeAudio()` ya da `unlock()` tıklama anında (SENKRON) çağrılırsa
 *   iki <audio> öğesi sessiz WAV ile bir kez çalınır; ses çok sonra gelse de aynı öğeler çalabilir.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type QueueChunk = {
  text: string;          // parçanın metni (cümle vurgusu ve süre tahmini için)
  url?: string;          // hazırsa ses adresi (blob: ya da http)
  duration?: number;     // saniye; bilinmiyorsa tahmin edilir
};

export const DEFAULT_CPS = 15.5;   // Türkçe konuşma ≈ 15–16 karakter/sn

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
      if (chunksRef.current[next].url) { void playIndex(next, 0, true); }
      else {
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
  useEffect(() => () => { els.current.forEach((a) => { try { a.pause(); a.removeAttribute("src"); a.load(); } catch {} }); }, []);

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
    playingRef.current = false; try { active()?.pause(); } catch {} setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  return { index, chunkTime, time, total, allKnown, durations, offsets, playing, waiting, blocked, firstReady,
           play, pause, toggle, seek, skip, unlock, isUnlocked: () => unlocked.current };
}
