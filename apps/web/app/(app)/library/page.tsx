"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, API, getToken } from "@/lib/api";
import { UploadCloud, FileText, Loader2 } from "lucide-react";

type Doc = {
  id: string; title: string; status: string; processing_stage?: string;
  page_count?: number; short_summary?: string; difficulty_level?: string;
};

export default function LibraryPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try { setDocs(await api("/documents")); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 4000); // işleme durumunu poll et
    return () => clearInterval(t);
  }, []);

  async function upload(file: File) {
    setUploading(true); setErr("");
    try {
      const fd = new FormData(); fd.append("file", file);
      await fetch(`${API}/documents`, {
        method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd,
      }).then(async (r) => { if (!r.ok) throw new Error((await r.json())?.error?.user_message || "Yükleme başarısız"); });
      await load();
    } catch (e: any) { setErr(e.message); } finally { setUploading(false); }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="font-heading text-3xl mb-1">Kütüphane</h1>
      <p className="text-text-secondary mb-6">PDF'lerini yükle; özetleyeyim, kavramlara ayırayım, çalışılabilir hale getireyim.</p>

      <div onClick={() => inputRef.current?.click()}
           className="mb-8 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center hover:border-accent-purple transition">
        <input ref={inputRef} type="file" accept="application/pdf" hidden
               onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        {uploading ? <Loader2 className="mx-auto animate-spin text-accent-purple" /> :
          <UploadCloud className="mx-auto text-accent-purple" size={32} />}
        <p className="mt-2 text-text-secondary">{uploading ? "Yükleniyor…" : "PDF yüklemek için tıkla veya sürükle"}</p>
      </div>

      {err && <p className="text-danger mb-4">{err}</p>}

      {docs.length === 0 ? (
        <div className="rounded-xl border bg-surface p-8 text-center text-text-secondary">
          Henüz bir PDF yüklemedin. İlk belgeni yükle; senin için özetleyeyim ve çalışılabilir hale getireyim.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {docs.map((d) => (
            <Link key={d.id} href={`/documents/${d.id}`}
                  className="rounded-xl border bg-surface p-5 shadow-soft hover:shadow-medium transition">
              <div className="flex items-start gap-3">
                <FileText className="text-accent-purple shrink-0" />
                <div className="min-w-0">
                  <h3 className="font-medium truncate">{d.title}</h3>
                  <p className="mt-1 text-sm text-text-secondary line-clamp-2">
                    {d.short_summary || statusLabel(d)}
                  </p>
                  <div className="mt-3 flex gap-2 text-xs">
                    <Badge status={d.status} />
                    {d.difficulty_level && <span className="rounded-full bg-surface-muted px-2 py-0.5">{d.difficulty_level}</span>}
                    {d.page_count ? <span className="rounded-full bg-surface-muted px-2 py-0.5">{d.page_count} sayfa</span> : null}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function statusLabel(d: Doc) {
  if (d.status === "processing") return `İşleniyor… (${d.processing_stage || ""})`;
  if (d.status === "failed") return "İşlenemedi.";
  if (d.status === "uploaded") return "Sırada…";
  return "Hazır.";
}
function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready: "bg-success/15 text-success", processing: "bg-accent-teal/15 text-accent-teal",
    uploaded: "bg-accent-amber/15 text-accent-amber", failed: "bg-danger/15 text-danger",
  };
  const label: Record<string, string> = { ready: "Hazır", processing: "İşleniyor", uploaded: "Sırada", failed: "Hata" };
  return <span className={`rounded-full px-2 py-0.5 ${map[status] || "bg-surface-muted"}`}>{label[status] || status}</span>;
}
