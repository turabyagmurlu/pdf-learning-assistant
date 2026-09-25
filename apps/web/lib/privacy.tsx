"use client";
/**
 * Gizlilik bilgisi (tek kullanicili kurulum): onay karti YOK.
 * Ilk yuklemede bir kez, tek satirlik bilgi bildirimi gosterilir ve localStorage'da
 * hatirlanir; yukleme hic beklemez. Kutuphane ve defter yukleme alanlari ortak kullanir:
 *
 *   const { gate, dialog } = usePrivacyGate();
 *   onFiles = (files) => gate(() => upload(files));
 *   return <>...{dialog}</>;
 *
 * `dialog` geriye uyum icin duruyor (null doner); bildirim Toast uzerinden cikar.
 */
import { useCallback } from "react";
import { toast } from "@/components/Toast";

const PRIVACY_ACK_KEY = "typdf.privacyAck.v2";
/** Yukleme alanlarinin kalici alt satiri */
export const PRIVACY_LINE = "Kaynaklar yapay zekâ ile (Google Gemini) işlenir.";
/** Ilk yuklemede bir kez gosterilen tek satir */
export const PRIVACY_ONCE = "Kaynakların Google Gemini'ye gönderilir; gizli ya da kişisel belge yükleme.";

function seen(): boolean {
  try { return localStorage.getItem(PRIVACY_ACK_KEY) === "1"; } catch { return true; }
}

function markSeen() {
  try { localStorage.setItem(PRIVACY_ACK_KEY, "1"); } catch { /* gizli sekme: yine de devam */ }
}

export function usePrivacyGate() {
  const gate = useCallback((fn: () => void) => {
    fn();
    if (seen()) return;
    markSeen();
    toast.info(PRIVACY_ONCE, {
      ms: 12000,
      action: { label: "Gizlilik", run: () => { window.location.href = "/gizlilik"; } },
    });
  }, []);

  return { gate, dialog: null as React.ReactNode };
}
