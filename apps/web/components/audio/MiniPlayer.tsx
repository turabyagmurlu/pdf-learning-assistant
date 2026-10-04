"use client";
/**
 * Kalıcı mini oynatıcı (V1): sesli özet çalarken başka sayfaya geçince altta "şimdi çalıyor" çubuğu.
 *  - Tam çubuk (varsayılan): sol kare kulaklık simgesi, defter adı + "sesli özet", ince ilerleme çizgisi,
 *    −15 sn, oynat/duraklat, kapat (×). Simge/ada dokununca defterin Sesli özet sekmesine gider.
 *    Telefonda alt menünün üstünde (--bottom-nav), tablet/masaüstünde içerik alanının altında (--sidebar-w'yi örtmez).
 *  - `compact` (okuyucu): sağ altta küçük yüzen kapsül (simge + oynat/duraklat); okuyucunun alt çubuğunun
 *    (--reader-bar) üstünde durur.
 *  - Görünürken :root'a `--mini-player-h` yazar (bildirimler ve sayfa alt boşluğu bunu hesaba katar).
 *  - İlgili defterin Sesli özet sekmesi açıkken gizlenir (orada tam oynatıcı var).
 *  - "listen" oturumlarında (Sor cevabı "Sesli dinle") ListenDock açıkken gizlenir; ada dokununca dock yeniden açılır.
 */
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Headphones, Pause, Play, RotateCcw, X, Loader2 } from "lucide-react";
import { useAudioPlayback, useAudioSession } from "@/components/audio/AudioProvider";
import { SKIP, fmt } from "@/components/AudioQueuePlayer";

/** Çubuğun yüksekliği (px); kapsülde 48 px kapsül + 8 px boşluk. */
export const MINI_PLAYER_H = 56;

