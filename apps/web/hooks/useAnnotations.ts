"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Annotation, listAnnotations, createAnnotation, deleteAnnotation, patchAnnotation, restoreAnnotation,
} from "@/lib/reader";

export function useAnnotations(docId: string) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setAnnotations(await listAnnotations(docId));
    setLoading(false);
  }, [docId]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (a: Omit<Annotation, "id" | "created_at">) => {
    const created = await createAnnotation(docId, a);
    if (created) setAnnotations((prev) => [...prev, created]);
    return created;
  }, [docId]);

  // Guncelleme PATCH ile (ayni kimlik kalir; cop kutusuna iz dusmez). Sunucu reddederse eski hale doner.
  const patch = useCallback(async (id: string, p: Partial<Pick<Annotation, "note_content" | "highlight_color" | "anchor">>) => {
    let before: Annotation | null = null;
    setAnnotations((prev) => {
      before = prev.find((x) => x.id === id) || null;
      return prev.map((x) => (x.id === id ? { ...x, ...p } : x));
    });
    const ok = await patchAnnotation(id, p);
    if (!ok && before) {
      const b = before as Annotation;
      setAnnotations((prev) => prev.map((x) => (x.id === id ? b : x)));
    }
    return ok;
  }, []);

  // Silme = cop kutusuna tasima (30 gun geri alinabilir)
  const remove = useCallback(async (id: string) => {
    setAnnotations((prev) => prev.filter((x) => x.id !== id));
    await deleteAnnotation(id);
  }, []);

  // Copten geri getir (geri al): ayni kimlikle listeye doner
  const restore = useCallback(async (a: Annotation) => {
    const ok = await restoreAnnotation(a.id);
    if (ok) setAnnotations((prev) => (prev.some((x) => x.id === a.id) ? prev : [...prev, a]));
    return ok;
  }, []);

  return { annotations, loading, add, patch, remove, restore, reload };
}
