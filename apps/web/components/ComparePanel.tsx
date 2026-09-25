"use client";
/**
 * Karsilastir: bir konuda defterdeki her kaynagin tutumu yan yana, uyusmalar,
 * celiskiler ve kaynaklarin cevaplamadigi sorular. Sonuc saklanir (ayni konu ucretsiz).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Loader2, Scale, AlertTriangle, CheckCircle2, HelpCircle, ExternalLink, RefreshCw } from "lucide-react";
import { citeLoc } from "@/components/CitedText";
import { Cost, costTitle, ErrNote, Err, toErr } from "@/components/CostBadge";

type Pos = { document_id: string; title: string; stance: string; claim: string; page: number | null; quote: string; unit?: string; time?: string };
type Res = { topic: string; summary: string; positions: Pos[]; sources_used: number; cached?: boolean;
  conflicts: { about: string; explanation: string; sides: { document_id: string; title: string; claim: string }[] }[];
  agreements: string[]; gaps: string[] };

const STANCE: Record<string, { t: string; c: string }> = {
  destekliyor: { t: "Destekliyor", c: "bg-green-500/10 text-green-800" },
  karsi: { t: "Karşı", c: "bg-red-500/10 text-red-800" },
  karma: { t: "Karma", c: "bg-amber-500/10 text-amber-800" },
  notr: { t: "Nötr / betimleyici", c: "bg-slate-500/10 text-slate-700" },
};

export default function ComparePanel({ notebookId, hints, initialTopic }: { notebookId: string; hints: string[]; initialTopic?: string }) {
  const router = useRouter();
  const [topic, setTopic] = useState(initialTopic || "");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState<Err>(null);

  async function run(t?: string, fresh = false) {
    const q = (t ?? topic).trim();
    if (q.length < 3) return;
    setTopic(q); setBusy(true); setErr(null); if (!fresh) setRes(null);
    try { setRes(await api(`/collections/${notebookId}/compare`, { method: "POST", body: JSON.stringify({ topic: q, fresh }) }, 1)); }
    catch (e) { setErr(toErr(e, "Karşılaştırma yapılamadı; birazdan tekrar dene.")); }
    finally { setBusy(false); }
  }
  const open = (d: string, p?: number | null) => router.push("/documents/" + d + (p ? "?page=" + p : ""));

  return (
    <div className="max-w-4xl">
      <p className="mb-3 text-sm text-text-secondary">
        Bir konu yaz; defterindeki her kaynağın o konuda <b>ne dediğini yan yana</b> koyayım, nerede uyuştuklarını,
        nerede <b>çeliştiklerini</b> ve hiçbirinin cevaplamadığı soruları göstereyim. Her yeni karşılaştırma 1 yapay zekâ kullanımı harcar;
        aynı konu ikinci kez ücretsiz gelir.
      </p>
      <div className="flex gap-2">
        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run(); }}
               placeholder={hints[0] ? `Örn: ${hints[0]}` : "Karşılaştırmak istediğin konuyu yaz…"} disabled={busy}
               aria-label="Karşılaştırılacak konu"
               className="min-w-0 flex-1 rounded-xl border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent-purple" />
        <button onClick={() => run()} disabled={busy || topic.trim().length < 3} title={costTitle(1)}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Scale size={15} />} Karşılaştır <Cost n={1} className="bg-white/20" />
        </button>
      </div>
      {!res && !busy && hints.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {hints.slice(0, 8).map((h) => (
            <button key={h} onClick={() => run(h)} title={costTitle(1)} className="min-h-[36px] rounded-full border bg-surface px-3 py-1 text-xs text-text-secondary hover:border-accent-purple/50 hover:text-accent-purple">{h} <Cost n={1} /></button>
          ))}
        </div>
      )}
      {busy && <p className="mt-4 flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" /> Her kaynaktan ilgili bölümler toplanıyor ve karşılaştırılıyor…</p>}
      <ErrNote err={err} className="mt-3" />

      {res && (
        <div className="mt-5 space-y-5">
          <div className="rounded-2xl border bg-surface p-4">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Genel tablo · {res.sources_used} kaynak</p>
              {res.cached && <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-800 dark:text-green-300">Kayıtlı sonuç · ücretsiz</span>}
              <button onClick={() => run(res.topic, true)} disabled={busy} title={costTitle(1)}
                      className="ml-auto flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs text-text-secondary hover:text-accent-purple">
                <RefreshCw size={12} /> Yeniden üret <Cost n={1} />
              </button>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed">{res.summary}</p>
          </div>

          {/* kaynak - kaynak tablo */}
          <div className="overflow-x-auto rounded-2xl border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-text-secondary">
                  <th className="px-3 py-2">Kaynak</th><th className="px-3 py-2">Tutum</th><th className="px-3 py-2">Ne diyor</th>
                </tr>
              </thead>
              <tbody>
                {res.positions.map((p, i) => (
                  <tr key={i} className="border-b align-top last:border-0">
                    <td className="w-56 px-3 py-2.5">
                      <button onClick={() => open(p.document_id, p.page)} className="text-left font-medium hover:text-accent-purple">{p.title}</button>
                      {p.page != null && <span className="mt-0.5 block text-[11px] text-text-secondary">{citeLoc(p as any)}</span>}
                    </td>
                    <td className="w-32 px-3 py-2.5"><span className={"rounded-full px-2 py-0.5 text-[11px] " + (STANCE[p.stance]?.c || "")}>{STANCE[p.stance]?.t || p.stance}</span></td>
                    <td className="px-3 py-2.5">
                      <p>{p.claim}</p>
                      {p.quote && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-text-secondary">kaynaktaki metin</summary>
                          <p className="mt-1 rounded-lg bg-surface-muted p-2 text-xs italic text-text-secondary">“{p.quote}…”</p>
                          <button onClick={() => open(p.document_id, p.page)} className="mt-1 flex min-h-[32px] items-center gap-1 text-xs text-accent-purple"><ExternalLink size={11} /> kaynakta aç</button>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.03] p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium text-red-800"><AlertTriangle size={15} /> Çelişkiler ({res.conflicts.length})</p>
              {!res.conflicts.length ? <p className="mt-2 text-sm text-text-secondary">Kaynaklar bu konuda birbirine ters düşmüyor.</p> : res.conflicts.map((c, i) => (
                <div key={i} className="mt-3 rounded-xl border bg-surface p-3 text-sm">
                  <p className="font-medium">{c.about}</p>
                  <ul className="mt-1.5 space-y-1">
                    {c.sides.map((s, j) => (
                      <li key={j} className="text-[13px]"><button onClick={() => open(s.document_id)} className="font-medium text-accent-purple hover:underline">{s.title}</button>: {s.claim}</li>
                    ))}
                  </ul>
                  {c.explanation && <p className="mt-1.5 text-xs text-text-secondary">Olası neden: {c.explanation}</p>}
                </div>
              ))}
            </div>
            <div className="space-y-4">
              <div className="rounded-2xl border border-green-500/30 bg-green-500/[0.03] p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium text-green-800"><CheckCircle2 size={15} /> Uyuştukları noktalar</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{res.agreements.map((a, i) => <li key={i}>{a}</li>)}</ul>
                {!res.agreements.length && <p className="mt-2 text-sm text-text-secondary">Belirgin ortak bulgu yok.</p>}
              </div>
              <div className="rounded-2xl border p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium"><HelpCircle size={15} className="text-accent-purple" /> Kaynakların cevaplamadığı</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{res.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
                {!res.gaps.length && <p className="mt-2 text-sm text-text-secondary">—</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