export default function MiniPlayer({ compact = false }: { compact?: boolean }) {
  const { session, stop, update } = useAudioSession();
  const { q } = useAudioPlayback();
  const pathname = usePathname() || "";
  const sp = useSearchParams();

  const isListen = session?.kind === "listen";
  const onLectureTab = !!session && !isListen && pathname === `/collections/${session.collectionId}` && sp?.get("tab") === "sesli";
  const visible = !!session && !onLectureTab && !(isListen && session.dock);

  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.style.setProperty("--mini-player-h", MINI_PLAYER_H + "px");
    else root.style.removeProperty("--mini-player-h");
    return () => { root.style.removeProperty("--mini-player-h"); };
  }, [visible]);

  if (!session || !visible) return null;

  const href = session.href || `/collections/${session.collectionId}?tab=sesli`;
  const openDock = () => update(session.key, { dock: true });
  const kindLabel = isListen ? "Dinleme" : "Sesli özet";
  const preparing = !session.chunks || !q.firstReady;
  const pct = q.total > 0 ? Math.min(100, (q.time / q.total) * 100) : 0;
  const toggleLabel = q.waiting ? "Bekleniyor; durdur" : q.playing ? "Duraklat" : "Oynat";
  const status = session.lost ? "yarıda kaldı · yeniden başlatmak için dokun"
    : preparing ? "hazırlanıyor…"
    : q.waiting ? "sıradaki parça hazırlanıyor…"
    : `${fmt(q.time)} / ${fmt(q.total)}${q.chapterIndex >= 0 && q.chapters.length > 1 ? " · " + q.chapters[q.chapterIndex].title : ""}`;
  const toggle = () => { q.unlock(); q.toggle(); };
  const ToggleIcon = q.waiting ? <Loader2 size={20} className="animate-spin" aria-hidden />
    : q.playing ? <Pause size={20} aria-hidden /> : <Play size={20} className="ml-0.5" aria-hidden />;

  if (compact) {
    return (
      <div role="region" aria-label={`Şimdi çalıyor: ${session.title}, ${kindLabel.toLowerCase()}`}
           className="fixed z-[35] flex items-center gap-1 rounded-full border bg-surface/95 p-0.5 shadow-medium backdrop-blur"
           style={{ right: 12, bottom: "calc(var(--reader-bar, 0px) + env(safe-area-inset-bottom, 0px) + 12px)" }}>
        {isListen ? (
          <button type="button" onClick={openDock} aria-label={`${session.title}: oynatıcıyı aç`} title={session.title}
                  className="relative flex h-11 w-11 items-center justify-center rounded-full bg-accent-purple/15 text-accent-purple">
            <Headphones size={18} aria-hidden />
            <svg aria-hidden viewBox="0 0 44 44" className="pointer-events-none absolute inset-0 -rotate-90">
              <circle cx="22" cy="22" r="20" fill="none" stroke="currentColor" strokeWidth="2.5"
                      strokeDasharray={`${(pct / 100) * 125.66} 125.66`} strokeLinecap="round" />
            </svg>
          </button>
        ) : (
        <Link href={href} aria-label={`${session.title} sesli özetine git`} title={session.title}
              className="relative flex h-11 w-11 items-center justify-center rounded-full bg-accent-purple/15 text-accent-purple">
          <Headphones size={18} aria-hidden />
          {/* ilerleme halkası */}
          <svg aria-hidden viewBox="0 0 44 44" className="pointer-events-none absolute inset-0 -rotate-90">
            <circle cx="22" cy="22" r="20" fill="none" stroke="currentColor" strokeWidth="2.5"
                    strokeDasharray={`${(pct / 100) * 125.66} 125.66`} strokeLinecap="round" />
          </svg>
        </Link>
        )}
        <button type="button" onClick={toggle} aria-label={toggleLabel} title={toggleLabel}
                className="flex h-11 w-11 items-center justify-center rounded-full text-text-primary hover:bg-surface-muted">
          {ToggleIcon}
        </button>
      </div>
    );
  }

  return (
    <div role="region" aria-label={`Şimdi çalıyor: ${session.title}, ${kindLabel.toLowerCase()}`}
         className="bottom-nav fixed z-[35] border-t bg-surface/95 shadow-medium backdrop-blur"
         style={{ left: "var(--sidebar-w, 0px)", right: 0, bottom: "var(--bottom-nav, 0px)", height: MINI_PLAYER_H }}>
      {/* ince ilerleme çizgisi */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-surface-muted">
        <div className="h-full bg-accent-purple transition-[width]" style={{ width: pct + "%" }} />
      </div>
      <div className="mx-auto flex h-full max-w-5xl items-center gap-1 px-2 sm:px-4">
        {isListen ? (
          <button type="button" onClick={openDock} aria-label={`${session.title}: oynatıcıyı aç`}
                  className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-lg pr-2 text-left hover:bg-surface-muted">
            <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-purple/15 text-accent-purple">
              <Headphones size={20} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-text-primary">{session.title}</span>
              <span className="block truncate text-xs text-text-secondary">{kindLabel} · {status}</span>
            </span>
          </button>
        ) : (
        <Link href={href} aria-label={`${session.title} sesli özetine git`}
              className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-lg pr-2 hover:bg-surface-muted">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-purple/15 text-accent-purple">
            <Headphones size={20} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-text-primary">{session.title}</span>
            <span className="block truncate text-xs text-text-secondary">Sesli özet · {status}</span>
          </span>
        </Link>
        )}
        <button type="button" onClick={() => { q.unlock(); q.skip(-SKIP); }} disabled={preparing}
                aria-label={`${SKIP} saniye geri`} title={`${SKIP} sn geri`}
                className="flex h-11 min-w-[44px] items-center justify-center gap-0.5 rounded-lg px-1.5 text-text-secondary hover:bg-surface-muted hover:text-text-primary disabled:opacity-40">
          <RotateCcw size={18} aria-hidden /><span className="text-xs font-semibold" aria-hidden>{SKIP}</span>
        </button>
        <button type="button" onClick={toggle} aria-label={toggleLabel} title={toggleLabel}
                className="flex h-11 w-11 items-center justify-center rounded-full text-text-primary hover:bg-surface-muted">
          {ToggleIcon}
        </button>
        <button type="button" onClick={stop} aria-label={`${kindLabel} sesini kapat`} title="Kapat"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted hover:text-text-primary">
          <X size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}
