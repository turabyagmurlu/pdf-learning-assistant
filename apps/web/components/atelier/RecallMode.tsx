"use client";
/**
 * Hatırla: cümledeki 1–3 anahtar kelime sfumato perdesi altında. Dokununca perde kalkar
 * (ya da "Hepsini göster" / boşluk). Sonra Tekrar · Zor · Bildim · Kolay (1–4) → aralıklı tekrar.
 * İsteğe bağlı "Yazarak cevapla": Türkçe büyük/küçük harf ve aksan farkı gözetmeden karşılaştırır.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Eye, Keyboard, Check, X } from "lucide-react";
import QuoteCard, { quoteSize } from "./QuoteCard";
import Progress from "./Progress";
import { checkAnswer, pickKeywords, segments } from "./text";
import { useAtelierKeys, type AtelierCard, type Grade } from "@/hooks/useAtelier";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const TYPED_KEY = "atelier.typed";
const INTERVALS = [0, 1, 2, 4, 8, 16, 32];

function nextLabel(box: number, g: Grade): string {
  if (g === "again") return "10 dk";
  const b = Math.max(0, Math.min(6, box));
  const days = g === "hard" ? Math.max(1, Math.round(INTERVALS[b] / 2))
    : INTERVALS[Math.min(6, b + (g === "good" ? 1 : 2))];
  return days >= 30 ? "1 ay" : days >= 7 && days % 7 === 0 ? `${days / 7} hf` : `${days} gün`;
}

const GRADES: { g: Grade; label: string; key: string; tone: string }[] = [
  { g: "again", label: "Tekrar", key: "1", tone: "hover:border-accent-coral/60 hover:bg-accent-coral/10" },
  { g: "hard", label: "Zor", key: "2", tone: "hover:border-accent-amber/60 hover:bg-accent-amber/10" },
  { g: "good", label: "Bildim", key: "3", tone: "hover:border-accent-teal/60 hover:bg-accent-teal/10" },
  { g: "easy", label: "Kolay", key: "4", tone: "hover:border-accent-purple/60 hover:bg-accent-soft" },
];

export default function RecallMode({ cards, index, onGrade }: {
  cards: AtelierCard[]; index: number; onGrade: (g: Grade) => void;
}) {
  const card = cards[index];
  const text = (card?.text || "").trim();
  const keys = useMemo(() => pickKeywords(text), [text]);
  const segs = useMemo(() => segments(text, keys), [text, keys]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [typed, setTyped] = useState(false);
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState<{ hits: boolean[]; all: boolean } | null>(null);
  const gradeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fid = useId();

  useEffect(() => { try { setTyped(localStorage.getItem(TYPED_KEY) === "1"); } catch {} }, []);
  // Yeni kart: perde yeniden iner
  useEffect(() => { setOpen(new Set()); setAnswer(""); setVerdict(null); }, [card?.key, index]);
  useEffect(() => { if (typed && keys.length) setTimeout(() => inputRef.current?.focus(), 60); }, [typed, index, keys.length]);

  const allOpen = keys.length === 0 || open.size >= keys.length;
  const revealAll = () => setOpen(new Set(keys.map((_, i) => i)));
  const toggleTyped = () => setTyped((v) => { const n = !v; try { localStorage.setItem(TYPED_KEY, n ? "1" : "0"); } catch {} return n; });

  function submit() {
    if (!answer.trim()) return;
    const v = checkAnswer(answer, keys.map((k) => k.word));
    setVerdict(v); revealAll();
    setTimeout(() => gradeRef.current?.querySelector<HTMLButtonElement>(`[data-g="${v.all ? "good" : "again"}"]`)?.focus(), 80);
  }

  function grade(g: Grade) { if (!allOpen) revealAll(); onGrade(g); }

  useAtelierKeys({
    " ": revealAll, Enter: () => { if (!allOpen) revealAll(); },
    "1": () => grade("again"), "2": () => grade("hard"), "3": () => grade("good"), "4": () => grade("easy"),
  });

  if (!card) return null;
  const box = card.box ?? 0;

  const body = (
    <p className={cx("font-reading italic text-text-primary", quoteSize(text))}>
      {segs.map((s, i) => {
        if (!s.hidden) return <span key={i}>{s.text}</span>;
        const isOpen = open.has(s.i);
        const hit = verdict ? verdict.hits[s.i] : null;
        return (
          <button key={i} type="button" disabled={isOpen}
                  onClick={() => setOpen((o) => new Set(o).add(s.i))}
                  aria-label={isOpen ? s.text : `Gizli kelime ${s.i + 1}; göstermek için dokun`}
                  className={cx("sfumato-veil rounded-md px-0.5 italic", isOpen && "revealed",
                    hit === true && "text-success", hit === false && "text-accent-coral underline decoration-dotted underline-offset-4")}>
            {s.text}
          </button>
        );
      })}
    </p>
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-4 pb-phi-5 md:px-8">
      <Progress index={index} count={cards.length} label="Kart" />
      <div key={card.key + ":" + index} className="card-turn mt-phi-3">
        <QuoteCard card={card}>{body}</QuoteCard>
      </div>

      {keys.length > 0 && (
        <div className="mt-phi-3 flex flex-wrap items-center justify-center gap-2">
          {!allOpen && (
            <button type="button" onClick={revealAll}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-full border bg-surface px-4 text-sm text-text-primary hover:bg-gold-soft">
              <Eye size={16} aria-hidden /> Hepsini göster <kbd className="hidden rounded border px-1 font-mono text-xs text-text-secondary sm:inline">Boşluk</kbd>
            </button>
          )}
          <button type="button" onClick={toggleTyped} aria-pressed={typed}
                  className={cx("inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm",
                    typed ? "border-gold bg-gold-soft text-text-primary" : "bg-surface text-text-secondary hover:text-text-primary")}>
            <Keyboard size={16} aria-hidden /> Yazarak cevapla
          </button>
        </div>
      )}

      {typed && keys.length > 0 && !verdict && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="mx-auto mt-phi-2 flex w-full max-w-lg gap-2">
          <label htmlFor={fid} className="sr-only">Perdeli kelimeleri yaz</label>
          <input id={fid} ref={inputRef} value={answer} onChange={(e) => setAnswer(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false}
                 placeholder={keys.length > 1 ? `${keys.length} kelimeyi aralarında boşlukla yaz` : "Gizli kelimeyi yaz"}
                 className="min-h-[44px] min-w-0 flex-1 rounded-xl border bg-surface px-3 font-reading text-base outline-none focus:border-gold" />
          <button type="submit" className="min-h-[44px] rounded-xl border bg-surface px-4 text-sm font-medium hover:bg-gold-soft">Kontrol et</button>
        </form>
      )}
      {verdict && (
        <p role="status" className={cx("mx-auto mt-phi-2 flex items-center gap-1.5 text-sm", verdict.all ? "text-success" : "text-text-secondary")}>
          {verdict.all ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden className="text-accent-coral" />}
          {verdict.all ? "Tamamı doğru." : `${verdict.hits.filter(Boolean).length} / ${verdict.hits.length} doğru.`}
        </p>
      )}

      <div ref={gradeRef} role="group" aria-label="Ne kadar hatırladın?"
           className={cx("mx-auto mt-phi-3 grid w-full max-w-2xl grid-cols-4 gap-2 transition-opacity duration-300 motion-reduce:transition-none",
             allOpen ? "opacity-100" : "opacity-60")}>
        {GRADES.map(({ g, label, key, tone }) => (
          <button key={g} type="button" data-g={g} onClick={() => grade(g)}
                  aria-label={`${label} — ${nextLabel(box, g)} sonra (${key})`}
                  className={cx("flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-xl border bg-surface px-1 shadow-soft",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold", tone)}>
            <span className="font-heading text-base text-text-primary">{label}</span>
            <span className="text-xs text-text-secondary">
              <kbd className="mr-1 hidden font-mono sm:inline">{key}</kbd>{nextLabel(box, g)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
