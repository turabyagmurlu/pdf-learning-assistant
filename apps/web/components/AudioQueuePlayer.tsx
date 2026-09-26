"use client";
/**
 * Tam oynatıcı (parçalı kuyruk): ilerleme, ±15 sn, hız, kaldığın yer, kilit ekranı (Media Session),
 * iOS ses kilidi, cümle vurgusu (metin cümlelere bölünür; çalan cümle vurgulanır ve görünür kaydırılır;
 * cümleye tıklayınca oraya atlar). Parçalar hazır oldukça çalar: "2/4 parça hazır · ~40 sn".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw, Gauge, Loader2 } from "lucide-react";
import { useAudioQueue, type QueueChunk } from "@/hooks/useAudioQueue";
import { API, getToken } from "@/lib/api";

export const SPEEDS = [0.8, 1, 1.15, 1.3, 1.5];
export const SKIP = 15;   // saniye

export function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ":" + (r < 10 ? "0" : "") + r;
}

export type Sentence = { chunk: number; text: string; speaker?: string; start: number; end: number; newLine: boolean };

const SPEAKER_RE = /^\s*(Ayşe|Ayse|Kerem)\s*:\s*/i;

/** Metni cümlelere böler (lookbehind yok: eski iOS Safari'de de çalışır); sohbet satırlarında konuşmacı adı ayrılır.
 *  Zaman karakter-orantılıdır: parçanın süresi, seslendirilen karakterlere (konuşmacı adları hariç) paylaştırılır. */
export function splitSentences(chunks: QueueChunk[], durations: number[]): Sentence[] {
  const out: Sentence[] = [];
  chunks.forEach((c, ci) => {
    const text = c.text || "";
    const dur = durations[ci] || 0;
    const items: { text: string; speaker?: string; newLine: boolean }[] = [];
    text.split(/\n+/).filter((l) => l.trim()).forEach((line) => {
      let speaker: string | undefined;
      let body = line;
      const m = line.match(SPEAKER_RE);
      if (m) { speaker = m[1].toLowerCase().startsWith("k") ? "Kerem" : "Ayşe"; body = line.slice(m[0].length); }
      const sents = (body.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) || [body]).map((x) => x.trim()).filter(Boolean);
      sents.forEach((t, si) => items.push({ text: t, speaker: si === 0 ? speaker : undefined, newLine: si === 0 }));
    });
    const totalChars = Math.max(1, items.reduce((n, it) => n + it.text.length + 1, 0));
    let pos = 0;
    items.forEach((it) => {
      const len = it.text.length + 1;
      out.push({ chunk: ci, text: it.text, speaker: it.speaker, newLine: it.newLine,
                 start: (pos / totalChars) * dur, end: ((pos + len) / totalChars) * dur });
      pos += len;
    });
  });
  return out;
}

