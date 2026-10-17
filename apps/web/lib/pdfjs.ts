/**
 * pdf.js tek kurulum noktasi. react-pdf yuklenirken worker adresini "pdf.worker.mjs" (goreli, YANLIS)
 * olarak ayarlar; uygulamada bu dosyayi yuklemeden PDF acan her yer (okuyucu, metin gorunumu, "Sor"
 * sekmesinin sayfa metni) adresi kendisi duzeltmezse ilk acilis bozuk adresle yapilir, worker kurulamaz
 * ve pdf.js bu hatayi tum sayfa icin onbellege alir ("bir aciliyor bir acilmiyor"). Burasi adresi
 * KOSULSUZ ve tam URL olarak ayarlar; PDF acan her modul pdfjs'i buradan almalidir.
 */
import { pdfjs } from "react-pdf";

// Eski Safari (< 17.4) icin ana tarafta Promise.withResolvers
if (typeof (Promise as any).withResolvers !== "function") {
  (Promise as any).withResolvers = function () {
    let resolve: any, reject: any;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
  };
}

export const WORKER_URL = "/pdf.worker.min.mjs";

export function ensureWorker() {
  const want = typeof window !== "undefined" ? new URL(WORKER_URL, window.location.origin).href : WORKER_URL;
  if (pdfjs.GlobalWorkerOptions.workerSrc !== want) pdfjs.GlobalWorkerOptions.workerSrc = want;
}
ensureWorker();

export { pdfjs };
