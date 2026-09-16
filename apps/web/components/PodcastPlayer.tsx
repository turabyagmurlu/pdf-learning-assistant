"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw, Gauge } from "lucide-react";

const SPEEDS = [0.8, 1, 1.15, 1.3, 1.5];
function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ":" + (r < 10 ? "0" : "") + r;
}

/** Podcast tarzi oynatici: ±15 sn, hiz, ilerleme, kaldigin yerden devam, kilit ekrani kontrolleri. */
export default function PodcastPlayer({ src, title, subtitle, artwork, storageKey, autoPlay }: {
  src: string; title: string; subtitle?: string; artwork?: string; storageKey: string; autoPlay?: boolean;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem("lecture.speed") || "1") || 1; } catch { return 1; }
  });

  useEffect(() => {
    const a = ref.current; if (!a) return;
    a.playbackRate = speed;
    const onTime = () => { setT(a.currentTime); try { localStorage.setItem(storageKey, String(a.currentTime)); } catch {} };
    const onMeta = () => {
      setDur(a.duration || 0);
      try {
        const saved = parseFloat(localStorage.getItem(storageKey) || "0");
        if (saved > 3 && saved < (a.duration || 0) - 3) a.currentTime = saved;
      } catch {}
      if (autoPlay) a.play().catch(() => {});
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => { setPlaying(false); try { localStorage.removeItem(storageKey); } catch {} };
    a.addEventListener("timeupdate", onTime); a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay); a.addEventListener("pause", onPause); a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime); a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay); a.removeEventListener("pause", onPause); a.removeEventListener("ended", onEnd);
    };
  }, [src, storageKey, autoPlay]);

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; try { localStorage.setItem("lecture.speed", String(speed)); } catch {} }, [speed]);

  // Media Session: kilit ekrani / kulaklik dugmeleri / bildirim
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = (navigator as any).mediaSession;
    try {
      ms.metadata = new (window as any).MediaMetadata({
        title, artist: subtitle || "TY PDF · Sesli ders", album: "TY PDF",
        artwork: artwork ? [{ src: artwork, sizes: "512x512", type: "image/png" }] : [],
      });
      ms.setActionHandler("play", () => ref.current?.play());
      ms.setActionHandler("pause", () => ref.current?.pause());
      ms.setActionHandler("seekbackward", () => skip(-15));
      ms.setActionHandler("seekforward", () => skip(15));
      ms.setActionHandler("seekto", (d: any) => { if (ref.current && typeof d.seekTime === "number") ref.current.currentTime = d.seekTime; });
    } catch {}
    return () => { try { ["play", "pause", "seekbackward", "seekforward", "seekto"].forEach((k) => ms.setActionHandler(k, null)); } catch {} };
  }, [title, subtitle, artwork]);

  useEffect(() => {
    const ms = (navigator as any)?.mediaSession;
    if (!ms) return;
    try { ms.playbackState = playing ? "playing" : "paused"; } catch {}
    try { if (dur > 0) ms.setPositionState({ duration: dur, playbackRate: speed, position: Math.min(t, dur) }); } catch {}
  }, [playing, t, dur, speed]);

  function skip(d: number) { const a = ref.current; if (!a) return; a.currentTime = Math.max(0, Math.min((a.duration || 0), a.currentTime + d)); }
  function toggle() { const a = ref.current; if (!a) return; playing ? a.pause() : a.play().catch(() => {}); }
  function nextSpeed() { const i = SPEEDS.indexOf(speed); setSpeed(SPEEDS[(i + 1) % SPEEDS.length]); }

  const pct = dur > 0 ? (t / dur) * 100 : 0;
  return (
    <div className="rounded-2xl border bg-surface p-4">
      <audio ref={ref} src={src} preload="metadata" />
      <div className="flex items-center gap-3">
        {artwork && <img src={artwork} alt="" className="h-12 w-12 shrink-0 rounded-xl" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          {subtitle && <p className="truncate text-xs text-text-secondary">{subtitle}</p>}
        </div>
      </div>

      <div className="mt-3 cursor-pointer" onClick={(e) => {
        const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const p = (e.clientX - r.left) / r.width; if (ref.current && dur > 0) ref.current.currentTime = p * dur;
      }}>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full bg-accent-purple" style={{ width: pct + "%" }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-text-secondary">
          <span>{fmt(t)}</span><span>-{fmt(Math.max(0, dur - t))}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-center gap-3">
        <button onClick={nextSpeed} title="Hız" className="flex w-14 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs text-text-secondary hover:border-accent-purple/50">
          <Gauge size={13} /> {speed}×
        </button>
        <button onClick={() => skip(-15)} aria-label="15 saniye geri" className="relative rounded-full p-2 text-text-secondary hover:bg-surface-muted">
          <RotateCcw size={24} /><span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold">15</span>
        </button>
        <button onClick={toggle} aria-label={playing ? "Duraklat" : "Oynat"}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-purple text-white shadow-md">
          {playing ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
        </button>
        <button onClick={() => skip(15)} aria-label="15 saniye ileri" className="relative rounded-full p-2 text-text-secondary hover:bg-surface-muted">
          <RotateCw size={24} /><span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold">15</span>
        </button>
        <span className="w-14" />
      </div>
    </div>
  );
}
