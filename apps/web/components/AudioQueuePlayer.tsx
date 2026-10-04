"use client";
/**
 * Tam oynatıcı (parçalı kuyruk): ilerleme, ±15 sn, hız, kaldığın yer, kilit ekranı (Media Session),
 * iOS ses kilidi, cümle vurgusu (metin cümlelere bölünür; çalan cümle vurgulanır ve görünür kaydırılır;
 * cümleye tıklayınca oraya atlar). Parçalar hazır oldukça çalar: "2/4 parça hazır · ~40 sn".
 *
 * İki kip:
 *  - `<AudioQueuePlayer />` (parça vermeden): kalıcı global sesi (AudioProvider) gösterir ve denetler.
 *    Sayfadan çıkınca ses kesilmez; alttaki mini çubuk devralır. Sesli özet sekmesi bunu kullanır.
 *  - `<AudioQueuePlayer chunks=... />`: bu bileşene ait yerel ses (sayfadan çıkınca durur; PodcastPlayer).
 *    Yerel ses çalmaya başlayınca global ses duraklatılır.
 *  V3 (T5-ses): bölüm çentikleri + ⏮⏭ bölüm + bölüm listesi; uyku zamanlayıcısı menüsü (15/30/45 dk, bölüm sonu);
 *  "İndir" (tüm parçalar hazır olunca tek dosya); hız tek kaynaktan (lib/audio SPEEDS, `audio.speed`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw, Gauge, Loader2, SkipBack, SkipForward, Moon, Download, List, Check } from "lucide-react";
import { useAudioQueue, useMediaSession, useQueueAutostart, type AudioQueue, type QueueChunk } from "@/hooks/useAudioQueue";
import { useAudioPlayback, useAudioPlaybackOptional, useAudioSession } from "@/components/audio/AudioProvider";
import { API, getToken } from "@/lib/api";
import { SPEEDS, loadSpeed, saveSpeed, SLEEP_OPTIONS, downloadChunks, type SleepMode } from "@/lib/audio";

export { SPEEDS };
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

export type LocalPlayerProps = {
  chunks: QueueChunk[];
  total?: number;                 // beklenen toplam parça (hazır olmayanlar dâhil)
  title: string; subtitle?: string; artwork?: string; storageKey: string; autoPlay?: boolean;
  showText?: boolean;
  syncDocId?: string;             // verilirse konum sunucuya da yazılır (PUT /documents/{id}/reading media_pos)
  note?: string;                  // ek durum satırı (ör. kota beklemesi)
  preparingEta?: number;          // bir sonraki parça için tahmini saniye
};
type GlobalPlayerProps = { chunks?: undefined; showText?: boolean };

export default function AudioQueuePlayer(props: LocalPlayerProps | GlobalPlayerProps) {
  if (props.chunks !== undefined) return <LocalPlayer {...props} />;
  return <GlobalPlayer showText={props.showText} />;
}

/** Kalıcı global ses: durum ve denetimler AudioProvider'dan. */
function GlobalPlayer({ showText = true }: { showText?: boolean }) {
  const { session } = useAudioSession();
  const { q, speed, setSpeed } = useAudioPlayback();
  if (!session || !session.chunks) return null;
  const chunks = session.chunks;
  const totalN = session.total || chunks.length;
  const readyN = chunks.filter((c) => !!c.url).length;
  const preparingEta = totalN > readyN ? Math.round(((chunks[readyN]?.text.length || 2600) / 100) + 2) : undefined;
  return (
    <PlayerView q={q} chunks={chunks} total={totalN} title={session.title} subtitle={session.subtitle} artwork={session.artwork}
                speed={speed} setSpeed={setSpeed} showText={showText} note={session.note || undefined} preparingEta={preparingEta} />
  );
}

