/**
 * Sor — derinlik seçimi (Kısa · Ayrıntılı · Derin ⚡2). Her iki sohbette (defter + okuyucu) ortak;
 * seçim localStorage'da saklanır, varsayılan Ayrıntılı.
 */
export type Depth = "kisa" | "ayrintili" | "derin";

export const DEPTHS: { id: Depth; label: string; hint: string; cost: number }[] = [
  { id: "kisa", label: "Kısa", hint: "1–2 paragraf, doğrudan cevap", cost: 1 },
  { id: "ayrintili", label: "Ayrıntılı", hint: "Ders gibi: başlıklar, kavramlar, örnek, kaynaklar arası bağ (600–1200 kelime)", cost: 1 },
  { id: "derin", label: "Derin", hint: "İki adımda uzun anlatım: taslak + genişletme; karşıt görüşler ve eksikler (1500+ kelime)", cost: 2 },
];

export const DEFAULT_DEPTH: Depth = "ayrintili";
const KEY = "typdf.askDepth";

export function depthCost(d: Depth): number {
  return DEPTHS.find((x) => x.id === d)?.cost ?? 1;
}

export function depthLabel(d: Depth): string {
  return DEPTHS.find((x) => x.id === d)?.label ?? "Ayrıntılı";
}

export function loadDepth(): Depth {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "kisa" || v === "ayrintili" || v === "derin") return v;
  } catch {}
  return DEFAULT_DEPTH;
}

export function saveDepth(d: Depth) {
  try { localStorage.setItem(KEY, d); } catch {}
}

/** Hazır sorular. `page` verilirse (okuyucu) "Bu sayfayı anlat" başa gelir. */
export type QuickQ = { label: string; q: string; page?: true };

export function quickQuestions(opts: { page?: number | null; multi?: boolean; scope: "defter" | "kaynak" }): QuickQ[] {
  const out: QuickQ[] = [];
  if (opts.page) out.push({ label: "Bu sayfayı anlat", q: `Açık olan ${opts.page}. sayfayı bana ders gibi anlat: ne söylüyor, hangi kavramlar geçiyor, nereye bağlanıyor?`, page: true });
  if (opts.multi) out.push({ label: "Kaynakları karşılaştır", q: "Bu defterdeki kaynaklar ana konuda nerede örtüşüyor, nerede ayrışıyor? Her kaynağın konumunu ayrı ayrı göster." });
  out.push({ label: "Ana fikirleri çıkar", q: opts.scope === "defter"
    ? "Bu defterdeki kaynakların ana fikirlerini çıkar ve aralarındaki ilişkiyi anlat."
    : "Bu kaynağın ana fikirlerini çıkar ve birbirine nasıl bağlandıklarını anlat." });
  out.push({ label: "Örnekle", q: opts.scope === "defter"
    ? "Bu defterdeki en önemli kavramları somut örneklerle ve benzetmelerle açıkla."
    : "Bu kaynaktaki en önemli kavramları somut örneklerle ve benzetmelerle açıkla." });
  return out;
}

/** "Sesli dinle": Ses ajanının oynatıcısı bu olayı dinler (AudioQueuePlayer). */
export function dispatchListen(text: string, title: string) {
  try {
    window.dispatchEvent(new CustomEvent("typdf:listen", { detail: { text, title } }));
  } catch {}
}
