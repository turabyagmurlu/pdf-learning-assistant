"use client";
/**
 * "Kendi sözlerinle anlat" (Feynman): metin kutusu → POST …/study-note/feedback (⚡1) → geri bildirim kartı.
 * Puan/not yok; eksik / yanlış / iyi noktalar + bir adım ileri sorusu. Yazılan metin cihazda saklanır (kaybolmasın).
 */
import { useEffect, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { Cost, costTitle, ErrNote, toErr, type Err } from "@/components/CostBadge";
import { wordCount } from "./cites";
import CitedMarkdown from "./CitedMarkdown";
import type { OpenPage, StudyScope } from "./types";

const MIN_WORDS = 20;

export default function FeedbackBox({ scope, docId, onOpen, compact, hasNote }: {
  scope: StudyScope;
  /** belge kapsamında geri bildirimdeki [s.N] rozetleri bu belgeye gider */
  docId?: string;
  onOpen: OpenPage;
  compact?: boolean;
  /** L2 / sentez notu hazır mı (yoksa geri bildirim L1 özetine göre verilir — söyleriz) */
  hasNote: boolean;
}) {
  const KEY = `studynote.own.${scope.kind}.${scope.id}`;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err>(null);
  const [result, setResult] = useState<{ md: string; basis: string } | null>(null);
  useEffect(() => { try { setText(localStorage.getItem(KEY) || ""); } catch {} }, [KEY]);
  useEffect(() => { try { if (text) localStorage.setItem(KEY, text); else localStorage.removeItem(KEY); } catch {} }, [KEY, text]);

  const words = wordCount(text);
  const base = scope.kind === "collection" ? `/collections/${scope.id}` : `/documents/${scope.id}`;

  async function run() {
    if (busy || words < MIN_WORDS) return;
    setBusy(true); setErr(null);
    try {
      const r = await api(`${base}/study-note/feedback`, { method: "POST", body: JSON.stringify({ text }) });
      setResult({ md: r?.feedback_md || "", basis: r?.basis || "" });
    } catch (e) {
      setErr(toErr(e, "Geri bildirim hazırlanamadı; birazdan tekrar dene."));
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Kendi sözlerinle anlat" className="rounded-2xl border bg-surface p-4">
      <p className="eyebrow">Kendi sözlerinle anlat</p>
      <p className="mt-1 text-sm text-text-secondary">
        {scope.kind === "collection"
          ? "Bu defterdeki kaynaklar birlikte ne anlatıyor? Kaynağa bakmadan, kendi cümlelerinle yaz. Eksik, karışık ve iyi yakaladığın noktaları söyleriz."
          : "Bu kaynağın anlattığını kaynağa bakmadan, kendi cümlelerinle yaz. Eksik, karışık ve iyi yakaladığın noktaları söyleriz; puan yok."}
        {!hasNote && (scope.kind === "collection" ? " Sentez notu henüz yok; geri bildirim kaynak özetlerine göre verilir." : " Ders notu henüz yok; geri bildirim özete göre verilir.")}
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={compact ? 4 : 6} lang="tr" spellCheck
                aria-label="Kendi sözlerinle anlat"
                placeholder="Örn. Bu kaynağa göre … çünkü … Bunun sonucu olarak …"
                className="mt-3 w-full resize-y rounded-xl border bg-surface-muted p-3 font-reading text-[15px] leading-relaxed outline-none focus:border-accent-purple" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-secondary" aria-live="polite">
          {words < MIN_WORDS ? `${words}/${MIN_WORDS} kelime — biraz daha yaz` : `${words} kelime`}
        </span>
        <button type="button" onClick={run} disabled={busy || words < MIN_WORDS} title={costTitle(1)}
                className="ml-auto flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <MessageSquare size={15} aria-hidden />}
          Geri bildirim al <Cost n={1} className="bg-on-accent/15" />
        </button>
      </div>
      <ErrNote err={err} className="mt-2" />
      {result && (
        <div className="mt-3 rounded-xl border border-accent-purple/30 bg-accent-purple/5 p-3" role="region" aria-label="Geri bildirim">
          <div className="font-reading text-[14px] leading-[1.75] text-text-primary">
            <CitedMarkdown text={result.md} docId={docId} onOpen={onOpen} />
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            {result.basis === "l1" ? "Ders notu olmadığı için özete göre değerlendirildi; notu hazırlarsan geri bildirim de derinleşir." : "Ders notuna göre değerlendirildi."}
            {" "}Yazdığın metin bu cihazda duruyor; düzeltip yeniden gönderebilirsin.
          </p>
        </div>
      )}
    </section>
  );
}
