"use client";
/**
 * Kalıcı ses (V1): sesli özet sayfadan bağımsız yaşar; kullanıcı başka sayfaya geçince ses kesilmez.
 * (app) layout'ta bir kez sarılır. Tek global kuyruk: aynı anda tek sesli özet çalar.
 *
 *  - `useAudioSession()`  → oturum (hangi defter, parçalar, durum notu) + denetimler. Seyrek değişir.
 *      play({ collectionId, title, subtitle, storageKey, chunks?, total?, autoPlay? }) → { key, signal }
 *        Önceki oturumu kapatır (ses durur, blob adresleri bırakılır, süren iş `signal` ile iptal olur).
 *      update(key, { chunks, total, note, busy, lost })  → yalnız oturum hâlâ o `key` ise uygulanır.
 *      isCurrent(key), stop(), stopIf(collectionId)
 *  - `useAudioPlayback()` → kuyruk durumu/denetimleri (`q`: oynat, duraklat, ±15, ara…) + hız. Sık değişir
 *      (zaman ilerledikçe); yalnız oynatıcılar (tam oynatıcı, mini çubuk) kullanır.
 *
 * Media Session (kilit ekranı) ve kaldığı yerden devam burada; iOS kilidi için çağıran tıklama anında
 * `primeAudio()` çağırır, `play()` önceki öğeleri bırakır ve sıradaki parça ısıtılmış öğeleri kullanır.
 * Çıkışta ((app) dışına geçiş) sağlayıcı kalkar ve ses durur; başka sekmede çıkış yapılırsa da durur.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAudioQueue, useMediaSession, useQueueAutostart, type AudioQueue, type QueueChunk } from "@/hooks/useAudioQueue";

export type AudioSession = {
  key: number;
  collectionId: string;
  title: string;            // defter adı
  subtitle: string;         // ör. "Sesli özet · 3 kaynak"
  artwork?: string;
  storageKey: string;       // kaldığı yer (localStorage)
  autoPlay: boolean;
  chunks: QueueChunk[] | null;   // null: iş başlatılıyor
  total: number;            // beklenen parça sayısı (hazır olmayanlar dâhil)
  note: string;             // ek durum satırı (ör. kota beklemesi)
  busy: boolean;            // ilk parça bekleniyor
  lost: boolean;            // sunucudaki iş kayboldu ("Yeniden başlat")
};

export type AudioStart = {
  collectionId: string; title: string; subtitle: string; storageKey: string;
  artwork?: string; autoPlay?: boolean; chunks?: QueueChunk[] | null; total?: number;
};
export type AudioPatch = Partial<Pick<AudioSession, "chunks" | "total" | "note" | "busy" | "lost" | "title" | "subtitle">>;

type SessionCtx = {
  session: AudioSession | null;
  play: (s: AudioStart) => { key: number; signal: AbortSignal };
  update: (key: number, p: AudioPatch) => boolean;
  isCurrent: (key: number) => boolean;
  stop: () => void;
  stopIf: (collectionId: string) => void;
};
type PlaybackCtx = { q: AudioQueue; speed: number; setSpeed: (n: number) => void };

const SessionContext = createContext<SessionCtx | null>(null);
const PlaybackContext = createContext<PlaybackCtx | null>(null);
const EMPTY: QueueChunk[] = [];

function revoke(s: AudioSession | null) {
  s?.chunks?.forEach((c) => { if (c.url && c.url.startsWith("blob:")) { try { URL.revokeObjectURL(c.url); } catch {} } });
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AudioSession | null>(null);
  const sessionRef = useRef<AudioSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seq = useRef(0);

  const [speed, setSpeedState] = useState(1);
  useEffect(() => {
    try { const v = parseFloat(localStorage.getItem("lecture.speed") || "1"); if (v > 0) setSpeedState(v); } catch {}
  }, []);
  const setSpeed = useCallback((n: number) => {
    setSpeedState(n);
    try { localStorage.setItem("lecture.speed", String(n)); } catch {}
  }, []);

  const q = useAudioQueue(session?.chunks || EMPTY, { rate: speed, storageKey: session?.storageKey });
  const qRef = useRef(q); qRef.current = q;

  const commit = useCallback((next: AudioSession | null) => { sessionRef.current = next; setSession(next); }, []);

  const stop = useCallback(() => {
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;
    qRef.current.reset();
    const old = sessionRef.current;
    commit(null);
    revoke(old);
  }, [commit]);

  const play = useCallback((s: AudioStart) => {
    stop();
    const key = ++seq.current;
    const ac = new AbortController(); abortRef.current = ac;
    commit({
      key, collectionId: s.collectionId, title: s.title, subtitle: s.subtitle, artwork: s.artwork,
      storageKey: s.storageKey, autoPlay: s.autoPlay ?? true,
      chunks: s.chunks ?? null, total: s.total ?? s.chunks?.length ?? 0,
      note: "", busy: !s.chunks, lost: false,
    });
    return { key, signal: ac.signal };
  }, [stop, commit]);

  const update = useCallback((key: number, p: AudioPatch) => {
    const cur = sessionRef.current;
    if (!cur || cur.key !== key) return false;
    commit({ ...cur, ...p });
    return true;
  }, [commit]);

  const isCurrent = useCallback((key: number) => sessionRef.current?.key === key, []);
  const stopIf = useCallback((collectionId: string) => {
    if (sessionRef.current?.collectionId === collectionId) stop();
  }, [stop]);

  // Kaldığı yerden devam + otomatik başlatma (oturum başına bir kez)
  useQueueAutostart(q, session ? session.key : null, session?.storageKey, session?.autoPlay);

  // Kilit ekranı / kulaklık düğmeleri: hangi sayfada olursa olsun çalışır
  const meta = useMemo(() => (session ? { title: session.title, subtitle: session.subtitle, artwork: session.artwork } : null),
                       [session]);
  useMediaSession(q, meta, speed);

  // Başka sekmede çıkış yapılırsa (oturum anahtarı silinir) ses durur; sağlayıcı kalkınca da durur
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === "token" && !e.newValue) stop(); };
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("storage", onStorage); stop(); };
  }, [stop]);

  const sessionValue = useMemo<SessionCtx>(() => ({ session, play, update, isCurrent, stop, stopIf }),
                                           [session, play, update, isCurrent, stop, stopIf]);
  const playbackValue: PlaybackCtx = { q, speed, setSpeed };

  return (
    <SessionContext.Provider value={sessionValue}>
      <PlaybackContext.Provider value={playbackValue}>{children}</PlaybackContext.Provider>
    </SessionContext.Provider>
  );
}

export function useAudioSession(): SessionCtx {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useAudioSession: AudioProvider içinde kullanılmalı");
  return c;
}
export function useAudioPlayback(): PlaybackCtx {
  const c = useContext(PlaybackContext);
  if (!c) throw new Error("useAudioPlayback: AudioProvider içinde kullanılmalı");
  return c;
}
/** Sağlayıcı dışında da çalışabilen bileşenler için (ör. tek dosyalık PodcastPlayer). */
export function useAudioPlaybackOptional(): PlaybackCtx | null {
  return useContext(PlaybackContext);
}
