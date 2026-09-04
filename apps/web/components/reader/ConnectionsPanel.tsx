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
  onOpen: (docId: string) => void;
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
      <div className="mb-3 flex items-center gap-2">
        <Link2 size={15} className="text-accent-purple" />
        <p className="text-sm font-medium">Bu sayfayla bağlantılı yerler</p>
      </div>

      {busy && (
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 size={14} className="animate-spin" /> Diğer belgelerin taranıyor…
        </p>
      )}

      {!busy && loadedPage === page && items.length === 0 && (
        <p className="text-sm text-text-secondary">
          Bu sayfa için başka belgelerinde belirgin bir bağlantı bulamadım.
          Daha fazla belge yükledikçe burası zenginleşir.
        </p>
      )}

      <div className="space-y-2.5">
        {items.map((c, i) => (
          <button key={i} onClick={() => onOpen(c.document_id)}
                  className="w-full rounded-xl border bg-surface p-3 text-left transition hover:border-accent-purple/50 hover:shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{c.title}</span>
              <span className="shrink-0 rounded-full bg-accent-purple/10 px-2 py-0.5 text-[11px] text-accent-purple">
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
          kitaptan öğrenmekten daha kalıcıdır.
        </p>
      )}
    </div>
  );
}
