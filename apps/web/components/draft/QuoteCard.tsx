"use client";
/**
 * Taslaktaki alıntı: sanat eseri gibi. Sol kenarda pigment şeridi, Fraunces italik metin,
 * altında küçük "s. 12 · Kaynak adı" (tıklayınca kaynağın o sayfası), kullanıcının yorumu
 * el yazısı hissinde küçük bir kenar notu. style: "underline" → pigment alt çizgi, "sticky" → not kâğıdı.
 * Yeni biriken (auto) alıntılar ilk görünüşte `.gilded` (altın parıltı) ile belirir.
 * style "ink" (el yazısı notu): metin yerine kutuya ölçekli çizim + "El yazısı notu · s. N".
 * onAsk verilirse altyazının yanında "Sor" düğmesi: alıntı Sor paneline/sekmesine soru olarak gider.
 */
import type { CSSProperties } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { HIGHLIGHT_COLORS, pigmentOf } from "@/lib/reader";
import InkPreview from "@/components/reader/InkPreview";
import type { Block } from "@/components/DraftEditor";

type QuoteBlock = Extract<Block, { type: "quote" }>;

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** #RRGGBB → rgba(…, a); başka biçimleri olduğu gibi döndürür. */
export function tint(hex: string, a: number) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

export function quotePigment(b: { color?: string | null }) {
  return pigmentOf(b.color || HIGHLIGHT_COLORS[0].value);
}

export default function QuoteCard({ b, onOpen, onAsk, gilded, compact }: {
  b: QuoteBlock; onOpen: () => void; onAsk?: () => void; gilded?: boolean; compact?: boolean;
}) {
  const style = b.style || "highlight";
  const ink = style === "ink" && b.ink?.strokes?.length ? b.ink : null;
  // el yazısında şerit mürekkebin rengini alır
  const pig = ink ? ink.strokes[0].c : quotePigment(b);
  const sticky = style === "sticky";
  const text = (b.text || "").trim();
  const note = (b.note || "").trim();
  const cite = [ink ? "El yazısı notu" : "", b.page ? `s. ${b.page}` : "", b.source || "Kaynak"].filter(Boolean).join(" · ");

  // Metin görünümü: vurguda yumuşak pigment zemin (fosforlu kalem gibi alt yarı), alt çizgide pigment çizgi
  const textStyle: CSSProperties = style === "underline"
    ? { textDecorationLine: "underline", textDecorationColor: pig, textDecorationThickness: 2, textUnderlineOffset: 5 }
    : sticky ? {}
    : { backgroundImage: `linear-gradient(transparent 58%, ${tint(pig, 0.55)} 58%, ${tint(pig, 0.55)} 92%, transparent 92%)`,
        boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" };

  return (
    <figure className={cx("relative my-4", compact ? "pl-4" : "pl-5 md:pl-6", gilded && "gilded sfumato-in")}
            aria-label={`Alıntı · ${cite}`}>
      {/* pigment şeridi */}
      <span aria-hidden className="absolute bottom-1 left-0 top-1 w-[5px] rounded-full"
            style={{ background: `linear-gradient(180deg, ${tint(pig, 0.35)}, ${pig} 18%, ${pig} 82%, ${tint(pig, 0.35)})` }} />

      <div className={cx(sticky && "rounded-md px-4 py-3 shadow-soft")}
           style={sticky ? { background: tint(pig, 0.42), transform: "rotate(-0.6deg)" } : undefined}>
        {ink && (
          <InkPreview strokes={ink.strokes} box={ink.box} maxHeight={compact ? 110 : 160}
                      label={`El yazısı notu${b.page ? ` · s. ${b.page}` : ""}`} className="max-w-[34rem]" />
        )}
        {text && (
          <blockquote className={cx("font-reading italic text-text-primary", compact ? "text-[15px] leading-[1.7]" : "text-[16px] leading-[1.8] md:text-[17px]")}>
            <span aria-hidden className="mr-0.5 font-heading not-italic text-[color:var(--gold)]">“</span>
            <span style={textStyle}>{text}</span>
            <span aria-hidden className="ml-0.5 font-heading not-italic text-[color:var(--gold)]">”</span>
          </blockquote>
        )}
        {/* yorum: el yazısı hissinde kenar notu (yalnız metin yoksa ana içerik olur) */}
        {note && (
          <p className={cx(text ? "mt-2 ml-1 max-w-[34rem] border-l border-dashed pl-3 text-[13px] leading-relaxed" : "text-[15px] leading-relaxed",
                           "font-reading italic text-[color:var(--accent-coral)]")}
             style={text ? { borderColor: "var(--gold)", transform: "rotate(-0.4deg)", transformOrigin: "left top" } : undefined}>
            <span className="sr-only">Notun: </span>{note}
          </p>
        )}
      </div>

      <figcaption className="mt-1.5 flex flex-wrap items-center gap-1">
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
                title="Kaynakta bu sayfayı aç"
                className="inline-flex min-h-[40px] items-center rounded-md px-1 text-xs tracking-wide text-text-secondary underline-offset-4 hover:text-accent-purple hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/40">
          {cite}
        </button>
        {onAsk && (text || note) && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onAsk(); }}
                  title="Bu alıntıyı soruya ekle (Sor)" aria-label="Bu alıntı hakkında sor"
                  className="inline-flex min-h-[40px] items-center gap-1 rounded-md px-1.5 text-xs text-text-secondary hover:text-accent-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/40">
            <MessageCircleQuestion size={13} aria-hidden /> Sor
          </button>
        )}
      </figcaption>
    </figure>
  );
}
