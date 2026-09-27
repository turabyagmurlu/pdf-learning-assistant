"use client";
/**
 * "Atölyede çalış": taslağın öne çıkan tek ana düğmesi (lapis dolgu). Tekrar bekleyen kart sayısı rozeti:
 * defterde GET /atelier/counts → by_collection[id]; belgede GET /atelier/deck?scope=document:<id>&mode=due&limit=1 → due.
 * Sayı alınamazsa rozet görünmez (düğme yine çalışır).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { api } from "@/lib/api";
import { atelierHref, type DraftScope } from "./scope";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export default function AtelierButton({ scope, compact, refreshKey }: { scope: DraftScope; compact?: boolean; refreshKey?: number }) {
  const [due, setDue] = useState<number | null>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        if (scope.kind === "collection") {
          const r = await api("/atelier/counts", {}, 1);
          const n = r?.by_collection?.[scope.id];
          if (!off) setDue(typeof n === "number" ? n : 0);
        } else {
          const r = await api(`/atelier/deck?scope=document:${encodeURIComponent(scope.id)}&mode=due&limit=1`, {}, 1);
          const n = typeof r?.due === "number" ? r.due : typeof r?.total === "number" ? r.total : null;
          if (!off) setDue(n);
        }
      } catch { if (!off) setDue(null); }
    })();
    return () => { off = true; };
  }, [scope.kind, scope.id, refreshKey]);

  return (
    <Link href={atelierHref(scope)}
          title="Bu taslaktaki alıntılarla oku, hatırla, dinle"
          className={cx("inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-accent-purple font-medium text-on-accent shadow-soft transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/40 focus-visible:ring-offset-2",
                        compact ? "px-3 text-sm" : "px-4 text-sm")}>
      <GraduationCap size={16} aria-hidden /> Atölyede çalış
      {!!due && due > 0 && (
        <span className="ml-0.5 rounded-full bg-surface px-1.5 text-xs font-semibold leading-5 text-accent-purple"
              aria-label={`${due} tekrar bekliyor`}>{due > 99 ? "99+" : due}</span>
      )}
    </Link>
  );
}
