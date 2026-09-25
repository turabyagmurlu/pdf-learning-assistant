"use client";
/**
 * Tek tip bildirimler (alt köşe). Her yerden: toast("Kaydedildi"), toast.error("..."),
 * toast("Defterden çıkarıldı", { action: { label: "Geri al", run: () => ... } }).
 *
 * Erisilebilirlik: canli bolgeler (role=status / role=alert) her zaman DOM'da durur;
 * boylece ekran okuyucu ilk bildirimi de okur. Fare ustune gelince ya da odak icerideyken
 * bildirim kapanmaz; "Geri al" gibi eylemli bildirimler en az 10 sn kalir.
 * Konum: bottom = --bottom-nav (B, layout; masaustunde 0) + 12px + --toast-lift (globals.css, 64px):
 * sohbet giris kutusu ve yuzen "Sor" dugmesinin ustunde kalir. Masaustunde sag alt.
 */
import { useEffect, useRef, useState } from "react";
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

function duration(t: T) {
  if (t.ms) return t.ms;
  if (t.action) return 10000;
  return t.kind === "error" ? 7000 : 4000;
}

export default function ToastHost() {
  const [list, setList] = useState<T[]>([]);
  const [paused, setPaused] = useState(false);
  const timers = useRef(new Map<number, { left: number; start: number; h: number | null }>());

  const remove = (id: number) => {
    const tm = timers.current.get(id);
    if (tm?.h) window.clearTimeout(tm.h);
    timers.current.delete(id);
    setList((l) => l.filter((x) => x.id !== id));
  };

  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent).detail as T;
      setList((l) => {
        const next = [...l, t];
        // en fazla 3 bildirim; tasanlarin zamanlayicisi da temizlenir
        next.slice(0, Math.max(0, next.length - 3)).forEach((x) => {
          const tm = timers.current.get(x.id);
          if (tm?.h) window.clearTimeout(tm.h);
          timers.current.delete(x.id);
        });
        return next.slice(-3);
      });
      timers.current.set(t.id, { left: duration(t), start: Date.now(), h: window.setTimeout(() => remove(t.id), duration(t)) });
    };
    window.addEventListener("typdf:toast", on);
    const map = timers.current;
    return () => {
      window.removeEventListener("typdf:toast", on);
      map.forEach((tm) => { if (tm.h) window.clearTimeout(tm.h); });
      map.clear();
    };
  }, []);

  // Fare ustundeyken / odak icerideyken sure durur, cikinca kalan sureden devam eder.
  useEffect(() => {
    timers.current.forEach((tm, id) => {
      if (paused && tm.h) {
        window.clearTimeout(tm.h);
        tm.left = Math.max(1500, tm.left - (Date.now() - tm.start));
        tm.h = null;
      } else if (!paused && !tm.h) {
        tm.start = Date.now();
        tm.h = window.setTimeout(() => remove(id), tm.left);
      }
    });
  }, [paused]);

  const item = (t: T) => {
    const Icon = t.kind === "error" ? AlertTriangle : t.kind === "info" ? Info : CheckCircle2;
    return (
      <div key={t.id} className="fade-in pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-xl border bg-surface py-1.5 pl-3.5 pr-1.5 text-sm shadow-medium">
        <Icon size={17} aria-hidden="true" className={"shrink-0 " + (t.kind === "error" ? "text-danger" : t.kind === "info" ? "text-accent-purple" : "text-success")} />
        <span className="min-w-0 flex-1 py-1">{t.msg}</span>
        {t.action && (
          <button type="button" onClick={() => { t.action!.run(); remove(t.id); }}
                  className="min-h-[40px] shrink-0 rounded-lg px-2.5 text-sm font-medium text-accent-purple hover:bg-accent-soft">
            {t.action.label}
          </button>
        )}
        <button type="button" onClick={() => remove(t.id)} aria-label="Bildirimi kapat"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover">
          <X size={16} />
        </button>
      </div>
    );
  };

  const errors = list.filter((t) => t.kind === "error");
  const others = list.filter((t) => t.kind !== "error");

  return (
    <div className="pointer-events-none fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-3 md:inset-x-auto md:right-5 md:items-end"
         style={{ bottom: "calc(max(var(--bottom-nav, 0px), env(safe-area-inset-bottom, 0px)) + 12px + var(--toast-lift, 0px))" }}
         onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
         onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div role="alert" aria-live="assertive" className="flex w-full flex-col items-center gap-2 md:items-end">
        {errors.map(item)}
      </div>
      <div role="status" aria-live="polite" className="flex w-full flex-col items-center gap-2 md:items-end">
        {others.map(item)}
      </div>
    </div>
  );
}
