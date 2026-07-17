"use client";
import { useCallback, useEffect, useState } from "react";
import { Annotation, listAnnotations, createAnnotation, deleteAnnotation } from "@/lib/reader";

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

  // Update = delete + recreate (backend has no PATCH; POST/DELETE are enough).
  const patch = useCallback(async (id: string, p: Partial<Pick<Annotation, "note_content" | "highlight_color">>) => {
    let merged: Annotation | null = null;
    setAnnotations((prev) => {
      const cur = prev.find((x) => x.id === id);
      if (cur) merged = { ...cur, ...p };
      return prev.map((x) => (x.id === id ? { ...x, ...p } : x));
    });
    if (!merged) return;
    const m = merged as Annotation;
    await deleteAnnotation(id);
    const created = await createAnnotation(docId, {
      page_number: m.page_number, selected_text: m.selected_text,
      note_content: m.note_content ?? "", highlight_color: m.highlight_color, anchor: m.anchor,
    });
    if (created) setAnnotations((prev) => prev.map((x) => (x.id === id ? { ...m, id: created.id } : x)));
  }, [docId]);

  const remove = useCallback(async (id: string) => {
    setAnnotations((prev) => prev.filter((x) => x.id !== id));
    await deleteAnnotation(id);
  }, []);

  return { annotations, loading, add, patch, remove, reload };
}
