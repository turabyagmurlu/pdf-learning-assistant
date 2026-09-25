"use client";
/**
 * Telefondan kaynak ekleme kolayliklari (T-6): "Sayfa fotoğrafla" (kamera, OCR kaynagi)
 * ve "Panodan yapıştır" (link, metin ya da gorsel). Yalniz dokunmatik cihazda gorunur
 * (`always` ile her yerde). AddSourceDialog'un "Dosya" ve "Link" segmentlerine yerlestirilir:
 *
 *   <MobileAddExtras collectionId={collectionId} onUpload={onUpload} onAdded={onAdded} />
 *
 * - onUpload verilirse dosyalar onunla yuklenir (defterdeki useUploader: tur/boyut denetimi,
 *   ilerleme, "Tekrar dene"). Verilmezse burada POST /documents (+collection_id) yapilir.
 * - Panodaki metin: web adresi ise POST /documents/web ya da /youtube; 40+ karakter ise
 *   POST /documents/text; gorsel ise dosya gibi yuklenir (OCR).
 * - clipboard.read() kullanici hareketiyle ve izinle calisir; izin yoksa readText denenir,
 *   o da olmazsa kisa bir aciklama gosterilir.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { toast } from "@/components/Toast";
import { isYoutubeUrl, linkedExistingText } from "@/components/YoutubeAdd";
import { rejectReason } from "@/lib/sources";

export interface MobileAddExtrasProps {
  collectionId?: string;
  /** Dosya yukleyici (AddSourceDialog'un onUpload'i). Yoksa bilesen kendi yukler. */
  onUpload?: (files: File[]) => Promise<number>;
  /** Link / metin eklendikten sonra (liste tazelensin, pencere kapansin) */
  onAdded?: (info?: { title?: string; linked_existing?: boolean }) => void;
  /** Dokunmatik olmayan cihazda da goster */
  always?: boolean;
  /** Yalniz belirli dugmeler */
  only?: "camera" | "paste";
  className?: string;
}

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

