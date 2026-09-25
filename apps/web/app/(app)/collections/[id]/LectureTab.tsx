"use client";
/**
 * Sesli ozet: defterdeki hazir kaynaklar tek akici metne cevrilir, anlatici sesiyle dinlenir.
 * Metin ve ses cihazda saklanir; ayni metin/ses ikinci kez uretilmez (ucretsiz).
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Headphones, Volume2 } from "lucide-react";
import { api, API, getToken } from "@/lib/api";
import PodcastPlayer from "@/components/PodcastPlayer";
import BrowserVoice, { browserVoiceSupported } from "@/components/BrowserVoice";
import { Cost, costTitle, isUsageLimit } from "@/components/CostBadge";
import type { ConfirmOptions } from "@/components/Confirm";

export default function LectureTab({ id, title, readyN, confirm }: {
  id: string; title: string; readyN: number;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
}) {
  const LEC_KEY = "lecture.text." + id;
  const VOICE_KEY = "lecture.voice";
  const [lecBusy, setLecBusy] = useState(false);
  const [lecture, setLecture] = useState("");
  const [lecErr, setLecErr] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const audioUrlRef = useRef<string>("");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const [voice, setVoice] = useState("");
  const [voiceList, setVoiceList] = useState<{ id: string; label: string }[]>([]);
  const AUDIO_KEY = "/typdf-audio/lecture/" + id + (voice ? "/" + voice : "");
  const [audioPct, setAudioPct] = useState(0);
  const [audioNote, setAudioNote] = useState("");
  const [quotaOut, setQuotaOut] = useState(false);   // kullanim doldu / ses yogun -> cihaz sesi oner
  const [useBrowserVoice, setUseBrowserVoice] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => { setCanSpeak(browserVoiceSupported()); }, []);

  // ~2600 karakter = 1 seslendirme kullanimi
  const ttsParts = Math.max(1, Math.ceil(Math.min(lecture.length, 12000) / 2600));

  function stopAudio() {
    try { if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = ""; } } catch {}
    setAudioUrl("");
  }
  useEffect(() => () => { stopAudio(); }, []);

  useEffect(() => {
    try { const t = localStorage.getItem(LEC_KEY); if (t) setLecture(t); } catch {}
    try { const v = localStorage.getItem(VOICE_KEY); if (v) setVoice(v); } catch {}
    (async () => {
      try { const r = await api("/tts/voices"); setVoiceList(r.voices || []); setVoice((v) => v || r.default || ""); }
      catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        if (!("caches" in window)) { setAudioReady(false); return; }
        const c = await caches.open("typdf-audio");
        setAudioReady(!!(await c.match(AUDIO_KEY)));
      } catch { setAudioReady(false); }
    })();
  }, [AUDIO_KEY]);

  async function makeLecture(refresh = false) {
    if (refresh) {
      const ok = await confirm({
        title: "Özet sıfırdan yeniden yazılsın mı?",
        description: "Şu anki özet metni yerine yepyeni bir metin yazılır. Bu 1 yapay zekâ kullanımı harcar.",
        losses: ["Kayıtlı özet metni değişir",
                 "Hazırlanan ses geçersiz olur; dinlemek için yeniden hazırlanması gerekir (⚡)"],
        confirmLabel: "Yeniden yaz",
      });
      if (!ok) return;
    }
    setLecBusy(true); setLecErr(""); stopAudio();
    setUseBrowserVoice(false); setQuotaOut(false);
    try {
      const r = await api(`/collections/${id}/lecture` + (refresh ? "?refresh=1" : ""), { method: "POST" }, 1);
      const s = r?.script || "";
      setLecture(s);
      try { localStorage.setItem(LEC_KEY, s); } catch {}
      if (refresh) {
        setAudioReady(false);
        try { localStorage.removeItem("lecture.pos." + id); } catch {}
        try { if ("caches" in window) { const c = await caches.open("typdf-audio"); await c.delete(AUDIO_KEY); } } catch {}
      }
    } catch (e: any) {
      if (isUsageLimit(e)) setQuotaOut(true);
      setLecErr(e?.message || "Sesli özet hazırlanamadı; birazdan tekrar dene.");
    } finally { setLecBusy(false); }
  }

  // Ses ornegi: tek cumle; onbelleklendigi icin ikinci kez ucretsiz.
  const [sampling, setSampling] = useState("");
  const sampleRef = useRef<HTMLAudioElement | null>(null);
  async function sampleVoice(v: string) {
    setSampling(v); setLecErr("");
    const guard = setTimeout(() => setSampling(""), 45000);
    const ac = new AbortController();
    const netTimer = setTimeout(() => ac.abort(), 40000);
    try {
      const res = await fetch(`${API}/tts`, {
        method: "POST", signal: ac.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({ text: "Merhaba, bu defterdeki kaynakları sana bu sesle anlatacağım.", voice: v }),
      });
      clearTimeout(netTimer);
      if (!res.ok) {
        let m = "Örnek dinlenemedi; birazdan tekrar dene.";
        try { const j = await res.json(); if (typeof j?.error?.user_message === "string") m = j.error.user_message; } catch {}
        if (res.status === 429 || res.status === 503) setQuotaOut(true);
        throw new Error(m);
      }
      const blob = await res.blob();
      if (blob.size < 1000) throw new Error("Ses boş geldi; tekrar dene.");
      const url = URL.createObjectURL(blob);
      try { sampleRef.current?.pause(); } catch {}
      const a = new Audio(url); sampleRef.current = a;
      a.onended = () => URL.revokeObjectURL(url);
      a.play().catch(() => setLecErr("Tarayıcı sesi engelledi; sayfaya bir kez dokunup tekrar dene."));
    } catch (e: any) {
      setLecErr(e?.name === "AbortError" ? "Örnek zaman aşımına uğradı; tekrar dene." : (e?.message || "Örnek dinlenemedi."));
    } finally { clearTimeout(netTimer); clearTimeout(guard); setSampling(""); }
  }
  useEffect(() => () => { try { sampleRef.current?.pause(); } catch {} }, []);

  async function playLecture() {
    if (!lecture) return;
    setAudioBusy(true); setLecErr(""); setAudioPct(0); setAudioNote("");
    setQuotaOut(false); stopAudio();
    try {
      let blob: Blob | null = null;
      try {
        if ("caches" in window) {
          const c = await caches.open("typdf-audio");
          const hit = await c.match(AUDIO_KEY);
          if (hit) blob = await hit.blob();
        }
      } catch {}
      if (!blob) {
        const job = await api("/tts/jobs", { method: "POST", body: JSON.stringify({ text: lecture.slice(0, 12000), voice: voice || undefined }) }, 1);
        const jid = job.job_id;
        let st: any = job.cached ? { status: "ready", done: job.total, total: job.total } : null;
        for (let i = 0; i < 240 && (!st || st.status === "running"); i++) {
          await new Promise((r) => setTimeout(r, 2000));
          st = await api(`/tts/jobs/${jid}`);
          if (st.total) setAudioPct(Math.round((st.done / st.total) * 100));
          setAudioNote(st.note || "");
          if (st.status === "ready") break;
          if (st.status === "error") {
            const err: any = new Error(st.error || "Seslendirme şu an yapılamadı; biraz sonra tekrar dene ya da cihaz sesiyle dinle.");
            err.quota = !!st.quota;
            throw err;
          }
        }
        if (!st || st.status !== "ready") throw new Error("Seslendirme çok uzun sürdü; biraz sonra tekrar dene.");
        const res = await fetch(`${API}/tts/jobs/${jid}/audio`, { headers: { Authorization: "Bearer " + getToken() } });
        if (!res.ok) throw new Error("Ses indirilemedi; tekrar dene.");
        blob = await res.blob();
        try {
          if ("caches" in window) {
            const c = await caches.open("typdf-audio");
            await c.put(AUDIO_KEY, new Response(blob, { headers: { "Content-Type": blob.type || "audio/wav" } }));
            setAudioReady(true);
          }
        } catch {}
      }
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      setAudioUrl(url);
    } catch (e: any) {
      if (e?.quota || isUsageLimit(e) || e?.code === "AI_BUSY") setQuotaOut(true);
      setLecErr(String(e?.message || "") || "Seslendirme yapılamadı; biraz sonra tekrar dene.");
    } finally { setAudioBusy(false); setAudioPct(0); setAudioNote(""); }
  }

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-text-secondary">
        Bu defterdeki {readyN} hazır kaynağı tek bir akıcı sesli özete çeviririm; yolda dinlersin.
        Özeti hazırlamak 1, seslendirmek metin uzunluğuna göre birkaç yapay zekâ kullanımı harcar; hazır olan ses cihazında saklanır.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => makeLecture(!!lecture)} disabled={lecBusy} title={costTitle(1)}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm text-white disabled:opacity-60">
          {lecBusy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
          {lecBusy ? "Özet hazırlanıyor…" : lecture ? "Yeniden hazırla" : "Özeti hazırla"}
          {!lecBusy && <Cost n={1} className="bg-white/20" />}
        </button>
        {lecture && !audioUrl && (
          <button onClick={playLecture} disabled={audioBusy} title={audioReady ? "Ses cihazında hazır · ücretsiz" : costTitle(ttsParts)}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-xl border px-4 text-sm hover:bg-black/5 disabled:opacity-60">
            {audioBusy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
            {audioBusy ? (audioPct > 0 ? `Ses hazırlanıyor… %${audioPct}` : "Ses hazırlanıyor…") : audioReady ? "Dinle · hazır" : <>Dinle <Cost n={ttsParts} /></>}
          </button>
        )}
      </div>

      {lecture && voiceList.length > 0 && (
        <div className="mt-4 rounded-2xl border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Anlatıcı sesi</span>
            <span className="text-xs text-text-secondary">· hepsi kadın sesi, doğal tonlama</span>
          </div>
          <div role="radiogroup" aria-label="Anlatıcı sesi" className="mt-3 flex flex-wrap gap-1.5">
            {voiceList.map((v) => (
              <button key={v.id} role="radio" aria-checked={voice === v.id}
                      onClick={() => { setVoice(v.id); try { localStorage.setItem(VOICE_KEY, v.id); } catch {} stopAudio(); }}
                      className={"min-h-[40px] rounded-xl border px-3 py-1.5 text-xs " +
                        (voice === v.id ? "border-accent-purple bg-accent-purple/10 font-semibold text-text-primary" : "hover:bg-black/5")}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => sampleVoice(voice)} disabled={!voice || !!sampling} title={costTitle(1) + " (aynı örnek ikinci kez ücretsiz)"}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-60">
              {sampling ? <Loader2 size={13} className="animate-spin" /> : <Volume2 size={13} />}
              {sampling ? "Örnek hazırlanıyor…" : <>Bu sesi dinle <Cost n={1} /></>}
            </button>
            <span className="text-xs text-text-secondary">
              Sesi değiştirirsen özet o sesle yeniden seslendirilir; her ses ayrı saklanır.
            </span>
          </div>
        </div>
      )}

      {lecture && canSpeak && !useBrowserVoice && (
        <button onClick={() => { stopAudio(); setUseBrowserVoice(true); }}
                className="mt-3 min-h-[40px] text-xs text-text-secondary underline underline-offset-4 hover:text-text-primary">
          Cihazının kendi sesiyle dinle (ücretsiz, daha robotik)
        </button>
      )}
      {audioBusy && audioNote && <p role="status" className="mt-3 text-sm text-text-secondary">{audioNote}</p>}
      {lecErr && (
        <div role={quotaOut ? "status" : "alert"} className={"mt-3 rounded-xl px-4 py-3 text-sm " + (quotaOut ? "border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "")}>
          <p className={quotaOut ? "" : "text-danger"}>{lecErr}</p>
          {quotaOut && canSpeak && lecture && (
            <button onClick={() => { setLecErr(""); setUseBrowserVoice(true); }}
                    className="mt-2 flex min-h-[40px] items-center gap-1.5 rounded-lg bg-accent-purple px-3 text-white">
              <Volume2 size={14} /> Cihaz sesiyle dinle (ücretsiz)
            </button>
          )}
        </div>
      )}
      {useBrowserVoice && lecture && (
        <div className="mt-4"><BrowserVoice text={lecture} onClose={() => setUseBrowserVoice(false)} /></div>
      )}
      {audioUrl && (
        <div className="mt-4">
          <PodcastPlayer src={audioUrl} title={title} subtitle={`Sesli özet · ${readyN} kaynak`}
                         artwork="/icon" storageKey={"lecture.pos." + id} autoPlay />
          <p className="mt-2 text-xs text-text-secondary">
            Ekran kilitliyken kulaklık/bildirim tuşlarıyla kontrol edebilirsin. Kaldığın yer hatırlanır; ses cihazda saklanır, tekrar hazırlanmaz.
          </p>
        </div>
      )}
      {lecture && (
        <details className="mt-4 rounded-2xl border bg-surface p-4" open={!audioUrl}>
          <summary className="cursor-pointer text-sm font-medium">Özet metni</summary>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{lecture}</p>
        </details>
      )}
    </div>
  );
}
