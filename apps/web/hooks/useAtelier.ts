"use client";
/**
 * Atölye (bottega) veri kancaları — yapay zekâ harcamaz.
 *  - useAtelier({ scope, mode }) : kartları yükler, oturumu yürütür, tekrar sonucunu iyimser gönderir.
 *  - useAtelierCounts(dep)       : menü ve kapak rozetleri için hafif sayım (GET /atelier/counts).
 *  - useAtelierKeys(map, on)     : yazı alanlarında devre dışı kalan basit klavye kısayolları.
 *
 * Kapsam: "all" | "collection:<id>" | "document:<id>".
 * Deste modu: "due" (Hatırla: vadesi gelenler + günlük yeni kartlar) | "all" (Oku/Dinle: kapsamdaki her şey).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";

export type AtelierScope = string;
export type Practice = "read" | "recall" | "listen";
export type Grade = "again" | "hard" | "good" | "easy";
export type DeckMode = "due" | "all";

export type AtelierCard = {
  key: string;
  kind: "quote" | "p";
  text: string;
  note?: string | null;
  color?: string | null;
  style?: string | null;
  page?: number | null;
  document_id?: string | null;
  source?: string | null;
  box?: number;
  due?: string | null;
  seen?: number;
};

type DeckResp = { items?: AtelierCard[]; total?: number; due?: number };

export type AtelierCounts = { due_total: number; by_collection: Record<string, number> };

/** Atölye verisi değişince (tekrar gönderildi) rozetler tazelensin. */
export const ATELIER_CHANGED = "typdf:atelier-changed";

export const PRACTICES: { key: Practice; label: string; hint: string }[] = [
  { key: "read", label: "Oku", hint: "Alıntıların arasında sakin bir akış" },
  { key: "recall", label: "Hatırla", hint: "Perdeli kelimeleri hatırla, aralıklı tekrar" },
  { key: "listen", label: "Dinle", hint: "Alıntılar sırayla sesli okunur" },
];

export function isPractice(v: string | null | undefined): v is Practice {
  return v === "read" || v === "recall" || v === "listen";
}

export function normalizeScope(v: string | null | undefined): AtelierScope {
  if (!v) return "all";
  if (v === "all") return v;
  if (/^(collection|document):[\w-]+$/.test(v)) return v;
  return "all";
}

export function atelierHref(scope: AtelierScope = "all", mode?: Practice): string {
  const q = new URLSearchParams();
  if (scope && scope !== "all") q.set("scope", scope);
  if (mode) q.set("mode", mode);
  const s = q.toString();
  return "/atelier" + (s ? "?" + s : "");
}

export function useAtelier({ scope, deck, session }: {
  scope: AtelierScope; deck: DeckMode;
  /** Değişince oturum baştan başlar (ör. pratik değişti). */
  session?: string;
}) {
  const [cards, setCards] = useState<AtelierCard[] | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [dueTotal, setDueTotal] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [finished, setFinished] = useState(false);
  const [stats, setStats] = useState({ count: 0, known: 0 });
  const [results, setResults] = useState<Record<string, Grade>>({});
  const requeued = useRef<Set<string>>(new Set());
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setCards(null); setError(""); setIndex(0); setFinished(false);
    setStats({ count: 0, known: 0 }); setResults({}); requeued.current = new Set();
    try {
      const q = new URLSearchParams({ scope, mode: deck, limit: "40" });
      const r = (await api("/atelier/deck?" + q.toString(), {}, 2)) as DeckResp | null;
      if (my !== reqId.current) return;
      const items = (r?.items || []).filter((c) => c && typeof c.text === "string" && c.text.trim());
      setCards(items);
      setDueTotal(r?.due ?? 0);
      setAllTotal(r?.total ?? items.length);
    } catch (e) {
      if (my !== reqId.current) return;
      setError(errorMessage(e, "Kartlar yüklenemedi. Birkaç saniye sonra tekrar dene."));
      setCards([]);
    }
  }, [scope, deck]);

  useEffect(() => { void load(); }, [load, session]);

  const count = cards?.length ?? 0;
  const current = cards && index < cards.length ? cards[index] : null;

  const go = useCallback((i: number) => {
    setIndex((cur) => {
      const n = cards?.length ?? 0;
      if (!n) return cur;
      return Math.max(0, Math.min(n - 1, i));
    });
  }, [cards]);

  const next = useCallback(() => {
    const n = cards?.length ?? 0;
    setIndex((i) => {
      if (i + 1 >= n) { setFinished(true); return i; }
      return i + 1;
    });
  }, [cards]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const finish = useCallback(() => setFinished(true), []);

  /** Hatırla sonucu: arayüz hemen ilerler; istek arka planda gider (başarısızsa sessizce bir kez daha denenir). */
  const review = useCallback((grade: Grade) => {
    const card = cards && cards[index];
    if (!card) return;
    const known = grade === "good" || grade === "easy";
    setStats((s) => ({ count: s.count + 1, known: s.known + (known ? 1 : 0) }));
    setResults((r) => ({ ...r, [card.key]: grade }));
    const body = JSON.stringify({ key: card.key, result: grade });
    api("/atelier/review", { method: "POST", body }, 1)
      .catch(() => new Promise((res) => setTimeout(res, 3000)).then(() => api("/atelier/review", { method: "POST", body }, 1)))
      .catch(() => { /* çevrimdışı: bu tekrar kaydedilmedi; oturum yine sürer */ })
      .finally(() => { try { window.dispatchEvent(new Event(ATELIER_CHANGED)); } catch {} });
    // "Tekrar": kart bu oturumun sonuna bir kez daha eklenir
    if (grade === "again" && !requeued.current.has(card.key)) {
      requeued.current.add(card.key);
      setCards((cs) => (cs ? [...cs, card] : cs));
      setIndex((i) => i + 1);
      return;
    }
    setIndex((i) => {
      if (i + 1 >= (cards?.length ?? 0)) { setFinished(true); return i; }
      return i + 1;
    });
  }, [cards, index]);

  const restart = useCallback(() => { void load(); }, [load]);

  return {
    loading: cards === null, cards: cards || [], count, index, current, error,
    dueTotal, allTotal, finished, stats, results,
    go, next, prev, finish, review, restart, reload: load,
  };
}

export function useAtelierCounts(dep?: unknown): AtelierCounts | null {
  const [c, setC] = useState<AtelierCounts | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      api("/atelier/counts", {}, 1)
        .then((r: unknown) => {
          const x = r as Partial<AtelierCounts> | null;
          if (alive && x && typeof x.due_total === "number") setC({ due_total: x.due_total, by_collection: x.by_collection || {} });
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    window.addEventListener(ATELIER_CHANGED, load);
    return () => { alive = false; clearInterval(t); window.removeEventListener(ATELIER_CHANGED, load); };
  }, [dep]);
  return c;
}

/** Yazı alanı dışında tuş kısayolları. `map` anahtarı KeyboardEvent.key. */
export function useAtelierKeys(map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map); ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      // Odak bir düğme/bağlantıdaysa Enter ve boşluk onun kendi işini yapsın
      if ((e.key === " " || e.key === "Enter") && el && (el.tagName === "BUTTON" || el.tagName === "A")) return;
      if (el?.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      const fn = ref.current[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
