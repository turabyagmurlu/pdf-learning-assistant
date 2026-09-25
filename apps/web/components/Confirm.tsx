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
import { useCallback, useId, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import Modal from "@/components/Modal";
import Button from "@/components/ui/Button";

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
  /** Istege bagli ek secenek (ornegin "Kaynaklari da sil"); secildi mi -> wasChecked() */
  checkbox?: string;
};

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const checkedRef = useRef(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setTyped(""); setChecked(false); checkedRef.current = false;
    setOpts(o);
    return new Promise<boolean>((res) => { resolver.current = res; });
  }, []);

  function close(v: boolean) {
    setOpts(null);
    setTyped("");
    resolver.current?.(v);
    resolver.current = null;
  }

  const titleId = "confirm-" + useId();
  const needType = (opts?.typeToConfirm || "").trim();
  const ready = !needType || typed.trim() === needType;

  const dialog = (
    <Modal open={!!opts} onClose={() => close(false)} size="md" labelledBy={titleId}>
      {opts && (
        <>
          <div className="flex items-start gap-3">
            <div className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
              (opts.danger ? "bg-danger-bg text-danger" : "bg-accent-soft text-accent-purple")}>
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-heading text-lg leading-snug">{opts.title}</h2>
              {opts.description && (
                <p className="mt-1.5 text-sm text-text-secondary">{opts.description}</p>
              )}
            </div>
            <button type="button" onClick={() => close(false)} aria-label="Kapat" data-modal-close=""
                    className="-mr-1.5 -mt-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover">
              <X size={18} />
            </button>
          </div>

          {(opts.losses?.length || opts.keeps?.length) ? (
            <div className="mt-3.5 space-y-1.5 rounded-xl bg-surface-muted/60 p-3 text-sm">
              {opts.losses?.map((l, i) => (
                <p key={"l" + i} className="flex items-start gap-2 text-danger">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" /> {l}
                </p>
              ))}
              {opts.keeps?.map((k, i) => (
                <p key={"k" + i} className="flex items-start gap-2 text-text-secondary">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" /> {k}
                </p>
              ))}
            </div>
          ) : null}

          {opts.checkbox && (
            <label className="mt-3.5 flex min-h-[44px] cursor-pointer items-start gap-2 rounded-xl border border-danger/30 p-3 text-sm">
              <input type="checkbox" checked={checked} className="mt-0.5 h-5 w-5 shrink-0 accent-red-600"
                     onChange={(e) => { setChecked(e.target.checked); checkedRef.current = e.target.checked; }} />
              <span>{opts.checkbox}</span>
            </label>
          )}

          {needType && (
            <div className="mt-3.5">
              <label htmlFor={titleId + "-type"} className="block text-xs text-text-secondary">
                Onaylamak için <b className="text-text-primary">{needType}</b> yaz
              </label>
              <input id={titleId + "-type"} data-autofocus="" value={typed} onChange={(e) => setTyped(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter" && ready) close(true); }}
                     placeholder={needType} autoComplete="off"
                     className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-danger" />
            </div>
          )}

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="lg" onClick={() => close(false)} data-autofocus={opts.danger && !needType ? "" : undefined}
                    className="sm:h-10">
              {opts.cancelLabel || "Vazgeç"}
            </Button>
            <Button variant="primary" size="lg" tone={opts.danger ? "danger" : undefined} onClick={() => ready && close(true)} disabled={!ready}
                    data-autofocus={!opts.danger && !needType ? "" : undefined} className="sm:h-10 disabled:cursor-not-allowed">
              {opts.confirmLabel || "Devam et"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );

  return { confirm, dialog, wasChecked: () => checkedRef.current };
}
