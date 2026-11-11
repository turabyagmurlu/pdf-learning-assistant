"use client";
/**
 * Defter içi raflar (klasörler): kaynakları raflara yerleştir, raf başlıkları altında düzenli göster.
 * - Otomatik raflama (ücretsiz, yapay zekâ yok): başlığın "DERS ADI - Ünite 3 - …" biçimindeki ilk kısmı raf olur;
 *   aynı ilk kısmı paylaşan en az 2 kaynak varsa raflanır.
 * - Raf içinde doğal sıra: "Ünite 2" "Ünite 10"dan önce gelir.
 * - Rafa taşı penceresi: mevcut raflar, yeni raf, raftan çıkar.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderPlus, Pencil, Trash2, Wand2, Check } from "lucide-react";
import Modal from "@/components/Modal";

export type ShelfDoc = { id: string; title: string; shelf?: string | null };

const coll = typeof Intl !== "undefined" ? new Intl.Collator("tr", { numeric: true, sensitivity: "base" }) : null;
export const natCmp = (a: string, b: string) => (coll ? coll.compare(a || "", b || "") : (a || "").localeCompare(b || ""));

/** Başlıktan raf adı: ayraçtan önceki kısım ("STRATEJİK YÖNETİM - Ünite 3" → "STRATEJİK YÖNETİM"). */
export function shelfKeyOf(title: string): string | null {
  const t = (title || "").replace(/\.(pdf|docx?|pptx?|txt|md)$/i, "").trim();
  const m = t.split(/\s+[-–—|:]\s+|_{2,}/);
  if (m.length >= 2 && m[0].trim().length >= 3) return m[0].trim();
  // "Ünite 3 Stratejik Yönetim" gibi: sayı/ünite ifadesinden önceki kısım
  const u = t.match(/^(.{3,}?)\s+(?:ünite|unite|bölüm|bolum|hafta|ders|chapter|part|kısım)\s*\d+/i);
  return u ? u[1].trim() : null;
}

/** Otomatik raflama önerisi: {docId: raf}. Yalnız en az 2 kaynağın paylaştığı ilk kısımlar raf olur. */
export function autoShelves(docs: ShelfDoc[]): Record<string, string> {
  const by: Record<string, string[]> = {};
  const label: Record<string, string> = {};
  for (const d of docs) {
    const k = shelfKeyOf(d.title);
    if (!k) continue;
    const norm = k.toLocaleLowerCase("tr");
    (by[norm] ||= []).push(d.id);
    label[norm] ||= k;
  }
  const out: Record<string, string> = {};
  for (const [norm, ids] of Object.entries(by)) if (ids.length >= 2) ids.forEach((id) => { out[id] = label[norm]; });
  return out;
}

/** Raflara göre bölümler (raflar alfabetik, raf içi doğal sıra; rafsızlar en sonda). */
export function shelfSections<T extends ShelfDoc>(docs: T[]): { name: string | null; list: T[] }[] {
  const m = new Map<string, T[]>();
  const rest: T[] = [];
  for (const d of docs) {
    const s = (d.shelf || "").trim();
    if (s) { if (!m.has(s)) m.set(s, []); m.get(s)!.push(d); } else rest.push(d);
  }
  const out: { name: string | null; list: T[] }[] = Array.from(m.entries()).sort((a, b) => natCmp(a[0], b[0]))
    .map(([name, list]) => ({ name, list: [...list].sort((a, b) => natCmp(a.title, b.title)) }));
  if (rest.length) out.push({ name: null, list: [...rest].sort((a, b) => natCmp(a.title, b.title)) });
  return out;
}

const CLOSED_KEY = (cid: string) => "typdf-shelf-closed." + cid;

/** Raf başlığı (katla / aç · yeniden adlandır · rafı kaldır) */
export function ShelfHeader({ cid, name, count, open, onToggle, onRename, onRemove }: {
  cid: string; name: string | null; count: number; open: boolean; onToggle: () => void;
  onRename?: () => void; onRemove?: () => void;
}) {
  void cid;
  return (
    <div className="mb-2 flex items-center gap-1">
      <button type="button" onClick={onToggle} aria-expanded={open}
              className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left hover:bg-surface-muted">
        {open ? <ChevronDown size={16} aria-hidden className="shrink-0 text-text-secondary" /> : <ChevronRight size={16} aria-hidden className="shrink-0 text-text-secondary" />}
        <span className="truncate text-sm font-semibold text-text-primary">{name || "Rafsız"}</span>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs text-text-secondary">{count}</span>
      </button>
      {name && onRename && (
        <button type="button" onClick={onRename} aria-label={`“${name}” rafını yeniden adlandır`} title="Yeniden adlandır"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted"><Pencil size={15} /></button>
      )}
      {name && onRemove && (
        <button type="button" onClick={onRemove} aria-label={`“${name}” rafını kaldır (kaynaklar silinmez)`} title="Rafı kaldır (kaynaklar silinmez)"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted hover:text-danger"><Trash2 size={15} /></button>
      )}
    </div>
  );
}

