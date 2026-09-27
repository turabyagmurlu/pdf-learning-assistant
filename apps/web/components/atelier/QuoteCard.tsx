"use client";
/**
 * Atölye kartı: vellum yüzey, sol kenarda pigment şeridi, büyük Fraunces italik alıntı,
 * kenar notu (kullanıcının yorumu) ve altta folyo "s. 12" + kaynak adı (kaynağında açar).
 * Hatırla modu gövdeyi `children` ile kendisi çizer (perdeli kelimeler).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { DropCap, Folio } from "@/components/art";
import { pigmentName, pigmentOf } from "@/lib/reader";
import { docHref } from "@/lib/links";
import type { AtelierCard } from "@/hooks/useAtelier";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Alıntı uzunluğuna göre yazı ölçüsü (kısa alıntı büyük ve ferah). */
export function quoteSize(text: string): string {
  const n = text.length;
  if (n < 110) return "text-[26px] leading-[1.35] md:text-[34px] md:leading-[1.3]";
  if (n < 260) return "text-[22px] leading-[1.45] md:text-[27px] md:leading-[1.42]";
  if (n < 520) return "text-[19px] leading-[1.55] md:text-[22px] md:leading-[1.55]";
  return "text-[17px] leading-[1.6] md:text-[19px] md:leading-[1.6]";
}

export function cardColor(card: Pick<AtelierCard, "color" | "kind">): string {
  if (card.kind === "p" || !card.color) return "var(--gold)";
  return pigmentOf(card.color);
}

export function eyebrowOf(card: Pick<AtelierCard, "color" | "kind" | "style">): string {
  if (card.kind === "p") return "Kendi satırların";
  if (card.style === "sticky") return "Kenar notu";
  const name = card.color ? pigmentName(card.color) : "";
  return card.style === "underline" ? `Alt çizgi${name ? " · " + name : ""}` : name || "Vurgu";
}

/** Kaynak satırı: folyo + kaynak adı; dokununca belge o sayfada açılır. */
export function SourceLine({ card, className }: { card: AtelierCard; className?: string }) {
  const label = card.source || "Kaynak";
  const inner = (
    <>
      {card.page ? <Folio page={card.page} /> : null}
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  if (!card.document_id) {
    return <p className={cx("flex min-h-[40px] items-center gap-2 text-sm text-text-secondary", className)}>{inner}</p>;
  }
  return (
    <Link href={docHref(card.document_id, { page: card.page ?? null })}
          aria-label={`${label}${card.page ? `, sayfa ${card.page}` : ""} — kaynağında aç`}
          title="Kaynağında aç"
          className={cx("inline-flex min-h-[40px] max-w-full items-center gap-2 rounded-lg px-2 -mx-2 text-sm text-text-secondary",
            "hover:bg-gold-soft hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold", className)}>
      {inner}
    </Link>
  );
}

export default function QuoteCard({ card, children, footer, active, className, dropCap = true }: {
  card: AtelierCard;
  /** Verilirse alıntı gövdesi yerine çizilir (Hatırla). */
  children?: ReactNode;
  footer?: ReactNode;
  active?: boolean;
  className?: string;
  dropCap?: boolean;
}) {
  const text = card.text.trim();
  const first = text.charAt(0);
  const useDrop = dropCap && !children && /^[«"'“‘(\[]*\p{L}/u.test(first + text.slice(1, 3)) && text.length > 60;
  const note = (card.note || "").trim();
  return (
    <article className={cx("vellum relative overflow-hidden rounded-2xl border px-6 py-7 shadow-soft md:px-12 md:py-10",
               active && "ring-1 ring-gold", className)}>
      <span aria-hidden className="absolute bottom-7 left-0 top-7 w-[5px] rounded-r-full"
            style={{ background: cardColor(card) }} />
      <p className="eyebrow">{eyebrowOf(card)}</p>
      <div className="mt-phi-2 grid gap-phi-3 lg:grid-cols-[minmax(0,1fr)_200px] lg:gap-phi-4">
        <div className="min-w-0">
          {children ?? (useDrop
            ? <DropCap as="blockquote" text={text} className={cx("font-reading italic text-text-primary", quoteSize(text))} />
            : <blockquote className={cx("font-reading italic text-text-primary", quoteSize(text))}>{text}</blockquote>)}
        </div>
        {note && (
          <aside aria-label="Kenar notun"
                 className="border-l-2 pl-phi-2 text-sm italic leading-relaxed text-text-secondary lg:mt-2 lg:self-start"
                 style={{ borderColor: "var(--gold)" }}>
            <span className="eyebrow mb-1 block not-italic">Kenar notun</span>
            {note}
          </aside>
        )}
      </div>
      <div className="rule-gold mt-phi-3" aria-hidden />
      <div className="mt-phi-1 flex flex-wrap items-center justify-between gap-2">
        <SourceLine card={card} />
        {footer}
      </div>
    </article>
  );
}
