/**
 * Folio — sayfa numarasi, kitap kenar notu gibi: "s. 12" (Fraunces, kucuk buyuk harf, altin murekkep).
 * Ekran okuyucu "Sayfa 12" duyar.
 */
export type FolioProps = {
  page: number | string | null | undefined;
  className?: string;
};

export default function Folio({ page, className = "" }: FolioProps) {
  if (page === null || page === undefined || page === "") return null;
  return (
    <span className={"font-heading-italic whitespace-nowrap text-small text-gold-ink " + className}
          style={{ fontVariantCaps: "all-small-caps", letterSpacing: "0.06em" }}>
      <span aria-hidden="true">s. {page}</span>
      <span className="sr-only">Sayfa {page}</span>
    </span>
  );
}
