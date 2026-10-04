/**
 * Çalışma notu atıfları — saf yardımcılar (bileşen yok, DOM yok; test edilebilir).
 *
 * Ders notu metninde sayfa atıfları `[s.12]`, `[s. 12]`, `[s.12-14]` biçiminde; sentez notunda kaynak atıfları
 * `[K2]`, `[K2 s.4]`, `[K2, s.4]` biçiminde gelir. Mevcut Markdown bileşeni yalnız `[K#]` işaretlerini rozete
 * çevirdiği için burada her atıf tekil bir `[K<i>]` işaretine dönüştürülür ve `refs[i-1]` ile geri çözülür:
 *
 *   const { text, refs } = extractPageRefs(md);
 *   <Markdown text={text} cite={(n) => <PageBadge ref={refs[n - 1]} />} />
 */

export type PageRef = {
  /** sayfa (ya da video bölümü) numarası; yalnız kaynak atıfıysa null */
  page: number | null;
  /** kaynak numarası (sentez notunda [K2]); belge notunda undefined */
  k?: number;
  /** metindeki özgün işaret */
  raw: string;
};

/** [s.12] · [s. 12] · [s.12-14] · [K2] · [K2 s.4] · [K2, s.4] · [K2; s. 4] */
const CITE_RE = /\[\s*(?:K\s*(\d+)\s*(?:[,;:]\s*)?)?(?:s\.?\s*(\d+)(?:\s*[-–]\s*\d+)?)?\s*\]/g;

/** Metindeki atıfları `[K<i>]` işaretlerine çevirir; aynı atıf tekrar ediyorsa aynı numarayı alır. */
export function extractPageRefs(md: string): { text: string; refs: PageRef[] } {
  const refs: PageRef[] = [];
  const index = new Map<string, number>();
  const text = (md || "").replace(CITE_RE, (raw, k: string | undefined, page: string | undefined) => {
    if (!k && !page) return raw;                       // boş köşeli parantez: dokunma
    const key = `${k || ""}|${page || ""}`;
    let n = index.get(key);
    if (!n) {
      refs.push({ page: page ? parseInt(page, 10) : null, k: k ? parseInt(k, 10) : undefined, raw });
      n = refs.length;
      index.set(key, n);
    }
    return `[K${n}]`;
  });
  return { text, refs };
}

/** Metinde geçen tekil sayfa numaraları (küçükten büyüğe). */
export function pagesIn(md: string): number[] {
  const out = new Set<number>();
  for (const r of extractPageRefs(md).refs) if (r.page) out.add(r.page);
  return Array.from(out).sort((a, b) => a - b);
}

/** Kelime sayısı (boşluklara göre). */
export function wordCount(...texts: (string | null | undefined)[]): number {
  let n = 0;
  for (const t of texts) if (t) n += (t.match(/\S+/g) || []).length;
  return n;
}

/** Okuma süresi etiketi: 1 → "1 dk", 95 → "1 sa 35 dk". */
export function fmtMinutes(min: number | null | undefined): string {
  if (!min || min <= 0) return "";
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

/** Video/ses kaynağında [s.N] bölüm numarasını "mm:ss" zamanına çevirir (media.sections ile). */
export function sectionTime(page: number | null, sections?: { page: number; start: number }[] | null): string {
  if (!page || !sections?.length) return "";
  const s = sections.find((x) => x.page === page);
  if (!s || typeof s.start !== "number") return "";
  const t = Math.max(0, Math.round(s.start));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Rozet etiketi: "s.12", "▶ 04:00" ya da "K2 · s.4". */
export function refLabel(ref: PageRef, opts?: { sections?: { page: number; start: number }[] | null; sourceTitle?: string | null }): string {
  const time = sectionTime(ref.page, opts?.sections);
  const loc = time ? "▶ " + time : ref.page ? "s." + ref.page : "";
  if (ref.k) return loc ? `K${ref.k} · ${loc}` : `K${ref.k}`;
  return loc;
}
