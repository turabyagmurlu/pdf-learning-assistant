"use client";
/**
 * Kritik islemler icin onay penceresi.
 *
 * window.confirm yerine bunu kullaniyoruz: uygulama (PWA) modunda tarayici
 * kutusu cirkin duruyor, bazen hic cikmiyor; ayrica neyin kaybolacagini
 * gosteremiyor. Gercekten geri alinamayan islemlerde (kalici silme)
 * `typeToConfirm` ile adin yazilmasini isteriz — yanlislikla basmayi onler.
 *
 * Kullanim:
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   if (!await confirm({ title: "...", danger: true })) return;
 *   ...
 *   return (<> ... {dialog} </>);
 */
import { useCallback, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

export type ConfirmOptions = {
  title: string;
  /** Ne olacagini duz Turkce anlat. */
  description?: string;
  /** Kaybolacak seyler: "3 vurgu", "1 taslak" gibi. */
  losses?: string[];
  /** Kalacak seyler: "Kaynaklar silinmez" gibi; yesil tonda gosterilir. */
  keeps?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Dolduysa: kullanici bu metni birebir yazmadan onay butonu acilmaz. */
  typeToConfirm?: string;
};

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setTyped("");
    setOpts(o);
    return new Promise<boolean>((res) => { resolver.current = res; });
  }, []);

  function close(v: boolean) {
    setOpts(null);
    setTyped("");
    resolver.current?.(v);
    resolver.current = null;
  }

  const needType = (opts?.typeToConfirm || "").trim();
  const ready = !needType || typed.trim() === needType;

  const dialog = !opts ? null : (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
         onClick={() => close(false)}
         role="dialog" aria-modal="true" aria-label={opts.title}>
      <div onClick={(e) => e.stopPropagation()}
           className="w-full max-w-md rounded-t-2xl border bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start gap-3">
          <div className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
            (opts.danger ? "bg-danger/10 text-danger" : "bg-accent-purple/10 text-accent-purple")}>
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-lg leading-snug">{opts.title}</h3>
            {opts.description && (
              <p className="mt-1.5 text-sm text-text-secondary">{opts.description}</p>
            )}
          </div>
          <button onClick={() => close(false)} aria-label="Kapat"
                  className="rounded-md p-1 text-text-secondary hover:bg-surface-muted">
            <X size={18} />
          </button>
        </div>

        {(opts.losses?.length || opts.keeps?.length) ? (
          <div className="mt-3.5 space-y-1.5 rounded-xl bg-surface-muted/60 p-3 text-sm">
            {opts.losses?.map((l, i) => (
              <p key={"l" + i} className="flex items-start gap-2 text-danger">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-danger" /> {l}
              </p>
            ))}
            {opts.keeps?.map((k, i) => (
              <p key={"k" + i} className="flex items-start gap-2 text-text-secondary">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-success" /> {k}
              </p>
            ))}
          </div>
        ) : null}

        {needType && (
          <div className="mt-3.5">
            <label className="block text-xs text-text-secondary">
              Onaylamak için <b className="text-text-primary">{needType}</b> yaz
            </label>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter" && ready) close(true); if (e.key === "Escape") close(false); }}
                   placeholder={needType}
                   className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-danger" />
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => close(false)}
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-surface-muted">
            {opts.cancelLabel || "Vazgeç"}
          </button>
          <button onClick={() => ready && close(true)} disabled={!ready}
                  autoFocus={!needType}
                  className={"rounded-xl px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40 " +
                    (opts.danger ? "bg-danger" : "bg-accent-purple")}>
            {opts.confirmLabel || "Devam et"}
          </button>
        </div>
      </div>
    </div>
  );

  return { confirm, dialog };
}
