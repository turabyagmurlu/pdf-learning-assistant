/**
 * "Sayfa sırasına diz": yalnız ARDIŞIK alıntı (quote) gruplarını kendi içinde sıralar;
 * paragraf/başlık/cevap bloklarının yeri değişmez. Sıra: belgenin taslaktaki ilk görünüşü → sayfa → eklenme zamanı.
 */
type Q = { type: string; document_id?: string; page?: number | null; at?: string };

export function sortQuoteRuns<T extends Q>(blocks: T[]): { blocks: T[]; changed: boolean } {
  const docOrder = new Map<string, number>();
  blocks.forEach((b) => { if (b.type === "quote" && b.document_id && !docOrder.has(b.document_id)) docOrder.set(b.document_id, docOrder.size); });
  const key = (b: T, i: number): [number, number, string, number] => [
    docOrder.get(b.document_id || "") ?? 0,
    typeof b.page === "number" ? b.page : Number.MAX_SAFE_INTEGER,
    b.at || "",
    i,
  ];
  const cmp = (a: [number, number, string, number], b: [number, number, string, number]) =>
    a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0) || a[3] - b[3];
  const out: T[] = [];
  let run: { b: T; i: number }[] = [];
  const flush = () => {
    run.sort((x, y) => cmp(key(x.b, x.i), key(y.b, y.i)));
    out.push(...run.map((x) => x.b));
    run = [];
  };
  blocks.forEach((b, i) => { if (b.type === "quote") run.push({ b, i }); else { flush(); out.push(b); } });
  flush();
  return { blocks: out, changed: out.some((b, i) => b !== blocks[i]) };
}
