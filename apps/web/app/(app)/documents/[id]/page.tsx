"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ChatPanel } from "@/components/chat/ChatPanel";

function toArr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

export default function DocumentPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [doc, setDoc] = useState<any>(null);
  const [fileUrl, setFileUrl] = useState<string>("");
  const [tab, setTab] = useState<"info" | "chat">("chat");

  async function load() {
    const d = await api(`/documents/${id}`); setDoc(d);
    if (d.status === "ready" || d.page_count) {
      try { const f = await api(`/documents/${id}/file`); setFileUrl(f.url); } catch {}
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(async () => {
      const s = await api(`/documents/${id}/status`);
      if (s.status === "ready" || s.status === "failed") { clearInterval(t); load(); }
    }, 3000);
    return () => clearInterval(t);
  }, [id]);

  if (!doc) return <div className="p-8 text-text-secondary">Yükleniyor…</div>;

  return (
    <div className="flex h-screen">
      {/* Sol panel: analiz */}
      <div className="w-72 border-r bg-surface p-4 overflow-auto">
        <h2 className="font-heading text-lg mb-2 truncate">{doc.title}</h2>
        {doc.status !== "ready" ? (
          <p className="text-sm text-text-secondary">
            {doc.status === "failed" ? `⚠️ ${doc.error_message}` : `İşleniyor… ${doc.processing_stage || ""}`}
          </p>
        ) : (
          <>
            {doc.short_summary && <p className="text-sm text-text-secondary mb-4">{doc.short_summary}</p>}
            {toArr(doc.outline).length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium mb-1">İçindekiler</p>
                <ul className="text-sm space-y-1">
                  {toArr(doc.outline).map((o, i) => <li key={i} className="text-text-secondary">{typeof o === "string" ? o : (o?.title || "")}</li>)}
                </ul>
              </div>
            )}
            {toArr(doc.key_concepts).length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1">Anahtar kavramlar</p>
                <div className="flex flex-wrap gap-1">
                  {toArr(doc.key_concepts).map((k, i) => (
                    <span key={i} title={k?.definition || ""}
                          className="rounded-full bg-accent-amber/15 text-accent-amber px-2 py-0.5 text-xs">{typeof k === "string" ? k : (k?.term || "")}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Orta: PDF görüntüleyici */}
      <div className="flex-1 bg-surface-muted">
        {fileUrl ? (
          <object data={fileUrl} type="application/pdf" className="w-full h-full">
            <iframe src={fileUrl} className="w-full h-full" title="PDF" />
          </object>
        ) : (
          <div className="flex h-full items-center justify-center text-text-secondary">PDF hazırlanıyor…</div>
        )}
      </div>

      {/* Sağ: chatbot */}
      <div className="w-[420px] border-l bg-surface">
        <ChatPanel documentId={id} />
      </div>
    </div>
  );
}
