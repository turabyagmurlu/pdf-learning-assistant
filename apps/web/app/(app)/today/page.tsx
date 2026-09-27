"use client";
/**
 * Bugün: günün başlangıç sayfası (GET /atelier/today; yapay zekâ harcamaz).
 * Selam · Kaldığın yer · Günün tekrarı · Son biriktirdiklerin · Defterler · 7 günlük şerit + seri.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Flame, Library, Palette } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { docHref } from "@/lib/links";
import { coverOf } from "@/lib/covers";
import { pigmentOf } from "@/lib/reader";
import { useRefreshOn } from "@/components/Wake";
import { Skeleton } from "@/components/Skeleton";
import { buttonClass } from "@/components/ui/Button";
import { Folio, GoldenSpiral, QuillSketch } from "@/components/art";
import { atelierHref } from "@/hooks/useAtelier";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

type Recent = { note_id: string; text: string; color?: string | null; page?: number | null; document_id: string; source?: string | null; at?: string | null };
type Scope = { kind: "collection"; id: string; title: string; cover_color?: string | null; cover_icon?: string | null; due: number };
type Today = {
  due: number; new_available: number; reviewed_today: number; streak_days: number;
  week: { day: string; count: number }[];
  recent: Recent[];
  resume: { document_id: string; title: string; page?: number | null; num_pages?: number | null; pct?: number | null; reading_at?: string | null } | null;
  scopes: Scope[];
};

function greeting(h: number) {
  if (h >= 5 && h < 12) return "Günaydın";
  if (h >= 12 && h < 17) return "İyi günler";
  if (h >= 17 && h < 22) return "İyi akşamlar";
  return "İyi geceler";
}

const DAY_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

function localDay(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
    try { setD((await api("/atelier/today")) as Today); }
    catch (e) { setErr(errorMessage(e, "Bugün sayfası yüklenemedi.")); }
  }, []);
  useEffect(() => { setNow(new Date()); void load(); }, [load]);
  useRefreshOn(load);
  useEffect(() => { document.title = "Bugün · TY PDF"; }, []);

  const hour = now?.getHours() ?? 9;
  const dateLine = now ? now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" }) : "";
  const due = d?.due ?? 0;
  const week = d?.week || [];
  const maxWeek = Math.max(1, ...week.map((w) => w.count));
  const todayKey = localDay(now || new Date());

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-phi-5 pt-phi-4 md:px-8 md:pt-phi-5">
      {/* Selam */}
      <header className="sfumato-in">
        <h1 className="font-heading text-[40px] leading-[1.05] text-text-primary md:text-[56px]" suppressHydrationWarning>
          {now ? greeting(hour) : " "}
        </h1>
        <p className="mt-phi-1 font-heading text-title italic text-text-secondary" suppressHydrationWarning>
          {dateLine ? dateLine.charAt(0).toLocaleUpperCase("tr-TR") + dateLine.slice(1) : " "}
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
        <div role="status" aria-label="Yükleniyor" className="mt-phi-4 grid gap-phi-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="vellum rounded-2xl border p-phi-4"><Skeleton className="h-3 w-28" /><Skeleton className="mt-4 h-10 w-2/3" /><Skeleton className="mt-6 h-11 w-44" /></div>
          <div className="vellum rounded-2xl border p-phi-3"><Skeleton className="h-3 w-24" /><Skeleton className="mt-4 h-5 w-5/6" /><Skeleton className="mt-6 h-2 w-full" /></div>
          <div className="grid gap-phi-2 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="rounded-2xl border bg-surface p-4"><Skeleton className="h-4 w-full" /><Skeleton className="mt-2 h-4 w-4/5" /><Skeleton className="mt-4 h-3 w-1/3" /></div>)}
          </div>
        </div>
      ) : d ? (
        <>
          <div className="mt-phi-4 grid gap-phi-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            {/* Günün tekrarı */}
            <section aria-labelledby="t-review" className="vellum relative overflow-hidden rounded-2xl border p-phi-3 shadow-soft md:p-phi-4">
              <p className="eyebrow">Günün tekrarı</p>
              {due > 0 ? (
                <>
                  <h2 id="t-review" className="mt-phi-1 font-heading text-display text-text-primary">
                    <span className="text-gold">{due}</span> kart seni bekliyor
                  </h2>
                  <p className="mt-phi-1 max-w-md text-body text-text-secondary">
                    Biriktirdiğin alıntılardan birkaç dakikalık sakin bir tekrar.
                    {d.new_available > 0 ? ` İçlerinde ${d.new_available} yeni kart var.` : ""}
                  </p>
                  <Link href={atelierHref("all", "recall")} className={buttonClass({ variant: "primary", size: "lg", className: "mt-phi-3" })}>
                    <Palette size={17} aria-hidden /> Atölyeye gir <ArrowRight size={16} aria-hidden />
                  </Link>
                </>
              ) : (
                <div className="flex items-center gap-phi-3">
                  <div className="shrink-0 text-text-secondary" aria-hidden><GoldenSpiral size={96} /></div>
                  <div>
                    <h2 id="t-review" className="mt-phi-1 font-heading text-display text-text-primary">Bugünlük tamam</h2>
                    <p className="mt-phi-1 text-body text-text-secondary">
                      {d.reviewed_today > 0 ? `Bugün ${d.reviewed_today} kart çalıştın.` : "Bekleyen tekrar yok."}{" "}
                      İstersen <Link href={atelierHref("all", "read")} className="font-medium text-text-primary underline decoration-gold underline-offset-4">alıntılarında dolaş</Link>.
                    </p>
                  </div>
                </div>
              )}
              <div className="pointer-events-none absolute -bottom-4 -right-2 hidden text-gold opacity-40 md:block" aria-hidden><QuillSketch /></div>
            </section>

            {/* Kaldığın yer + 7 gün */}
            <div className="flex flex-col gap-phi-3">
              {d.resume ? (
                <Link href={docHref(d.resume.document_id, { page: d.resume.page ?? null })}
                      className="vellum lift group block rounded-2xl border p-phi-3 shadow-soft">
                  <p className="eyebrow">Kaldığın yer</p>
                  <p className="mt-phi-1 line-clamp-2 font-heading text-heading text-text-primary">{d.resume.title}</p>
                  <div className="mt-phi-1 flex items-center gap-2 text-sm text-text-secondary">
                    {d.resume.page ? <Folio page={d.resume.page} /> : null}
                    {d.resume.num_pages ? <span>/ {d.resume.num_pages}</span> : null}
                    <span className="ml-auto inline-flex items-center gap-1 text-text-primary group-hover:underline">
                      <BookOpen size={15} aria-hidden /> Devam et
                    </span>
                  </div>
                  {typeof d.resume.pct === "number" && (
                    <div className="mt-phi-2 h-[3px] overflow-hidden rounded-full bg-gold-soft" role="progressbar"
                         aria-label="Okuma ilerlemesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.resume.pct)}>
                      <div className="h-full rounded-full" style={{ width: Math.max(2, Math.min(100, d.resume.pct)) + "%", background: "var(--gold)" }} />
                    </div>
                  )}
                </Link>
              ) : (
                <Link href="/library" className="vellum lift block rounded-2xl border p-phi-3 shadow-soft">
                  <p className="eyebrow">Kaldığın yer</p>
                  <p className="mt-phi-1 text-body text-text-secondary">Henüz bir okuma yok. Kütüphane&apos;den bir kaynak aç.</p>
                </Link>
              )}

              <section aria-labelledby="t-week" className="vellum rounded-2xl border p-phi-3 shadow-soft">
                <div className="flex items-baseline justify-between gap-2">
                  <p id="t-week" className="eyebrow">Son 7 gün</p>
                  {d.streak_days > 0 && (
                    <p className="inline-flex items-center gap-1 font-heading text-base italic text-text-primary">
                      <Flame size={15} aria-hidden className="text-gold" />
                      {d.streak_days >= 2 ? `${d.streak_days} gün üst üste` : "Seri bugün başladı"}
                    </p>
                  )}
                </div>
                <ol className="mt-phi-2 grid h-24 grid-cols-7 items-end gap-2" aria-label="Günlere göre çalışılan kart">
                  {week.map((w) => {
                    const isToday = w.day === todayKey;
                    const dt = new Date(w.day + "T12:00:00");
                    const h = w.count ? Math.max(8, Math.round((w.count / maxWeek) * 100)) : 4;
                    return (
                      <li key={w.day} className="flex h-full flex-col items-center justify-end gap-1"
                          aria-label={`${dt.toLocaleDateString("tr-TR", { weekday: "long" })}: ${w.count} kart${isToday ? " (bugün)" : ""}`}>
                        <span aria-hidden className={cx("w-full max-w-[22px] rounded-full", !isToday && (w.count ? "bg-border-strong opacity-60" : "bg-border"))}
                              style={{ height: h + "%", background: isToday ? "var(--gold)" : undefined }} />
                        <span aria-hidden className={cx("text-xs", isToday ? "font-semibold text-text-primary" : "text-text-secondary")}>
                          {DAY_SHORT[dt.getDay()]}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </div>
          </div>

          {/* Son biriktirdiklerin */}
          <section aria-labelledby="t-recent" className="mt-phi-5">
            <SectionTitle id="t-recent" eyebrow="Taslaklarına düştü" title="Son biriktirdiklerin"
                          right={d.recent.length ? (
                            <Link href={atelierHref("all", "read")} className="inline-flex min-h-[40px] items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
                              Akışta oku <ArrowRight size={14} aria-hidden />
                            </Link>
                          ) : undefined} />
            {d.recent.length ? (
              <ul className="grid gap-phi-2 sm:grid-cols-2 lg:grid-cols-3">
                {d.recent.slice(0, 6).map((r) => (
                  <li key={r.note_id}>
                    <Link href={docHref(r.document_id, { page: r.page ?? null })}
                          aria-label={`${r.text.slice(0, 80)} — ${r.source || "kaynak"}${r.page ? `, sayfa ${r.page}` : ""}; kaynağında aç`}
                          className="lift relative flex h-full flex-col overflow-hidden rounded-2xl border bg-surface py-4 pl-6 pr-4 shadow-soft">
                      <span aria-hidden className="absolute bottom-4 left-0 top-4 w-1 rounded-r-full" style={{ background: r.color ? pigmentOf(r.color) : "var(--gold)" }} />
                      <span className="line-clamp-4 font-reading text-[17px] italic leading-relaxed text-text-primary">{r.text}</span>
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
                Okurken vurguladığın her şey burada birikir ve Atölye&apos;de çalışma kartına dönüşür.
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
                      {s.due > 0 && (
                        <Link href={atelierHref("collection:" + s.id, "recall")}
                              aria-label={`${s.title}: ${s.due} tekrar — Atölyede çalış`}
                              className="flex min-h-[40px] items-center justify-between gap-2 border-t px-4 text-sm hover:bg-gold-soft">
                          <span className="font-medium text-gold-ink">{s.due} tekrar</span>
                          <Palette size={15} aria-hidden className="text-gold" />
                        </Link>
                      )}
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
