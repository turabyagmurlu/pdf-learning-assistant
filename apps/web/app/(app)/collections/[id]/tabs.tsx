"use client";
/**
 * Defter sekmeleri (3.0 "Derin ve Sade"): Kaynaklar · Sor · Çalışma notu + "Daha fazla ▾"
 * (Sözlük, Sesli özet, Dışa aktar, Defteri sil).
 * - Eski adresler: ?tab=sohbet / karsilastir → Sor; ?tab=taslak / yaz / kaynakca → Çalışma notu;
 *   ?tab=harita / zaman (kaldırıldı) → Sözlük; ?tab=ders → Sesli özet.
 * - Az kaynakta sekmeler gizlenmez: kilitli ama görünür, açıklamalı (dokununca/odaklanınca).
 * - role=tablist/tab + aria-selected, ok tuşlarıyla gezinme.
 */
import { KeyboardEvent, ReactNode, useEffect, useRef, useState } from "react";
import { FileText, MessageSquare, PenLine, BookMarked, Headphones, Lock, Plus, ChevronDown } from "lucide-react";
import { Cost, costTitle } from "@/components/CostBadge";

export type TabKey = "kaynaklar" | "sor" | "not" | "sozluk" | "sesli";

/** Ana sekmeler (3). */
export const TABS: [TabKey, string, typeof FileText][] = [
  ["kaynaklar", "Kaynaklar", FileText],
  ["sor", "Sor", MessageSquare],
  ["not", "Çalışma notu", PenLine],
];
/** "Daha fazla" içindeki görünümler (ana sekme değil; seçilince şeritte "Daha fazla · Sözlük" olarak görünür). */
export const MORE_VIEWS: [TabKey, string, typeof FileText][] = [
  ["sozluk", "Sözlük", BookMarked],
  ["sesli", "Sesli özet", Headphones],
];
const ALL: TabKey[] = [...TABS.map((t) => t[0]), ...MORE_VIEWS.map((t) => t[0])];
const LEGACY: Record<string, TabKey> = {
  raf: "kaynaklar", sohbet: "sor", karsilastir: "sor", taslak: "not", yaz: "not", kaynakca: "not",
  harita: "sozluk", zaman: "sozluk", ders: "sesli",
};

export function parseTab(v: string | null | undefined): TabKey {
  if (!v) return "kaynaklar";
  if ((ALL as string[]).includes(v)) return v as TabKey;
  return LEGACY[v] || "kaynaklar";
}
export function tabLabel(t: TabKey): string {
  for (const x of [...TABS, ...MORE_VIEWS]) if (x[0] === t) return x[1];
  return "";
}
export const isMoreView = (t: TabKey) => MORE_VIEWS.some((x) => x[0] === t);

/** Kilit nedeni (null = açık). Gerçek teknik koşula bağlı: 0 hazır kaynak. */
export function lockReason(t: TabKey, readyN: number, processing: number): string | null {
  const wait = processing > 0 ? " Kaynağın hazırlanıyor; hazır olunca kendiliğinden açılır." : " Önce bir kaynak ekle.";
  if (t === "sor" && readyN === 0) return "Soru sormak için en az 1 hazır kaynak gerekir." + wait;
  if ((t === "sozluk" || t === "sesli") && readyN === 0)
    return (t === "sozluk" ? "Sözlük" : "Sesli özet") + " hazır kaynaklarından üretilir." + wait;
  return null;
}

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Ok tuşları: aynı tablist içindeki bir sonraki/önceki sekmeye geç ve aç. */
function arrowNav(e: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const list = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > [role="tab"]'));
  const i = list.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const j = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
  list[j].focus(); list[j].click();
}

export type MoreAction = { key: string; label: string; Icon: typeof FileText; run: () => void; danger?: boolean; disabled?: string | null; /** ⚡ maliyeti (yalnız harcayan eylemde) */ cost?: number };

