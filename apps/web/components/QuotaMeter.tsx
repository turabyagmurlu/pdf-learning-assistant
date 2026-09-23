"use client";
/**
 * Yapay zeka kota gostergesi: bugun ne kadar istek harcandi, hangi model
 * aktif / dolu, kota ne zaman yenilenir. Metin modelleri havuz halinde
 * calisir: biri dolunca uygulama otomatik digerine gecer.
 */
import { useEffect, useState } from "react";
import { Gauge, X } from "lucide-react";
import { api } from "@/lib/api";

type M = { model: string; status: string; requests: number };
type U = {
  day: string; reset_at: string;
  kinds: Record<string, { requests: number; tokens: number }>;
  text_models: M[]; tts_models: M[];
  embed: { model: string; status: string };
};

const KIND: Record<string, string> = { metin: "Soru-cevap ve özetler", dizin: "PDF dizinleme", ses: "Seslendirme", video: "Video dökümü" };
const ST: Record<string, { t: string; c: string }> = {
  aktif: { t: "aktif", c: "bg-green-500/15 text-green-700" },
  dakikalik_dolu: { t: "dakikalık dolu", c: "bg-amber-500/15 text-amber-700" },
  gunluk_doldu: { t: "bugün doldu", c: "bg-red-500/15 text-red-700" },
};

function level(u: U | null): "ok" | "warn" | "full" {
  if (!u) return "ok";
  const t = u.text_models;
  if (t.length && t.every((m) => m.status === "gunluk_doldu")) return "full";
  if (t.some((m) => m.status !== "aktif") || u.embed.status !== "aktif") return "warn";
  return "ok";
}

export default function QuotaMeter({ compact }: { compact?: boolean }) {
  const [u, setU] = useState<U | null>(null);
  const [open, setOpen] = useState(false);

  async function load() { try { setU(await api("/usage", {}, 1)); } catch {} }
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  useEffect(() => { if (open) load(); }, [open]);

  const lv = level(u);
  const dot = lv === "full" ? "bg-red-500" : lv === "warn" ? "bg-amber-500" : "bg-green-500";
  const total = u ? Object.values(u.kinds).reduce((a, k) => a + k.requests, 0) : 0;
  const reset = u ? new Date(u.reset_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <>
      {compact ? (
        <button onClick={() => setOpen(true)} aria-label="Yapay zekâ kotası" className="relative rounded-md p-2 text-text-secondary hover:bg-surface-muted">
          <Gauge size={18} /><span className={"absolute right-1.5 top-1.5 h-2 w-2 rounded-full " + dot} />
        </button>
      ) : (
        <button onClick={() => setOpen(true)} title="Yapay zekâ kotası"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-text-secondary hover:bg-surface-muted">
          <Gauge size={18} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm">AI kotası</span>
            <span className="block text-[11px] opacity-80">{u ? `bugün ${total} istek` : "…"}</span>
          </span>
          <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + dot} />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Yapay zekâ kotası"
               className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border bg-surface p-5 sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-heading text-lg">Yapay zekâ kotası</h3>
              <button onClick={() => setOpen(false)} aria-label="Kapat" className="rounded-md p-1 hover:bg-surface-muted"><X size={18} /></button>
            </div>
            {!u ? <p className="text-sm text-text-secondary">Yükleniyor…</p> : (
              <>
                <p className={"rounded-xl px-3 py-2 text-sm " + (lv === "full" ? "bg-red-500/10 text-red-700" : lv === "warn" ? "bg-amber-500/10 text-amber-800" : "bg-green-500/10 text-green-800")}>
                  {lv === "full" ? `Bugünkü metin kotası tüm modellerde doldu. Saat ${reset} civarı yenilenir; kayıtlı cevaplar ve arama çalışmaya devam eder.`
                    : lv === "warn" ? "Bazı modeller dolu; uygulama otomatik olarak boştaki modele geçiyor."
                    : "Her şey yolunda. Bir model dolarsa uygulama kendiliğinden diğerine geçer."}
                </p>

                <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Bugün harcanan</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.keys(KIND).map((k) => (
                    <div key={k} className="rounded-xl border p-2.5">
                      <p className="text-[11px] text-text-secondary">{KIND[k]}</p>
                      <p className="text-lg font-medium">{u.kinds[k]?.requests || 0}<span className="text-xs font-normal text-text-secondary"> istek</span></p>
                    </div>
                  ))}
                </div>

                <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Metin modelleri (havuz)</p>
                <ul className="space-y-1">
                  {u.text_models.map((m, i) => (
                    <li key={m.model} className="flex items-center gap-2 text-sm">
                      <span className="w-4 text-right text-[11px] text-text-secondary">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.model}</span>
                      <span className="text-[11px] text-text-secondary">{m.requests}</span>
                      <span className={"rounded-full px-2 py-0.5 text-[11px] " + (ST[m.status]?.c || "")}>{ST[m.status]?.t || m.status}</span>
                    </li>
                  ))}
                </ul>
                {u.tts_models.length > 0 && (
                  <>
                    <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Ses modelleri</p>
                    <ul className="space-y-1">
                      {u.tts_models.map((m) => (
                        <li key={m.model} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.model}</span>
                          <span className="text-[11px] text-text-secondary">{m.requests}</span>
                          <span className={"rounded-full px-2 py-0.5 text-[11px] " + (ST[m.status]?.c || "")}>{ST[m.status]?.t || m.status}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{u.embed.model} (dizin)</span>
                  <span className={"rounded-full px-2 py-0.5 text-[11px] " + (ST[u.embed.status]?.c || "")}>{ST[u.embed.status]?.t || u.embed.status}</span>
                </div>

                <p className="mt-4 text-xs leading-relaxed text-text-secondary">
                  Günlük kotalar her gün saat <b>{reset}</b> civarı sıfırlanır. Tasarruf için: aynı ya da çok benzer
                  soru tekrar sorulursa kayıtlı cevap gelir (0 kota), aynı metin ikinci kez dizinlenmez,
                  üretilen sesler saklanır.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
