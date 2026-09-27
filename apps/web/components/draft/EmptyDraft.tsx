"use client";
/** Boş taslak: açık defter çizimi + kısa açıklama + (vurgu varsa) "Mevcut vurgularını getir". */
import { Loader2, Download } from "lucide-react";
import { CodexSketch } from "@/components/art";

export default function EmptyDraft({ kind, canImport, importing, onImport, compact }: {
  kind: "collection" | "document"; canImport: boolean; importing: boolean; onImport: () => void; compact?: boolean;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center sfumato-in">
      <CodexSketch size={compact ? 120 : 176} className="text-text-secondary" />
      <p className="eyebrow mt-4">{kind === "collection" ? "Defterin taslağı" : "Bu kaynağın taslağı"}</p>
      <p className="mt-2 max-w-sm font-reading text-[17px] italic leading-relaxed text-text-primary">
        Okurken yaptığın her vurgu buraya kendiliğinden düşer.
      </p>
      <p className="mt-1 max-w-sm text-sm text-text-secondary">
        Aralarına kendi cümlelerini yazabilir, sonra Atölye’de bu alıntılarla çalışabilirsin.
      </p>
      {canImport && (
        <button type="button" onClick={onImport} disabled={importing}
                className="mt-5 flex min-h-[44px] items-center gap-2 rounded-xl border border-accent-purple/40 bg-surface px-4 text-sm font-medium text-text-primary hover:bg-accent-purple/10 disabled:opacity-60">
          {importing ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Download size={16} aria-hidden />}
          Mevcut vurgularını getir
        </button>
      )}
    </div>
  );
}
