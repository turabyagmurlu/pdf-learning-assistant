"use client";
import { useEffect, useRef, useState } from "react";
import { api, API, getToken } from "@/lib/api";
import { Sparkles, Play, Pause, Square, Volume2, Loader2 } from "lucide-react";

type Voice = { id: string; label: string };

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

  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("Sulafat");
  const [audioBusy, setAudioBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string>("");

  // ses listesini yukle
  useEffect(() => {
    (async () => {
      try {
        const r = await api("/tts/voices");
        if (r?.voices?.length) {
          setVoices(r.voices);
          let pick = r.default || r.voices[0].id;
          try {
            const saved = localStorage.getItem("reader.voiceId");
            if (saved && r.voices.some((v: Voice) => v.id === saved)) pick = saved;
          } catch {}
          setVoice(pick);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => { try { localStorage.setItem("reader.voiceId", voice); } catch {} }, [voice]);
  useEffect(() => { try { const s = parseFloat(localStorage.getItem("reader.rate") || ""); if (!isNaN(s)) setRate(s); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem("reader.rate", String(rate)); } catch {} }, [rate]);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);

  function stopAudio() {
    try {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ""; }
    } catch {}
    setPlaying(false); setPaused(false);
  }

  // sayfadan cikinca sesi durdur
  useEffect(() => () => { stopAudio(); }, []);

  async function explain() {
    setErr(""); setBusy(true); stopAudio();
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

  async function speak() {
    if (!text) return;
    setErr(""); setAudioBusy(true); stopAudio();
    try {
      const res = await fetch(`${API}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) {
        let msg = "Seslendirme yapılamadı.";
        try { const j = await res.json(); msg = j?.error?.user_message || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const a = new Audio(url);
      a.playbackRate = rate;
      a.onended = () => { setPlaying(false); setPaused(false); };
      a.onerror = () => { setPlaying(false); setPaused(false); };
      audioRef.current = a;
      await a.play();
      setPlaying(true); setPaused(false);
    } catch (e: any) {
      setErr(e?.message || "Seslendirme yapılamadı.");
    } finally {
      setAudioBusy(false);
    }
  }

  function toggle() {
    const a = audioRef.current;
    if (!a || !urlRef.current) { speak(); return; }
    if (a.paused) { a.play(); setPaused(false); setPlaying(true); }
    else { a.pause(); setPaused(true); }
  }

  const stale = explainedPage !== null && explainedPage !== page;

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <button
        onClick={explain}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-purple px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
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
              disabled={audioBusy}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-60"
            >
              {audioBusy ? <Loader2 size={15} className="animate-spin" />
                : playing && !paused ? <Pause size={15} /> : <Play size={15} />}
              {audioBusy ? "Ses hazırlanıyor…" : playing && !paused ? "Duraklat" : paused ? "Devam" : "Sesli oku"}
            </button>
            {(playing || paused) && (
              <button onClick={stopAudio} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-black/5">
                <Square size={14} /> Durdur
              </button>
            )}
          </div>

          <div className="mt-3 space-y-2 rounded-xl border bg-surface-muted p-3">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <Volume2 size={14} /> Kadın sesi
            </label>
            <select
              value={voice}
              onChange={(e) => { setVoice(e.target.value); stopAudio(); }}
              className="w-full rounded-lg border bg-surface px-2 py-1.5 text-sm outline-none"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>{v.label} ({v.id})</option>
              ))}
            </select>
            <p className="text-xs text-text-secondary">
              Ses yapay zekâ ile üretilir; ilk okumada birkaç saniye sürebilir.
            </p>

            <label className="mt-1 block text-xs text-text-secondary">Hız: {rate.toFixed(2)}x</label>
            <input
              type="range" min={0.7} max={1.5} step={0.05} value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-full accent-accent-purple"
            />
            <button
              onClick={speak}
              disabled={audioBusy || !text}
              className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs text-text-secondary hover:bg-black/5 disabled:opacity-50"
            >
              Bu sesle yeniden oku
            </button>
          </div>

          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        </>
      )}

      {!text && !busy && !err && (
        <p className="mt-6 text-center text-sm text-text-secondary">
          Açık olan sayfayı sade dille anlatır, doğal kadın sesiyle okur.
        </p>
      )}
    </div>
  );
}
