"use client";
/**
 * Tum okuyucu turleri (PDF, metin/Office/web, YouTube/ses) icin ortak baslik:
 *   [← Geri]  Defter adi › Kaynak adi                        [sag taraf: children]
 *
 * - Geri: 44 px hedef, duz "Geri" etiketi (hedef adini yazmaz; bkz. BackButton).
 *   Uygulama icinden gelindiyse gercek geri, dogrudan acildiysa deftere / Kutuphane'ye.
 * - Defter: `?from=<collection_id>` varsa o; yoksa kaynagin bagli oldugu ilk defter
 *   (`collection_ids[0]`, eski API'de `collection_id`); hic yoksa "Kütüphane".
 * - iOS ana ekran uygulamasinda (standalone) tarayici geri tusu olmadigi icin
 *   bu baslik okuyucudan cikisin garantisidir; ust guvenli alan dikkate alinir.
 */
import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useGoBack } from "@/components/BackButton";

export type NotebookCtx = { id: string | null; title: string | null };

function idsOf(doc: any): string[] {
  const raw = doc?.collection_ids;
  let ids: string[] = [];
  if (Array.isArray(raw)) ids = raw.filter(Boolean).map(String);
  else if (typeof raw === "string") { try { const p = JSON.parse(raw); if (Array.isArray(p)) ids = p.map(String); } catch {} }
  if (!ids.length && doc?.collection_id) ids = [String(doc.collection_id)];
  return ids;
}

/** Okuyucunun hangi defter baglaminda acildigini bulur (baslik icin ad dahil). */
export function useNotebookContext(doc: any): NotebookCtx {
  const [ctx, setCtx] = useState<NotebookCtx>({ id: null, title: null });
  const idsKey = idsOf(doc).join(",");

  useEffect(() => {
    let alive = true;
    let from: string | null = null;
    try { from = new URLSearchParams(window.location.search).get("from"); } catch {}
    const ids = idsKey ? idsKey.split(",") : [];
    const cid = from || ids[0] || null;
    if (!cid) { setCtx({ id: null, title: null }); return; }
    const key = "typdf.colTitle." + cid;
    let cachedTitle: string | null = null;
    try { cachedTitle = sessionStorage.getItem(key); } catch {}
    setCtx({ id: cid, title: cachedTitle });
    if (cachedTitle) return;
    (async () => {
      try {
        const list: any[] = await api("/collections", {}, 1);
        const hit = Array.isArray(list) ? list.find((c) => String(c.id) === cid) : null;
        if (!alive) return;
        if (hit?.title) {
          try { sessionStorage.setItem(key, hit.title); } catch {}
          setCtx({ id: cid, title: hit.title });
        } else if (from && !ids.includes(from)) {
          // gecersiz ?from: kaynagin kendi defterine dus
          setCtx({ id: ids[0] || null, title: null });
        }
      } catch { /* baslik yoksa yalniz "Defter" yazar */ }
    })();
    return () => { alive = false; };
  }, [idsKey]);

  return ctx;
}

/** Ekran genisligi sorgusu (SSR'da false; ilk boyamadan sonra gercek deger). */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const apply = () => setOn(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, [query]);
  return on;
}

export function notebookHref(ctx: NotebookCtx): string {
  return ctx.id ? `/collections/${ctx.id}` : "/library";
}

export default function ReaderHeader({ doc, ctx, children, className }: {
  doc: any; ctx: NotebookCtx; children?: ReactNode; className?: string;
}) {
  const goBack = useGoBack(notebookHref(ctx));
  const parentLabel = ctx.id ? (ctx.title || "Defter") : "Kütüphane";
  return (
    <header className={"flex shrink-0 items-center gap-1 border-b bg-surface px-1.5 sm:px-2 " + (className || "")}
            style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <button type="button" onClick={goBack} aria-label="Geri" title="Geri"
              className="flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-text-primary hover:bg-surface-muted">
        <ArrowLeft size={20} aria-hidden />
        <span className="hidden sm:inline">Geri</span>
      </button>
      <nav aria-label="Konum" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-sm">
          <li className="min-w-0 max-w-[45%] shrink">
            <Link href={notebookHref(ctx)}
                  className="flex min-h-[44px] items-center truncate rounded-md px-1 text-text-secondary hover:text-text-primary hover:underline">
              <span className="truncate">{parentLabel}</span>
            </Link>
          </li>
          <li aria-hidden className="shrink-0 text-text-secondary"><ChevronRight size={14} /></li>
          <li className="min-w-0 flex-1">
            <span aria-current="page" className="block truncate font-medium text-text-primary" title={doc?.title || ""}>
              {doc?.title || "Kaynak"}
            </span>
          </li>
        </ol>
      </nav>
      {children}
    </header>
  );
}
