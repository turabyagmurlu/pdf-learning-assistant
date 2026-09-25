"use client";
/**
 * YouTube kaynagi icin okuyucu: solda ozet/kavramlar, ortada video + zaman
 * damgali dokum (oynayan bolum vurgulanir, satira tiklayinca o saniyeye atlar),
 * sagda kaynakli sohbet. PDF'teki "sayfa" = videodaki 2 dakikalik bolum.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { usePoll } from "@/hooks/usePoll";
import { ChatPanel } from "@/components/chat/ChatPanel";
import ReaderHeader, { useNotebookContext, notebookHref, useMedia } from "@/components/reader/ReaderHeader";
import Modal from "@/components/Modal";
import { stageInfo } from "@/lib/docstage";
import { ExternalLink, Loader2, Search, Info, MessageSquare } from "lucide-react";

declare global { interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void } }

type Line = { t: number; x: string };
type Section = { page: number; start: number; end: number; lines: Line[] };

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(r).padStart(2, "0");
}
function toArr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

let ytReady: Promise<any> | null = null;
function loadYT(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject();
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytReady) {
    ytReady = new Promise((res) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); res(window.YT); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      document.head.appendChild(s);
    });
  }
  return ytReady;
}

export default function VideoReader({ id, doc }: { id: string; doc: any }) {
  const media = (typeof doc.media === "string" ? JSON.parse(doc.media) : doc.media) || {};
  const vid: string = media.video_id;
  const isAudio = doc.source_type === "audio";
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState("");
  useEffect(() => {
    if (!isAudio) return;
    api(`/documents/${id}/file`).then((r) => setAudioUrl(r.url)).catch(() => {});
  }, [id, isAudio]);
  // ses oynatici: zamani takip et, acilista kaldigi yerden / ?page=N'den basla
  useEffect(() => {
    if (!isAudio) return;
    let last = -1;
    const t = setInterval(() => {
      const a = audioRef.current; if (!a) return;
      const cur = Math.floor(a.currentTime);
      if (cur === last) return;
      last = cur;
      setNow(a.currentTime); if (a.currentTime > 1) { try { localStorage.setItem(`video.pos.${id}`, String(a.currentTime)); } catch {} }
    }, 1000);
    return () => clearInterval(t);
  }, [isAudio, id]);
  const [secs, setSecs] = useState<Section[] | null>(null);
  const [now, setNow] = useState(0);
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const playerRef = useRef<any>(null);
  const holder = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const ctx = useNotebookContext(doc);
  const isLg = useMedia("(min-width: 1024px)");
  const isXl = useMedia("(min-width: 1280px)");
  const [infoOpen, setInfoOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // dokum: hazir olana kadar yokla (sekme gizliyken / cevrimdisiyken durur)
  async function loadTranscript(): Promise<boolean> {
    const r = await api(`/documents/${id}/transcript`, {}, 1);
    if (r.ready) { setSecs(r.sections || []); return true; }
    return false;
  }
  useEffect(() => { setSecs(null); loadTranscript().catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, doc.status]);
  usePoll(loadTranscript, { active: secs === null && doc.status !== "failed", base: 5000, max: 15000 });

  // ?page=N -> o bolumun basindan baslat
  function startFromUrl(list: Section[] | null): number {
    try {
      const n = parseInt(new URLSearchParams(window.location.search).get("page") || "", 10);
      const ss = media.sections || list || [];
      const hit = ss.find((s: any) => s.page === n);
      if (hit) return Math.floor(hit.start);
      const saved = parseFloat(localStorage.getItem(`video.pos.${id}`) || "");
      return !isNaN(saved) ? Math.floor(saved) : 0;
    } catch { return 0; }
  }

  // oynatici
  useEffect(() => {
    if (!vid) return;
    let alive = true;
    loadYT().then((YT) => {
      if (!alive || !holder.current) return;
      const el = document.createElement("div");
      holder.current.innerHTML = ""; holder.current.appendChild(el);
      playerRef.current = new YT.Player(el, {
        videoId: vid, width: "100%", height: "100%",
        playerVars: { start: startFromUrl(null), rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => {
            if (pendingSeek.current != null) { playerRef.current?.seekTo(pendingSeek.current, true); pendingSeek.current = null; }
          },
        },
      });
    }).catch(() => {});
    let last = -1;
    const t = setInterval(() => {
      try {
        const cur = playerRef.current?.getCurrentTime?.();
        if (typeof cur !== "number" || Math.floor(cur) === last) return;
        last = Math.floor(cur);
        setNow(cur); if (cur > 1) localStorage.setItem(`video.pos.${id}`, String(cur));
      } catch {}
    }, 1000);
    return () => { alive = false; clearInterval(t); try { playerRef.current?.destroy?.(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vid]);

  function seek(sec: number, play = true) {
    if (isAudio) {
      const a = audioRef.current;
      if (a) { a.currentTime = sec; if (play) a.play().catch(() => {}); setNow(sec); setFollow(true); }
      else pendingSeek.current = sec;
      return;
    }
    const p = playerRef.current;
    if (p?.seekTo) { p.seekTo(sec, true); if (play) p.playVideo?.(); setNow(sec); setFollow(true); }
    else pendingSeek.current = sec;
  }
  function goPage(pg: number) {
    const ss: any[] = secs || media.sections || [];
    const hit = ss.find((s) => s.page === pg);
    if (hit) seek(hit.start);
  }

  // oynayan bolumu gorunur tut
  const active = (secs || []).findIndex((s) => now >= s.start && now < s.end);
  useEffect(() => {
    if (!follow || active < 0 || q) return;
    const el = listRef.current?.querySelector(`[data-sec="${active}"]`) as HTMLElement | null;
    if (el && listRef.current) {
      const box = listRef.current;
      if (el.offsetTop < box.scrollTop || el.offsetTop > box.scrollTop + box.clientHeight - 80)
        box.scrollTo({ top: el.offsetTop - 12, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, [active, follow, q]);

  const needle = q.trim().toLowerCase();
  const view = (secs || []).map((s, i) => ({ s, i, lines: needle ? s.lines.filter((l) => l.x.toLowerCase().includes(needle)) : s.lines }))
    .filter((v) => !needle || v.lines.length);
  const st = stageInfo({ ...doc, source_type: isAudio ? "audio" : "youtube" });

  const info = (
    <>
        <p className="mt-1 text-xs text-text-secondary">
          {media.channel ? media.channel + " · " : ""}{media.duration ? fmt(media.duration) : ""}
          {media.method ? " · " + (media.method === "altyazi" ? "altyazıdan" : "yapay zekâ dökümü") : ""}
        </p>
        {!isAudio && (
          <a href={doc.source_url || `https://www.youtube.com/watch?v=${vid}`} target="_blank" rel="noreferrer"
             className="mt-2 inline-flex min-h-[40px] items-center gap-1 text-xs text-accent-purple hover:underline">
            YouTube'da aç <ExternalLink size={12} aria-hidden /><span className="sr-only"> (yeni sekmede açılır)</span>
          </a>
        )}
        {doc.status !== "ready" ? (
          <p className="mt-4 text-sm text-text-secondary">
            {doc.status === "failed" ? `⚠️ ${doc.error_message || "Bu kaynak işlenemedi."}` : `${st.label}…`}
          </p>
        ) : (
          <>
            {doc.short_summary && <p className="mt-4 text-sm leading-relaxed text-text-secondary">{doc.short_summary}</p>}
            {toArr(doc.key_concepts).length > 0 && (
              <div className="mt-5">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">Anahtar kavramlar</h3>
                <div className="flex flex-wrap gap-1.5">
                  {toArr(doc.key_concepts).map((k, i) => (
                    <span key={i} title={k?.definition || ""} className="rounded-full bg-accent-amber/15 px-2.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">
                      {typeof k === "string" ? k : (k?.term || "")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
    </>
  );

  return (
    <div className="flex h-dvh flex-col">
    <ReaderHeader doc={doc} ctx={ctx}>
      {!isXl && (
        <button type="button" onClick={() => setInfoOpen(true)} aria-haspopup="dialog"
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-text-secondary hover:bg-surface-muted">
          <Info size={18} aria-hidden /> <span className="hidden sm:inline">Özet</span><span className="sr-only sm:hidden">Özet ve kavramlar</span>
        </button>
      )}
    </ReaderHeader>
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* sol: bilgi */}
      <aside className="hidden w-72 shrink-0 overflow-auto border-r bg-surface p-4 xl:block" aria-label="Özet ve kavramlar">
        <h2 className="font-heading text-lg leading-tight">{doc.title}</h2>
        {isXl && info}
      </aside>

      {/* orta: video + dokum */}
      <section aria-label={isAudio ? "Ses ve döküm" : "Video ve döküm"} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {isAudio ? (
          <div className="shrink-0 border-b bg-surface px-4 py-3">
            {audioUrl ? (
              <audio ref={audioRef} src={audioUrl} controls preload="metadata" className="w-full"
                     onLoadedMetadata={(e) => {
                       const a = e.currentTarget;
                       const want = pendingSeek.current ?? startFromUrl(secs);
                       if (want > 0) a.currentTime = want;
                       pendingSeek.current = null;
                     }} />
            ) : <p className="text-sm text-text-secondary">Ses yükleniyor…</p>}
          </div>
        ) : (
          <div className="shrink-0 bg-black">
            <div className="mx-auto aspect-video max-h-[52vh] w-full max-w-[calc(52vh*16/9)]">
              <div ref={holder} className="h-full w-full" />
            </div>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 sm:px-4">
          <label className="ml-auto flex min-h-[40px] min-w-0 items-center gap-1.5 rounded-lg border bg-surface px-2">
            <Search size={14} className="shrink-0 text-text-secondary" aria-hidden />
            <span className="sr-only">Dökümde ara</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dökümde ara…"
                   className="w-32 min-w-0 bg-transparent text-sm outline-none sm:w-40" />
          </label>
        </div>
        <div ref={listRef} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}
             className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {secs === null ? (
            <div className="flex items-center gap-2 p-6 text-sm text-text-secondary">
              {doc.status !== "failed" && <Loader2 size={16} className="animate-spin" aria-hidden />}
              <span role="status">{doc.status === "failed" ? (doc.error_message || "Bu kaynak işlenemedi.") : `Döküm hazırlanıyor · ${st.label}`}</span>
            </div>
          ) : !view.length ? (
            <p className="p-6 text-sm text-text-secondary">{needle ? "Eşleşme yok. Farklı bir kelime dene." : "Bu kaynaktan döküm çıkarılamadı. Kaynağı Kütüphane'den yeniden işlemeyi dene."}</p>
          ) : view.map(({ s, i, lines }) => (
            <section key={s.page} data-sec={i}
                     className={"mb-3 rounded-xl border p-3 transition " + (i === active ? "border-red-400/60 bg-red-500/5" : "bg-surface")}>
              <button type="button" onClick={() => seek(s.start)} aria-label={`Bölüm ${s.page}: ${fmt(s.start)} ile ${fmt(s.end)} arası, buradan oynat`}
                      className="mb-1 min-h-[36px] text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-red-700">
                ▶ {fmt(s.start)} – {fmt(s.end)} · bölüm {s.page}
              </button>
              <p className="text-sm leading-relaxed">
                {lines.map((l, k) => (
                  <span key={k} onClick={() => seek(l.t)} title={fmt(l.t) + " — buradan oynat"}
                        className={"cursor-pointer rounded px-0.5 hover:bg-red-500/10 " +
                          (now >= l.t && (k + 1 >= lines.length || now < lines[k + 1].t) && i === active ? "bg-red-500/15" : "")}>
                    {l.x}{" "}
                  </span>
                ))}
              </p>
            </section>
          ))}
          {!follow && active >= 0 && !q && (
            <button type="button" onClick={() => setFollow(true)}
                    className="sticky bottom-2 left-full min-h-[40px] rounded-full bg-red-700 px-4 text-sm text-white shadow">
              Oynayan yere dön
            </button>
          )}
        </div>
      </section>

      {/* sag: sohbet (genis ekran) */}
      {isLg && (
        <aside className="flex w-[400px] shrink-0 flex-col border-l bg-surface" aria-label="Bu kaynağa sor">
          <div className="min-h-0 flex-1">
            <ChatPanel documentId={id} onGoPage={goPage} video={!isAudio} generic={isAudio} notebookHref={ctx.id ? notebookHref(ctx) : null} />
          </div>
        </aside>
      )}
    </div>

    {/* dar ekran: sohbet alttan acilan tabakada */}
    {!isLg && (
      <div className="shrink-0 border-t bg-surface px-3 pt-2" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={() => setChatOpen(true)} aria-haspopup="dialog"
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-accent-purple px-4 text-sm font-medium text-white">
          <MessageSquare size={17} aria-hidden /> Bu kaynağa sor
        </button>
      </div>
    )}
    {!isLg && (
      <Modal open={chatOpen} onClose={() => setChatOpen(false)} ariaLabel="Bu kaynağa sor" size="lg" className="h-[85dvh] p-0">
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatPanel documentId={id} onGoPage={(pg) => { setChatOpen(false); goPage(pg); }} video={!isAudio} generic={isAudio}
                     notebookHref={ctx.id ? notebookHref(ctx) : null} onClose={() => setChatOpen(false)} />
        </div>
      </Modal>
    )}
    {!isXl && (
      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title={doc.title || "Özet"} size="md">
        {info}
      </Modal>
    )}
    </div>
  );
}
