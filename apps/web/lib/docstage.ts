/**
 * Kaynak isleme asamasini sade dile cevirir. Kullaniciya gorunen 3 ana asama:
 *   Okunuyor -> Anlamlandiriliyor -> Ozet hazirlaniyor
 * Taranmis sayfa (OCR), ses ve video icin "okuma" asamasinin sade karsiliklari kullanilir.
 */
export type StageDoc = {
  status: string; processing_stage?: string | null;
  progress_done?: number | null; progress_total?: number | null;
  source_type?: string | null;
  page_count?: number | null;
};

export function stageInfo(d: StageDoc): { label: string; pct: number | null } {
  if (d.status === "ready") return { label: "Hazır", pct: 100 };
  if (d.status === "failed") return { label: "Hazırlanamadı", pct: null };
  const s = d.processing_stage;
  if (d.status === "uploaded" || !s) return { label: "Sırada", pct: 0 };
  const t = d.progress_total || 0, n = d.progress_done || 0;
  if (s === "ocr") {
    return { label: t > 0 ? `Taranmış sayfalar okunuyor ${n}/${t}` : "Taranmış sayfalar okunuyor", pct: t > 0 ? 2 + Math.round((n / t) * 8) : 3 };
  }
  if (s === "extracting" && d.source_type === "audio") {
    return { label: t > 1 ? `Kayıt yazıya dökülüyor ${n}/${t}` : "Kayıt yazıya dökülüyor", pct: t > 1 ? 2 + Math.round((n / t) * 8) : 5 };
  }
  if (s === "extracting" && d.source_type === "youtube") {
    return { label: t > 1 ? `Video yazıya dökülüyor ${n}/${t}` : "Video yazıya dökülüyor", pct: t > 1 ? 2 + Math.round((n / t) * 8) : 5 };
  }
  if (s === "extracting") return { label: "Okunuyor", pct: 5 };
  if (s === "chunking") return { label: "Okunuyor", pct: 10 };
  if (s === "embedding") {
    const pct = t > 0 ? 10 + Math.round((n / t) * 80) : 12;
    return { label: t > 0 ? `Anlamlandırılıyor %${Math.min(99, Math.round((n / t) * 100))}` : "Anlamlandırılıyor", pct };
  }
  if (s === "analyzing") return { label: "Özet hazırlanıyor", pct: 94 };
  return { label: "Hazırlanıyor", pct: null };
}

/** Saniye araligini "1-2 dk" / "1 dakikadan az" gibi okunur metne cevirir. */
export function formatRange(loSec: number, hiSec: number): string {
  if (hiSec < 60) return "1 dakikadan az";
  const lo = Math.max(1, Math.round(loSec / 60));
  const hi = Math.max(lo, Math.round(hiSec / 60));
  if (hi >= 60) return "1 saatten fazla";
  return lo === hi ? `yaklaşık ${lo} dk` : `${lo}-${hi} dk`;
}

/**
 * Kalan sure icin kaba tahmin (aralik). Hazir / basarisiz kaynakta null.
 * Tahmin bilerek genistir; kullaniciya "yaklasik" diye gosterilir:
 *   `Tahmini kalan: ${etaText(d)}`
 */
export function etaRange(d: StageDoc): { lo: number; hi: number } | null {
  if (d.status === "ready" || d.status === "failed") return null;
  const s = d.processing_stage;
  const t = d.progress_total || 0, n = d.progress_done || 0;
  const left = Math.max(0, t - n);
  const pages = Math.max(1, d.page_count || 0);
  const tail = { lo: 10, hi: 40 };                         // ozet asamasi
  if (s === "analyzing") return tail;
  if (s === "embedding" && t > 0) return { lo: left * 3 + tail.lo, hi: left * 8 + tail.hi };
  if (s === "ocr" && t > 0) return { lo: left * 3 + 30, hi: left * 8 + 120 };
  if ((d.source_type === "audio" || d.source_type === "youtube") && s === "extracting") {
    const parts = t > 1 ? left : 3;
    return { lo: parts * 15 + 30, hi: parts * 45 + 120 };
  }
  // Sirada / okunuyor: sayfa sayisina gore
  return { lo: 20 + pages * 0.5, hi: 60 + pages * 2 };
}

export function etaText(d: StageDoc): string | null {
  const r = etaRange(d);
  return r ? formatRange(r.lo, r.hi) : null;
}
