"use client";
/**
 * Ortak, erisilebilir pencere (dialog).
 *
 *   <Modal open={open} onClose={() => setOpen(false)} title="Baslik" size="md">
 *     ...icerik...
 *   </Modal>
 *
 * - role="dialog" + aria-modal; baslik verilirse aria-labelledby ona baglanir,
 *   verilmezse `labelledBy` (icerikteki baslik elemaninin id'si) kullanilir.
 * - Odak tuzagi: Tab / Shift+Tab pencere icinde doner.
 * - Esc kapatir (ic ice pencerelerde yalniz en ustteki).
 * - Acilista ilk odak: [data-autofocus] / [autofocus] > ilk odaklanabilir oge > panel.
 * - Kapaninca odak, pencereyi acan ogeye geri verilir.
 * - Acikken sayfa kaydirmasi kilitlenir.
 * - sheet (varsayilan true): telefonda alttan acilan tabaka + iPhone alt guvenli alan;
 *   sm ve ustunde ortada pencere. sheet={false}: her boyutta ortada.
 */
import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Size = "sm" | "md" | "lg";
export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** title yoksa: pencereyi adlandiran elemanin id'si */
  labelledBy?: string;
  size?: Size;
  sheet?: boolean;
  children: ReactNode;
  /** Ustte hizalanmis (komut paleti gibi) pencere */
  align?: "center" | "top";
  /** Baslik satirindaki kapat dugmesini gizle (icerik kendi dugmesini koyuyorsa) */
  hideClose?: boolean;
  /** Ic panel icin ek sinif (dolgu vb.) */
  className?: string;
  /** Baslik yokken ekran okuyucu icin ad */
  ariaLabel?: string;
};

const WIDTH: Record<Size, string> = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-2xl" };

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

// Ic ice pencereler: Esc ve odak tuzagi yalniz en ustteki icin calisir.
const stack: number[] = [];
let seq = 0;
let lockCount = 0;
let savedOverflow = "";

function lockScroll() {
  if (lockCount++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}
function unlockScroll() {
  if (--lockCount <= 0) {
    lockCount = 0;
    document.body.style.overflow = savedOverflow;
  }
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true" && el.offsetParent !== null,
  );
}

export default function Modal({
  open, onClose, title, labelledBy, size = "md", sheet = true, children,
  align = "center", hideClose, className, ariaLabel,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const autoId = useId();
  const titleId = title ? `modal-t-${autoId}` : labelledBy;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const myId = ++seq;
    stack.push(myId);
    const opener = document.activeElement as HTMLElement | null;
    lockScroll();

    // ilk odak
    const t = window.setTimeout(() => {
      const p = panelRef.current;
      if (!p || p.contains(document.activeElement)) return;
      const pref = p.querySelector<HTMLElement>("[data-autofocus],[autofocus]");
      const list = focusables(p).filter((el) => el.dataset.modalClose === undefined);
      (pref || list[0] || p).focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== myId) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const p = panelRef.current;
      if (!p) return;
      const list = focusables(p);
      if (!list.length) { e.preventDefault(); p.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || !p.contains(a))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !p.contains(a))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(myId);
      if (i >= 0) stack.splice(i, 1);
      unlockScroll();
      if (opener && typeof opener.focus === "function" && document.contains(opener)) {
        window.setTimeout(() => opener.focus(), 0);
      }
    };
  }, [open]);

  if (!open || !mounted) return null;

  const outer =
    "fixed inset-0 z-[85] flex justify-center bg-black/50 " +
    (align === "top"
      ? "items-start px-3 pt-[10vh]"
      : sheet ? "items-end sm:items-center sm:p-4" : "items-center p-4");
  const panel =
    "relative flex max-h-[90dvh] w-full flex-col overflow-y-auto overscroll-contain border bg-surface shadow-xl outline-none " +
    WIDTH[size] + " " +
    (sheet && align !== "top" ? "rounded-t-2xl sm:rounded-2xl " : "rounded-2xl ") +
    (className ?? "p-5");

  return createPortal(
    <div className={outer} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1}
           aria-labelledby={titleId} aria-label={titleId ? undefined : ariaLabel}
           className={panel}
           style={sheet && align !== "top" ? { paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)" } : undefined}>
        {title != null && (
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 id={titleId} className="font-heading text-lg leading-snug">{title}</h2>
            {!hideClose && (
              <button type="button" onClick={onClose} aria-label="Kapat" data-modal-close=""
                      className="-mr-1.5 -mt-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
                <X size={18} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
