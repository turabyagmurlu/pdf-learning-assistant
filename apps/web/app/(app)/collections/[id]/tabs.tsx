"use client";
/**
 * Defter sekmeleri: Kaynaklar · Sor (Sohbet, Karşılaştır) · Yaz (Taslak, Kaynakça) ·
 * Araçlar (Sözlük, Harita, Zaman, Sesli özet).
 * - Az kaynakta sekmeler gizlenmez: kilitli ama gorunur, aciklamali (dokununca/odaklaninca).
 * - role=tablist/tab + aria-selected, ok tuslariyla gezinme.
 * - 375 px'e sigar: sm altinda alt sekme ikonlari gizli.
 */
import { KeyboardEvent, ReactNode, useState } from "react";
import { FileText, MessageSquare, Scale, PenLine, Quote, BookMarked, Share2, Clock, Headphones, Lock, Plus } from "lucide-react";

export type TabKey = "kaynaklar" | "sohbet" | "karsilastir" | "taslak" | "kaynakca" | "sozluk" | "harita" | "zaman" | "sesli";
type GroupKey = "kaynaklar" | "sor" | "yaz" | "araclar";

export const GROUPS: { k: GroupKey; label: string; tabs: [TabKey, string, typeof FileText][] }[] = [
  { k: "kaynaklar", label: "Kaynaklar", tabs: [["kaynaklar", "Kaynaklar", FileText]] },
  { k: "sor", label: "Sor", tabs: [["sohbet", "Sohbet", MessageSquare], ["karsilastir", "Karşılaştır", Scale]] },
  { k: "yaz", label: "Yaz", tabs: [["taslak", "Taslak", PenLine], ["kaynakca", "Kaynakça", Quote]] },
  { k: "araclar", label: "Araçlar", tabs: [["sozluk", "Sözlük", BookMarked], ["harita", "Harita", Share2], ["zaman", "Zaman", Clock], ["sesli", "Sesli özet", Headphones]] },
];
const ALL = GROUPS.flatMap((g) => g.tabs.map((t) => t[0]));
const LEGACY: Record<string, TabKey> = { raf: "kaynaklar", sor: "sohbet", ders: "sesli" };

export function parseTab(v: string | null | undefined): TabKey {
  if (!v) return "kaynaklar";
  if ((ALL as string[]).includes(v)) return v as TabKey;
  return LEGACY[v] || "kaynaklar";
}
export function groupOf(t: TabKey): GroupKey {
  return (GROUPS.find((g) => g.tabs.some((x) => x[0] === t)) || GROUPS[0]).k;
}
export function tabLabel(t: TabKey): string {
  for (const g of GROUPS) for (const x of g.tabs) if (x[0] === t) return x[1];
  return "";
}

/** Kilit nedeni (null = acik). Gercek teknik kosula bagli: 0 hazir kaynak / Karsilastir icin 2. */
export function lockReason(t: TabKey, readyN: number, processing: number): string | null {
  const wait = processing > 0 ? " Kaynağın hazırlanıyor; hazır olunca kendiliğinden açılır." : " Önce bir kaynak ekle.";
  if (t === "sohbet" && readyN === 0) return "Soru sormak için en az 1 hazır kaynak gerekir." + wait;
  if (t === "karsilastir" && readyN < 2) return `Karşılaştırma için en az 2 hazır kaynak gerekir · şu an ${readyN}.` + (processing > 0 ? " İşlenen kaynak hazır olunca açılabilir." : " 1 kaynak daha ekle.");
  if (["sozluk", "harita", "zaman", "sesli"].includes(t) && readyN === 0)
    return "Araçlar hazır kaynaklarından sözlük, kavram haritası, zaman çizelgesi ve sesli özet üretir." + wait;
  return null;
}

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Ok tuslari: ayni tablist icindeki bir sonraki/onceki sekmeye gec ve ac. */
function arrowNav(e: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const list = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > [role="tab"]'));
  const i = list.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const j = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
  list[j].focus(); list[j].click();
}

export function TabBar({ tab, onTab, readyN, processing, compact, lastInGroup }: {
  tab: TabKey; onTab: (t: TabKey) => void; readyN: number; processing: number; compact?: boolean;
  lastInGroup: Partial<Record<GroupKey, TabKey>>;
}) {
  const [hint, setHint] = useState<string | null>(null);
  const cur = GROUPS.find((g) => g.k === groupOf(tab)) || GROUPS[0];
  const p = compact ? "c-" : "";
  const groupLocked = (g: (typeof GROUPS)[number]) => g.tabs.every(([k]) => !!lockReason(k, readyN, processing));

  const groupRow = (
    <div role="tablist" aria-label="Defter bölümleri" onKeyDown={arrowNav}
         className={cx("flex shrink-0 gap-0.5 rounded-full bg-surface-muted p-0.5", !compact && "mb-1")}>
      {GROUPS.map((g) => {
        const on = g.k === cur.k;
        const locked = groupLocked(g);
        return (
          <button key={g.k} role="tab" id={`${p}grp-${g.k}`} aria-selected={on} tabIndex={on ? 0 : -1}
                  aria-describedby={locked ? `${p}lock-${g.k}` : undefined}
                  onClick={() => { if (!on) onTab(lastInGroup[g.k] || g.tabs[0][0]); }}
                  onMouseEnter={() => locked && setHint(lockReason(g.tabs[0][0], readyN, processing))}
                  onMouseLeave={() => setHint(null)}
                  onFocus={() => locked && setHint(lockReason(g.tabs[0][0], readyN, processing))}
                  onBlur={() => setHint(null)}
                  className={cx("flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-full px-3 text-sm transition sm:px-3.5",
                    on ? "bg-surface font-semibold text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary",
                    locked && !on && "opacity-70")}>
            {g.label}
            {locked && <Lock size={12} aria-hidden className="shrink-0" />}
            {locked && <span id={`${p}lock-${g.k}`} className="sr-only">Kilitli: {lockReason(g.tabs[0][0], readyN, processing)}</span>}
          </button>
        );
      })}
    </div>
  );

  const subRow = cur.tabs.length > 1 && (
    <div role="tablist" aria-label={`${cur.label} sekmeleri`} onKeyDown={arrowNav}
         className={cx("flex min-w-0 gap-0.5", compact ? "shrink-0" : "max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}>
      {cur.tabs.map(([k, label, Icon]) => {
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
                  className={cx("flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-sm sm:px-3",
                    compact ? "rounded-lg" : "border-b-2",
                    on ? (compact ? "bg-accent-purple/10 font-semibold text-text-primary" : "border-accent-purple font-semibold text-text-primary")
                       : cx(!compact && "border-transparent", "text-text-secondary hover:text-text-primary"),
                    why && !on && "opacity-70")}>
            <Icon size={15} aria-hidden className="hidden sm:inline" /> {label}
            {why && <Lock size={12} aria-hidden className="shrink-0" />}
            {why && <span id={`${p}why-${k}`} className="sr-only">Kilitli: {why}</span>}
          </button>
        );
      })}
    </div>
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2 overflow-x-auto py-1.5 [-ms-overflow-style:none] [mask-image:linear-gradient(to_right,black_88%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groupRow}
        {subRow}
      </div>
    );
  }
  return (
    <div className="border-b">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        {groupRow}
        {subRow}
      </div>
      <p aria-hidden className={cx("min-h-[1.25rem] pb-1 pt-0.5 text-xs text-text-secondary", !hint && "invisible")}>{hint || "·"}</p>
    </div>
  );
}

/** Kilitli sekmeye gelindiginde (tiklama, derin baglanti) bos sayfa yerine aciklama + eylem. */
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
