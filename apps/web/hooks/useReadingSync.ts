"use client";
/**
 * Okuma konumu cihazlar arasi (TO-1).
 *
 *   const sync = useReadingSync(id, { page, numPages, pct, mediaPos });
 *   // sync.serverPage: baska cihazda daha ileride/geride birakilan sayfa (yoksa null)
 *   // sync.serverDevice: "Telefon" | "Tablet" | "Bilgisayar" (o cihazin adi)
 *   // sync.serverAt: ISO zaman;  sync.serverMediaPos: video/ses saniyesi
 *   // sync.dismiss(): "Oraya git" ya da "kapat" sonrasi cipi gizle
 *
 * - Degisiklikleri 3 sn gecikmeyle `PUT /documents/{id}/reading` ile yazar (ayni degeri tekrar yazmaz).
 * - Sekme gizlenirken / sayfa kapanirken (`visibilitychange`, `pagehide`) bekleyen kaydi
 *   `fetch(..., {keepalive:true})` ile hemen gonderir.
 * - Acilista sunucudaki konumu alir (`opts.reading` verildiyse GET yapmaz); yereldeki
 *   `reader.prog.{id}` kaydindan DAHA YENI ve sayfasi farkliysa `serverPage` doner
 *   ("Tablette s.120'deydin · Oraya git" cipi icin; cip ReaderHeader'da, H ajani).
 * - Yapay zeka yok, kullanim harcamaz. Cevrimdisi iken sessizce atlar, tekrar dener.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { API, api, getToken } from "@/lib/api";

export type ReadingState = {
  page?: number | null;
  num_pages?: number | null;
  pct?: number | null;
  media_pos?: number | null;
  device?: string | null;
  updated_at?: string | null;
};

export type ReadingInput = {
  page?: number | null;
  numPages?: number | null;
  pct?: number | null;
  /** video / ses konumu (saniye) */
  mediaPos?: number | null;
};

export type ReadingSync = {
  serverPage: number | null;
  serverDevice: string | null;
  serverAt: string | null;
  serverMediaPos: number | null;
  /** cipi kapat (oraya gidince ya da kullanici kapatinca) */
  dismiss: () => void;
  /** bu cihazin adi */
  device: string;
};

const DELAY_MS = 3000;

/** Telefon | Tablet | Bilgisayar — ekran + dokunma + tarayici kimligine gore. */
export function deviceName(): string {
  if (typeof window === "undefined") return "Bilgisayar";
  const ua = navigator.userAgent || "";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const touch = coarse || (navigator.maxTouchPoints || 0) > 1;
  const shortSide = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  // iPadOS Safari kendini Mac gibi tanitir: dokunma + Mac = tablet
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Macintosh/i.test(ua) && touch)) return "Tablet";
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "Tablet";
  if (/iPhone|iPod|Mobile|Android/i.test(ua)) return shortSide >= 600 && touch ? "Tablet" : "Telefon";
  if (touch && shortSide >= 600 && shortSide < 1100) return "Tablet";
  if (touch && shortSide < 600) return "Telefon";
  return "Bilgisayar";
}

type Payload = { page?: number; num_pages?: number; pct?: number; media_pos?: number; device: string };

function samePayload(a: Payload | null, b: Payload): boolean {
  if (!a) return false;
  return a.page === b.page && a.num_pages === b.num_pages && a.pct === b.pct
    && Math.round((a.media_pos ?? -1)) === Math.round((b.media_pos ?? -1));
}

function localProgress(docId: string): { page?: number; at?: number; pct?: number } | null {
  try {
    const raw = localStorage.getItem(`reader.prog.${docId}`);
    if (raw) { const p = JSON.parse(raw); if (p && typeof p === "object") return p; }
    const pos = parseInt(localStorage.getItem(`reader.pos.${docId}`) || "", 10);
    if (!isNaN(pos)) return { page: pos };
  } catch {}
  return null;
}