/** "Daha fazla ▾" menüsü: Sözlük · Sesli özet · Dışa aktar · Defteri sil */
function MoreMenu({ tab, onTab, readyN, processing, actions, compact }: {
  tab: TabKey; onTab: (t: TabKey) => void; readyN: number; processing: number; actions: MoreAction[]; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => list.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus(), 0);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  function onListKey(e: KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") || []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[n].focus();
  }
  const on = isMoreView(tab);
  const item = "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-surface-muted disabled:opacity-50 disabled:hover:bg-transparent";
  return (
    <div ref={wrap} className="relative shrink-0">
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
              className={cx("flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-full px-3 text-sm transition",
                on ? "bg-surface font-semibold text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary")}>
        {on ? tabLabel(tab) : "Daha fazla"} <ChevronDown size={14} aria-hidden className={cx("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div ref={list} role="menu" aria-label="Daha fazla" onKeyDown={onListKey}
             className={cx("absolute z-40 mt-1 w-60 rounded-xl border bg-surface p-1 text-text-primary shadow-xl", compact ? "right-0" : "left-0")}>
          {MORE_VIEWS.map(([k, label, Icon]) => {
            const why = lockReason(k, readyN, processing);
            return (
              <button key={k} type="button" role="menuitemradio" aria-checked={tab === k} disabled={!!why} title={why || undefined}
                      onClick={() => { setOpen(false); onTab(k); }} className={cx(item, tab === k && "bg-accent-purple/10 font-medium")}>
                <Icon size={16} aria-hidden className="text-text-secondary" />
                <span className="flex-1">{label}</span>
                {why && <Lock size={12} aria-hidden className="text-text-secondary" />}
              </button>
            );
          })}
          <div className="my-1 border-t" role="separator" />
          {actions.map((a) => (
            <button key={a.key} type="button" role="menuitem" disabled={!!a.disabled} title={a.disabled || (a.cost ? costTitle(a.cost) : undefined)}
                    onClick={() => { setOpen(false); a.run(); }}
                    className={cx(item, a.danger && "text-danger hover:bg-danger/10")}>
              <a.Icon size={16} aria-hidden className={a.danger ? "" : "text-text-secondary"} />
              <span className="flex-1">{a.label}</span>
              {a.cost ? <Cost n={a.cost} /> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TabBar({ tab, onTab, readyN, processing, compact, moreActions }: {
  tab: TabKey; onTab: (t: TabKey) => void; readyN: number; processing: number; compact?: boolean;
  moreActions: MoreAction[];
}) {
  const [hint, setHint] = useState<string | null>(null);
  const p = compact ? "c-" : "";

  const row = (
    <div role="tablist" aria-label="Defter bölümleri" onKeyDown={arrowNav}
         className={cx("flex shrink-0 items-center gap-0.5 rounded-full bg-surface-muted p-0.5")}>
      {TABS.map(([k, label, Icon]) => {
        const on = tab === k;
        const why = lockReason(k, readyN, processing);
        return (
          <button key={k} role="tab" id={`${p}tab-${k}`} aria-selected={on} tabIndex={on ? 0 : -1}
                  aria-controls={on && !compact ? `panel-${k}` : undefined}
                  aria-disabled={why ? true : undefined}
                  aria-describedby={why ? `${p}why-${k}` : undefined}
                  onClick={() => onTab(k)}
                  onMouseEnter={() => why && setHint(why)} onMouseLeave={() => setHint(null)}
                  onFocus={() => why && setHint(why)} onBlur={() => setHint(null)}
                  className={cx("flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm transition sm:px-3.5",
                    on ? "bg-surface font-semibold text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary",
                    why && !on && "opacity-70")}>
            <Icon size={15} aria-hidden className="hidden shrink-0 sm:inline" /> {label}
            {why && <Lock size={12} aria-hidden className="shrink-0" />}
            {why && <span id={`${p}why-${k}`} className="sr-only">Kilitli: {why}</span>}
          </button>
        );
      })}
      <MoreMenu tab={tab} onTab={onTab} readyN={readyN} processing={processing} actions={moreActions} compact={compact} />
    </div>
  );

  if (compact) {
    return <div className="flex items-center gap-2 overflow-x-auto py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{row}</div>;
  }
  return (
    <div className="border-b">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1 pb-1">{row}</div>
      <p aria-hidden className={cx("min-h-[1.25rem] pb-1 pt-0.5 text-xs text-text-secondary", !hint && "invisible")}>{hint || "·"}</p>
    </div>
  );
}

/** Kilitli sekmeye gelindiğinde (tıklama, derin bağlantı) boş sayfa yerine açıklama + eylem. */
export function LockedPanel({ reason, onAdd, children }: { reason: string; onAdd: () => void; children?: ReactNode }) {
  return (
    <div className="mx-auto mt-6 max-w-lg rounded-2xl border border-dashed bg-surface p-6 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-muted text-text-secondary"><Lock size={20} /></span>
      <p className="mt-3 text-sm text-text-primary">{reason}</p>
      {children}
      <button onClick={onAdd} className="mx-auto mt-4 flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm font-medium text-white">
        <Plus size={16} /> Kaynak ekle
      </button>
    </div>
  );
}
