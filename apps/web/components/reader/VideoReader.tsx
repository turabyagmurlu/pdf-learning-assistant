"use client";
/**
 * YouTube kaynagi icin okuyucu: solda ozet/kavramlar, ortada video + zaman
 * damgali dokum (oynayan bolum vurgulanir, satira tiklayinca o saniyeye atlar),
 * sagda kaynakli sohbet. PDF'teki "sayfa" = videodaki 2 dakikalik bolum.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { stageInfo } from "@/lib/docstage";
import { ExternalLink, Loader2, Search } from "lucide-react";

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
  const [secs, setSecs] = useState<Section[] | null>(null);
  const [now, setNow] = useState(0);
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const playerRef = useRef<any>(null);
  const holder = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(null);

  // dokum (hazir olana kadar yokla)
  useEffect(() => {
    let alive = true, t: any;
    async function load() {
      try {
        const r = await api(`/documents/${id}/transcript`);
        if (!alive) return;
        if (r.ready) setSecs(r.sections || []);
        else t = setTimeout(load, 5000);
      } catch { if (alive) t = setTimeout(load, 8000); }
    }
    load();
    return () => { alive = false; clearTimeout(t); };
  }, [id, doc.status]);

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
    const t = setInterval(() => {
      try {
        const cur = playerRef.current?.getCurrentTime?.();
        if (typeof cur === "number") { setNow(cur); if (cur > 1) localStorage.setItem(`video.pos.${id}`, String(cur)); }
      } catch {}
    }, 700);
    return () => { alive = false; clearInterval(t); try { playerRef.current?.destroy?.(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vid]);

  function seek(sec: number, play = true) {
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
        box.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
    }
  }, [active, follow, q]);

  const needle = q.trim().toLowerCase();
  const view = (secs || []).map((s, i) => ({ s, i, lines: needle ? s.lines.filter((l) => l.x.toLowerCase().includes(needle)) : s.lines }))
    .filter((v) => !needle || v.lines.length);
  const st = stageInfo({ ...doc, source_type: "youtube" });

  return (
    <div className="flex h-screen flex-col lg:flex-row">
      {/* sol: bilgi */}
      <aside className="hidden w-72 shrink-0 overflow-auto border-r bg-surface p-4 xl:block">
        <h2 className="font-heading text-lg leading-tight">{doc.title}</h2>
        <p className="mt-1 text-xs text-text-secondary">
          {media.channel ? media.channel + " · " : ""}{media.duration ? fmt(media.duration) : ""}
          {media.method ? " · " + (media.method === "altyazi" ? "altyazıdan" : "yapay zekâ dökümü") : ""}
        </p>
        <a href={doc.source_url || `https://www.youtube.com/watch?v=${vid}`} target="_blank" rel="noreferrer"
           className="mt-2 inline-flex items-center gap-1 text-xs text-accent-purple hover:underline">
          YouTube'da aç <ExternalLink size={12} />
        </a>
        {doc.status !== "ready" ? (
          <p className="mt-4 text-sm text-text-secondary">
            {doc.status === "failed" ? `⚠️ ${doc.error_message}` : `${st.label}…`}
          </p>
        ) : (
          <>
            {doc.short_summary && <p className="mt-4 text-sm leading-relaxed text-text-secondary">{doc.short_summary}</p>}
            {toArr(doc.key_concepts).length > 0 && (
              <div className="mt-5">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">Anahtar kavramlar</p>
                <div className="flex flex-wrap gap-1.5">
                  {toArr(doc.key_concepts).map((k, i) => (
                    <span key={i} title={k?.definition || ""} className="rounded-full bg-accent-amber/15 px-2.5 py-0.5 text-xs text-accent-amber">
                      {typeof k === "string" ? k : (k?.term || "")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </aside>

      {/* orta: video + dokum */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 bg-black">
          <div className="mx-auto aspect-video max-h-[52vh] w-full max-w-[calc(52vh*16/9)]">
            <div ref={holder} className="h-full w-full" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <h3 className="truncate text-sm font-medium xl:hidden">{doc.title}</h3>
          <div className="ml-auto flex items-center gap-1.5 rounded-lg border bg-surface px-2 py-1">
            <Search size={14} className="text-text-secondary" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dökümde ara…"
                   className="w-40 bg-transparent text-sm outline-none" />
          </div>
        </div>
        <div ref={listRef} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}
             className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {secs === null ? (
            <div className="flex items-center gap-2 p-6 text-sm text-text-secondary">
              <Loader2 size={16} className="animate-spin" />
              {doc.status === "failed" ? doc.error_message : `Döküm hazırlanıyor · ${st.label}`}
            </div>
          ) : !view.length ? (
            <p className="p-6 text-sm text-text-secondary">{needle ? "Eşleşme yok." : "Döküm boş."}</p>
          ) : view.map(({ s, i, lines }) => (
            <section key={s.page} data-sec={i}
                     className={"mb-3 rounded-xl border p-3 transition " + (i === active ? "border-red-400/60 bg-red-500/5" : "bg-surface")}>
              <button onClick={() => seek(s.start)}
                      className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:text-red-600">
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
            <button onClick={() => setFollow(true)}
                    className="sticky bottom-2 left-full rounded-full bg-red-600 px-3 py-1 text-xs text-white shadow">
              Oynayan yere dön
            </button>
          )}
        </div>
      </main>

      {/* sag: sohbet */}
      <aside className="flex h-[45vh] shrink-0 flex-col border-t bg-surface lg:h-auto lg:w-[400px] lg:border-l lg:border-t-0">
        <div className="min-h-0 flex-1">
          <ChatPanel documentId={id} onGoPage={goPage} video />
        </div>
      </aside>
    </div>
  );
}
