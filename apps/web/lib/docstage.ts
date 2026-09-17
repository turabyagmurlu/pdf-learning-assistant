/** Belge isleme asamasini insan diline cevirir; gomme asamasinda gercek yuzde verir. */
export type StageDoc = {
  status: string; processing_stage?: string | null;
  progress_done?: number | null; progress_total?: number | null;
};

export function stageInfo(d: StageDoc): { label: string; pct: number | null } {
  if (d.status === "ready") return { label: "Hazır", pct: 100 };
  if (d.status === "failed") return { label: "Hata", pct: null };
  const s = d.processing_stage;
  if (d.status === "uploaded" || !s) return { label: "Sırada", pct: 0 };
  if (s === "extracting") return { label: "Metin çıkarılıyor", pct: 5 };
  if (s === "chunking") return { label: "Parçalanıyor", pct: 10 };
  if (s === "embedding") {
    const t = d.progress_total || 0, n = d.progress_done || 0;
    const pct = t > 0 ? 10 + Math.round((n / t) * 80) : 12;
    return { label: t > 0 ? `Dizinleniyor ${n}/${t}` : "Dizinleniyor", pct };
  }
  if (s === "analyzing") return { label: "Özetleniyor", pct: 94 };
  return { label: "İşleniyor", pct: null };
}