export function useReadingSync(docId: string, input: ReadingInput, opts?: { reading?: ReadingState | null; enabled?: boolean }): ReadingSync {
  const enabled = opts?.enabled !== false && !!docId;
  const [server, setServer] = useState<{ page: number | null; device: string | null; at: string | null; mediaPos: number | null }>({
    page: null, device: null, at: null, mediaPos: null,
  });
  const deviceRef = useRef<string>("Bilgisayar");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Payload | null>(null);   // gonderilmeyi bekleyen
  const lastSent = useRef<Payload | null>(null);  // en son basariyla gonderilen
  const ready = useRef(false);                    // ilk deger gelmeden yazma
  const initialReading = opts?.reading;

  useEffect(() => { deviceRef.current = deviceName(); }, []);

  /* ---------- acilis: sunucudaki konum ---------- */
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const apply = (r: ReadingState | null | undefined) => {
      if (!alive || !r) return;
      const sPage = typeof r.page === "number" && r.page > 0 ? r.page : null;
      const sAt = r.updated_at ? Date.parse(r.updated_at) : NaN;
      const loc = localProgress(docId);
      const locAt = loc?.at ?? 0;
      const locPage = loc?.page ?? null;
      // sunucu daha yeni (ya da yerelde hic kayit yok) ve sayfasi farkli -> oner
      const newer = !loc || isNaN(sAt) ? !!sPage && sPage !== locPage : sAt > locAt + 1500;
      const differs = sPage !== null && sPage !== locPage && sPage !== (input.page ?? null);
      const otherDevice = !r.device || r.device !== deviceRef.current;
      if (sPage && newer && differs && otherDevice) {
        setServer({ page: sPage, device: r.device || null, at: r.updated_at || null,
                    mediaPos: typeof r.media_pos === "number" ? r.media_pos : null });
      } else if (typeof r.media_pos === "number" && r.media_pos > 5 && otherDevice && newer) {
        setServer({ page: null, device: r.device || null, at: r.updated_at || null, mediaPos: r.media_pos });
      }
      // ilk gonderimde ayni degeri yeniden yazmamak icin
      lastSent.current = {
        page: sPage ?? undefined, num_pages: r.num_pages ?? undefined, pct: r.pct ?? undefined,
        media_pos: typeof r.media_pos === "number" ? r.media_pos : undefined, device: r.device || "",
      };
    };
    if (initialReading !== undefined) { apply(initialReading); return () => { alive = false; }; }
    (async () => {
      try {
        const d: any = await api(`/documents/${encodeURIComponent(docId)}`, {}, 1);
        apply(d?.reading || null);
      } catch { /* cevrimdisi: cip yok */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, enabled]);

  /* ---------- gonderim ---------- */
  const flush = useCallback((keepalive: boolean) => {
    const p = pending.current;
    if (!p) return;
    if (samePayload(lastSent.current, p)) { pending.current = null; return; }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;  // bekle, sonra dene
    const token = getToken();
    if (!token) return;
    pending.current = null;
    const body = JSON.stringify(p);
    try {
      fetch(`${API}/documents/${encodeURIComponent(docId)}/reading`, {
        method: "PUT", keepalive,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body,
      }).then((res) => { if (res.ok) lastSent.current = p; else if (!pending.current) pending.current = p; })
        .catch(() => { if (!pending.current) pending.current = p; });
      if (keepalive) lastSent.current = p;   // sayfa kapaniyor: cevap beklenmez
    } catch {
      pending.current = p;
    }
  }, [docId]);

  const { page, numPages, pct, mediaPos } = input;
  useEffect(() => {
    if (!enabled) return;
    const hasPage = typeof page === "number" && page > 0;
    const hasMedia = typeof mediaPos === "number" && mediaPos >= 0;
    if (!hasPage && !hasMedia) return;
    ready.current = true;
    const p: Payload = { device: deviceRef.current };
    if (hasPage) p.page = Math.round(page as number);
    if (typeof numPages === "number" && numPages > 0) p.num_pages = Math.round(numPages);
    if (typeof pct === "number") p.pct = Math.max(0, Math.min(100, Math.round(pct)));
    else if (hasPage && typeof numPages === "number" && numPages > 0) p.pct = Math.round(((page as number) / numPages) * 100);
    if (hasMedia) p.media_pos = Math.round((mediaPos as number) * 10) / 10;
    if (samePayload(lastSent.current, p)) return;
    pending.current = p;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; flush(false); }, DELAY_MS);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [enabled, page, numPages, pct, mediaPos, flush]);

  /* ---------- sekme gizlenince / sayfa kapanirken hemen yaz ---------- */
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") return;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      flush(true);
    };
    const onPageHide = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } flush(true); };
    const onOnline = () => { if (pending.current && ready.current) flush(false); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      // bilesen kapanirken (baska sayfaya gecis) bekleyeni yaz
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      flush(true);
    };
  }, [enabled, flush]);

  const dismiss = useCallback(() => setServer({ page: null, device: null, at: null, mediaPos: null }), []);

  return {
    serverPage: server.page,
    serverDevice: server.device,
    serverAt: server.at,
    serverMediaPos: server.mediaPos,
    dismiss,
    device: deviceRef.current,
  };
}

/** "Tablette s.120'deydin" gibi kisa metin (cip icin yardimci). */
export function readingChipText(s: { serverPage: number | null; serverDevice: string | null; serverMediaPos?: number | null }): string | null {
  const dev = s.serverDevice || "Başka cihazda";
  const loc = dev === "Telefon" ? "Telefonda" : dev === "Tablet" ? "Tablette" : dev === "Bilgisayar" ? "Bilgisayarda" : dev;
  if (s.serverPage) return `${loc} s.${s.serverPage}'deydin`;
  if (typeof s.serverMediaPos === "number" && s.serverMediaPos > 0) {
    const m = Math.floor(s.serverMediaPos / 60), sec = Math.floor(s.serverMediaPos % 60);
    return `${loc} ${m}:${String(sec).padStart(2, "0")}'de kalmıştın`;
  }
  return null;
}
