"use client";
/**
 * Ses seçici (Ajan V, 3.0): TEK liste — 4 kadın anlatıcı + 3 erkek ses. Her satırda "Dinle" (örnek cümle,
 * GET /tts/voices/{voice}/sample: sabit önbellekten ücretsiz; örneği henüz hiç üretilmemiş ses için ilk dinleme 1 kullanım)
 * ve seçim. Seçim `lib/audio` saveVoice ile localStorage `typdf-voice` anahtarına yazılır; LectureTab ve ListenDock
 * aynı anahtarı okur (`typdf:voice-changed` olayıyla anında).
 *
 *   <VoicePicker open onClose />   — ListenDock, okuyucu ⋯ → "Ses seçimi" (`typdf:voice-picker`) olayında açar.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Smartphone, Volume2 } from "lucide-react";
import { api, API, getToken } from "@/lib/api";
import { loadVoice, saveVoice, type VoiceOption } from "@/lib/audio";
import Modal from "@/components/Modal";
import { Cost } from "@/components/CostBadge";
import { browserVoiceSupported } from "@/components/BrowserVoice";

type Lists = { female: VoiceOption[]; male: VoiceOption[]; def: string };

export default function VoicePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lists, setLists] = useState<Lists | null>(null);
  const [err, setErr] = useState("");
  const [voice, setVoice] = useState("");
  const [sampling, setSampling] = useState("");
  const [canSpeak, setCanSpeak] = useState(false);
  const sampleRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setVoice(loadVoice());
    setCanSpeak(browserVoiceSupported());
    if (lists) return;
    (async () => {
      try {
        const r = await api("/tts/voices");
        const female: VoiceOption[] = r.voices || [];
        const male: VoiceOption[] = r.male_voices || [];
        setLists({ female, male, def: r.default || female[0]?.id || "" });
      } catch {
        setErr("Ses listesi alınamadı; birazdan tekrar dene.");
      }
    })();
  }, [open, lists]);

  // Pencere kapanınca çalan örnek de dursun
  useEffect(() => { if (!open) { try { sampleRef.current?.pause(); } catch {} } }, [open]);
  useEffect(() => () => { try { sampleRef.current?.pause(); } catch {} }, []);

  function choose(id: string) {
    setVoice(id);
    saveVoice(id);   // typdf-voice + typdf:voice-changed → ListenDock / LectureTab anında alır
  }

  async function sample(id: string) {
    if (sampling) return;
    setSampling(id); setErr("");
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 40000);
    try {
      const res = await fetch(`${API}/tts/voices/${encodeURIComponent(id)}/sample`, {
        signal: ac.signal, headers: { Authorization: "Bearer " + (getToken() || "") },
      });
      if (!res.ok) {
        let m = "Örnek dinlenemedi; birazdan tekrar dene.";
        try { const j = await res.json(); if (typeof j?.error?.user_message === "string") m = j.error.user_message; } catch {}
        throw new Error(m);
      }
      const blob = await res.blob();
      if (blob.size < 500) throw new Error("Ses boş geldi; tekrar dene.");
      const url = URL.createObjectURL(blob);
      try { sampleRef.current?.pause(); } catch {}
      const a = new Audio(url); sampleRef.current = a;
      a.onended = () => URL.revokeObjectURL(url);
      await a.play().catch(() => setErr("Tarayıcı sesi engelledi; sayfaya bir kez dokunup tekrar dene."));
      // Artık sabit önbellekte: bundan sonra herkes için ücretsiz
      setLists((l) => l ? {
        ...l,
        female: l.female.map((v) => (v.id === id ? { ...v, sample_ready: true } : v)),
        male: l.male.map((v) => (v.id === id ? { ...v, sample_ready: true } : v)),
      } : l);
    } catch (e: unknown) {
      const er = e as { name?: string; message?: string };
      setErr(er?.name === "AbortError" ? "Örnek zaman aşımına uğradı; tekrar dene." : (er?.message || "Örnek dinlenemedi."));
    } finally { clearTimeout(t); setSampling(""); }
  }

  const row = (v: VoiceOption) => {
    const on = voice === v.id || (!voice && lists?.def === v.id);
    const free = v.sample_ready !== false;   // alan yoksa (eski sunucu) ücretsiz say
    return (
      <li key={v.id} className="flex items-center gap-2">
        <button type="button" role="radio" aria-checked={on} onClick={() => choose(v.id)}
                className={"flex min-h-[44px] flex-1 items-center gap-2 rounded-xl border px-3 text-left text-sm " +
                  (on ? "border-accent-purple bg-accent-purple/10 font-medium text-text-primary" : "hover:bg-surface-muted")}>
          <span className={"flex h-5 w-5 shrink-0 items-center justify-center rounded-full border " + (on ? "border-accent-purple bg-accent-purple text-on-accent" : "border-text-secondary/40")}>
            {on && <Check size={12} aria-hidden />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{v.id}</span>
            <span className="block truncate text-xs text-text-secondary">{v.label}</span>
          </span>
        </button>
        <button type="button" onClick={() => sample(v.id)} disabled={!!sampling}
                aria-label={`${v.id} sesini dinle`}
                title={free ? "Örnek cümleyi dinle · ücretsiz" : "Örnek cümle ilk kez üretilecek (1 kullanım); sonra herkes için ücretsiz"}
                className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl border px-3 text-xs hover:bg-surface-muted disabled:opacity-60">
          {sampling === v.id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Volume2 size={14} aria-hidden />}
          Dinle {free ? null : <Cost n={1} />}
        </button>
      </li>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Anlatıcı sesi" size="md">
      <p className="text-sm text-text-secondary">
        Sesli dinleme ve Sesli özet bu sesle okunur. “Dinle” ile örnek cümleyi ücretsiz dene; seçimin bu cihazda saklanır.
      </p>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      {!lists && !err && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" aria-hidden /> Sesler alınıyor…</p>
      )}
      {lists && (
        <div role="radiogroup" aria-label="Anlatıcı sesi" className="mt-3 space-y-3">
          <div>
            <p className="eyebrow">Kadın sesler</p>
            <ul className="mt-1.5 space-y-1.5">{lists.female.map(row)}</ul>
          </div>
          <div>
            <p className="eyebrow">Erkek sesler</p>
            <ul className="mt-1.5 space-y-1.5">{lists.male.map(row)}</ul>
          </div>
        </div>
      )}
      {canSpeak && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-text-secondary">
          <Smartphone size={13} aria-hidden className="mt-0.5 shrink-0" />
          Kota dolarsa ya da istersen oynatıcıdan “Cihaz sesi · ücretsiz” seçeneğini de kullanabilirsin.
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="min-h-[44px] rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent">Tamam</button>
      </div>
    </Modal>
  );
}
