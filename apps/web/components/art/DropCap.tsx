/**
 * DropCap — ilk harfi `lines` satir boyunca buyuk, altin, Fraunces 600 yapar.
 * `initial-letter` destekleyen tarayicida onu, digerlerinde float yedegini kullanir (globals.css .dropcap-letter).
 * Ekran okuyucu metni butun olarak okur (ilk harf gorunur kopyasi aria-hidden).
 */
import type { CSSProperties, ElementType } from "react";

export type DropCapProps = {
  text: string;
  /** Kac satir yuksekliginde (varsayilan 3) */
  lines?: number;
  as?: ElementType;
  className?: string;
};

export default function DropCap({ text, lines = 3, as: Tag = "p", className = "" }: DropCapProps) {
  const t = (text || "").trimStart();
  if (!t) return <Tag className={className} />;
  // ilk "harf": tirnak / parantez gibi isaretler varsa onlari da ilk harfle birlikte al
  const m = t.match(/^[«"'“‘(\[]*\p{L}|^./u);
  const first = m ? m[0] : t[0];
  const rest = t.slice(first.length);
  return (
    <Tag className={className} style={{ "--dc-lines": lines } as CSSProperties}>
      <span className="dropcap-letter" aria-hidden="true">{first}</span>
      <span className="sr-only">{first}</span>
      {rest}
    </Tag>
  );
}