/** Yerel ses (bu bileşenle yaşar). */
function LocalPlayer({ chunks, total, title, subtitle, artwork, storageKey, autoPlay, showText = true,
                       syncDocId, note, preparingEta }: LocalPlayerProps) {
  const [speed, setSpeed] = useState<number>(() => loadSpeed());
  const q = useAudioQueue(chunks, { rate: speed, storageKey });
  useEffect(() => { saveSpeed(speed); }, [speed]);
  useQueueAutostart(q, storageKey, storageKey, autoPlay);
  useMediaSession(q, useMemo(() => ({ title, subtitle, artwork }), [title, subtitle, artwork]), speed);
  // Aynı anda iki ses çalmasın: yerel ses başlayınca kalıcı sesi duraklat
  const global = useAudioPlaybackOptional();
  const pauseGlobal = useRef(global?.q.pause); pauseGlobal.current = global?.q.pause;
  useEffect(() => { if (q.playing) pauseGlobal.current?.(); }, [q.playing]);
  return (
    <PlayerView q={q} chunks={chunks} total={total ?? chunks.length} title={title} subtitle={subtitle} artwork={artwork}
                speed={speed} setSpeed={setSpeed} showText={showText} syncDocId={syncDocId} note={note} preparingEta={preparingEta} />
  );
}

