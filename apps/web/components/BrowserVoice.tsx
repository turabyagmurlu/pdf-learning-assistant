"use client";
/**
 * Tarayicinin kendi ses motoruyla (Web Speech API) okuma.
 * Gemini ses kotasi dolduğunda yedek yol: ucretsiz, sinirsiz, anında baslar.
 * Uzun metin tek seferde verilince Chrome susuyor; bu yuzden cumlelere bolup
 * sirayla okutuyoruz ve boylece ilerleme de gosterebiliyoruz.
 */
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Square, Volume2 } from "lucide-react";

const SPEEDS = [0.9, 1, 1.15, 1.3, 1.5];

function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const raw of (text || "").split(/(?<=[.!?…])\s+/)) {
    let s = raw.trim();
    if (!s) continue;
    while (s.length > 220) {                 // cok uzun cumleyi de bol
      let cut = s.lastIndexOf(" ", 220);
      if (cut < 110) cut = 220;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

export function browserVoiceSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Bilinen kadin Turkce ses adlari (Edge/Windows dogal sesleri dahil). */
const FEMALE_HINTS = /emel|filiz|seda|aylin|zeynep|ayse|ayşe|female|kadın|kadin/i;
const NATURAL_HINTS = /natural|neural|online|google/i;

function voiceQuality(v: SpeechSynthesisVoice) {
  const female = FEMALE_HINTS.test(v.name);
  const natural = NATURAL_HINTS.test(v.name) || !v.localService;
  return { female, natural, score: (female ? 2 : 0) + (natural ? 1 : 0) };
}

function describe(v: SpeechSynthesisVoice) {
  const q = voiceQuality(v);
  const bits = [q.female ? "kadın" : "erkek"];
  if (q.natural) bits.push("doğal");
  else bits.push("robotik");
  return `${v.name} — ${bits.join(", ")}`;
}

export default function BrowserVoice({ text, onClose }: { text: string; onClose?: () => void }) {
  const parts = useRef<string[]>(splitSentences(text));
  const idx = useRef(0);
  const stopped = useRef(false);
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState(1);
  const [voiceName, setVoiceName] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Okuma sirasinda hiz/ses degisince eski deger okunmasin diye ref tutuyoruz.
  const rateRef = useRef(1);
  const voiceRef = useRef("");
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { voiceRef.current = voiceName; }, [voiceName]);
  useEffect(() => { voicesRef.current = voices; }, [voices]);

  useEffect(() => { parts.current = splitSentences(text); idx.current = 0; setPos(0); }, [text]);

  useEffect(() => {
    if (!browserVoiceSupported()) return;
    const read = () => {
      const all = window.speechSynthesis.getVoices();
      const tr = all.filter((v) => /^tr/i.test(v.lang));
      // En iyisi basa: once kadin, sonra dogal ses.
      const sorted = (tr.length ? tr : all).sort((a, b) => voiceQuality(b).score - voiceQuality(a).score);
      setVoices(sorted);
      setVoiceName((n) => n || (sorted[0]?.name ?? ""));
    };
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", read);
      stopped.current = true;
      try { window.speechSynthesis.cancel(); } catch {}
    };
  }, []);

  function speakFrom(i: number) {
    if (!browserVoiceSupported()) return;
    stopped.current = false;
    const synth = window.speechSynthesis;
    synth.cancel();
    const next = (k: number) => {
      if (stopped.current || k >= parts.current.length) {
        if (!stopped.current) { setState("idle"); idx.current = 0; setPos(0); }
        return;
      }
      idx.current = k;
      setPos(Math.round(((k + 1) / parts.current.length) * 100));
      const u = new SpeechSynthesisUtterance(parts.current[k]);
      u.lang = "tr-TR";
      u.rate = rateRef.current;
      const v = voicesRef.current.find((x) => x.name === voiceRef.current);
      if (v) u.voice = v;
      u.onend = () => next(k + 1);
      u.onerror = () => next(k + 1);
      synth.speak(u);
    };
    setState("playing");
    next(i);
  }

  function toggle() {
    const synth = window.speechSynthesis;
    if (state === "playing") { synth.pause(); setState("paused"); }
    else if (state === "paused") { synth.resume(); setState("playing"); }
    else speakFrom(0);
  }

  function stop() {
    stopped.current = true;
    try { window.speechSynthesis.cancel(); } catch {}
    setState("idle"); idx.current = 0; setPos(0);
    onClose?.();
  }

  if (!browserVoiceSupported()) return null;

  return (
    <div className="rounded-2xl border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm">
        <Volume2 size={15} className="text-accent-purple" />
        <span className="font-medium">Cihaz sesi (yedek)</span>
        <span className="text-xs text-text-secondary">· kota harcamaz, ama anlatıcı sesi kadar doğal değil</span>
      </div>
      {voices.length > 0 && !voiceQuality(voices.find((v) => v.name === voiceName) || voices[0]).female && (
        <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[11px] text-text-secondary">
          Bu cihazda yüklü tek Türkçe ses erkek ve robotik. Doğal bir kadın sesi istersen uygulamayı
          <b> Microsoft Edge</b>'de aç — Edge'in çevrimiçi Türkçe kadın sesi burada listeye düşer.
          Asıl anlatıcı sesi için kota yenilenince <b>Dinle</b>'ye dön.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={toggle}
                className="flex items-center gap-1.5 rounded-xl bg-accent-purple px-4 py-2 text-sm text-white">
          {state === "playing" ? <Pause size={15} /> : <Play size={15} />}
          {state === "playing" ? "Duraklat" : state === "paused" ? "Devam et" : "Oku"}
        </button>
        <button onClick={stop} className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm">
          <Square size={13} /> Durdur
        </button>

        <div className="flex items-center gap-1 rounded-xl border px-1.5 py-1">
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => { setRate(s); if (state !== "idle") setTimeout(() => speakFrom(idx.current), 0); }}
                    className={"rounded-lg px-2 py-1 text-xs " + (rate === s ? "bg-accent-purple text-white" : "text-text-secondary")}>
              {s}×
            </button>
          ))}
        </div>

        {voices.length > 1 && (
          <select value={voiceName} onChange={(e) => { setVoiceName(e.target.value); if (state !== "idle") setTimeout(() => speakFrom(idx.current), 0); }}
                  className="rounded-xl border bg-surface px-2 py-2 text-xs">
            {voices.map((v) => <option key={v.name} value={v.name}>{describe(v)}</option>)}
          </select>
        )}
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border">
        <div className="h-full bg-accent-purple transition-all" style={{ width: pos + "%" }} />
      </div>
      <p className="mt-1.5 text-[11px] text-text-secondary">
        {state === "idle" && pos === 0
          ? `${parts.current.length} cümle hazır.`
          : `%${pos} · ${idx.current + 1}/${parts.current.length}. cümle`}
      </p>
    </div>
  );
}