export default function MobileAddExtras({ collectionId, onUpload, onAdded, always, only, className }: MobileAddExtrasProps) {
  const [touch, setTouch] = useState(false);
  const [busy, setBusy] = useState<"camera" | "paste" | null>(null);
  const [hint, setHint] = useState("");
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { setTouch(!!window.matchMedia?.("(pointer: coarse)").matches); } catch { setTouch(false); }
  }, []);
  if (!touch && !always) return null;

  async function uploadFiles(files: File[]): Promise<number> {
    const list: File[] = [];
    for (const f of files) {
      const why = rejectReason(f);
      if (why) toast.error(why); else list.push(f);
    }
    if (!list.length) return 0;
    if (onUpload) return onUpload(list);
    let ok = 0;
    for (const f of list) {
      const fd = new FormData();
      fd.append("file", f);
      if (collectionId) fd.append("collection_id", collectionId);
      try {
        const r = (await api("/documents", { method: "POST", body: fd }, 1)) as { linked_existing?: boolean } | null;
        ok++;
        if (r?.linked_existing) toast.info(linkedExistingText(!!collectionId));
      } catch (e) { toast.error(`“${f.name}” yüklenemedi. ${errorMessage(e)}`); }
    }
    if (ok) {
      toast(ok === 1 ? "Kaynak eklendi; hazırlanıyor." : `${ok} kaynak eklendi; hazırlanıyor.`);
      onAdded?.();
    }
    return ok;
  }

  async function onCamera(list: FileList | null) {
    if (!list || !list.length) return;
    const files = Array.from(list).map((f, i) =>
      f.name && !/^image\.(jpe?g|png|webp)$/i.test(f.name) ? f
        : new File([f], `sayfa-${new Date().toISOString().slice(0, 10)}-${i + 1}.${(f.type.split("/")[1] || "jpg").replace("jpeg", "jpg")}`, { type: f.type }));
    setBusy("camera");
    try { await uploadFiles(files); } finally { setBusy(null); if (camRef.current) camRef.current.value = ""; }
  }

  async function addText(text: string) {
    const t = text.trim();
    if (URL_RE.test(t) && !/\s/.test(t)) {
      const yt = isYoutubeUrl(t);
      const r = (await api(yt ? "/documents/youtube" : "/documents/web", {
        method: "POST", body: JSON.stringify({ url: t, collection_id: collectionId || null }),
      }, 1)) as { title?: string; linked_existing?: boolean } | null;
      toast(r?.linked_existing ? linkedExistingText(!!collectionId) : `“${r?.title || "Kaynak"}” eklendi; hazırlanıyor.`);
      onAdded?.(r || undefined);
      return true;
    }
    if (t.length >= 40) {
      const r = (await api("/documents/text", {
        method: "POST", body: JSON.stringify({ text: t, collection_id: collectionId || null }),
      }, 1)) as { title?: string; linked_existing?: boolean } | null;
      toast(r?.linked_existing ? linkedExistingText(!!collectionId) : `“${r?.title || "Metin"}” kaynak olarak eklendi.`);
      onAdded?.(r || undefined);
      return true;
    }
    setHint(t ? "Panodaki metin çok kısa (en az 40 karakter) ve bir link değil." : "Panoda metin ya da görsel bulunamadı.");
    return false;
  }

  async function onPaste() {
    setHint(""); setBusy("paste");
    try {
      const clip = navigator.clipboard;
      let handled = false;
      if (clip && typeof clip.read === "function") {
        try {
          const items = await clip.read();
          for (const it of items) {
            const imgType = it.types.find((t) => t.startsWith("image/"));
            if (imgType) {
              const blob = await it.getType(imgType);
              const ext = (imgType.split("/")[1] || "png").replace("jpeg", "jpg");
              await uploadFiles([new File([blob], `pano-${Date.now()}.${ext}`, { type: imgType })]);
              handled = true; break;
            }
            if (it.types.includes("text/plain")) {
              const text = await (await it.getType("text/plain")).text();
              handled = await addText(text); break;
            }
          }
          if (!handled && !items.length) setHint("Panoda metin ya da görsel bulunamadı.");
          if (handled || items.length) return;
        } catch { /* izin yok ya da desteklenmiyor: readText dene */ }
      }
      if (clip && typeof clip.readText === "function") {
        const text = await clip.readText();
        await addText(text);
        return;
      }
      setHint("Bu tarayıcı panoyu okuyamıyor. Metni yukarıdaki alana uzun basıp yapıştır.");
    } catch (e) {
      const msg = errorMessage(e, "");
      setHint(msg || "Pano okunamadı. Tarayıcı izin istediyse 'İzin ver' de ve tekrar dene; olmazsa alana uzun basıp yapıştır.");
    } finally { setBusy(null); }
  }

  const btn = "flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium text-text-primary hover:bg-surface-muted disabled:opacity-60";

  return (
    <div className={cx("mt-3", className)}>
      <div className="flex gap-2">
        {only !== "paste" && (
          <>
            <input ref={camRef} type="file" accept="image/*" capture="environment" multiple hidden
                   onChange={(e) => onCamera(e.target.files)} aria-hidden="true" tabIndex={-1} />
            <button type="button" onClick={() => !busy && camRef.current?.click()} disabled={!!busy} className={btn}
                    aria-label="Sayfa fotoğrafla: kamerayla çekilen sayfa kaynak olur (metin okunur)">
              {busy === "camera" ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Camera size={17} aria-hidden />} Sayfa fotoğrafla
            </button>
          </>
        )}
        {only !== "camera" && (
          <button type="button" onClick={onPaste} disabled={!!busy} className={btn}
                  aria-label="Panodan yapıştır: kopyaladığın link, metin ya da görsel kaynak olur">
            {busy === "paste" ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <ClipboardPaste size={17} aria-hidden />} Panodan yapıştır
          </button>
        )}
      </div>
      {hint && <p role="status" className="mt-1.5 text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}
