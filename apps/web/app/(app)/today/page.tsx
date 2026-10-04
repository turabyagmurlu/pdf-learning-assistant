"use client";
/**
 * Bugün: günün başlangıç sayfası (yapay zekâ harcamaz).
 * 3 blok: Kaldığın yer (tek ana eylem: Okumaya devam et) · Son biriktirdiklerin · Defterlerin.
 * Veri: GET /documents (okuma alanı), GET /notes/recent, GET /collections — hafif uçlar.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Library } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { docHref } from "@/lib/links";
import { coverOf } from "@/lib/covers";
import { pigmentOf } from "@/lib/reader";
import { useRefreshOn } from "@/components/Wake";
import { Skeleton } from "@/components/Skeleton";
import { buttonClass } from "@/components/ui/Button";
import { Folio, GoldenSpiral } from "@/components/art";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

type Recent = { note_id: string; text: string; note?: string | null; color?: string | null; page?: number | null; document_id: string; source?: string | null; at?: string | null };
type Scope = { id: string; title: string; cover_color?: string | null; cover_icon?: string | null; doc_count?: number; note_count?: number };
type Resume = { document_id: string; title: string; page?: number | null; num_pages?: number | null; pct?: number | null; reading_at?: string | null };
type DocRow = { id: string; title: string; page_count?: number | null; last_page?: number | null; progress_pct?: number | null; reading_at?: string | null };
type Today = { recent: Recent[]; resume: Resume | null; scopes: Scope[] };

function greeting(h: number) {
  if (h >= 5 && h < 12) return "Günaydın";
  if (h >= 12 && h < 17) return "İyi günler";
  if (h >= 17 && h < 22) return "İyi akşamlar";
  return "İyi geceler";
}

function pickResume(docs: DocRow[]): Resume | null {
  const read = docs.filter((d) => d.reading_at).sort((a, b) => String(b.reading_at).localeCompare(String(a.reading_at)));
  const r = read[0];
  if (!r) return null;
  return { document_id: r.id, title: r.title, page: r.last_page ?? null, num_pages: r.page_count ?? null, pct: r.progress_pct ?? null, reading_at: r.reading_at ?? null };
}

function SectionTitle({ eyebrow, title, right, id }: { eyebrow: string; title: string; right?: React.ReactNode; id: string }) {
  return (
    <div className="mb-phi-2 flex items-end justify-between gap-3">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="mt-0.5 font-heading text-title text-text-primary">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export default function TodayPage() {
  const [d, setD] = useState<Today | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const [docs, recent, cols] = await Promise.all([
        api("/documents").catch(() => []) as Promise<DocRow[]>,
        api("/notes/recent?limit=6").catch(() => []) as Promise<Recent[]>,
        api("/collections") as Promise<Scope[]>,
      ]);
      setD({ resume: pickResume(Array.isArray(docs) ? docs : []), recent: Array.isArray(recent) ? recent : [], scopes: Array.isArray(cols) ? cols : [] });
    } catch (e) { setErr(errorMessage(e, "Bugün sayfası yüklenemedi.")); }
  }, []);
  useEffect(() => { setNow(new Date()); void load(); }, [load]);
  useRefreshOn(load);
  useEffect(() => { document.title = "Bugün · TY PDF"; }, []);

  const hour = now?.getHours() ?? 9;
  const dateLine = now ? now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-phi-5 pt-phi-4 md:px-8 md:pt-phi-5">
      {/* Selam */}
      <header className="sfumato-in">
        <h1 className="font-heading text-[40px] leading-[1.05] text-text-primary md:text-[56px]" suppressHydrationWarning>
          {now ? greeting(hour) : " "}
        </h1>
        <p className="mt-phi-1 font-heading text-title italic text-text-secondary" suppressHydrationWarning>
          {dateLine ? dateLine.charAt(0).toLocaleUpperCase("tr-TR") + dateLine.slice(1) : " "}
        </p>
        <div className="rule-gold mt-phi-3" aria-hidden />
      </header>

      {err && !d && (
        <div role="alert" className="mt-phi-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning-bg px-4 py-3 text-sm">
          <span>{err}</span>
          <button type="button" onClick={load} className={buttonClass({ variant: "secondary", size: "sm" })}>Tekrar dene</button>
        </div>
      )}

      {!d && !err ? (
        <div role="status" aria-label="Yükleniyor" className="mt-phi-4 grid gap-phi-3">
          <div className="vellum rounded-2xl border p-phi-4"><Skeleton className="h-3 w-28" /><Skeleton className="mt-4 h-10 w-2/3" /><Skeleton className="mt-6 h-11 w-44" /></div>
          <div className="grid gap-phi-2 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="rounded-2xl border bg-surface p-4"><Skeleton className="h-4 w-full" /><Skeleton className="mt-2 h-4 w-4/5" /><Skeleton className="mt-4 h-3 w-1/3" /></div>)}
          </div>
        </div>
      ) : d ? (
        <>
          {/* Kaldığın yer — tek ana eylem */}
          <section aria-labelledby="t-resume" className="vellum relative mt-phi-4 overflow-hidden rounded-2xl border p-phi-3 shadow-soft md:p-phi-4">
            <p className="eyebrow">Kaldığın yer</p>
            {d.resume ? (
              <>
                <h2 id="t-resume" className="mt-phi-1 line-clamp-2 font-heading text-display text-text-primary">{d.resume.title}</h2>
                <div className="mt-phi-1 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                  {d.resume.page ? <Folio page={d.resume.page} /> : null}
                  {d.resume.num_pages ? <span>/ {d.resume.num_pages}</span> : null}
                  {typeof d.resume.pct === "number" ? <span>· %{Math.round(d.resume.pct)} okundu</span> : null}
                </div>
                {typeof d.resume.pct === "number" && (
                  <div className="mt-phi-2 h-[3px] max-w-md overflow-hidden rounded-full bg-gold-soft" role="progressbar"
                       aria-label="Okuma ilerlemesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.resume.pct)}>
                    <div className="h-full rounded-full" style={{ width: Math.max(2, Math.min(100, d.resume.pct)) + "%", background: "var(--gold)" }} />
                  </div>
                )}
                <Link href={docHref(d.resume.document_id, { page: d.resume.page ?? null })}
                      className={buttonClass({ variant: "primary", size: "lg", className: "mt-phi-3" })}>
                  <BookOpen size={17} aria-hidden /> Okumaya devam et <ArrowRight size={16} aria-hidden />
                </Link>
              </>
            ) : (
              <div className="flex items-center gap-phi-3">
                <div className="shrink-0 text-text-secondary" aria-hidden><GoldenSpiral size={96} /></div>
                <div>
                  <h2 id="t-resume" className="mt-phi-1 font-heading text-display text-text-primary">Henüz bir okuma yok</h2>
                  <p className="mt-phi-1 text-body text-text-secondary">Kütüphane&apos;den bir kaynak aç; kaldığın yer burada görünür.</p>
                  <Link href="/library" className={buttonClass({ variant: "primary", size: "lg", className: "mt-phi-2" })}>
                    <Library size={17} aria-hidden /> Kütüphaneyi aç
                  </Link>
                </div>
              </div>
            )}
          </section>

          {/* Son biriktirdiklerin */}
          <section aria-labelledby="t-recent" className="mt-phi-5">
            <SectionTitle id="t-recent" eyebrow="Çalışma notuna düştü" title="Son biriktirdiklerin" />
            {d.recent.length ? (
              <ul className="grid gap-phi-2 sm:grid-cols-2 lg:grid-cols-3">
                {d.recent.slice(0, 6).map((r) => (
                  <li key={r.note_id}>
                    <Link href={docHref(r.document_id, { page: r.page ?? null })}
                          aria-label={`${(r.text || r.note || "Kenar notu").slice(0, 80)} — ${r.source || "kaynak"}${r.page ? `, sayfa ${r.page}` : ""}; kaynağında aç`}
                          className="lift relative flex h-full flex-col overflow-hidden rounded-2xl border bg-surface py-4 pl-6 pr-4 shadow-soft">
                      <span aria-hidden className="absolute bottom-4 left-0 top-4 w-1 rounded-r-full" style={{ background: r.color ? pigmentOf(r.color) : "var(--gold)" }} />
                      <span className={"line-clamp-4 font-reading text-[17px] leading-relaxed text-text-primary " + (r.text ? "italic" : "")}>{r.text || r.note || "Kenar notu"}</span>
                      <span className="mt-auto flex items-center gap-2 pt-3 text-sm text-text-secondary">
                        {r.page ? <Folio page={r.page} /> : null}
                        <span className="min-w-0 truncate">{r.source}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed px-5 py-6 text-body text-text-secondary">
                Okurken vurguladığın her şey burada birikir ve defterinin Çalışma notu&apos;na düşer.
              </p>
            )}
          </section>

          {/* Defterler */}
          <section aria-labelledby="t-books" className="mt-phi-5">
            <SectionTitle id="t-books" eyebrow="Çalışma masan" title="Defterlerin"
                          right={
                            <Link href="/notebooks" className="inline-flex min-h-[40px] items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
                              Tümü <ArrowRight size={14} aria-hidden />
                            </Link>
                          } />
            {d.scopes.length ? (
              <ul className="grid grid-cols-2 gap-phi-2 md:grid-cols-3 lg:grid-cols-4">
                {d.scopes.map((s) => {
                  const cv = coverOf(s);
                  return (
                    <li key={s.id} className="flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-soft">
                      <Link href={"/collections/" + s.id} className={cx("lift flex min-h-[112px] flex-1 flex-col justify-between gap-2 p-4", cv.tone.bg)}>
                        <cv.Icon size={22} strokeWidth={1.9} className={cv.tone.fg} aria-hidden />
                        <span className={cx("line-clamp-2 font-heading text-heading leading-tight", cv.tone.fg)}>{s.title}</span>
                      </Link>
                      {(s.doc_count || s.note_count) ? (
                        <p className="flex min-h-[36px] items-center gap-2 border-t px-4 text-xs text-text-secondary">
                          {s.doc_count ? <span>{s.doc_count} kaynak</span> : null}
                          {s.note_count ? <span>· {s.note_count} vurgu</span> : null}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Link href="/notebooks" className="flex items-center gap-2 rounded-2xl border border-dashed px-5 py-6 text-body text-text-secondary hover:text-text-primary">
                <Library size={17} aria-hidden /> İlk defterini aç
              </Link>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