/** Katlanmış raflar (cihazda hatırlanır) */
export function useClosedShelves(cid: string) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { setClosed(new Set(JSON.parse(localStorage.getItem(CLOSED_KEY(cid)) || "[]"))); } catch { /* yok say */ }
  }, [cid]);
  const toggle = (name: string | null) => setClosed((prev) => {
    const k = name || "__none__";
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    try { localStorage.setItem(CLOSED_KEY(cid), JSON.stringify(Array.from(n))); } catch { /* yok say */ }
    return n;
  });
  const isOpen = (name: string | null) => !closed.has(name || "__none__");
  return { isOpen, toggle };
}

/** Rafa taşı penceresi */
export function ShelfPicker({ doc, shelves, onPick, onClose }: {
  doc: ShelfDoc | null; shelves: string[];
  onPick: (shelf: string | null) => void; onClose: () => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => { setName(""); }, [doc?.id]);
  const sorted = useMemo(() => [...shelves].sort(natCmp), [shelves]);
  if (!doc) return null;
  return (
    <Modal open={!!doc} onClose={onClose} title="Rafa yerleştir" size="sm">
      <p className="mb-3 line-clamp-2 text-sm text-text-secondary">{doc.title}</p>
      {sorted.length > 0 && (
        <div className="mb-3 space-y-1" role="list">
          {sorted.map((s) => (
            <button key={s} type="button" role="listitem" onClick={() => onPick(s)}
                    className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg border px-3 text-left text-sm hover:border-accent-purple/50 ${doc.shelf === s ? "border-accent-purple bg-accent-purple/5" : ""}`}>
              <span className="min-w-0 flex-1 truncate">{s}</span>
              {doc.shelf === s && <Check size={15} className="text-accent-purple" aria-hidden />}
            </button>
          ))}
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (n) onPick(n); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Yeni raf adı (ör. Ünite 1–4)"
               aria-label="Yeni raf adı" maxLength={80}
               className="min-h-[44px] min-w-0 flex-1 rounded-lg border bg-surface px-3 text-sm" />
        <button type="submit" disabled={!name.trim()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent-purple px-3 text-sm font-medium text-white disabled:opacity-40">
          <FolderPlus size={15} aria-hidden /> Ekle
        </button>
      </form>
      {doc.shelf && (
        <button type="button" onClick={() => onPick(null)}
                className="mt-3 min-h-[40px] w-full rounded-lg text-sm text-text-secondary hover:bg-surface-muted">
          Raftan çıkar
        </button>
      )}
    </Modal>
  );
}

/** Raf adı değiştirme penceresi */
export function ShelfRename({ from, onSave, onClose }: { from: string | null; onSave: (to: string) => void; onClose: () => void }) {
  const [v, setV] = useState(from || "");
  useEffect(() => { setV(from || ""); }, [from]);
  if (!from) return null;
  return (
    <Modal open={!!from} onClose={onClose} title="Rafı yeniden adlandır" size="sm">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = v.trim(); if (n) onSave(n); }}>
        <input value={v} onChange={(e) => setV(e.target.value)} aria-label="Raf adı" maxLength={80} autoFocus
               className="min-h-[44px] min-w-0 flex-1 rounded-lg border bg-surface px-3 text-sm" />
        <button type="submit" disabled={!v.trim()} className="min-h-[44px] rounded-lg bg-accent-purple px-4 text-sm font-medium text-white disabled:opacity-40">Kaydet</button>
      </form>
    </Modal>
  );
}

/** Üst şerit: "Raflara ayır" (otomatik) düğmesi */
export function AutoShelfButton({ count, onRun, busy }: { count: number; onRun: () => void; busy?: boolean }) {
  return (
    <button type="button" onClick={onRun} disabled={busy || count === 0}
            title={count ? `Başlıklara göre ${count} kaynağı raflara yerleştirir · ücretsiz` : "Ortak başlıklı kaynak bulunamadı"}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border bg-surface px-3 text-sm font-medium text-text-primary hover:border-accent-purple/50 disabled:opacity-40">
      <Wand2 size={15} className="text-accent-purple" aria-hidden /> Raflara ayır
    </button>
  );
}

/**
 * "Raflar" yönetim penceresi (her zaman görünen düğmeden açılır):
 * - Otomatik ayır · yeni raf aç
 * - Raf listesi: yeniden adlandır / kaldır
 * - Her kaynak için raf seçimi (açılır liste)
 */
export function ShelfManager({ open, onClose, docs, onAssign, onRename, onRemove, onAuto, autoCount, busy }: {
  open: boolean; onClose: () => void;
  docs: ShelfDoc[];
  onAssign: (docId: string, shelf: string | null) => void;
  onRename: (from: string) => void;
  onRemove: (name: string) => void;
  onAuto: () => void; autoCount: number; busy?: boolean;
}) {
  const [extra, setExtra] = useState<string[]>([]);       // henüz kaynağı olmayan yeni raflar (bu pencere açıkken)
  const [name, setName] = useState("");
  const used = useMemo(() => Array.from(new Set(docs.map((d) => (d.shelf || "").trim()).filter(Boolean))), [docs]);
  const all = useMemo(() => Array.from(new Set([...used, ...extra])).sort(natCmp), [used, extra]);
  const count = (s: string) => docs.filter((d) => (d.shelf || "").trim() === s).length;
  const sortedDocs = useMemo(() => [...docs].sort((a, b) => natCmp(a.title, b.title)), [docs]);
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Raflar" size="lg">
      <p className="mb-3 text-sm text-text-secondary">
        Kaynaklarını raflara (klasörlere) ayır. Raflar yalnız bu defterde geçerli; kaynaklar silinmez.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAuto} disabled={busy || autoCount === 0}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent-purple px-3 text-sm font-medium text-white disabled:opacity-40">
          <Wand2 size={15} aria-hidden /> Otomatik ayır{autoCount ? ` (${autoCount} kaynak)` : ""}
        </button>
        <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => {
          e.preventDefault(); const n = name.trim(); if (!n) return;
          setExtra((x) => (x.includes(n) ? x : [...x, n])); setName("");
        }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Yeni raf adı" aria-label="Yeni raf adı" maxLength={80}
                 className="min-h-[44px] min-w-0 flex-1 rounded-lg border bg-surface px-3 text-sm" />
          <button type="submit" disabled={!name.trim()}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium disabled:opacity-40">
            <FolderPlus size={15} aria-hidden /> Raf aç
          </button>
        </form>
      </div>

      {all.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">Raflar</h3>
          <ul className="space-y-1">
            {all.map((s) => (
              <li key={s} className="flex items-center gap-1 rounded-lg border px-2">
                <span className="min-w-0 flex-1 truncate py-2 text-sm font-medium">{s}</span>
                <span className="shrink-0 text-xs text-text-secondary">{count(s)} kaynak</span>
                {count(s) > 0 ? (
                  <>
                    <button type="button" onClick={() => onRename(s)} aria-label={`“${s}” rafını yeniden adlandır`} title="Yeniden adlandır"
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted"><Pencil size={15} /></button>
                    <button type="button" onClick={() => onRemove(s)} aria-label={`“${s}” rafını kaldır`} title="Rafı kaldır (kaynaklar silinmez)"
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted hover:text-danger"><Trash2 size={15} /></button>
                  </>
                ) : (
                  <span className="px-2 text-xs text-text-secondary">boş · aşağıdan kaynak seç</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">Kaynaklar</h3>
      <ul className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
        {sortedDocs.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-muted/60">
            <span className="min-w-0 flex-1 truncate text-sm" title={d.title}>{d.title}</span>
            <select value={(d.shelf || "").trim()} onChange={(e) => onAssign(d.id, e.target.value || null)}
                    aria-label={`“${d.title}” için raf`} disabled={busy}
                    className="min-h-[40px] w-40 shrink-0 rounded-lg border bg-surface px-2 text-sm sm:w-56">
              <option value="">— Rafsız —</option>
              {all.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
