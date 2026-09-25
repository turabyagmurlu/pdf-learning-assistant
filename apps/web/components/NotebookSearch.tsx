"use client";
/**
 * Defter ici arama: yalniz bu defterin kaynaklarinda arar.
 * Sonuclar belgeye gore gruplu, sayfa numarali; tikla -> PDF o sayfada acilir.
 * Varsayilan mod "Kelime" (aninda). "Anlamca" ve "Karma" da kisisel kullanimdan dusmez.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Search, X, Loader2, FileText, ExternalLink, Type, Brain, Layers } from "lucide-react";

type Hit = { page: number | null; section?: string | null; snippet: string; how: "text" | "meaning" | "both"; score: number };
type Group = { document_id: string; title: string; best: number; count: number; hits: Hit[] };
type Result = { query: string; groups: Group[]; total: number; mode: string; documents: number };

const cx = (...a: any[]) => a.filter(Boolean).join(" ");

/** Parcadaki eslesen kelimeleri vurgula (Turkce buyuk/kucuk harf duyarsiz). */
function Mark({ text, q }: { text: string; q: string }) {
  const terms = q.replace(/"/g, "").split(/\s+/).filter((t) => t.length >= 2);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp("(" + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        re.test(p) && terms.some((t) => t.toLocaleLowerCase("tr") === p.toLocaleLowerCase("tr"))
          ? <mark key={i} className="rounded bg-accent-amber/30 px-0.5 text-text-primary">{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

export default function NotebookSearch({ collectionId, readyCount }: { collectionId: string; readyCount: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"hybrid" | "text" | "meaning">("text");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  async function run(query: string, m = mode) {
    const s = query.trim();
    if (s.length < 2) { setRes(null); setErr(""); return; }
    const my = ++seq.current;
    setBusy(true); setErr("");
    try {
      const r = await api(`/collections/${collectionId}/search?q=${encodeURIComponent(s)}&mode=${m}`);
      if (my === seq.current) setRes(r);
    } catch (e: any) {
      if (my === seq.current) { setErr(e?.message || "Arama yapılamadı."); setRes(null); }
    } finally { if (my === seq.current) setBusy(false); }
  }

  // Yazarken bekle; kelime modunda aninda, anlam modunda gereksiz istek olmasin
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setRes(null); return; }
    timer.current = setTimeout(() => run(q, mode), mode === "text" ? 200 : 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mode]);

  const open = (docId: string, page: number | null) =>
    router.push("/documents/" + docId + (page ? "?page=" + page : ""));

  return (
    <div className="mb-4 rounded-2xl border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") run(q); if (e.key === "Escape") { setQ(""); setRes(null); } }}
                 placeholder={`Bu defterdeki ${readyCount} kaynakta ara… (tırnak: tam ifade)`}
                 aria-label="Bu defterin kaynaklarında ara"
                 className="w-full rounded-xl border bg-surface py-2 pl-9 pr-9 text-sm outline-none focus:border-accent-purple" />
          {q && (
            <button onClick={() => { setQ(""); setRes(null); }} aria-label="Aramayı temizle"
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            </button>
          )}
        </div>
        <div role="radiogroup" aria-label="Arama türü" className="flex items-center gap-0.5 rounded-xl border p-0.5"
             title="Kelime: birebir geçen yerler · Anlamca: yakın kavramlar da · Karma: ikisi birden · hepsi ücretsiz">
          {([["text", "Kelime", Type], ["meaning", "Anlamca", Brain], ["hybrid", "Karma", Layers]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => setMode(k)} role="radio" aria-checked={mode === k}
                    className={cx("flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs",
                      mode === k ? "bg-accent-soft font-medium text-accent-purple" : "text-text-secondary hover:bg-surface-hover")}>
              <I size={12} /> {l}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="mt-2 text-xs text-danger">{err}</p>}

      {res && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-text-secondary">
            {res.total === 0
              ? <>"<b>{res.query}</b>" için sonuç yok.{" "}
                  {res.mode === "text" && (
                    <button onClick={() => setMode("meaning")} className="font-medium text-accent-purple underline-offset-2 hover:underline">
                      Anlamca yakın olanları da göster (ücretsiz)
                    </button>
                  )}</>
              : <><b>{res.groups.length}</b> kaynakta <b>{res.total}</b> yer · tıkla, kaynakta o yer açılsın</>}
          </p>
          <div className="space-y-2">
            {res.groups.map((g) => (
              <div key={g.document_id} className="rounded-xl border bg-surface-muted/40">
                <button onClick={() => open(g.document_id, g.hits[0]?.page ?? null)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover">
                  <FileText size={14} className="shrink-0 text-accent-purple" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.title}</span>
                  <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-2xs text-text-secondary">{g.count} yer</span>
                </button>
                <div className="divide-y border-t">
                  {g.hits.map((h, i) => (
                    <button key={i} onClick={() => open(g.document_id, h.page)}
                            title={h.how === "meaning" ? "Anlamca yakın (kelime birebir geçmiyor)" : "Kelime birebir geçiyor"}
                            className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-hover">
                      <span className={cx("mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-medium",
                        h.how === "meaning" ? "bg-info-bg text-info" : "bg-surface-muted text-text-secondary")}>
                        s.{h.page ?? "?"}
                      </span>
                      <span className="min-w-0 flex-1 text-xs leading-relaxed text-text-secondary">
                        {h.section && <span className="mr-1 text-2xs uppercase tracking-wide text-text-secondary">{h.section} ·</span>}
                        <Mark text={h.snippet} q={res.query} />
                      </span>
                      <ExternalLink size={12} className="mt-1 shrink-0 text-text-secondary/60" />
                    </button>
                  ))}
                  {g.count > g.hits.length && (
                    <p className="px-3 py-1.5 text-2xs text-text-secondary">+{g.count - g.hits.length} yer daha bu kaynakta</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
