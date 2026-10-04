"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * Açık sayfanın düz metni (Sor → "Bu sayfayı anlat" hazır sorusu için).
 *  - pdf.js `getTextContent()` ile sayfa metni çıkarılır, sayfa başına önbelleğe alınır (en çok 24 sayfa).
 *  - Metin katmanı boşsa (taranmış PDF) GET /documents/{id}/content (OCR metni) bir kez okunur.
 *  - `enabled` false iken hiçbir şey yüklenmez (Sor paneli kapalıyken boşuna indirme yok).
 * Dönen `getPageText(n)` eşzamanlıdır: hazır değilse null (ChatPanel o zaman sayfa metnini eklemez).
 */
const MAX_PAGES = 24;

export function usePageText(fileUrl: string, docId: string, page: number, enabled: boolean) {
  const cache = useRef<Map<number, string>>(new Map());
  const docRef = useRef<{ url: string; doc: Promise<any> } | null>(null);
  const ocrRef = useRef<Promise<Record<number, string>> | null>(null);
  const [, tick] = useState(0);

  // kaynak değişince her şey sıfırlanır
  useEffect(() => {
    cache.current = new Map();
    ocrRef.current = null;
    return () => { docRef.current?.doc.then((d: any) => d?.destroy?.()).catch(() => {}); docRef.current = null; };
  }, [fileUrl, docId]);

  useEffect(() => {
    if (!enabled || !fileUrl || !page || cache.current.has(page)) return;
    let alive = true;
    (async () => {
      let text = "";
      try {
        if (!docRef.current || docRef.current.url !== fileUrl) {
          const { pdfjs } = await import("react-pdf");
          if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          docRef.current = { url: fileUrl, doc: pdfjs.getDocument({ url: fileUrl, withCredentials: false }).promise };
        }
        const d = await docRef.current.doc;
        const pg = await d.getPage(page);
        const tc = await pg.getTextContent();
        text = (tc.items as any[])
          .map((it) => (it && typeof it.str === "string" ? it.str + (it.hasEOL ? "\n" : " ") : ""))
          .join("").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      } catch { text = ""; }
      if (text.length < 40) {
        // taranmış PDF: OCR metni (tek istek, tüm sayfalar)
        try {
          if (!ocrRef.current) {
            ocrRef.current = api(`/documents/${docId}/content`).then((r: any) => {
              const m: Record<number, string> = {};
              for (const p of (Array.isArray(r?.pages) ? r.pages : [])) {
                const n = Number(p.page ?? p.page_number);
                if (n >= 1) m[n] = String(p.text || "");
              }
              return m;
            }).catch(() => ({} as Record<number, string>));
          }
          const m = await ocrRef.current;
          if (m[page] && m[page].trim().length > text.length) text = m[page].trim();
        } catch {}
      }
      if (!alive) return;
      cache.current.set(page, text);
      while (cache.current.size > MAX_PAGES) {
        const k = cache.current.keys().next().value as number;
        cache.current.delete(k);
      }
      tick((t) => t + 1);
    })();
    return () => { alive = false; };
  }, [enabled, fileUrl, docId, page]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((n: number): string | null => cache.current.get(n) ?? null, [fileUrl, docId]);
}
