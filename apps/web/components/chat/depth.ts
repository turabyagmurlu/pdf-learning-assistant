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

/* ---------------------------------------------------------------- devam soruları güvenlik ağı
 * Sunucu (services/intent.split_followups) gövdeden "## Devam soruları" / "<<<DEVAM>>>" bloğunu ayırır.
 * Yine de kaçan bir şey olursa (eski kayıt, bozuk işaret, akış ortası) ekranda görünmesin: aynı toleranslı
 * kural burada da uygulanır. */
const DEVAM = "[Dd][Ee][Vv][Aa][Mm]";
const SORULARI = "sorular[ıiIİ]?";
const MARK_CORE =
  `(?:<{2,}\\s*${DEVAM}(?:\\s+${SORULARI})?\\s*:?\\s*>{0,3}` +            // <<<DEVAM>>>, <<<DEVAM, <<< devam >>>
  `|#{1,6}\\s*${DEVAM}\\s+${SORULARI}\\s*:?\\s*>{0,3}` +                    // ## Devam soruları
  `|\\*{1,2}\\s*${DEVAM}\\s+${SORULARI}\\s*:?\\s*\\*{0,2}` +                // **Devam soruları:**
  `|${DEVAM}\\s+${SORULARI}\\s*:` +                                          // Devam soruları:
  `|${DEVAM}\\s*:)`;                                                          // DEVAM:
const SPLIT_RE = new RegExp(`^[ \\t]*[*_>]*[ \\t]*${MARK_CORE}`, "gmi");
const LINE_RE = new RegExp(`^[ \\t]*[*_>]*[ \\t]*(?:${MARK_CORE}|${DEVAM}\\s+${SORULARI})[ \\t*_:>]*$`, "i");
const LOOSE_LINE_RE = new RegExp(`^[^\\n]{0,8}${DEVAM}[^\\n]{0,40}$`, "gm");
const CITE_IN_Q = /\s*\[K\s*\d+(?:\s*s\.\s*\d+)?(?:\s*[,;]\s*K?\s*\d+(?:\s*s\.\s*\d+)?)*\]/g;

function trimBody(b: string): string {
  let s = b.replace(/\s+$/, "");
  for (let i = 0; i < 3; i++) {
    const n = s.replace(/(?:\n[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*)+\s*$/, "").replace(/\s+$/, "");
    const lines = n.split("\n");
    while (lines.length && LINE_RE.test(lines[lines.length - 1])) lines.pop();
    const m = lines.join("\n").replace(/\s+$/, "");
    if (m === s) break;
    s = m;
  }
  return s;
}

function parseQuestions(tail: string, limit = 3): string[] {
  const out: string[] = [];
  for (const raw of tail.split("\n")) {
    if (LINE_RE.test(raw)) continue;
    let s = raw.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, "").trim().replace(/^[*_]+|[*_]+$/g, "").trim();
    s = s.replace(CITE_IN_Q, "").trim().replace(/^["'«»“”]+|["'«»“”]+$/g, "").trim();
    if (!s || s.startsWith("#") || s.startsWith("<") || new RegExp(`^${MARK_CORE}`, "i").test(s)) continue;
    if (s.length >= 8 && !out.includes(s)) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Gövde + devam soruları. İşaret yoksa metin olduğu gibi (sondaki boşluklar kırpılmış) döner. */
export function splitFollowups(text: string): { body: string; followups: string[] } {
  const t = (text || "").replace(/\r\n/g, "\n");
  if (!t.trim()) return { body: "", followups: [] };
  const matches = Array.from(t.matchAll(SPLIT_RE));
  if (matches.length) {
    const late = matches.filter((m) => (m.index ?? 0) >= t.length * 0.3);
    const m = (late.length ? late : matches)[0];
    const idx = m.index ?? 0;
    return { body: trimBody(t.slice(0, idx)), followups: parseQuestions(t.slice(idx + m[0].length)) };
  }
  // Yedek: sondaki "devam" geçen kısa satır ve altındaki birkaç madde
  const windowStart = Math.max(0, t.length - 1200);
  const loose = Array.from(t.matchAll(LOOSE_LINE_RE)).filter((m) => (m.index ?? 0) >= windowStart);
  if (loose.length) {
    const x = loose[loose.length - 1];
    const idx = x.index ?? 0;
    const head = x[0].trim();
    const tail = t.slice(idx + x[0].length);
    const after = tail.split("\n").filter((l) => l.trim());
    const low = head.toLocaleLowerCase("tr");
    const looksLabel = head.length <= 40 && (low.endsWith(":") || low.endsWith("soruları") || low.endsWith(">") || head.startsWith("<"));
    if (looksLabel && after.length <= 6 && after.every((l) => l.length <= 220)) {
      return { body: trimBody(t.slice(0, idx)), followups: parseQuestions(tail) };
    }
  }
  return { body: trimBody(t), followups: [] };
}

/** Yalnız gövde (ekrana basılan her cevap buradan geçer). */
export function stripFollowups(text: string): string {
  return splitFollowups(text).body;
}

/** Çalışma notundaki alıntının yanındaki "Sor" (typdf:ask) için soru kutusuna konan hazır metin. */
export function askPrefillText(text: string, page?: number | null): string {
  const t = (text || "").trim().replace(/\s+/g, " ");
  const snip = t.length > 600 ? t.slice(0, 600) + "…" : t;
  return `«${snip}»${page ? ` (s.${page})` : ""} — bunu açıkla`;
}

/** "Sesli dinle": Ses ajanının oynatıcısı bu olayı dinler (AudioQueuePlayer). */
export function dispatchListen(text: string, title: string) {
  try {
    window.dispatchEvent(new CustomEvent("typdf:listen", { detail: { text, title } }));
  } catch {}
}
