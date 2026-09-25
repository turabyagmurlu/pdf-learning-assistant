"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, errorMessage } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import SourceIcon from "@/components/SourceIcon";
import Button from "@/components/ui/Button";
import FilterChip from "@/components/ui/FilterChip";
import Badge from "@/components/ui/Badge";
import { docHref } from "@/lib/links";
import { Search, ArrowRight, Compass, Loader2 } from "lucide-react";

type Doc = { id: string; title: string; status: string; source_type?: string | null; collection_ids?: string[] | null; collection_id?: string | null };
type Col = { id: string; title: string };
type Hit = { id: string; document_id: string; page_number?: number | null; section_title?: string | null; content: string; score: number; title: string };

const colIds = (d: Doc) => (Array.isArray(d.collection_ids) ? d.collection_ids : d.collection_id ? [d.collection_id] : []);
/** Sonuc ilgili sayfada acilsin (video/ses okuyucusu da ?page= ile ilgili bolume gider). */
const hitHref = (h: Hit) => docHref(h.document_id, { page: h.page_number });

export default function SearchPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [cols, setCols] = useState<Col[]>([]);
  const [scope, setScope] = useState<string>("");            // "" tum kaynaklar, "c:<id>" defter, "d" secili kaynaklar
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const lastQ = useRef("");
  const fid = useId();

  useEffect(() => {
    (async () => {
      try { const d = (await api("/documents")) as Doc[]; setDocs(d.filter((x) => x.status === "ready")); }
      catch (e) { setDocs([]); setErr(errorMessage(e)); }
    })();
    (async () => {
      try { const c = await api("/collections"); setCols(((Array.isArray(c) ? c : []) as Col[]).map((x) => ({ id: x.id, title: x.title }))); }
      catch { /* defter kapsami olmadan da arama calisir */ }
    })();
  }, []);

  const scopeIds = useMemo((): string[] | null => {
    if (scope === "d") return sel.length ? sel : null;
    if (scope.startsWith("c:")) {
      const cid = scope.slice(2);
      return (docs || []).filter((d) => colIds(d).includes(cid)).map((d) => d.id);
    }
    return null;
  }, [scope, sel, docs]);

  const run = useCallback(async (query?: string) => {
    const text = (query ?? q).trim();
    if (!text) return;
    lastQ.current = text;
    if (scopeIds && scopeIds.length === 0) {
      setHits([]); setErr("Bu defterde aranabilir (hazır) kaynak yok. Kapsamı “Tüm kaynaklar” yap ya da deftere kaynak ekle.");
      return;
    }
    setBusy(true); setHits(null); setErr("");
    try {
      const body: { query: string; document_ids?: string[] } = { query: text };
      if (scopeIds) body.document_ids = scopeIds;
      const r = (await api("/search", { method: "POST", body: JSON.stringify(body) })) as Hit[];
      setHits(Array.isArray(r) ? r : []);
    } catch (e) {
      setHits(null); setErr("Arama yapılamadı. " + errorMessage(e));
    } finally { setBusy(false); }
  }, [q, scopeIds]);

  // ?q= (Hizli gecis paletinden "Icerikte ara") ile gelindiyse hemen ara
  useEffect(() => {
    const start = new URLSearchParams(window.location.search).get("q");
    if (start) { setQ(start); void run(start); }
    const onSearch = (e: Event) => { const t = String((e as CustomEvent).detail || ""); if (t) { setQ(t); void run(t); } };
    window.addEventListener("typdf:search", onSearch);
    return () => window.removeEventListener("typdf:search", onSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    const url = new URL(window.location.href);
    url.searchParams.set("q", t);
    window.history.replaceState(null, "", url.toString());
    void run(t);
  }

  function toggle(id: string) { setSel((s) => (s.indexOf(id) >= 0 ? s.filter((x) => x !== id) : [...s, id])); }
  const noDocs = docs !== null && docs.length === 0 && !err;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 md:px-6 md:py-8">
      <PageHeader eyebrow="Tüm kaynaklar" title="Araştır"
                  subtitle="Bütün defterlerinin ve kaynaklarının içinde anlamca ara; pasajı kaynağı ve sayfasıyla bul. Ücretsiz." />

      <form onSubmit={submit} role="search" className="flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3">
        <Search size={18} className="text-text-secondary" aria-hidden="true" />
        <label htmlFor={fid} className="sr-only">Kaynaklarının içinde ara</label>
        <input id={fid} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ne arıyorsun? Bir soru ya da birkaç kelime yaz"
               type="search" enterKeyHint="search"
               className="w-full border-0 bg-transparent py-3 text-base outline-none md:text-sm" />
        <Button type="submit" variant="primary" disabled={busy || !q.trim()} className="shrink-0">
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {busy ? "Aranıyor…" : "Ara"}
        </Button>
      </form>

      {docs && docs.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={fid + "-scope"} className="text-xs text-text-secondary">Nerede aransın?</label>
            <select id={fid + "-scope"} value={scope} onChange={(e) => setScope(e.target.value)}
                    className="min-h-[40px] rounded-lg border bg-surface px-3 text-sm">
              <option value="">Tüm kaynaklar ({docs.length})</option>
              {cols.length > 0 && (
                <optgroup label="Bu defterde ara">
                  {cols.map((c) => {
                    const n = docs.filter((d) => colIds(d).includes(c.id)).length;
                    return <option key={c.id} value={"c:" + c.id}>{c.title} ({n})</option>;
                  })}
                </optgroup>
              )}
              <option value="d">Seçtiğim kaynaklar…</option>
            </select>
          </div>
          {scope === "d" && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Aranacak kaynaklar">
              {docs.map((d) => {
                const on = sel.indexOf(d.id) >= 0;
                return (
                  <FilterChip key={d.id} active={on} onClick={() => toggle(d.id)} className="max-w-[240px]">
                    <SourceIcon kind={d.source_type} size={12} /> <span className="truncate">{d.title}</span>
                  </FilterChip>
                );
              })}
              {!sel.length && <span className="text-xs text-text-secondary">Hiç seçmezsen tüm kaynaklarda aranır.</span>}
            </div>
          )}
        </div>
      )}

      <div className="mt-6" aria-live="polite" aria-busy={busy}>
        {err && <p role="alert" className="mb-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}
        {busy ? <p className="text-sm text-text-secondary">Kaynaklarında aranıyor…</p> :
         noDocs ? (
          <div className="rounded-2xl border bg-surface p-10 text-center text-sm text-text-secondary">
            <Compass size={26} className="mx-auto mb-2 text-accent-purple" aria-hidden="true" />
            Henüz aranabilir kaynağın yok. <Link href="/library" className="text-accent-purple underline underline-offset-2">Kütüphane&apos;ye</Link> ya da bir deftere kaynak ekle; hazır olunca burada içinde arayabilirsin.
          </div>
         ) : hits === null ? (
          !err && (
            <div className="rounded-2xl border bg-surface p-10 text-center text-sm text-text-secondary">
              <Compass size={26} className="mx-auto mb-2 text-accent-purple" aria-hidden="true" />
              Bir soru ya da birkaç kelime yaz; kaynaklarından en ilgili pasajları sayfa numarasıyla getireyim.
            </div>
          )
         ) : hits.length === 0 ? (
          !err && <p className="text-sm text-text-secondary">“{lastQ.current}” için sonuç bulunamadı. Farklı kelimeler dene ya da kapsamı “Tüm kaynaklar” yap.</p>
         ) : (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">{hits.length} pasaj bulundu</p>
            <ul className="space-y-3">
              {hits.map((h) => (
                <li key={h.id} className="group relative rounded-2xl border bg-surface p-4 transition hover:border-accent-purple/50 hover:shadow-sm">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <SourceIcon kind={(docs || []).find((d) => d.id === h.document_id)?.source_type} size={15} />
                      <Link href={hitHref(h)} className="truncate font-medium text-text-primary after:absolute after:inset-0 after:rounded-2xl after:content-['']">
                        {h.title}
                      </Link>
                      {h.page_number ? <span className="shrink-0 text-xs text-text-secondary">· s.{h.page_number}</span> : null}
                      {h.section_title ? <span className="hidden truncate text-xs text-text-secondary sm:inline">· {h.section_title}</span> : null}
                    </div>
                    <Badge tone="neutral" title="Benzerlik">%{Math.round((h.score || 0) * 100)}</Badge>
                  </div>
                  <p className="line-clamp-3 text-sm leading-relaxed text-text-secondary">{h.content}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs text-accent-purple opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                    {h.page_number ? `Kaynağı aç · s.${h.page_number}` : "Kaynağı aç"} <ArrowRight size={12} aria-hidden="true" />
                  </span>
                </li>
              ))}
            </ul>
          </div>
         )}
      </div>
    </div>
  );
}
