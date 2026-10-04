"use client";
/**
 * Çalışma notu — belge ve defter düzeyinde tek görünüm (SPEC-v3 "Çalışma notu", T5-ozet §3, T5-sadeleştirme §2.5-b).
 *
 *   <StudyNote scope={{ kind: "document" | "collection", id }} compact? onOpenPage? title? />
 *
 * Üst (Ders notu, katmanlı):
 *  - Belge: L0 tek cümle (Markdown) · L1 kartı (paragraf, "Ne öğreneceksin", okuma süresi, zorluk, zor noktalar) — mevcut
 *    analizden, kota 0 · L2 "Ders notunu hazırla ⚡1/⚡2" → bölüm bölüm not, [s.N] rozetleri tıklanır (onOpenPage ya da docHref).
 *  - Defter: kaynak listesi (L0'lar) · "Sentezle ⚡1" → ortak kavramlar, çelişkiler, tamamlayıcı noktalar; [K2 s.4] rozetleri.
 *  - "Kendi sözlerinle anlat" → Geri bildirim al ⚡1.
 * Alt ("Biriktirdiklerin"): mevcut DraftEditor sade araç çubuğuyla; her alıntının yanında "Sor".
 * Kart tekrarı, perde, puan, rozet, seri YOK. Her ⚡ düğme maliyetini gösterir; önbellekten gelen her şey ücretsiz.
 *
 * Uçlar: GET/POST /documents/{id}/study-note(/feedback), GET/POST /collections/{cid}/study-note(/feedback) — app/api/study_notes.py
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Gauge, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { docHref } from "@/lib/links";
import Markdown from "@/components/Markdown";
import { Cost, costTitle, ErrNote, toErr, type Err } from "@/components/CostBadge";
import { Skeleton } from "@/components/Skeleton";
import DraftEditor from "@/components/DraftEditor";
import { fmtMinutes } from "./cites";
import LessonNote from "./LessonNote";
import SynthesisNote from "./SynthesisNote";
import FeedbackBox from "./FeedbackBox";
import type { ColNote, DocNote, NoteData, OpenPage, StudyScope } from "./types";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export type StudyNoteProps = {
  scope: StudyScope;
  /** okuyucu yan paneli: tek sütun, küçük yazı, L1 ayrıntıları katlı */
  compact?: boolean;
  /** atıf/alıntı tıklanınca (okuyucu içinde sayfaya atlamak için); yoksa okuyucu sayfası açılır */
  onOpenPage?: OpenPage;
  /** dışa aktarma başlığı; verilmezse sunucudan gelen ad */
  title?: string;
};

export default function StudyNote({ scope, compact, onOpenPage, title }: StudyNoteProps) {
  const router = useRouter();
  const [data, setData] = useState<NoteData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const base = scope.kind === "collection" ? `/collections/${scope.id}` : `/documents/${scope.id}`;

  useEffect(() => {
    let off = false;
    setData(null); setErr(null);
    api(`${base}/study-note`, {}, 2)
      .then((r) => { if (!off) setData(r); })
      .catch((e) => { if (!off) setErr(errorMessage(e, "Çalışma notu alınamadı. Birkaç saniye sonra tekrar dene.")); });
    return () => { off = true; };
  }, [base, nonce]);

  const openPage: OpenPage = useCallback((docId, page) => {
    if (onOpenPage) onOpenPage(docId, page);
    else router.push(docHref(docId, { page, from: scope.kind === "collection" ? scope.id : null }));
  }, [onOpenPage, router, scope.kind, scope.id]);

  /* ---------- L2 üretimi (⚡): bir kez, saklanır; force ile yenile ---------- */
  const [busy, setBusy] = useState(false);
  const [genErr, setGenErr] = useState<Err>(null);
  async function generate(force = false) {
    if (busy) return;
    setBusy(true); setGenErr(null);
    try {
      const r = await api(`${base}/study-note${force ? "?force=1" : ""}`, { method: "POST" });
      setData(r);
    } catch (e) {
      setGenErr(toErr(e, "Not hazırlanamadı; birazdan tekrar dene."));
    } finally { setBusy(false); }
  }

  if (err) {
    return (
      <div className={cx("rounded-2xl border bg-surface text-sm", compact ? "p-4" : "p-5")} role="alert">
        <p className="text-text-primary">{err}</p>
        <button type="button" onClick={() => setNonce((n) => n + 1)}
                className="mt-3 flex min-h-[44px] items-center gap-1.5 rounded-xl border bg-surface px-4 hover:border-accent-purple/50">
          <RefreshCw size={14} aria-hidden /> Tekrar dene
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div role="status" aria-label="Çalışma notu yükleniyor" className={cx("space-y-3", compact ? "p-3" : "")}>
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-12 w-1/2 rounded-xl" />
      </div>
    );
  }

  const heading = title || data.title || (scope.kind === "collection" ? "Defter" : "Kaynak");
  const hasL2 = !!data.l2;

  return (
    <div className={cx("min-w-0", compact ? "space-y-5 p-3" : "space-y-8")}>
      {/* ====== ÜST: Ders notu ====== */}
      {data.scope === "document"
        ? <DocTop d={data} compact={compact} busy={busy} genErr={genErr} onGenerate={generate} openPage={openPage} />
        : <ColTop d={data} compact={compact} busy={busy} genErr={genErr} onGenerate={generate} openPage={openPage} />}

      {/* ====== Kendi sözlerinle anlat (⚡1) ====== */}
      {(data.scope === "collection" ? data.ready > 0 : data.status === "ready") && (
        <FeedbackBox scope={scope} docId={data.scope === "document" ? data.id : undefined} onOpen={openPage} compact={compact} hasNote={hasL2} />
      )}

      {/* ====== ALT: Biriktirdiklerin ====== */}
      <section aria-label="Biriktirdiklerin">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h2 className={cx("font-heading text-text-primary", compact ? "text-base" : "text-xl")}>Biriktirdiklerin</h2>
          <span className="text-xs text-text-secondary">
            {scope.kind === "collection" ? "Defterdeki kaynaklardan vurguların, kaynak ve sayfa sırasıyla; aralarına kendi cümlelerin." : "Bu kaynaktaki vurguların, sayfa sırasıyla; aralarına kendi cümlelerin."}
          </span>
        </div>
        <DraftEditor scope={scope} title={heading} compact={compact} onOpenPage={openPage} />
      </section>
    </div>
  );
}

