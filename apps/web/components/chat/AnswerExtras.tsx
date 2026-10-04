"use client";
/**
 * Sor cevabının çevresindeki ortak parçalar (defter + okuyucu):
 *  - AnswerActions: "Sesli dinle" (typdf:listen olayı → Ses ajanının oynatıcısı), "Çalışma notuna ekle", "Kopyala"
 *  - Understood: "Sorunu şöyle anladım: …" gri satırı; tıklayınca düzeltme kutusu açılır, düzeltilen soru yeniden sorulur
 *  - Followups: devam soruları (cevaptan ayrı alanda gelir)
 */
import { useState } from "react";
import { Check, Copy, Headphones, Loader2, NotebookPen, Send, Pencil } from "lucide-react";
import { mdToPlain } from "@/lib/markdown";
import { toast } from "@/components/Toast";
import { dispatchListen } from "./depth";

export type AddState = "idle" | "busy" | "done";

const btn = "flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium text-text-secondary transition hover:border-accent-purple/50 hover:text-accent-purple disabled:opacity-60";

/** Markdown'ı sesli okuma için düz metne çevirir; [K#] atıfları atılır. */
export function speakableText(md: string): string {
  return mdToPlain(md, () => "").replace(/[ \t]+([.,;:!?])/g, "$1").replace(/\*\*Genel bilgi:\*\*/g, "Genel bilgi:").trim();
}

export function AnswerActions({ text, title, onAddNote, addState = "idle", children }: {
  text: string; title: string;
  onAddNote?: () => void | Promise<void>; addState?: AddState;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Cevap işlemleri">
      <button type="button" onClick={() => dispatchListen(speakableText(text), title)}
              title="Bu cevabı sesli dinle" className={btn + " border-accent-purple/40 bg-accent-purple/5 text-text-primary"}>
        <Headphones size={13} aria-hidden /> Sesli dinle
      </button>
      {onAddNote && (
        <button type="button" onClick={() => onAddNote()} disabled={addState !== "idle"}
                aria-label={addState === "done" ? "Çalışma notuna eklendi" : "Bu cevabı çalışma notuna ekle (ücretsiz)"}
                title={addState === "done" ? "Çalışma notuna eklendi" : "Bu cevabı çalışma notuna ekle · ücretsiz"}
                className={btn + (addState === "done" ? " border-green-600/40 text-green-800 dark:text-green-300" : "")}>
          {addState === "done" ? <Check size={13} aria-hidden /> : addState === "busy" ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <NotebookPen size={13} aria-hidden />}
          {addState === "done" ? "Eklendi" : "Çalışma notuna ekle"}
        </button>
      )}
      <button type="button" className={btn}
              onClick={async () => {
                try { await navigator.clipboard.writeText(speakableText(text)); setCopied(true); setTimeout(() => setCopied(false), 1500); }
                catch { toast.error("Panoya kopyalanamadı; metni seçip kopyalayabilirsin."); }
              }}>
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} {copied ? "Kopyalandı" : "Kopyala"}
      </button>
      {children}
    </div>
  );
}

export function Understood({ question, rewritten, onCorrect, disabled }: {
  question: string; rewritten?: string | null; onCorrect: (q: string) => void; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const rq = (rewritten || "").trim();
  if (!rq) return null;
  const same = rq.replace(/\s+/g, " ").toLocaleLowerCase("tr") === question.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");
  if (editing) {
    return (
      <form className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t.length >= 3) { setEditing(false); onCorrect(t); } }}>
        <label htmlFor="understood-fix" className="sr-only">Soruyu düzelt</label>
        <input id="understood-fix" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
               className="min-h-[44px] min-w-0 flex-1 rounded-lg border bg-surface px-3 text-sm outline-none focus:border-accent-purple" />
        <button type="submit" disabled={disabled || draft.trim().length < 3}
                className="flex min-h-[44px] items-center gap-1 rounded-lg bg-accent-purple px-3 text-sm font-medium text-white disabled:opacity-60">
          <Send size={13} aria-hidden /> Böyle sor
        </button>
        <button type="button" onClick={() => setEditing(false)} className="min-h-[44px] rounded-lg px-2 text-sm text-text-secondary hover:bg-surface-muted">Vazgeç</button>
      </form>
    );
  }
  return (
    <button type="button" onClick={() => { setDraft(rq); setEditing(true); }} disabled={disabled}
            title="Yanlış anladıysa tıkla, soruyu düzelt"
            className="mt-2 flex min-h-[44px] w-full items-start gap-1.5 rounded-lg px-1 text-left text-xs text-text-secondary hover:bg-surface-muted">
      <Pencil size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        {same ? "Sorunu olduğu gibi anladım." : <>Sorunu şöyle anladım: <i>“{rq}”</i></>}
        <span className="ml-1 text-accent-purple">Düzelt</span>
      </span>
    </button>
  );
}

export function Followups({ items, onAsk, disabled }: { items: string[]; onAsk: (q: string) => void; disabled?: boolean }) {
  if (!items?.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5 pl-1">
      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Daha derine in</p>
      {items.map((f, k) => (
        <button key={k} type="button" onClick={() => onAsk(f)} disabled={disabled}
                className="group flex min-h-[44px] items-start gap-2 self-start rounded-xl border border-dashed bg-surface px-3 py-1.5 text-left text-sm text-text-secondary transition hover:border-accent-purple/50 hover:text-text-primary disabled:opacity-60">
          <Send size={12} className="mt-1 shrink-0 group-hover:text-accent-purple" aria-hidden /> {f}
        </button>
      ))}
    </div>
  );
}
