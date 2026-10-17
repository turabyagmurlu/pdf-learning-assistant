"use client";
/**
 * Sesli özet oynatıcı kartı (P1 — Dinle ekranı). Spotify / Apple Podcasts / NotebookLM ölçüsünde sade:
 *  - Kart: defter kapağı, başlık, toplam süre, ilerleme çubuğu (bölüm çentikleriyle), ⏪15 · büyük ▶/⏸ · 15⏩,
 *    altta hız · uyku · indir. Kaldığın yer varsa "Kaldığın yerden devam (06:12)" + "Baştan başla".
 *  - Bölümler listesi (başlık + süre; dokun → atla; çalan vurgulu) ve katlanır "Metni göster" (cümle vurgusu).
 *  - Telefonda tek sütun; iPad/masaüstünde (md) oynatıcı solda, bölümler/metin sağda.
 *
 * İki kip:
 *  - `live`: bu defterin kalıcı oturumu (AudioProvider) çalıyor/duraklatılmış → denetimler kuyruğa gider.
 *  - boşta: cihazda (ya da metin olarak) hazır özet var ama oturum yok → ▶ / bölüm / çubuk dokunuşu `onStart(at)`
 *    çağırır (çağıran tıklama anında SENKRON `primeAudio()` yapar: iOS kilidi).
 * Bölüm kaynağı: `hints` (sunucudan gelen gerçek bölümler: parça indeksi ya da metin oranı) yoksa kuyruğun
 * paragraf bazlı bölümleri. Boşta kartta son bilinen bölümler/süre (`saved`) gösterilir.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check, ChevronDown, Download, Loader2, Moon, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useAudioPlayback, useAudioSession } from "@/components/audio/AudioProvider";
import { SKIP, splitSentences } from "@/components/AudioQueuePlayer";
import { CoverBadge } from "@/components/CoverPicker";
import { SPEEDS, SLEEP_OPTIONS, downloadChunks } from "@/lib/audio";
import { getToken } from "@/lib/api";

export type ChapterHint = { title: string; chunk?: number; frac?: number };
export type SavedChapter = { title: string; start: number };
export type SavedListen = { total: number; chapters: SavedChapter[]; approx?: boolean };

/** 06:12 · 1:02:03 */
export function clock(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return h > 0 ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}
/** "12 dk" (en az 1). */
export function minutes(s: number): string {
  return Math.max(1, Math.round((s || 0) / 60)) + " dk";
}

/** Maliyet rozeti: yalnız ⚡N görünür; ekran okuyucu "N kullanım" der. */
export function Bolt({ n, onAccent = false }: { n: number; onAccent?: boolean }) {
  const k = Math.max(1, Math.round(n || 1));
  return (
    <>
      <span aria-hidden className={"inline-flex items-center rounded-full px-1.5 text-xs font-semibold leading-5 " +
        (onAccent ? "bg-white/20 text-white" : "bg-surface-muted text-text-secondary")}>⚡{k}</span>
      <span className="sr-only"> ({k} kullanım)</span>
    </>
  );
}

type Row = { title: string; start: number; dur: number; ready: boolean };

type Props = {
  /** Dar panel (okuyucu yan paneli): iki sutun yok */
  narrow?: boolean;
  live: boolean;
  stale?: boolean;                 // çalan oturum eski sesle: ▶ yeni sesle başlatır
  title: string;
  subtitle: string;
  cover: { id: string; color?: string | null; icon?: string | null };
  hints: ChapterHint[];
  saved: SavedListen | null;       // boşta gösterilecek süre/bölümler
  onSaveChapters?: (s: SavedListen) => void;
  resumeAt: number;                // sn; > 3 ise "Kaldığın yerden devam"
  startCost: number;               // 0: cihazda hazır (ücretsiz); N: dinlemek için ses hazırlanır
  onStart: (at: number | null) => void;   // null: kaldığı yerden; 0: baştan; n: bu saniyeden
  text: string;
  dialog: boolean;
  playRef?: RefObject<HTMLButtonElement>;
  emphasize?: boolean;
  aside?: ReactNode;               // kartın altında (uyarılar, ⋯ Ayarlar)
};

const SPEAKER = /^\s*(Ayşe|Ayse|Kerem)\s*:\s*/i;

