"use client";
/**
 * Okuyucudan "Taslağa ekle": secili metni kaynak adi ve sayfasiyla bir alinti karti olarak
 * defterin taslaginin SONUNA ekler (POST /collections/{cid}/draft/blocks — sunucuda atomik).
 * Hedef defter: okuyucu basligindaki defter (?from= ya da kaynagin ilk defteri).
 * Kaynak hicbir defterde degilse kucuk bir defter secici acilir. Yapay zeka kullanmaz (ucretsiz).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, PenLine } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { toast } from "@/components/Toast";
import Modal from "@/components/Modal";
import type { NotebookCtx } from "@/components/reader/ReaderHeader";

type Pending = { text: string; page: number | null };
type Col = { id: string; title: string };

export function useAddToDraft(doc: any, ctx: NotebookCtx) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [cols, setCols] = useState<Col[] | null>(null);
  const [linkToo, setLinkToo] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function send(cid: string, title: string, p: Pending, link: boolean) {
    const text = p.text.trim().replace(/\s+/g, " ").slice(0, 4000);
    if (!text) return false;
    try {
      if (link) {
        await api(`/collections/${cid}/documents`, { method: "POST", body: JSON.stringify({ document_ids: [doc.id] }) }, 1);
      }
      await api(`/collections/${cid}/draft/blocks`, {
        method: "POST",
        body: JSON.stringify({ blocks: [{ type: "quote", text, source: doc?.title || "Kaynak", page: p.page, document_id: doc.id }] }),
      }, 1);
      toast(`Taslağa eklendi · ${title}`, {
        action: { label: "Taslağı aç", run: () => router.push(`/collections/${cid}?tab=taslak`) },
      });
      return true;
    } catch (e) {
      toast.error(errorMessage(e, "Taslağa eklenemedi. Birkaç saniye sonra tekrar dene."));
      return false;
    }
  }

  /** Secimi taslaga ekle. page: PDF sayfasi / bolum numarasi. */
  function addToDraft(text: string, page: number | null) {
    if (!text.trim() || !doc?.id) return;
    const p = { text, page };
    if (ctx.id) { send(ctx.id, ctx.title || "Defter", p, false); return; }
    setPending(p);
    if (cols === null) {
      api("/collections", {}, 1)
        .then((list: any[]) => setCols(Array.isArray(list) ? list.map((c) => ({ id: String(c.id), title: c.title || "Defter" })) : []))
        .catch(() => setCols([]));
    }
  }

  async function pick(c: Col) {
    if (!pending) return;
    setBusy(c.id);
    const ok = await send(c.id, c.title, pending, linkToo);
    setBusy(null);
    if (ok) setPending(null);
  }

  const picker = (
    <Modal open={!!pending} onClose={() => setPending(null)} title="Hangi defterin taslağına?" size="sm">
      <p className="mb-3 text-sm text-text-secondary">Bu kaynak henüz bir defterde değil. Alıntıyı eklemek istediğin defteri seç.</p>
      {cols === null ? (
        <p role="status" className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={15} className="animate-spin" aria-hidden /> Defterlerin yükleniyor…</p>
      ) : cols.length === 0 ? (
        <div className="text-sm">
          <p>Henüz defterin yok. Önce bir defter oluştur ve bu kaynağı ona ekle.</p>
          <Link href="/notebooks" className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-accent-purple px-4 text-white">Defterlere git</Link>
        </div>
      ) : (
        <>
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {cols.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => pick(c)} disabled={!!busy}
                        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border bg-surface px-3 text-left text-sm hover:border-accent-purple/50 disabled:opacity-60">
                  {busy === c.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <PenLine size={15} aria-hidden className="text-text-secondary" />}
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={linkToo} onChange={(e) => setLinkToo(e.target.checked)} className="h-5 w-5" />
            Kaynağı da bu deftere ekle
          </label>
        </>
      )}
    </Modal>
  );

  return { addToDraft, picker };
}