function PlayerView({ q, chunks, total, title, subtitle, artwork, speed, setSpeed, showText, syncDocId, note, preparingEta }: {
  q: AudioQueue; chunks: QueueChunk[]; total: number;
  title: string; subtitle?: string; artwork?: string;
  speed: number; setSpeed: (n: number) => void;
  showText: boolean; syncDocId?: string; note?: string; preparingEta?: number;
}) {
  const { index, chunkTime, time, total: dur, allKnown, durations, playing, waiting, blocked, firstReady,
          chapters, chapterIndex, sleep, setSleep } = q;
  const readyN = chunks.filter((c) => !!c.url).length;
  const totalN = total;
  const allReady = readyN >= totalN && readyN === chunks.length && chunks.length > 0;
  const [menu, setMenu] = useState<"" | "sleep" | "chapters">("");
  const [dl, setDl] = useState<"" | "busy" | "err">("");
  const [sleepLeft, setSleepLeft] = useState("");
  useEffect(() => {
    if (!sleep.endsAt) { setSleepLeft(sleep.mode === "chapter" ? "bölüm sonunda" : ""); return; }
    const tick = () => { const s = Math.max(0, Math.round(((sleep.endsAt || 0) - Date.now()) / 1000)); setSleepLeft(fmt(s)); };
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [sleep.endsAt, sleep.mode]);
  async function download() {
    setDl("busy");
    try { const ok = await downloadChunks(chunks, title, "Bearer " + (getToken() || "")); setDl(ok ? "" : "err"); }
    catch { setDl("err"); }
  }

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
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full bg-accent-purple transition-[width]" style={{ width: pct + "%" }} />
          {/* bölüm çentikleri */}
          {dur > 0 && chapters.slice(1).map((c, i) => (
            <span key={i} aria-hidden className="absolute top-0 h-full w-px bg-surface/80" style={{ left: `${Math.min(99.5, (c.start / dur) * 100)}%` }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-text-secondary">
          <span>{fmt(time)}</span><span>{allKnown ? "" : "~"}-{fmt(Math.max(0, dur - time))}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-1.5 sm:gap-3">
        <button onClick={nextSpeed} title="Oynatma hızı" aria-label={`Oynatma hızı ${speed}×, değiştir`} className="flex min-h-[40px] w-14 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs text-text-secondary hover:border-accent-purple/50">
          <Gauge size={13} /> {speed}×
        </button>
        <button onClick={() => { q.unlock(); q.prevChapter(); }} disabled={chapters.length < 2} aria-label="Önceki bölüm" title="Önceki bölüm"
                className="flex h-10 w-10 items-center justify-center rounded-xl border text-text-secondary hover:border-accent-purple/50 hover:bg-surface-muted disabled:opacity-40">
          <SkipBack size={16} />
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
        <button onClick={() => { q.unlock(); q.nextChapter(); }} disabled={chapters.length < 2} aria-label="Sonraki bölüm" title="Sonraki bölüm"
                className="flex h-10 w-10 items-center justify-center rounded-xl border text-text-secondary hover:border-accent-purple/50 hover:bg-surface-muted disabled:opacity-40">
          <SkipForward size={16} />
        </button>
        <button onClick={() => setMenu(menu === "sleep" ? "" : "sleep")} aria-expanded={menu === "sleep"} aria-haspopup="menu"
                title="Uyku zamanlayıcısı" aria-label={sleep.mode === "off" ? "Uyku zamanlayıcısı" : `Uyku zamanlayıcısı açık: ${sleepLeft}`}
                className={"flex min-h-[40px] w-14 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs hover:border-accent-purple/50 " +
                  (sleep.mode !== "off" ? "border-accent-purple text-accent-purple" : "text-text-secondary")}>
          <Moon size={13} /> {sleep.mode !== "off" && sleep.endsAt ? sleepLeft : ""}
        </button>
      </div>

      {/* Bölüm adı + liste / indir */}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-text-secondary">
        <button onClick={() => setMenu(menu === "chapters" ? "" : "chapters")} disabled={chapters.length === 0} aria-expanded={menu === "chapters"}
                className="flex min-h-[32px] min-w-0 items-center gap-1 rounded-lg px-2 hover:bg-surface-muted disabled:opacity-50">
          <List size={13} />
          <span className="truncate">{chapters.length ? `Bölüm ${Math.max(1, chapterIndex + 1)}/${chapters.length}${chapterIndex >= 0 ? " · " + chapters[chapterIndex].title : ""}` : "Bölümler hazırlanıyor"}</span>
        </button>
        <button onClick={download} disabled={!allReady || dl === "busy"} title={allReady ? "Sesi tek dosya olarak indir (çevrimdışı dinle)" : "Tüm parçalar hazır olunca indirilebilir"}
                aria-label="Sesi indir" className="flex min-h-[32px] shrink-0 items-center gap-1 rounded-lg px-2 hover:bg-surface-muted disabled:opacity-50">
          {dl === "busy" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {dl === "err" ? "İndirilemedi" : "İndir"}
        </button>
      </div>

      {menu === "sleep" && (
        <div role="menu" aria-label="Uyku zamanlayıcısı" className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border bg-surface-muted/40 p-2 text-xs">
          <span className="mr-1 text-text-secondary">Uyku:</span>
          {SLEEP_OPTIONS.map((o) => (
            <button key={o.id} role="menuitemradio" aria-checked={sleep.mode === o.id}
                    onClick={() => { setSleep(o.id as SleepMode); setMenu(""); }}
                    className={"flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 " +
                      (sleep.mode === o.id ? "border-accent-purple bg-accent-purple/10 font-semibold text-text-primary" : "hover:bg-black/5")}>
              {sleep.mode === o.id && <Check size={12} />}{o.label}
            </button>
          ))}
          <span className="ml-1 text-text-secondary">Süre dolunca ses yavaşça kısılır, otuz saniye geri alınır.</span>
        </div>
      )}

      {menu === "chapters" && chapters.length > 0 && (
        <ol aria-label="Bölümler" className="mt-2 max-h-48 overflow-y-auto rounded-xl border bg-surface-muted/40 p-1 text-sm">
          {chapters.map((c, i) => {
            const ready = !!chunks[c.chunk]?.url;
            return (
              <li key={i}>
                <button disabled={!ready} onClick={() => { q.unlock(); q.seekChapter(i); setMenu(""); }}
                        className={"flex w-full min-h-[40px] items-center gap-2 rounded-lg px-2 text-left hover:bg-black/5 disabled:opacity-50 " +
                          (i === chapterIndex ? "bg-accent-purple/10 font-medium" : "")}>
                  <span className="w-6 shrink-0 text-xs text-text-secondary">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-xs text-text-secondary">{fmt(c.start)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

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
