"use client";
/**
 * Cihaz sesi (Web Speech API) — ücretsiz, çevrimdışı çalışabilir, yapay zekâ harcamaz.
 * Bir ya da birden çok metni sırayla okur; her metin cümlelere bölünür (Chrome uzun metinde susar).
 * iOS'ta duraklatma güvenilmez: duraklat = iptal, devam = o metnin başından.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { splitSentences } from "./text";

const FEMALE = /emel|filiz|seda|aylin|zeynep|ayse|ayşe|female|kadın|kadin/i;
const NATURAL = /natural|neural|online|google/i;
const IS_IOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

export function deviceVoiceSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function bestVoice(): SpeechSynthesisVoice | null {
  if (!deviceVoiceSupported()) return null;
  const all = window.speechSynthesis.getVoices();
  const tr = all.filter((v) => /^tr/i.test(v.lang));
  const pool = tr.length ? tr : [];
  const score = (v: SpeechSynthesisVoice) => (FEMALE.test(v.name) ? 2 : 0) + (NATURAL.test(v.name) || !v.localService ? 1 : 0);
  return pool.sort((a, b) => score(b) - score(a))[0] || null;
}

export type VoiceState = "idle" | "playing" | "paused";

export function useDeviceVoice(rate = 1) {
  const [state, setState] = useState<VoiceState>("idle");
  const [item, setItem] = useState(-1);
  const texts = useRef<string[]>([]);
  const cur = useRef(0);
  const run = useRef(0);
  const onDone = useRef<(() => void) | null>(null);
  const rateRef = useRef(rate); rateRef.current = rate;

  const stop = useCallback(() => {
    run.current++;
    try { window.speechSynthesis.cancel(); } catch {}
    setState("idle"); setItem(-1);
  }, []);

  useEffect(() => {
    if (!deviceVoiceSupported()) return;
    const warm = () => { try { window.speechSynthesis.getVoices(); } catch {} };
    warm();
    window.speechSynthesis.addEventListener("voiceschanged", warm);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", warm);
      run.current++;
      try { window.speechSynthesis.cancel(); } catch {}
    };
  }, []);

  /** `list` metinlerini `from` sırasından başlayarak okur. */
  const speak = useCallback((list: string[], from = 0, done?: () => void) => {
    if (!deviceVoiceSupported()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const my = ++run.current;
    texts.current = list;
    onDone.current = done || null;
    const voice = bestVoice();
    const playItem = (k: number) => {
      if (my !== run.current) return;
      if (k >= texts.current.length) { setState("idle"); setItem(-1); onDone.current?.(); return; }
      cur.current = k; setItem(k);
      const parts = splitSentences(texts.current[k]);
      const sayPart = (p: number) => {
        if (my !== run.current) return;
        if (p >= parts.length) { setTimeout(() => playItem(k + 1), 450); return; }
        const u = new SpeechSynthesisUtterance(parts[p]);
        u.lang = "tr-TR";
        u.rate = rateRef.current;
        if (voice) u.voice = voice;
        u.onend = () => sayPart(p + 1);
        u.onerror = () => sayPart(p + 1);
        synth.speak(u);
      };
      sayPart(0);
    };
    setState("playing");
    playItem(from);
  }, []);

  const pause = useCallback(() => {
    if (!deviceVoiceSupported()) return;
    if (IS_IOS) { run.current++; try { window.speechSynthesis.cancel(); } catch {} }
    else window.speechSynthesis.pause();
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    if (!deviceVoiceSupported()) return;
    const synth = window.speechSynthesis;
    if (IS_IOS || !synth.paused) speak(texts.current, cur.current, onDone.current || undefined);
    else { synth.resume(); setState("playing"); }
  }, [speak]);

  return { state, item, speak, pause, resume, stop, supported: deviceVoiceSupported() };
}
