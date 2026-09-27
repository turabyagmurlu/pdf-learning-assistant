"use client";
/**
 * "Kapağı düzenle" penceresi: 8 renk yuvarlagi + simge izgarasi, anlik onizleme, "Kaydet".
 *   <CoverPicker open={open} onClose={...} id={col.id} title={col.title}
 *                color={col.cover_color} icon={col.cover_icon} onSaved={(c, i) => ...} />
 * - Renk ve simge secimleri radio grubu (ok tuslari tarayicinin dogal davranisi).
 * - Her dokunma hedefi >= 44px.
 */
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import Modal from "@/components/Modal";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { toast } from "@/components/Toast";
import { COVER_COLORS, COVER_ICONS, COVER_ICON_NAMES, COVER_TONES, CoverColor, coverOf } from "@/lib/covers";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Kucuk kapak rozeti (baslik yaninda, listelerde). */
export function CoverBadge({ id, color, icon, size = 40, className = "" }: {
  id?: string | null; color?: string | null; icon?: string | null; size?: 24 | 32 | 40 | 56; className?: string;
}) {
  const c = coverOf({ id, cover_color: color, cover_icon: icon });
  const box = size === 24 ? "h-6 w-6 rounded-md" : size === 32 ? "h-8 w-8 rounded-lg" : size === 40 ? "h-10 w-10 rounded-xl" : "h-14 w-14 rounded-2xl";
  const ic = size === 24 ? 14 : size === 32 ? 18 : size === 40 ? 20 : 28;
  return (
    <span aria-hidden className={cx("inline-flex shrink-0 items-center justify-center", box, c.tone.bg, c.tone.fg, className)}>
      <c.Icon size={ic} strokeWidth={1.9} />
    </span>
  );
}

export default function CoverPicker({ open, onClose, id, title, color, icon, onSaved }: {
  open: boolean; onClose: () => void; id: string; title: string;
  color?: string | null; icon?: string | null;
  onSaved: (color: CoverColor, icon: string) => void;
}) {
  const start = coverOf({ id, cover_color: color, cover_icon: icon });
  const [c, setC] = useState<CoverColor>(start.color);
  const [i, setI] = useState<string>(start.icon);
  const [busy, setBusy] = useState(false);

  // Pencere her acildiginda kayitli kapaktan basla
  useEffect(() => {
    if (!open) return;
    const s = coverOf({ id, cover_color: color, cover_icon: icon });
    setC(s.color); setI(s.icon);
  }, [open, id, color, icon]);

  const prev = coverOf({ id, cover_color: c, cover_icon: i });

  async function save() {
    setBusy(true);
    try {
      await api(`/collections/${id}`, { method: "PATCH", body: JSON.stringify({ cover_color: c, cover_icon: i }) }, 1);
      onSaved(c, i);
      toast("Kapak kaydedildi");
      onClose();
    } catch {
      toast.error("Kapak kaydedilemedi. Bağlantını kontrol edip tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Kapağı düzenle" size="md">
      {/* Anlik onizleme */}
      <div className={cx("flex h-28 flex-col justify-between rounded-2xl p-3", prev.tone.bg)} aria-live="polite">
        <prev.Icon size={26} strokeWidth={1.9} className={prev.tone.fg} aria-hidden />
        <p className={cx("line-clamp-1 font-heading text-lg leading-tight", prev.tone.fg)}>{title}</p>
        <span className="sr-only">Önizleme: {COVER_TONES[c].label} renk, {COVER_ICONS[i]?.label || ""} simgesi</span>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-text-primary">Renk</legend>
        <div role="radiogroup" aria-label="Kapak rengi" className="mt-2 flex flex-wrap gap-1">
          {COVER_COLORS.map((k) => {
            const on = k === c;
            return (
              <button key={k} type="button" role="radio" aria-checked={on} aria-label={COVER_TONES[k].label}
                      title={COVER_TONES[k].label} onClick={() => setC(k)}
                      className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-purple">
                <span className={cx("flex h-8 w-8 items-center justify-center rounded-full", COVER_TONES[k].dot,
                                    on && "ring-2 ring-text-primary ring-offset-2 ring-offset-surface")}>
                  {on && <Check size={16} className="text-white dark:text-stone-900" aria-hidden />}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-text-primary">Simge</legend>
        <div role="radiogroup" aria-label="Kapak simgesi" className="mt-2 grid grid-cols-6 gap-1 sm:grid-cols-8">
          {COVER_ICON_NAMES.map((name) => {
            const { Icon, label } = COVER_ICONS[name];
            const on = name === i;
            return (
              <button key={name} type="button" role="radio" aria-checked={on} aria-label={label} title={label}
                      onClick={() => setI(name)}
                      className={cx("flex h-11 w-full items-center justify-center rounded-xl border transition-colors",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-purple",
                        on ? cx("border-text-primary/60", prev.tone.bg, prev.tone.fg) : "border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary")}>
                <Icon size={20} strokeWidth={1.9} aria-hidden />
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Vazgeç</Button>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />} Kaydet
        </Button>
      </div>
    </Modal>
  );
}