/* =================================================================== belge üstü */

function DocTop({ d, compact, busy, genErr, onGenerate, openPage }: {
  d: DocNote; compact?: boolean; busy: boolean; genErr: Err; onGenerate: (force?: boolean) => void; openPage: OpenPage;
}) {
  const l1 = d.l1;
  const ready = d.status === "ready";
  const [more, setMore] = useState(!compact);
  const isMedia = d.source_type === "youtube" || d.source_type === "audio";
  const time = fmtMinutes(l1.reading_minutes);
  const goals = l1.learn_goals || [];
  const hard = l1.difficult_concepts || [];
  const hasL1 = !!(l1.paragraph || goals.length || hard.length || time || l1.difficulty_tr);

  return (
    <section aria-label="Ders notu" className={compact ? "space-y-3" : "space-y-4"}>
      {!ready ? (
        <p className="rounded-2xl border bg-surface p-4 text-sm text-text-secondary" role="status">
          {d.status === "failed" ? "Bu kaynak işlenemedi; “Yeniden işle” ile tekrar dene. İşlenince özet ve ders notu burada olur."
            : "Kaynak hazırlanıyor. İşlenmesi bitince özeti, öğrenme hedefleri ve ders notu burada belirir."}
        </p>
      ) : (
        <>
          {/* L0 */}
          {d.l0 ? (
            <div className={cx("font-reading italic text-text-primary", compact ? "text-[16px] leading-relaxed" : "text-[19px] leading-relaxed")}>
              <Markdown text={d.l0} inline />
            </div>
          ) : (
            <p className="text-sm text-text-secondary">Bu kaynağın özeti henüz çıkarılmadı; “Yeniden işle” ile tekrar denenebilir.</p>
          )}

          {/* L1 kartı */}
          {hasL1 && (
            <div className={cx("vellum rounded-2xl border", compact ? "p-3" : "p-4 md:p-5")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                {time && <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden /> {isMedia ? "izleme" : "okuma"} ~{time}</span>}
                {l1.difficulty_tr && <span className="inline-flex items-center gap-1"><Gauge size={12} aria-hidden /> zorluk: {l1.difficulty_tr}</span>}
                {d.plan.sections > 0 && <span>{d.plan.sections} bölüm</span>}
                {compact && (l1.paragraph || goals.length > 0 || hard.length > 0) && (
                  <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
                          className="ml-auto min-h-[32px] rounded-lg px-2 text-accent-purple hover:bg-surface">
                    {more ? "Daha az" : "Daha fazla"}
                  </button>
                )}
              </div>
              {more && (
                <div className={cx("mt-3 space-y-3 font-reading text-text-primary", compact ? "text-[14px] leading-[1.75]" : "text-[15px] leading-[1.8]")}>
                  {l1.paragraph && <Markdown text={l1.paragraph} />}
                  {goals.length > 0 && (
                    <div>
                      <p className="eyebrow">Ne öğreneceksin</p>
                      <ul className="mt-1 space-y-1">
                        {goals.map((g, i) => (
                          <li key={i} className="flex gap-2"><CheckCircle2 size={15} aria-hidden className="mt-1 shrink-0 text-accent-purple" /><span>{g}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {hard.length > 0 && (
                    <div>
                      <p className="eyebrow">Zor noktalar</p>
                      <ul className="mt-1 space-y-1 text-text-secondary">
                        {hard.map((h, i) => <li key={i} className="flex gap-2"><span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-coral" /><span className="text-text-primary">{h}</span></li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* L2 */}
          {d.l2 ? (
            <LessonNote note={d.l2} docId={d.id} sections={d.media_sections} onOpen={openPage} compact={compact}
                        stale={d.l2_stale} at={d.l2_at} refreshCalls={d.plan.calls} onRefresh={() => onGenerate(true)} busy={busy} />
          ) : (
            <div className={cx("rounded-2xl border border-dashed bg-surface", compact ? "p-3" : "p-4 md:p-5")}>
              <p className="eyebrow">Ders notu</p>
              <p className="mt-1 text-sm text-text-secondary">
                Bölüm bölüm, sayfa atıflı bir ders notu: her bölüm ne anlatıyor, kavramlar nasıl bağlanıyor, sık yanlış anlamalar ve
                kendini sınayacağın 5 soru. Bir kez hazırlanır ve saklanır; sonra açmak ücretsiz.
                {d.plan.sections > 0 && ` ${d.plan.sections} bölüm${d.plan.calls > 1 ? " · uzun kaynak: iki adımda hazırlanır" : ""}.`}
              </p>
              <button type="button" onClick={() => onGenerate(false)} disabled={busy} title={costTitle(d.plan.calls)}
                      className="mt-3 flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent disabled:opacity-60">
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}
                {busy ? "Hazırlanıyor… bu birkaç dakika sürebilir" : "Ders notunu hazırla"} {!busy && <Cost n={d.plan.calls} className="bg-on-accent/15" />}
              </button>
              <ErrNote err={genErr} className="mt-2" />
            </div>
          )}
          {d.l2 && <ErrNote err={genErr} />}
        </>
      )}
    </section>
  );
}

/* =================================================================== defter üstü */

function ColTop({ d, compact, busy, genErr, onGenerate, openPage }: {
  d: ColNote; compact?: boolean; busy: boolean; genErr: Err; onGenerate: (force?: boolean) => void; openPage: OpenPage;
}) {
  const ready = d.sources.filter((s) => s.status === "ready");
  const withNote = ready.filter((s) => s.has_note).length;
  return (
    <section aria-label="Sentez notu" className={compact ? "space-y-3" : "space-y-4"}>
      {ready.length === 0 ? (
        <p className="rounded-2xl border bg-surface p-4 text-sm text-text-secondary" role="status">
          Bu defterde henüz hazır kaynak yok. Kaynak ekle; işlenince her kaynağın özeti burada listelenir ve kaynakları birleştiren sentez notu hazırlanabilir.
        </p>
      ) : (
        <>
          {/* kaynaklar: K# · ad · tek cümle (kota 0) */}
          <ol className={cx("space-y-1.5", compact && "max-h-64 overflow-y-auto pr-1")} aria-label="Kaynaklar">
            {d.sources.map((s) => (
              <li key={s.document_id} className="flex gap-2 rounded-xl border bg-surface px-3 py-2">
                <span className="mt-0.5 shrink-0 rounded-full bg-surface-muted px-1.5 text-[11px] font-medium leading-5 text-text-secondary">K{s.k}</span>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => openPage(s.document_id, null)} className="min-h-[28px] text-left text-sm font-medium text-text-primary hover:text-accent-purple">
                    {s.title}
                  </button>
                  {s.status !== "ready" ? <p className="text-xs text-text-secondary">hazırlanıyor</p>
                    : s.l0 ? <div className="line-clamp-2 text-xs text-text-secondary"><Markdown text={s.l0} inline /></div> : null}
                </div>
                {s.has_note && <span className="shrink-0 self-start text-[11px] text-accent-purple" title="Bu kaynağın ders notu hazır">not ✓</span>}
              </li>
            ))}
          </ol>

          {d.l2 ? (
            <SynthesisNote note={d.l2} sources={d.sources} onOpen={openPage} compact={compact} stale={d.l2_stale} at={d.l2_at}
                           onRefresh={() => onGenerate(true)} busy={busy} />
          ) : (
            <div className={cx("rounded-2xl border border-dashed bg-surface", compact ? "p-3" : "p-4 md:p-5")}>
              <p className="eyebrow">Sentez notu</p>
              <p className="mt-1 text-sm text-text-secondary">
                {ready.length} kaynağı birleştiren okunur bir not: ortak kavramlar, kaynakların ayrıştığı yerler, birbirini tamamlayan noktalar,
                okuma sırası ve kaynaklar arası sorular. Her iddia kaynak numarasıyla atıflı. Bir kez hazırlanır, saklanır.
                {withNote < ready.length && ` Ders notu hazır olan kaynak: ${withNote}/${ready.length} — notlar arttıkça sentez derinleşir.`}
              </p>
              <button type="button" onClick={() => onGenerate(false)} disabled={busy} title={costTitle(1)}
                      className="mt-3 flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent disabled:opacity-60">
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}
                {busy ? "Sentezleniyor…" : "Sentezle"} {!busy && <Cost n={1} className="bg-on-accent/15" />}
              </button>
              <ErrNote err={genErr} className="mt-2" />
            </div>
          )}
          {d.l2 && <ErrNote err={genErr} />}
        </>
      )}
    </section>
  );
}
