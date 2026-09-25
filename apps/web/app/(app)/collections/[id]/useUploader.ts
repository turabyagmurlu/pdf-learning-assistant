"use client";
/**
 * Defter icinden dosya yukleme: dosyalar sirayla yuklenir ve bu deftere baglanir.
 * - Tur ve boyut yuklemeden once denetlenir (lib/sources: en fazla 50 MB, ses kaydi 100 MB).
 * - Hata sayfayi silmez: bildirim + "Tekrar dene"; son hata satir ici de gosterilebilir.
 * - Yukleme surerken sayfadan cikista tarayici uyarisi.
 * - Ayni dosya zaten varsa API yeni kopya acmaz ({linked_existing: true}).
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { rejectReason, MAX_MB } from "@/lib/sources";
import { toast } from "@/components/Toast";

export type UploadErr = { text: string; retry: File[] } | null;

export function useUploader(collectionId: string, onDone: () => Promise<void> | void) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<UploadErr>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // Yukleme surerken sekme kapatilir/yenilenirse uyar (yarim kalmasin)
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [busy]);

  async function upload(files: FileList | File[] | null): Promise<number> {
    const all = Array.from(files || []);
    if (!all.length || busy) return 0;
    const rejected: string[] = [];
    const list: File[] = [];
    for (const f of all) {
      const why = rejectReason(f);
      if (why) rejected.push(why); else list.push(f);
    }
    setError(null);
    let ok = 0, linked = 0;
    const failed: { f: File; msg: string }[] = [];
    if (list.length) {
      setBusy({ done: 0, total: list.length });
      for (let i = 0; i < list.length; i++) {
        const fd = new FormData();
        fd.append("file", list[i]);
        fd.append("collection_id", collectionId);
        try {
          const r = await api("/documents", { method: "POST", body: fd }, 1);
          if (r?.linked_existing) linked++; else ok++;
        } catch (e: any) {
          failed.push({ f: list[i], msg: typeof e?.message === "string" ? e.message : "" });
        }
        setBusy({ done: i + 1, total: list.length });
      }
      setBusy(null);
      try { await doneRef.current(); } catch {}
    }
    if (ok) toast(ok === 1 ? "Kaynak eklendi; hazırlanıyor. Hazır olunca haber vereceğim." : `${ok} kaynak eklendi; hazırlanıyor. Hazır olunca haber vereceğim.`);
    if (linked) toast.info(linked === 1 ? "Bu kaynak zaten kütüphanende vardı, deftere bağlandı." : `${linked} kaynak zaten kütüphanende vardı, deftere bağlandı.`);
    if (failed.length || rejected.length) {
      const parts: string[] = [];
      if (failed.length === 1) parts.push(`“${failed[0].f.name}” yüklenemedi${failed[0].msg ? ": " + failed[0].msg : "."}`);
      else if (failed.length > 1) parts.push(`${failed.length} dosya yüklenemedi: dosya bozuk ya da ${MAX_MB} MB'tan büyük olabilir. Başka bir dosya dene.`);
      parts.push(...rejected);
      const text = parts.join(" ");
      const retry = failed.map((x) => x.f);
      setError({ text, retry });
      toast.error(text, retry.length ? { action: { label: "Tekrar dene", run: () => { upload(retry); } }, ms: 10000 } : { ms: 8000 });
    }
    return ok + linked;
  }

  return { busy, upload, error, clearError: () => setError(null) };
}
