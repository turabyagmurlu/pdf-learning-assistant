/**
 * Atölye metin yardımcıları (yapay zekâ yok, tamamen cihazda):
 *  - normTr: Türkçe büyük/küçük harf + aksan normalizasyonu (yazarak cevapta karşılaştırma).
 *  - pickKeywords: bir cümlede perdelenecek 1–3 anahtar kelime (sayılar ve özel adlar öncelikli,
 *    sonra durak kelimesi olmayan en uzun/ender kelimeler).
 *  - segments: metni düz parça + anahtar kelime parçalarına böler (perde çizimi için).
 */

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

export function normTr(s: string): string {
  return (s || "")
    .replace(/İ/g, "i").replace(/I/g, "ı")
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] || c)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[’'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Türkçe durak kelimeleri (normalize edilmiş biçimde). */
const STOP = new Set(normTr(`
  ve veya ile ama fakat ancak lakin çünkü ki de da bu şu o bir iki her hiç hem ya yani gibi kadar için
  daha en çok az pek ise diye olarak olan olup oldu olur olması olduğu olduğunu olmak olmayan değil
  ben sen biz siz onlar bunu şunu onu bunun şunun onun bunlar şunlar onlar bunları onları buna ona şuna
  kendi kendisi kendini sonra önce şimdi zaman bazı birçok tüm bütün diğer başka aynı yine hep artık
  mi mı mu mü ne neden nasıl nerede niçin hangi kim kimin var yok eğer ise sadece yalnız bile dahi
  ayrıca üzere göre karşı doğru beri itibaren rağmen dolayı böyle şöyle öyle ancak halde iken
  the of and to in is that for on with as by an be are was were this from or at it its not
`).split(" ").filter(Boolean));

export type Seg = { text: string; hidden: boolean; i: number };

type Tok = { word: string; start: number; end: number };

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}’'\-.,]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // "1.453" gibi sayılar bütün kalsın; sözcük sonundaki kesme işaretli eki ayır ("Leonardo'nun" → Leonardo)
    let w = m[0];
    const apo = w.search(/[’']/);
    if (apo > 0 && !/^\d/.test(w)) w = w.slice(0, apo);
    w = w.replace(/[.,-]+$/, "");
    if (!w) continue;
    out.push({ word: w, start: m.index, end: m.index + w.length });
  }
  return out;
}

/** Perdelenecek kelime aralıkları (başlangıca göre sıralı). */
export function pickKeywords(text: string, max?: number): Tok[] {
  const toks = tokens(text);
  if (!toks.length) return [];
  const freq = new Map<string, number>();
  toks.forEach((t) => { const n = normTr(t.word); freq.set(n, (freq.get(n) || 0) + 1); });
  const want = max ?? (toks.length < 9 ? 1 : toks.length < 22 ? 2 : 3);
  const scored = toks.map((t, i) => {
    const n = normTr(t.word);
    const hasDigit = /\d/.test(t.word);
    // Özel ad: büyük harfle başlıyor ve cümle başında değil
    const prevCh = text.slice(0, t.start).trimEnd().slice(-1);
    const sentenceStart = i === 0 || /[.!?…:;"“«(]/.test(prevCh);
    const proper = /^\p{Lu}/u.test(t.word) && !sentenceStart;
    let score = 0;
    if (STOP.has(n)) score = -1000;
    else if (!hasDigit && n.length < 4) score = -500;
    else {
      score = n.length;                                   // uzun kelime ≈ ender
      if ((freq.get(n) || 0) > 1) score -= 3;             // tekrar eden daha az ayırt edici
      if (hasDigit) score += 40;
      if (proper) score += 25;
    }
    return { t, n, score };
  });
  const seen = new Set<string>();
  const picked: Tok[] = [];
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    if (picked.length >= want || s.score <= 0) break;
    if (seen.has(s.n)) continue;
    seen.add(s.n);
    picked.push(s.t);
  }
  return picked.sort((a, b) => a.start - b.start);
}

export function segments(text: string, keys: Tok[]): Seg[] {
  const out: Seg[] = [];
  let pos = 0;
  keys.forEach((k, i) => {
    if (k.start > pos) out.push({ text: text.slice(pos, k.start), hidden: false, i: -1 });
    out.push({ text: text.slice(k.start, k.end), hidden: true, i });
    pos = k.end;
  });
  if (pos < text.length) out.push({ text: text.slice(pos), hidden: false, i: -1 });
  return out;
}

/** Yazılan cevap perdeli kelimelerin kaçını içeriyor? (Türkçe normalize, ek toleransı: kök başı eşleşmesi) */
export function checkAnswer(input: string, hidden: string[]): { hits: boolean[]; all: boolean } {
  const got = normTr(input).split(" ").filter(Boolean);
  const hits = hidden.map((h) => {
    const n = normTr(h);
    if (!n) return true;
    return got.some((g) => g === n || (n.length >= 5 && g.length >= 4 && (n.startsWith(g) || g.startsWith(n))));
  });
  return { hits, all: hits.every(Boolean) };
}

/** Konuşma motoru uzun metinde susabildiği için cümlelere böl. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const raw of (text || "").split(/(?<=[.!?…])\s+/)) {
    let s = raw.trim();
    while (s.length > 220) {
      let cut = s.lastIndexOf(" ", 220);
      if (cut < 110) cut = 220;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  }
  return out;
}
