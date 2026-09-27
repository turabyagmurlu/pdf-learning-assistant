"use client";
/**
 * Atölye (bottega): tam ekran, dikkat dağıtmayan çalışma odası.
 * Üstte kapat (✕ → geri), kapsam seçici ve üç pratik (Oku · Hatırla · Dinle).
 * Uygulama menüleri ve mini oynatıcı bu rotada (app)/layout.tsx tarafından gizlenir.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, BookOpen, Brain, Headphones, ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useGoBack } from "@/components/BackButton";
import { Skeleton } from "@/components/Skeleton";
import {
  PRACTICES, atelierHref, useAtelier, useAtelierKeys,
  type AtelierScope, type DeckMode, type Practice,
} from "@/hooks/useAtelier";
import ReadMode from "./ReadMode";
import RecallMode from "./RecallMode";
import ListenMode from "./ListenMode";
import { AllDone, EmptyAtelier, SessionEnd } from "./SessionEnd";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const ICON: Record<Practice, LucideIcon> = { read: BookOpen, recall: Brain, listen: Headphones };

type Col = { id: string; title?: string; name?: string };

export default function Atelier({ initialScope, initialPractice }: { initialScope: AtelierScope; initialPractice: Practice }) {
  const router = useRouter();
  const close = useGoBack("/today");
  const [scope, setScope] = useState<AtelierScope>(initialScope);
  const [practice, setPractice] = useState<Practice>(initialPractice);
  const [anyway, setAnyway] = useState(false);          // Hatırla: vadesi gelen yoksa yine de hepsi
  const [cols, setCols] = useState<Col[]>([]);
  const deck: DeckMode = practice === "recall" && !anyway ? "due" : "all";
  const a = useAtelier({ scope, deck, session: practice });
  const sid = useId();

  useEffect(() => {
    api("/collections", {}, 1).then((r: unknown) => {
      const x = r as { collections?: Col[] } | Col[] | null;
      setCols(Array.isArray(x) ? x : x?.collections || []);
    }).catch(() => {});
  }, []);

  // Adres çubuğu kapsam/pratikle eşleşsin (yenileyince aynı yere dönülür)
  useEffect(() => {
    router.replace(atelierHref(scope, practice), { scroll: false });
  }, [scope, practice, router]);

  useEffect(() => { document.title = "Atölye · TY PDF"; }, []);
  useEffect(() => { setAnyway(false); }, [scope, practice]);

  useAtelierKeys({ Escape: close });

  // Belge kapsamının adı kartlardan
  const docTitle = useMemo(() => {
    if (!scope.startsWith("document:")) return "";
    const id = scope.slice(9);
    return a.cards.find((c) => c.document_id === id)?.source || "Bu belge";
  }, [scope, a.cards]);

  const scopeLabel = scope === "all" ? "Tüm alıntılar"
    : scope.startsWith("collection:") ? (cols.find((c) => c.id === scope.slice(11))?.title || "Defter")
    : docTitle;

  let body: React.ReactNode;
  if (a.loading) {
    body = (
      <div className="mx-auto w-full max-w-4xl px-4 md:px-8" role="status" aria-label="Kartlar hazırlanıyor">
        <Skeleton className="h-[3px] w-full" />
        <div className="vellum mt-phi-3 rounded-2xl border px-6 py-8 md:px-12">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-5 h-7 w-11/12" />
          <Skeleton className="mt-3 h-7 w-10/12" />
          <Skeleton className="mt-3 h-7 w-7/12" />
          <Skeleton className="mt-8 h-4 w-40" />
        </div>
      </div>
    );
  } else if (a.error && !a.cards.length) {
    body = (
      <div role="alert" className="mx-auto max-w-md px-6 py-phi-5 text-center">
        <p className="text-body text-text-secondary">{a.error}</p>
        <button type="button" onClick={a.reload} className="mt-phi-3 min-h-[44px] rounded-xl border bg-surface px-4 text-sm hover:bg-gold-soft">
          Tekrar dene
        </button>
      </div>
    );
  } else if (a.finished) {
    body = <SessionEnd practice={practice} count={practice === "recall" ? a.stats.count : a.count}
                       known={a.stats.known} onAgain={a.restart} />;
  } else if (!a.cards.length) {
    body = practice === "recall" && !anyway && a.allTotal > 0
      ? <AllDone onAnyway={() => setAnyway(true)} />
      : <EmptyAtelier scoped={scope !== "all"} />;
  } else if (practice === "read") {
    body = <ReadMode cards={a.cards} index={a.index} onPrev={a.prev} onNext={a.next} />;
  } else if (practice === "recall") {
    body = <RecallMode cards={a.cards} index={a.index} onGrade={a.review} />;
  } else {
    body = <ListenMode cards={a.cards} onDone={a.finish} />;
  }

  return (
    <div className="relative flex min-h-dvh flex-col"
         style={{ background: "radial-gradient(120% 80% at 50% 0%, var(--surface) 0%, transparent 60%), radial-gradient(90% 60% at 50% 110%, var(--gold-soft) 0%, transparent 70%)" }}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-phi-2 md:px-6"
              style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
        <button type="button" onClick={close} aria-label="Atölyeden çık (Esc)" title="Atölyeden çık"
                className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-gold-soft hover:text-text-primary">
          <X size={20} aria-hidden />
        </button>
        <div className="min-w-0">
          <p className="eyebrow leading-none">Atölye</p>
          {/* Kapsam seçici: yerel <select> (dokunmatikte sistem seçicisi açılır) */}
          <label htmlFor={sid} className="sr-only">Hangi alıntılarla çalışılsın?</label>
          <div className="relative mt-0.5 max-w-[60vw] md:max-w-xs">
            <select id={sid} value={scope} onChange={(e) => setScope(e.target.value)}
                    className="min-h-[40px] w-full cursor-pointer appearance-none truncate rounded-lg bg-transparent py-1 pl-0 pr-7 font-heading text-lg text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-gold">
              <option value="all">Tüm alıntılar</option>
              {scope.startsWith("document:") && <option value={scope}>{scopeLabel}</option>}
              {cols.length > 0 && (
                <optgroup label="Defterler">
                  {cols.map((c) => <option key={c.id} value={"collection:" + c.id}>{c.title || c.name || "Adsız defter"}</option>)}
                </optgroup>
              )}
              {scope.startsWith("collection:") && !cols.some((c) => "collection:" + c.id === scope) && (
                <option value={scope}>{scopeLabel}</option>
              )}
            </select>
            <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-gold" />
          </div>
        </div>
        <nav role="tablist" aria-label="Pratik"
             className="order-last flex w-full justify-center gap-1 rounded-full border bg-surface/70 p-1 shadow-soft backdrop-blur md:order-none md:ml-auto md:w-auto">
          {PRACTICES.map(({ key, label, hint }) => {
            const Icon = ICON[key];
            const on = key === practice;
            return (
              <button key={key} type="button" role="tab" aria-selected={on} title={hint}
                      onClick={() => setPractice(key)}
                      className={cx("flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm transition-colors md:flex-none",
                        on ? "bg-gold-soft font-medium text-text-primary ring-1 ring-gold" : "text-text-secondary hover:text-text-primary")}>
                <Icon size={16} aria-hidden className={on ? "text-gold" : ""} /> {label}
              </button>
            );
          })}
        </nav>
      </header>
      <div className="rule-gold mx-3 md:mx-6" aria-hidden />
      <div className="flex flex-1 flex-col pt-phi-3" aria-busy={a.loading}>
        {body}
      </div>
    </div>
  );
}
