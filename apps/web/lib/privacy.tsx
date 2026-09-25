"use client";
/**
 * Ilk yuklemeden once bir kez gosterilen gizlilik bilgi karti (rapor 4 §5.2-B).
 * Kutuphane ve defter yukleme alanlari ortak kullanir:
 *
 *   const { gate, dialog } = usePrivacyGate();
 *   onFiles = (files) => gate(() => upload(files));
 *   return <>...{dialog}</>;
 *
 * "Anladım, yükle" localStorage'da hatirlanir; bir daha sorulmaz.
 */
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";

export const PRIVACY_ACK_KEY = "typdf.privacyAck.v1";
/** Yukleme alanlarinin kalici alt satiri (rapor 4 §5.2-C) */
export const PRIVACY_LINE = "Kaynaklar yapay zekâ ile (Google Gemini) işlenir.";

function acked(): boolean {
  try { return localStorage.getItem(PRIVACY_ACK_KEY) === "1"; } catch { return true; }
}

export function usePrivacyGate() {
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const gate = useCallback((fn: () => void) => {
    if (acked()) { fn(); return; }
    pending.current = fn;
    setOpen(true);
  }, []);

  const close = (ok: boolean) => {
    setOpen(false);
    const fn = pending.current;
    pending.current = null;
    if (ok) {
      try { localStorage.setItem(PRIVACY_ACK_KEY, "1"); } catch { /* gizli sekme: yine de devam */ }
      fn?.();
    }
  };

  const dialog = (
    <Modal open={open} onClose={() => close(false)} title="Kaynakların nasıl işlenir?" size="md">
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-text-secondary">
        <li>Dosyan hesabına kaydedilir. Diğer kullanıcılar göremez.</li>
        <li>Özet, arama ve cevaplar için metni Google&apos;ın yapay zekâ servisine (Gemini) gönderilir. Ücretsiz katmanda Google bu içeriği hizmetlerini geliştirmek için kullanabilir.</li>
        <li>Kişisel ya da gizli bilgi içeren belgeleri (kimlik, sağlık, yayımlanmamış veri) yükleme.</li>
        <li>Bir kaynağı sildiğinde dosyası, notların ve sohbet geçmişi de silinir.</li>
      </ul>
      <p className="mt-2 text-xs text-text-secondary">
        Ayrıntılar: <Link href="/gizlilik" className="text-accent-purple underline underline-offset-2" onClick={() => close(false)}>Gizlilik</Link>
      </p>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => close(false)} className="min-h-[44px] rounded-xl border px-4 text-sm hover:bg-surface-muted sm:min-h-[40px]">Vazgeç</button>
        <button type="button" data-autofocus="" onClick={() => close(true)}
                className="min-h-[44px] rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent sm:min-h-[40px]">Anladım, yükle</button>
      </div>
    </Modal>
  );

  return { gate, dialog };
}
