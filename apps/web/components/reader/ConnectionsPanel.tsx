"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Link2, Loader2 } from "lucide-react";

type Conn = {
  document_id: string; title: string; page: number;
  section?: string | null; excerpt: string; score: number;
};

export default function ConnectionsPanel({
  documentId, page, onOpen,
}: {
  documentId: string;
  page: number;
  onOpen: (docId: string, page?: number) => void;
}) {
  const [items, setItems] = useState<Conn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadedPage, setLoadedPage] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    if (!page) return;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api(`/documents/${documentId}/connections?page=${page}`);
        if (alive) { setItems(r.connections || []); setLoadedPage(page); }
      } catch {
        if (alive) { setItems([]); setLoadedPage(page); }
      } finally { if (alive) setBusy(false); }
    }, 700);
    return () => { alive = false; clearTimeout(t); };
  }, [documentId, page]);

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <div className="mb-1 flex items-center gap-2">
        <Link2 size={15} className="text-accent-purple" aria-hidden />
        <h2 className="text-sm font-medium">Bu sayfayla bağlantılı yerler</h2>
      </div>
      <p className="mb-3 text-xs text-text-secondary">Kütüphanendeki diğer kaynaklardan · ücretsiz</p>

      {busy && (
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Diğer kaynakların taranıyor…
        </p>
      )}

      {!busy && loadedPage === page && items.length === 0 && (
        <p className="text-sm text-text-secondary">
          Bu sayfa için diğer kaynaklarında belirgin bir bağlantı bulamadım.
          Daha fazla kaynak ekledikçe burası zenginleşir.
        </p>
      )}

      <div className="space-y-2.5">
        {items.map((c, i) => (
          <button key={i} type="button" onClick={() => onOpen(c.document_id, c.page)}
                  className="w-full rounded-xl border bg-surface p-3 text-left transition hover:border-accent-purple/50 hover:shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{c.title}</span>
              <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text-secondary">
                s.{c.page}
              </span>
            </div>
            {c.section && <p className="mt-0.5 truncate text-xs text-text-secondary">{c.section}</p>}
            <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-text-secondary">{c.excerpt}…</p>
          </button>
        ))}
      </div>

      {items.length > 0 && (
        <p className="mt-4 text-xs text-text-secondary">
          Aynı fikrin başka kaynaklarda nasıl anlatıldığını görmek, konuyu tek bir
          kaynaktan öğrenmekten daha kalıcıdır.
        </p>
      )}
    </div>
  );
}
