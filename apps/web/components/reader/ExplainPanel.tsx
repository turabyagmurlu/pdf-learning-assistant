"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Sparkles, Play, Pause, Square, Volume2 } from "lucide-react";

/** Kadin sesi olma ihtimali yuksek isimler (Windows/Chrome/Edge/Android) */
const FEMALE_HINTS = [
  "emel", "yelda", "seda", "filiz", "aylin", "zeynep", "elif",
  "female", "kadin", "woman", "google türkçe", "google turkce",
];
const MALE_HINTS = ["tolga", "male", "erkek", "man"];

function scoreVoice(v: SpeechSynthesisVoice): number {
  const n = (v.name + " " + v.voiceURI).toLowerCase();
  let s = 0;
  if (v.lang?.toLowerCase().startsWith("tr")) s += 100;
  if (FEMALE_HINTS.some((h) => n.includes(h))) s += 50;
  if (MALE_HINTS.some((h) => n.includes(h))) s -= 40;
  if (n.includes("google")) s += 10;
  if (n.includes("natural") || n.includes("neural")) s += 15;
  return s;
}

export default function ExplainPanel({
  documentId, page, getPageText,
}: {
  documentId: string;
  page: number;
  getPageText: (n: number) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [explainedPage, setExplainedPage] = useState<number | null>(null);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>("");
  const [rate, setRate] = useState(0.95);
  const [pitch, setPitch] = useState(1.25);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const uttRef = useRef<SpeechSynthesisUtterance | null>(null);

  // sesleri yukle (bazi tarayicilarda gec gelir)
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices();
      if (!all.length) return;
      const sorted = [...all].sort((a, b) => scoreVoice(b) - scoreVoice(a));
      setVoices(sorted);
      setVoiceURI((cur) => {
        if (cur && sorted.some((v) => v.voiceURI === cur)) return cur;
        try {
          const saved = localStorage.getItem("reader.voice");
          if (saved && sorted.some((v) => v.voiceURI === saved)) return saved;
        } catch {}
        return sorted[0]?.voiceURI || "";
      });
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { try { window.speechSynthesis.onvoiceschanged = null; } catch {} };
  }, []);

  useEffect(() => { try { if (voiceURI) localStorage.setItem("reader.voice", voiceURI); } catch {} }, [voiceURI]);
  useEffect(() => {
    try {
      const r = parseFloat(localStorage.getItem("reader.rate") || ""); if (!isNaN(r)) setRate(r);
      const p = parseFloat(localStorage.getItem("reader.pitch") || ""); if (!isNaN(p)) setPitch(p);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("reader.rate", String(rate)); } catch {} }, [rate]);
  useEffect(() => { try { localStorage.setItem("reader.pitch", String(pitch)); } catch {} }, [pitch]);

  // sayfadan cikinca konusmayi durdur
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch {} }, []);

  const trVoices = useMemo(() => voices.filter((v) => v.lang?.toLowerCase().startsWith("tr")), [voices]);
  const listed = trVoices.length ? trVoices : voices.slice(0, 12);

  async function explain() {
    setErr(""); setBusy(true); stop();
    try {
      const pageText = (getPageText(page) || "").trim();
      const r = await api(`/documents/${documentId}/explain-page`, {
        method: "POST",
        body: JSON.stringify({ text: pageText.slice(0, 8000), page }),
      });
      setText(r.explanation || "");
      setExplainedPage(page);
    } catch (e: any) {
      setErr(e?.message || "Anlatım oluşturulamadı. Sunucu uyanıyor olabilir, tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  function speak() {
    if (!text || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.voiceURI === voiceURI);
    if (v) u.voice = v;
    u.lang = v?.lang || "tr-TR";
    u.rate = rate;
    u.pitch = pitch;   // ton: yukseltince ses incelir/yumusar
    u.volume = 1;
    u.onend = () => { setSpeaking(false); setPaused(false); };
    u.onerror = () => { setSpeaking(false); setPaused(false); };
    uttRef.current = u;
    window.speechSynthesis.speak(u);
    setSpeaking(true); setPaused(false);
  }
  function toggle() {
    if (!window.speechSynthesis) return;
    if (!speaking) return speak();
    if (paused) { window.speechSynthesis.resume(); setPaused(false); }
    else { window.speechSynthesis.pause(); setPaused(true); }
  }
  function stop() {
    try { window.speechSynthesis?.cancel(); } catch {}
    setSpeaking(false); setPaused(false);
  }

  const stale = explainedPage !== null && explainedPage !== page;

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <button
        onClick={explain}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-purple px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        <Sparkles size={16} />
        {busy ? "Hazırlanıyor…" : `Bu sayfayı anlat (s.${page})`}
      </button>

      {stale && !busy && (
        <p className="mt-2 text-center text-xs text-text-secondary">
          Sayfa {explainedPage} anlatıldı. Yeni sayfa için tekrar bas.
        </p>
      )}
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}

      {text && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={toggle}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-black/5"
            >
              {speaking && !paused ? <Pause size={15} /> : <Play size={15} />}
              {speaking && !paused ? "Duraklat" : speaking ? "Devam" : "Sesli oku"}
            </button>
            {speaking && (
              <button onClick={stop} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-black/5">
                <Square size={14} /> Durdur
              </button>
            )}
          </div>

          <div className="mt-3 space-y-2 rounded-xl border bg-surface-muted p-3">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <Volume2 size={14} /> Ses
            </label>
            <select
              value={voiceURI}
              onChange={(e) => { setVoiceURI(e.target.value); stop(); }}
              className="w-full rounded-lg border bg-surface px-2 py-1.5 text-sm outline-none"
            >
              {listed.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} {v.lang ? `(${v.lang})` : ""}
                </option>
              ))}
            </select>
            {!trVoices.length ? (
              <p className="text-xs text-text-secondary">
                Cihazında Türkçe ses bulunamadı. Windows&apos;ta Ayarlar → Saat ve Dil → Konuşma bölümünden
                Türkçe ses paketi ekleyebilirsin.
              </p>
            ) : trVoices.length === 1 ? (
              <p className="text-xs text-text-secondary">
                Cihazında tek Türkçe ses var. Kadın sesi için Windows Ayarlar → Saat ve Dil → Konuşma →
                &quot;Ses ekle&quot; bölümünden Türkçe ses paketlerini kontrol et. Şimdilik alttaki
                <b> Ton</b> ayarını sağa çekerek sesi inceltebilirsin.
              </p>
            ) : null}
            <label className="mt-1 block text-xs text-text-secondary">Hız: {rate.toFixed(2)}x</label>
            <input
              type="range" min={0.6} max={1.4} step={0.05} value={rate}
              onChange={(e) => { setRate(parseFloat(e.target.value)); }}
              className="w-full accent-accent-purple"
            />
            <label className="mt-1 block text-xs text-text-secondary">
              Ton: {pitch.toFixed(2)} <span className="opacity-70">(sağa çekince ses incelir)</span>
            </label>
            <input
              type="range" min={0.7} max={2} step={0.05} value={pitch}
              onChange={(e) => { setPitch(parseFloat(e.target.value)); }}
              className="w-full accent-accent-purple"
            />
            <button
              onClick={() => { stop(); setTimeout(speak, 60); }}
              disabled={!text}
              className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs text-text-secondary hover:bg-black/5 disabled:opacity-50"
            >
              Bu ayarla dene
            </button>
          </div>

          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        </>
      )}

      {!text && !busy && !err && (
        <p className="mt-6 text-center text-sm text-text-secondary">
          Açık olan sayfayı sade dille anlatır, istersen sesli okur.
        </p>
      )}
    </div>
  );
}
