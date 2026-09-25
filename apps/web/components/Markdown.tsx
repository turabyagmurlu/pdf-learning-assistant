"use client";
/**
 * Markdown metnini React'e çevirir (HTML üretmez, XSS yok).
 * `cite` verilirse [K1] gibi atıf işaretleri o fonksiyonun döndürdüğü düğümle
 * değiştirilir (her numara için ayrı çağrılır); verilmezse metin olarak kalır.
 *
 *   <Markdown text={answer} cite={(n) => <CiteBadge n={n} />} />
 */
import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";

export type MarkdownProps = {
  text: string;
  cite?: (n: number) => ReactNode;
  className?: string;
  /** Tek paragraf ise sarmalayıcı `p` yerine `span` kullan (satır içi bağlam). */
  inline?: boolean;
};

function renderInline(inl: Inline[], cite?: (n: number) => ReactNode, keyBase = ""): ReactNode[] {
  return inl.map((x, i) => {
    const key = keyBase + i;
    switch (x.t) {
      case "text": return <Fragment key={key}>{x.v}</Fragment>;
      case "code": return <code key={key} className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em] dark:bg-white/10">{x.v}</code>;
      case "bold": return <strong key={key} className="font-semibold">{renderInline(x.c, cite, key + ".")}</strong>;
      case "italic": return <em key={key}>{renderInline(x.c, cite, key + ".")}</em>;
      case "cite":
        if (!cite) return <Fragment key={key}>{x.raw}</Fragment>;
        return (
          <span key={key} className="mx-0.5 inline-flex flex-wrap gap-0.5 align-baseline">
            {x.n.map((n, j) => <Fragment key={j}>{cite(n)}</Fragment>)}
          </span>
        );
    }
  });
}

function renderBlock(b: Block, i: number, cite?: (n: number) => ReactNode): ReactNode {
  const k = String(i);
  switch (b.type) {
    case "h1": return <h3 key={k} className="mt-3 text-base font-semibold first:mt-0">{renderInline(b.inline, cite, k)}</h3>;
    case "h2": return <h4 key={k} className="mt-3 text-[15px] font-semibold first:mt-0">{renderInline(b.inline, cite, k)}</h4>;
    case "h3": return <h5 key={k} className="mt-2 text-sm font-semibold first:mt-0">{renderInline(b.inline, cite, k)}</h5>;
    case "ul": return (
      <ul key={k} className="my-1.5 list-disc space-y-1 pl-5">
        {b.items.map((it, j) => <li key={j}>{renderInline(it, cite, k + "." + j)}</li>)}
      </ul>
    );
    case "ol": return (
      <ol key={k} start={b.start} className="my-1.5 list-decimal space-y-1 pl-5">
        {b.items.map((it, j) => <li key={j}>{renderInline(it, cite, k + "." + j)}</li>)}
      </ol>
    );
    case "blockquote": return (
      <blockquote key={k} className="my-1.5 border-l-2 border-amber-400 pl-3 text-text-secondary">{renderInline(b.inline, cite, k)}</blockquote>
    );
    default: return <p key={k} className="whitespace-pre-wrap">{renderInline(b.inline, cite, k)}</p>;
  }
}

export default function Markdown({ text, cite, className, inline }: MarkdownProps) {
  const blocks = parseMarkdown(text);
  if (inline && blocks.length === 1 && blocks[0].type === "p") {
    return <span className={className}>{renderInline(blocks[0].inline, cite)}</span>;
  }
  return (
    <div className={"md-body space-y-2 " + (className || "")}>
      {blocks.map((b, i) => renderBlock(b, i, cite))}
    </div>
  );
}
