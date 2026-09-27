"use client";
/**
 * Dinle: kapsamdaki alıntılar sırayla sesli okunur; çalan kart vurgulanır.
 *  - Varsayılan: cihaz sesi (ücretsiz, yapay zekâ yok).
 *  - İsteğe bağlı "Anlatıcı sesi": her alıntı için /tts/jobs (sunucu önbellekli) → kalıcı ses sağlayıcısı.
 *    Atölyeden çıkınca anlatıcı durur (mini oynatıcı Atölye oturumunu taşımaz).
 */
import { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Loader2 } from "lucide-react";
import { API, api, errorMessage, getToken } from "@/lib/api";
import { Cost } from "@/components/CostBadge";
import { useAudioPlayback, useAudioSession } from "@/components/audio/AudioProvider";
import { primeAudio, type QueueChunk } from "@/hooks/useAudioQueue";
import { useAtelierKeys, type AtelierCard } from "@/hooks/useAtelier";
import { useDeviceVoice } from "./voice";
import { SourceLine, cardColor } from "./QuoteCard";
import Progress from "./Progress";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const SESSION_ID = "atelier";
const SPEEDS = [0.9, 1, 1.15, 1.3];

type Engine = "device" | "narrator";

export default function ListenMode({ cards, onDone }: { cards: AtelierCard[]; onDone: () => void }) {
  const [engine, setEngine] = useState<Engine>("device");
  const [rate, setRate] = useState(1);
  const [pos, setPos] = useState(0);            // cihaz sesi boştayken seçili kart
  const [narrErr, setNarrErr] = useState("");
  const voice = useDeviceVoice(rate);
  const audio = useAudioSession();
  const { q, setSpeed } = useAudioPlayback();
  const narrKey = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const texts = cards.map((c) => c.text);

  const narrOn = engine === "narrator" && !!audio.session && audio.session.collectionId === SESSION_ID && narrKey.current === audio.session.key;
  const current = narrOn ? q.index : voice.item >= 0 ? voice.item : pos;
  const playing = narrOn ? q.playing : voice.state === "playing";
  const waiting = narrOn && (audio.session?.busy || q.waiting);

  // Çalan kart görünür kalsın
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${current}"]`)?.scrollIntoView({
      block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [current]);

  // Atölyeden çıkınca anlatıcı durur
  const { stopIf } = audio;
  useEffect(() => () => stopIf(SESSION_ID), [stopIf]);

  // Anlatıcı bitti mi?
  useEffect(() => {
    if (!narrOn || !cards.length) return;
    if (!q.playing && q.index >= cards.length - 1 && q.total > 0 && q.time >= q.total - 0.5) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrOn, q.playing, q.index, q.time]);

  function playDevice(from: number) {
    audio.stopIf(SESSION_ID);
    voice.speak(texts, from, onDone);
  }

  async function startNarrator() {
    voice.stop();
    setNarrErr("");
    primeAudio();
    const storageKey = "atelier.listen.pos";
    try { localStorage.removeItem(storageKey); } catch {}
    const list: QueueChunk[] = cards.map((c) => ({ text: c.text }));
    const { key, signal } = audio.play({
      collectionId: SESSION_ID, title: "Atölye · Dinle", subtitle: `${cards.length} alıntı`,
      storageKey, artwork: "/icon", autoPlay: true, chunks: [...list], total: list.length,
    });
    narrKey.current = key;
    audio.update(key, { busy: true });
    setSpeed(rate);
    try {
      // Sırayla hazırlanır; ilk parça gelir gelmez çalmaya başlar, gerisi arkadan dolar
      for (let i = 0; i < cards.length; i++) {
        if (signal.aborted || !audio.isCurrent(key)) return;
        const job = (await api("/tts/jobs", { method: "POST", body: JSON.stringify({ text: cards[i].text.slice(0, 4000) }) }, 1)) as { job_id: string };
        let ok = false;
        for (let t = 0; t < 120 && !signal.aborted; t++) {
          const st = (await api(`/tts/jobs/${job.job_id}`, {}, 2)) as { status: string; error?: string | null };
          if (st.status === "ready") { ok = true; break; }
          if (st.status === "error") throw new Error(st.error || "Anlatıcı sesi şu an hazırlanamadı.");
          await new Promise((r) => setTimeout(r, 1500));
        }
        if (!ok || signal.aborted) return;
        const res = await fetch(`${API}/tts/jobs/${job.job_id}/audio`, { headers: { Authorization: "Bearer " + (getToken() || "") }, signal });
        if (!res.ok) throw new Error("Anlatıcı sesi indirilemedi.");
        const url = URL.createObjectURL(await res.blob());
        list[i] = { text: list[i].text, url };
        if (!audio.update(key, { chunks: [...list], busy: false })) { URL.revokeObjectURL(url); return; }
      }
    } catch (e) {
      if (signal.aborted || !audio.isCurrent(key)) return;
      setNarrErr(errorMessage(e, "Anlatıcı sesi şu an kullanılamıyor.") + " Cihaz sesiyle dinlemeye devam edebilirsin.");
      audio.stop();
      setEngine("device");
    }
  }

  function toggle() {
    if (narrOn) { q.toggle(); return; }
    if (engine === "narrator") { void startNarrator(); return; }
    if (voice.state === "playing") voice.pause();
    else if (voice.state === "paused") voice.resume();
    else playDevice(Math.max(0, pos));
  }

  function jump(i: number) {
    const k = Math.max(0, Math.min(cards.length - 1, i));
    if (narrOn) { q.seek(q.offsets[k] || 0); return; }
    setPos(k);
    if (voice.state !== "idle") playDevice(k);
  }

  function chooseEngine(e: Engine) {
    if (e === engine) return;
    voice.stop(); audio.stopIf(SESSION_ID); narrKey.current = null;
    setEngine(e); setNarrErr("");
  }

  function chooseRate(r: number) {
    setRate(r);
    if (narrOn) setSpeed(r);
    else if (voice.state === "playing") setTimeout(() => playDevice(Math.max(0, voice.item)), 0);
  }

  useAtelierKeys({ " ": toggle, ArrowLeft: () => jump(current - 1), ArrowRight: () => jump(current + 1) });

  const chip = (on: boolean) => cx("min-h-[40px] rounded-full px-3 text-sm",
    on ? "bg-gold-soft font-medium text-text-primary ring-1 ring-gold" : "text-text-secondary hover:text-text-primary");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-phi-5 md:px-8">
      <Progress index={Math.max(0, current)} count={cards.length} />

      {/* Denetimler */}
      <div className="vellum sticky top-2 z-10 mt-phi-3 flex flex-col gap-3 rounded-2xl border p-phi-2 shadow-soft md:flex-row md:items-center">
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={() => jump(current - 1)} aria-label="Önceki alıntı (←)"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-gold-soft hover:text-text-primary">
            <SkipBack size={18} aria-hidden />
          </button>
          <button type="button" onClick={toggle} aria-label={playing ? "Duraklat (boşluk)" : "Dinlemeye başla (boşluk)"}
                  className="flex h-14 w-14 items-center justify-center rounded-full text-on-accent shadow-soft"
                  style={{ background: "var(--gold)" }}>
            {waiting ? <Loader2 size={22} className="animate-spin" aria-hidden /> : playing ? <Pause size={22} aria-hidden /> : <Play size={22} aria-hidden className="ml-0.5" />}
          </button>
          <button type="button" onClick={() => jump(current + 1)} aria-label="Sonraki alıntı (→)"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-gold-soft hover:text-text-primary">
            <SkipForward size={18} aria-hidden />
          </button>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-center gap-x-3 gap-y-2 md:justify-end">
          <div role="radiogroup" aria-label="Ses" className="flex items-center gap-1 rounded-full border p-0.5">
            <button type="button" role="radio" aria-checked={engine === "device"} onClick={() => chooseEngine("device")} className={chip(engine === "device")}>
              Cihaz sesi
            </button>
            <button type="button" role="radio" aria-checked={engine === "narrator"} onClick={() => chooseEngine("narrator")}
                    className={cx(chip(engine === "narrator"), "inline-flex items-center gap-1")}
                    title="Daha doğal ses; Gemini kullanır, hazırlanan ses önbellekte kalır">
              Anlatıcı sesi <Cost n={1} />
            </button>
          </div>
          <div role="radiogroup" aria-label="Hız" className="flex items-center gap-0.5">
            {SPEEDS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={rate === s} aria-label={`Hız ${s}×`}
                      onClick={() => chooseRate(s)} className={cx(chip(rate === s), "min-w-[40px] px-2 text-xs")}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
      {narrErr && <p role="alert" className="mt-2 text-center text-sm text-text-secondary">{narrErr}</p>}
      {engine === "device" && !voice.supported && (
        <p role="alert" className="mt-2 text-center text-sm text-text-secondary">Bu tarayıcıda cihaz sesi yok; anlatıcı sesini deneyebilirsin.</p>
      )}

      {/* Alıntılar */}
      <ol ref={listRef} className="mt-phi-3 flex flex-col gap-phi-2" aria-label="Dinlenecek alıntılar">
        {cards.map((c, i) => {
          const on = i === current;
          return (
            <li key={c.key + ":" + i} data-i={i} aria-current={on ? "true" : undefined}
                className={cx("relative overflow-hidden rounded-2xl border px-5 py-4 transition-[opacity,box-shadow] duration-500 motion-reduce:transition-none",
                  on ? "vellum opacity-100 shadow-soft ring-1 ring-gold" : "bg-surface/60 opacity-70 hover:opacity-100")}>
              <span aria-hidden className="absolute bottom-4 left-0 top-4 w-1 rounded-r-full" style={{ background: cardColor(c) }} />
              <button type="button" onClick={() => jump(i)} className="block w-full text-left"
                      aria-label={`${i + 1}. alıntıya geç`}>
                <span className={cx("font-reading italic text-text-primary", on ? "text-[19px] leading-relaxed" : "line-clamp-3 text-reading")}>
                  {c.text}
                </span>
              </button>
              <SourceLine card={c} className="mt-1" />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
