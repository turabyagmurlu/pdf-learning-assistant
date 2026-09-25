/**
 * Kaynak islenirken kullaniciya gosterilen sade asama adi + kaba sure tahmini
 * (lib/docstage'in sade etiketleri uzerine ince katman).
 */
import { stageInfo, etaText, StageDoc } from "@/lib/docstage";

export function waitInfo(d: StageDoc): { label: string; pct: number | null; eta: string | null } {
  const s = stageInfo(d);
  return { label: s.label, pct: s.pct, eta: etaText(d) };
}
