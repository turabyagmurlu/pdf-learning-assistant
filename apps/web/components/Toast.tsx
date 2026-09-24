"use client";
/**
 * Tek tip bildirimler (alt köşe). Her yerden: toast("Kaydedildi"), toast.error("..."),
 * toast("Defterden çıkarıldı", { action: { label: "Geri al", run: () => ... } }).
 */
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type Kind = "ok" | "error" | "info";
type Opts = { kind?: Kind; action?: { label: string; run: () => void }; ms?: number };
type T = { id: number; msg: string } & Opts;

let seq = 0;
export function toast(msg: string, opts: Opts = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("typdf:toast", { detail: { id: ++seq, msg, ...opts } }));
}
toast.error = (msg: string, opts: Opts = {}) => toast(msg, { ...opts, kind: "error" });
toast.info = (msg: string, opts: Opts = {}) => toast(msg, { ...opts, kind: "info" });

export default function ToastHost() {
  const [list, setList] = useState<T[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent).detail as T;
      setList((l) => [...l.slice(-2), t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.ms || (t.action ? 6000 : 3200));
    };
    window.addEventListener("typdf:toast", on);
    return () => window.removeEventListener("typdf:toast", on);
  }, []);
  if (!list.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-3 md:inset-x-auto md:right-5 md:items-end"
         style={{ bottom: "calc(env(safe-area-inset-bottom) + 76px)" }} aria-live="polite">
      {list.map((t) => {
        const Icon = t.kind === "error" ? AlertTriangle : t.kind === "info" ? Info : CheckCircle2;
        return (
          <div key={t.id} className="fade-in pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-xl border bg-surface px-3.5 py-2.5 text-sm shadow-medium">
            <Icon size={17} className={"shrink-0 " + (t.kind === "error" ? "text-danger" : t.kind === "info" ? "text-accent-purple" : "text-success")} />
            <span className="min-w-0 flex-1">{t.msg}</span>
            {t.action && (
              <button onClick={() => { t.action!.run(); setList((l) => l.filter((x) => x.id !== t.id)); }}
                      className="shrink-0 rounded-md px-2 py-0.5 text-sm font-medium text-accent-purple hover:bg-accent-purple/10">
                {t.action.label}
              </button>
            )}
            <button onClick={() => setList((l) => l.filter((x) => x.id !== t.id))} aria-label="Kapat"
                    className="shrink-0 rounded p-0.5 text-text-secondary hover:bg-surface-muted"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