export default function LecturePlayer(p: Props) {
  const { session } = useAudioSession();
  const { q, speed, setSpeed } = useAudioPlayback();
  const live = p.live;
  const chunks = useMemo(() => (live && session?.chunks ? session.chunks : []), [live, session?.chunks]);
  const totalN = live ? (session?.total || chunks.length) : 0;
  const readyN = chunks.filter((c) => !!c.url).length;
  const allReady = live && chunks.length > 0 && readyN >= totalN && readyN === chunks.length;

  const total = live ? q.total : (p.saved?.total || 0);
  const time = live ? q.time : Math.min(p.resumeAt > 3 ? p.resumeAt : 0, total || 0);
  const approx = live ? !q.allKnown : !!p.saved?.approx;

  // ---- Bölümler ----
  const rows: Row[] = useMemo(() => {
    let base: SavedChapter[];
    if (live) {
      base = p.hints.length
        ? p.hints.map((h) => ({ title: h.title, start: h.chunk != null ? (q.offsets[h.chunk] ?? 0) : (h.frac || 0) * q.total }))
        : q.chapters.map((c) => ({ title: c.title, start: c.start }));
    } else base = p.saved?.chapters || [];
    const list = base.filter((c) => isFinite(c.start)).sort((a, b) => a.start - b.start)
      .filter((c, i, a) => i === 0 || c.start - a[i - 1].start > 0.5);
    const end = live ? q.total : (p.saved?.total || 0);
    return list.map((c, i) => {
      let ready = true;
      if (live) {
        let k = 0; while (k < chunks.length - 1 && c.start >= (q.offsets[k + 1] ?? Infinity)) k++;
        ready = !!chunks[k]?.url;
      }
      return { title: c.title, start: c.start, dur: Math.max(0, (list[i + 1]?.start ?? end) - c.start), ready };
    });
  }, [live, p.hints, p.saved, q.offsets, q.total, q.chapters, chunks]);
  const current = useMemo(() => {
    let k = -1; for (let i = 0; i < rows.length; i++) { if (rows[i].start <= time + 0.2) k = i; else break; }
    return k;
  }, [rows, time]);

  // Süreler kesinleşince boşta kart için sakla (sonraki açılışta bölümler ve toplam süre hemen görünür)
  const savedSig = useRef("");
  const onSave = p.onSaveChapters;
  useEffect(() => {
    if (!live || !allReady || !q.allKnown || !onSave || q.total <= 0) return;
    const s: SavedListen = { total: q.total, chapters: rows.map((r) => ({ title: r.title, start: r.start })) };
    const sig = JSON.stringify(s);
    if (sig === savedSig.current) return;
    savedSig.current = sig; onSave(s);
  }, [live, allReady, q.allKnown, q.total, rows, onSave]);

  // ---- Denetimler ----
  const useQueue = live && !p.stale;
  const playing = useQueue && q.playing;
  const waiting = useQueue && q.waiting;
  function toggle() {
    if (useQueue) { q.unlock(); q.toggle(); } else p.onStart(null);
  }
  function seekTo(t: number) {
    if (useQueue) { q.unlock(); q.seek(t); } else p.onStart(t);
  }
  function skip(d: number) { if (useQueue) { q.unlock(); q.skip(d); } }
  function nextSpeed() { const i = SPEEDS.indexOf(speed); setSpeed(SPEEDS[(i + 1) % SPEEDS.length]); }

  // Klavye (yalnız bu oturum çalarken): ← → 15 sn, boşluk oynat/duraklat
  const toggleRef = useRef(toggle); toggleRef.current = toggle;
  const skipRef = useRef(skip); skipRef.current = skip;
  useEffect(() => {
    if (!useQueue) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === " " && el && (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); skipRef.current(-SKIP); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skipRef.current(SKIP); }
      else if (e.key === " ") { e.preventDefault(); toggleRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [useQueue]);

  // Uyku
  const [sleepOpen, setSleepOpen] = useState(false);
  const [sleepLeft, setSleepLeft] = useState("");
  const sleep = q.sleep;
  useEffect(() => {
    if (!useQueue || !sleep.endsAt) { setSleepLeft(""); return; }
    const tick = () => setSleepLeft(clock(Math.max(0, ((sleep.endsAt || 0) - Date.now()) / 1000)));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [useQueue, sleep.endsAt]);
  const sleepOn = useQueue && sleep.mode !== "off";

  // İndir
  const [dl, setDl] = useState<"" | "busy" | "err">("");
  async function download() {
    setDl("busy");
    try { const ok = await downloadChunks(chunks, p.title, "Bearer " + (getToken() || "")); setDl(ok ? "" : "err"); }
    catch { setDl("err"); }
  }

  const pct = total > 0 ? Math.min(100, (time / total) * 100) : 0;
  const status = !live ? ""
    : q.blocked ? "Dinlemek için ▶'ye dokun."
    : waiting ? "Sıradaki kısım hazırlanıyor…"
    : session?.note ? session.note
    : readyN < totalN ? `Kalan kısım hazırlanıyor (${readyN}/${totalN}); dinlemeye devam edebilirsin.` : "";

  // ---- Metin (cümle vurgusu) ----
  const [showText, setShowText] = useState(false);
  const sentences = useMemo(() => (live ? splitSentences(chunks, q.durations) : []), [live, chunks, q.durations]);
  const chunkIdx = q.index, chunkTime = q.chunkTime;
  const activeIdx = useMemo(() => {
    if (!useQueue) return -1;
    let a = -1;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (s.chunk < chunkIdx) { a = i; continue; }
      if (s.chunk === chunkIdx && s.start <= chunkTime + 0.15) a = i;
      if (s.chunk > chunkIdx) break;
    }
    return a;
  }, [useQueue, sentences, chunkIdx, chunkTime]);
  const textBox = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showText || activeIdx < 0 || !playing) return;
    const el = textBox.current?.querySelector(`[data-s="${activeIdx}"]`) as HTMLElement | null;
    if (!el || !textBox.current) return;
    const box = textBox.current.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.top < box.top + 8 || r.bottom > box.bottom - 8) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx, playing, showText]);

  const idleResume = !useQueue && p.resumeAt > 3;
  const playLabel = waiting ? "Bekleniyor; durdur" : playing ? "Duraklat" : idleResume ? `Kaldığın yerden devam et (${clock(p.resumeAt)})` : "Oynat";
  const ctl = "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 text-sm text-text-secondary hover:border-accent-purple/50 hover:bg-surface-muted disabled:opacity-40";

  return (
    <div className={p.narrow ? "" : "md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-start md:gap-6"}>
      {/* SOL: oynatıcı kartı */}
      <div className={p.narrow ? "" : "md:sticky md:top-20"}>
        <section aria-label="Sesli özet oynatıcı" className="rounded-3xl border bg-surface p-4 shadow-soft sm:p-5">
          <div className="flex items-center gap-3">
            <CoverBadge id={p.cover.id} color={p.cover.color} icon={p.cover.icon} size={56} />
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 font-heading text-lg leading-tight">{p.title}</h2>
              <p className="mt-0.5 truncate text-sm text-text-secondary">
                {p.subtitle}{total > 0 ? ` · ${approx ? "~" : ""}${minutes(total)}` : ""}
              </p>
            </div>
          </div>

          {/* İlerleme (dokunma alanı 44px; çubuk 8px) + bölüm çentikleri */}
          <div role="slider" tabIndex={total > 0 ? 0 : -1} aria-label="İlerleme" aria-valuemin={0}
               aria-valuemax={Math.round(total)} aria-valuenow={Math.round(time)} aria-valuetext={`${clock(time)} / ${clock(total)}`}
               onKeyDown={(e) => {
                 if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); skip(-SKIP); }
                 else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); skip(SKIP); }
               }}
               onClick={(e) => {
                 const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                 const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                 if (total > 0) seekTo(f * total);
               }}
               className="mt-4 flex min-h-[44px] cursor-pointer items-center">
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-accent-purple transition-[width]" style={{ width: pct + "%" }} />
              {total > 0 && rows.slice(1).map((c, i) => (
                <span key={i} aria-hidden className="absolute top-0 h-full w-0.5 bg-surface" style={{ left: `${Math.min(99.5, (c.start / total) * 100)}%` }} />
              ))}
            </div>
          </div>
          <div className="flex justify-between text-xs tabular-nums text-text-secondary">
            <span>{clock(time)}</span>
            <span>{total > 0 ? `${approx ? "~" : ""}-${clock(Math.max(0, total - time))}` : ""}</span>
          </div>

          {/* ⏪15 · ▶ · 15⏩ */}
          <div className="mt-3 flex items-center justify-center gap-5 sm:gap-7">
            <button type="button" onClick={() => skip(-SKIP)} disabled={!useQueue} aria-label={`${SKIP} saniye geri`}
                    className="flex h-14 w-14 flex-col items-center justify-center rounded-full text-text-primary hover:bg-surface-muted disabled:opacity-30">
              <RotateCcw size={24} aria-hidden /><span className="text-xs font-semibold leading-none" aria-hidden>{SKIP}</span>
            </button>
            <button ref={p.playRef} type="button" onClick={toggle} aria-label={playLabel} title={playLabel}
                    className={"flex h-20 w-20 items-center justify-center rounded-full bg-accent-purple text-white shadow-medium transition active:scale-95 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-accent-purple/40 " +
                      (p.emphasize && !playing ? "ring-4 ring-accent-purple/25" : "")}>
              {waiting ? <Loader2 size={30} className="animate-spin" aria-hidden />
                : playing ? <Pause size={34} aria-hidden /> : <Play size={34} className="ml-1" aria-hidden />}
            </button>
            <button type="button" onClick={() => skip(SKIP)} disabled={!useQueue} aria-label={`${SKIP} saniye ileri`}
                    className="flex h-14 w-14 flex-col items-center justify-center rounded-full text-text-primary hover:bg-surface-muted disabled:opacity-30">
              <RotateCw size={24} aria-hidden /><span className="text-xs font-semibold leading-none" aria-hidden>{SKIP}</span>
            </button>
          </div>

          {/* Boşta: kaldığın yer / maliyet ipucu */}
          {!useQueue && (
            <div className="mt-3 flex flex-col items-center gap-1 text-center">
              {idleResume && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button type="button" onClick={() => p.onStart(null)}
                          className="min-h-[44px] rounded-full bg-accent-purple/10 px-4 text-sm font-semibold text-accent-purple hover:bg-accent-purple/15">
                    Kaldığın yerden devam ({clock(p.resumeAt)})
                  </button>
                  <button type="button" onClick={() => p.onStart(0)}
                          className="min-h-[44px] rounded-full px-3 text-sm text-text-secondary underline-offset-4 hover:underline">
                    Baştan başla
                  </button>
                </div>
              )}
              <p className="text-xs text-text-secondary">
                {p.startCost > 0
                  ? <>Dinlemeye başlayınca ses hazırlanır <Bolt n={p.startCost} /></>
                  : idleResume ? "Cihazında hazır · ücretsiz" : "Dinlemek için ▶'ye dokun · cihazında hazır, ücretsiz"}
              </p>
            </div>
          )}

          {/* hız · uyku · indir */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button type="button" onClick={nextSpeed} aria-label={`Oynatma hızı ${speed}×, değiştir`} className={ctl}>
              <span className="font-semibold text-text-primary">{speed}×</span> hız
            </button>
            <button type="button" onClick={() => setSleepOpen((o) => !o)} disabled={!useQueue}
                    aria-expanded={sleepOpen} aria-label={sleepOn ? `Uyku zamanlayıcısı açık${sleepLeft ? ": " + sleepLeft : ""}` : "Uyku zamanlayıcısı"}
                    className={ctl + (sleepOn ? " border-accent-purple text-accent-purple" : "")}>
              <Moon size={15} aria-hidden /> {sleepOn ? (sleepLeft || "bölüm sonu") : "Uyku"}
            </button>
            <button type="button" onClick={download} disabled={!allReady || dl === "busy"}
                    title={allReady ? "Tek dosya olarak indir; internet olmadan da dinle" : "Ses tamamen hazır olunca indirilebilir"}
                    aria-label="Sesi indir" className={ctl}>
              {dl === "busy" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />}
              {dl === "err" ? "Olmadı" : "İndir"}
            </button>
          </div>

          {sleepOpen && useQueue && (
            <div role="group" aria-label="Uyku zamanlayıcısı" className="mt-2 flex flex-wrap gap-1.5 rounded-2xl bg-surface-muted/50 p-2">
              {SLEEP_OPTIONS.map((o) => (
                <button key={o.id} type="button" aria-pressed={sleep.mode === o.id}
                        onClick={() => { q.setSleep(o.id); setSleepOpen(false); }}
                        className={"flex min-h-[44px] items-center gap-1 rounded-xl border px-3 text-sm " +
                          (sleep.mode === o.id ? "border-accent-purple bg-accent-purple/10 font-semibold" : "bg-surface hover:bg-black/5")}>
                  {sleep.mode === o.id && <Check size={14} aria-hidden />}{o.label}
                </button>
              ))}
              <p className="w-full px-1 text-xs text-text-secondary">Süre dolunca ses yavaşça kısılır; uyandığında son 30 saniyeden devam eder.</p>
            </div>
          )}

          {status && <p role="status" className="mt-3 text-center text-xs text-text-secondary">{status}</p>}
        </section>
        {p.aside}
      </div>

      {/* SAĞ: bölümler + metin */}
      <div className={`mt-4 space-y-4 ${p.narrow ? "" : "md:mt-0"}`}>
        {rows.length > 0 && (
          <section aria-label="Bölümler" className="rounded-3xl border bg-surface p-2 sm:p-3">
            <h3 className="px-2 pb-1 pt-1 text-sm font-semibold">Bölümler <span className="font-normal text-text-secondary">· {rows.length}</span></h3>
            <ol className="max-h-[22rem] overflow-y-auto md:max-h-[28rem]">
              {rows.map((r, i) => {
                const on = i === current && (useQueue || time > 0);
                return (
                  <li key={i}>
                    <button type="button" disabled={!r.ready} onClick={() => seekTo(r.start + 0.05)} aria-current={on ? "true" : undefined}
                            className={"flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-black/5 disabled:opacity-50 " +
                              (on ? "bg-accent-purple/10" : "")}>
                      <span className={"flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs " +
                        (on ? "bg-accent-purple text-white" : "bg-surface-muted text-text-secondary")}>
                        {on && playing ? <Play size={12} aria-hidden /> : i + 1}
                      </span>
                      <span className={"min-w-0 flex-1 text-sm " + (on ? "font-semibold text-text-primary" : "")}>
                        <span className="line-clamp-2">{r.title}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                        {r.ready ? `${approx ? "~" : ""}${clock(r.dur)}` : "hazırlanıyor"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {p.text && (
          <section className="rounded-3xl border bg-surface">
            <button type="button" onClick={() => setShowText((s) => !s)} aria-expanded={showText}
                    className="flex min-h-[48px] w-full items-center justify-between gap-2 px-4 text-left text-sm font-semibold">
              {showText ? "Metni gizle" : "Metni göster"}
              <ChevronDown size={16} aria-hidden className={"transition-transform " + (showText ? "rotate-180" : "")} />
            </button>
            {showText && (
              <div ref={textBox} className="max-h-[28rem] overflow-y-auto px-4 pb-4 text-[15px] leading-relaxed">
                {live && sentences.length > 0 ? sentences.map((s, i) => {
                  const ready = !!chunks[s.chunk]?.url;
                  const go = () => { if (ready) seekTo((q.offsets[s.chunk] || 0) + s.start + 0.05); };
                  return (
                    <span key={i}>
                      {s.newLine && i > 0 && <br />}
                      {s.speaker && <span className="mr-1 font-semibold text-accent-purple">{s.speaker}:</span>}
                      <span data-s={i} role="button" tabIndex={0} onClick={go} onKeyDown={(e) => { if (e.key === "Enter") go(); }}
                            className={"rounded px-0.5 " + (i === activeIdx ? "bg-accent-purple/20 text-text-primary" : ready ? "cursor-pointer hover:bg-black/5" : "opacity-60")}>
                        {s.text}{" "}
                      </span>
                    </span>
                  );
                }) : p.dialog ? p.text.split("\n").filter((l) => l.trim()).map((l, i) => {
                  const m = l.match(SPEAKER);
                  return <p key={i} className="mb-2">{m && <span className="mr-1 font-semibold text-accent-purple">{m[1]}:</span>}{m ? l.slice(m[0].length).trim() : l}</p>;
                }) : <div className="whitespace-pre-wrap">{p.text}</div>}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
