/**
 * Okuyucu bağlantıları tek yerden: `/documents/{id}?page=&from=&t=`
 * `from` = açılan defterin kimliği (okuyucu başlığı, "Taslağa ekle" ve
 * "Tüm deftere sor" bu deftere bağlanır). Defter içindeki HER okuyucu
 * bağlantısı bu yardımcıyı kullanmalı.
 */
export function docHref(
  docId: string,
  opts?: { page?: number | null; from?: string | null; time?: number | null },
): string {
  const q = new URLSearchParams();
  if (opts?.page != null && opts.page > 0) q.set("page", String(Math.round(opts.page)));
  if (opts?.from) q.set("from", opts.from);
  if (opts?.time != null && opts.time >= 0) q.set("t", String(Math.round(opts.time)));
  const s = q.toString();
  return "/documents/" + encodeURIComponent(docId) + (s ? "?" + s : "");
}