export default function AudioQueuePlayer({ chunks, total, title, subtitle, artwork, storageKey, autoPlay, showText = true,
                                           syncDocId, note, preparingEta }: {
  chunks: QueueChunk[];
  total?: number;                 // beklenen toplam parça (hazır olmayanlar dâhil)
  title: string; subtitle?: string; artwork?: string; storageKey: string; autoPlay?: boolean;
  showText?: boolean;
  syncDocId?: string;             // verilirse konum sunucuya da yazılır (PUT /documents/{id}/reading media_pos)
  note?: string;                  // ek durum satırı (ör. kota beklemesi)
  preparingEta?: number;          // bir sonraki parça için tahmini saniye
}) {
  const [speed, setSpeed] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem("lecture.speed") || "1") || 1; } catch { return 1; }
  });
  const q = useAudioQueue(chunks, { rate: speed, storageKey });
  const { index, chunkTime, time, total: dur, allKnown, durations, playing, waiting, blocked, firstReady } = q;
  const readyN = chunks.filter((c) => !!c.url).length;
  const totalN = total ?? chunks.length;

  useEffect(() => { try { localStorage.setItem("lecture.speed", String(speed)); } catch {} }, [speed]);

  // İlk parça hazır olunca: kaldığı yerden devam + (istenirse) otomatik başlat
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !firstReady) return;
    started.current = true;
    let saved = 0;
    try { saved = parseFloat(localStorage.getItem(storageKey) || "0") || 0; } catch {}
    if (saved > 3 && saved < dur - 3) q.seek(saved);
    if (autoPlay) q.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstReady]);

  // Media Session: kilit ekranı / kulaklık düğmeleri / bildirim
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = (navigator as any).mediaSession;
    try {
      ms.metadata = new (window as any).MediaMetadata({
        title, artist: subtitle || "TY PDF · Sesli özet", album: "TY PDF",
        artwork: artwork ? [{ src: artwork, sizes: "512x512", type: "image/png" }] : [],
      });
      ms.setActionHandler("play", () => q.play());
      ms.setActionHandler("pause", () => q.pause());
      ms.setActionHandler("seekbackward", () => q.skip(-SKIP));
      ms.setActionHandler("seekforward", () => q.skip(SKIP));
      ms.setActionHandler("seekto", (d: any) => { if (typeof d.seekTime === "number") q.seek(d.seekTime); });
    } catch {}
    return () => { try { ["play", "pause", "seekbackward", "seekforward", "seekto"].forEach((k) => ms.setActionHandler(k, null)); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle, artwork]);
  useEffect(() => {
    const ms = (navigator as any)?.mediaSession; if (!ms) return;
    try { ms.playbackState = playing ? "playing" : "paused"; } catch {}
    try { if (dur > 0) ms.setPositionState({ duration: dur, playbackRate: speed, position: Math.min(time, dur) }); } catch {}
  }, [playing, time, dur, speed]);

  // Konumu sunucuya yaz (cihazlar arası): 5 sn'de bir, değiştiyse
  const lastSync = useRef(0);
  useEffect(() => {
    if (!syncDocId || !playing) return;
    const now = Date.now();
    if (now - lastSync.current < 5000) return;
    lastSync.current = now;
    try {
      fetch(`${API}/documents/${encodeURIComponent(syncDocId)}/reading`, {
        method: "PUT", keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({ media_pos: Math.round(time * 10) / 10 }),
      }).catch(() => {});
    } catch {}
  }, [time, playing, syncDocId]);

  // Klavye: ← → 15 sn, boşluk oynat/duraklat (yazı alanındayken karışmaz)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === " " && el && (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); q.skip(-SKIP); }
      else if (e.key === "ArrowRight") { e.preventDefault(); q.skip(SKIP); }
      else if (e.key === " ") { e.preventDefault(); q.unlock(); q.toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.toggle]);

  // Cümle vurgusu
  const sentences = useMemo(() => splitSentences(chunks, durations), [chunks, durations]);
  const activeIdx = useMemo(() => {
    let a = -1;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (s.chunk < index) { a = i; continue; }
      if (s.chunk === index && s.start <= chunkTime + 0.15) a = i;
      if (s.chunk > index) break;
    }
    return a;
  }, [sentences, index, chunkTime]);
  const textBox = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showText || activeIdx < 0 || !playing) return;
    const el = textBox.current?.querySelector(`[data-s="${activeIdx}"]`) as HTMLElement | null;
    if (!el || !textBox.current) return;
    const box = textBox.current.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.top < box.top + 8 || r.bottom > box.bottom - 8) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx, playing, showText]);

  function nextSpeed() { const i = SPEEDS.indexOf(speed); setSpeed(SPEEDS[(i + 1) % SPEEDS.length]); }
  const pct = dur > 0 ? Math.min(100, (time / dur) * 100) : 0;
  const eta = preparingEta != null ? preparingEta : Math.round(((chunks[index + 1]?.text.length || 2600) / 100) + 2);

  const statusLine = !firstReady
    ? `Ses hazırlanıyor… ${readyN}/${totalN} parça hazır${preparingEta ? ` · ~${preparingEta} sn` : ""}${waiting ? " · hazır olunca kendiliğinden çalar" : ""}`
    : waiting ? `Sıradaki parça hazırlanıyor… ${readyN}/${totalN} parça hazır · ~${eta} sn`
    : readyN < totalN ? `${readyN}/${totalN} parça hazır; kalanı arkada hazırlanıyor, dinlemeye devam et.` : "";

  return (
    <div className="rounded-2xl border bg-surface p-4">
      <div className="flex items-center gap-3">
        {artwork && <img src={artwork} alt="" className="h-12 w-12 shrink-0 rounded-xl" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          {subtitle && <p className="truncate text-xs text-text-secondary">{subtitle}</p>}
        </div>
      </div>

      <div className="mt-3 cursor-pointer" role="slider" aria-label="İlerleme" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(time)}
           onClick={(e) => {
             const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
             const p = (e.clientX - r.left) / r.width; if (dur > 0) { q.unlock(); q.seek(p * dur); }
           }}>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full bg-accent-purple transition-[width]" style={{ width: pct + "%" }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-text-secondary">
          <span>{fmt(time)}</span><span>{allKnown ? "" : "~"}-{fmt(Math.max(0, dur - time))}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 sm:gap-3">
        <button onClick={nextSpeed} title="Oynatma hızı" aria-label={`Oynatma hızı ${speed}×, değiştir`} className="flex min-h-[40px] w-14 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs text-text-secondary hover:border-accent-purple/50">
          <Gauge size={13} /> {speed}×
        </button>
        <button onClick={() => { q.unlock(); q.skip(-SKIP); }} aria-label={`${SKIP} saniye geri`} title={`${SKIP} sn geri (←)`}
                className="flex min-h-[40px] items-center gap-1 rounded-xl border px-3 py-2 text-sm hover:border-accent-purple/50 hover:bg-surface-muted">
          <RotateCcw size={18} /><span className="font-semibold">{SKIP}</span><span className="text-xs text-text-secondary">sn</span>
        </button>
        <button onClick={() => { q.unlock(); q.toggle(); }} aria-label={waiting ? "Bekleniyor; durdur" : playing ? "Duraklat" : "Oynat"}
                title={firstReady ? "Oynat / duraklat (boşluk)" : "Dokun: ses hazır olunca kendiliğinden çalar"}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-purple text-white shadow-md disabled:opacity-60">
          {waiting ? <Loader2 size={22} className="animate-spin" /> : playing ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
        </button>
        <button onClick={() => { q.unlock(); q.skip(SKIP); }} aria-label={`${SKIP} saniye ileri`} title={`${SKIP} sn ileri (→)`}
                className="flex min-h-[40px] items-center gap-1 rounded-xl border px-3 py-2 text-sm hover:border-accent-purple/50 hover:bg-surface-muted">
          <span className="text-xs text-text-secondary">sn</span><span className="font-semibold">{SKIP}</span><RotateCw size={18} />
        </button>
        <span className="w-14" />
      </div>

      {(statusLine || note || blocked) && (
        <p role="status" className="mt-3 text-center text-xs text-text-secondary">
          {blocked ? "Dinlemek için ▶ düğmesine dokun." : note || statusLine}
        </p>
      )}

      {showText && sentences.length > 0 && (
        <div ref={textBox} className="mt-4 max-h-72 overflow-y-auto rounded-xl bg-surface-muted/40 p-3 text-sm leading-relaxed">
          {sentences.map((s, i) => {
            const ready = !!chunks[s.chunk]?.url;
            return (
              <span key={i}>
                {s.newLine && i > 0 && <br />}
                {s.speaker && <span className="mr-1 font-semibold text-accent-purple">{s.speaker}:</span>}
                <span data-s={i} role="button" tabIndex={0}
                      onClick={() => { if (!ready) return; q.unlock(); q.seek((q.offsets[s.chunk] || 0) + s.start + 0.05); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && ready) { q.unlock(); q.seek((q.offsets[s.chunk] || 0) + s.start + 0.05); } }}
                      className={"rounded px-0.5 " + (i === activeIdx ? "bg-accent-purple/20 text-text-primary" : ready ? "cursor-pointer hover:bg-black/5" : "opacity-60")}>
                  {s.text}{" "}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
