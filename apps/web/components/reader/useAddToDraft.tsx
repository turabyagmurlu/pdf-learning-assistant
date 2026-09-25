"use client";
/**
 * Okuyucudan "Taslağa ekle": seçili metni kaynak adı ve sayfasıyla bir alıntı kartı olarak
 * defterin taslağının SONUNA ekler (POST /collections/{cid}/draft/blocks — sunucuda atomik).
 * Hedef defter (H-2):
 *   - adreste ?from= varsa o defter (okuyucu başlığındaki defter);
 *   - yoksa ve kaynak tek defterdeyse o defter;
 *   - yoksa ve kaynak birden çok defterdeyse İLK seferde defter seçici açılır, seçim bu oturumda hatırlanır;
 *   - kaynak hiçbir defterde değilse seçici (kaynağı deftere de ekleme seçeneğiyle).
 * 4000 karakterden uzun seçim kesilir; bildirimde söylenir ve "Geri al" ile eklenen kart çıkarılır (TO-5).
 * Yapay zekâ kullanmaz (ücretsiz).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, PenLine } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { toast } from "@/components/Toast";
import Modal from "@/components/Modal";
import { notebookIdsOf, type NotebookCtx } from "@/components/reader/ReaderHeader";

const MAX_CHARS = 4000;

type Pending = { text: string; page: number | null };
type Col = { id: string; title: string };

function fromParam(): string | null {
  try { return new URLSearchParams(window.location.search).get("from"); } catch { return null; }
}

export function useAddToDraft(doc: any, ctx: NotebookCtx) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [cols, setCols] = useState<Col[] | null>(null);
  const [linkToo, setLinkToo] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const docIds: string[] = notebookIdsOf(doc);
  const inDoc = new Set(docIds);
  const remember = (cid: string) => { try { sessionStorage.setItem("typdf.draftTarget." + doc?.id, cid); } catch {} };
  const remembered = (): string | null => { try { return sessionStorage.getItem("typdf.draftTarget." + doc?.id); } catch { return null; } };

  /** Eklenen kartı geri çıkarır: taslağı okur, bloğu atar, aynı sürüme koşullu yazar. */
  async function removeBlocks(cid: string, ids: string[]) {
    try {
      const cur = await api(`/collections/${cid}/draft`, {}, 1);
      const j = cur?.draft ? JSON.parse(cur.draft) : null;
      if (!j || !Array.isArray(j.blocks)) return;
      const blocks = j.blocks.filter((b: any) => !ids.includes(b?.id));
      const body: { draft: string; draft_rev?: number } = { draft: JSON.stringify({ v: 1, blocks }) };
      if (typeof cur.draft_rev === "number") body.draft_rev = cur.draft_rev;
      const r = await api(`/collections/${cid}`, { method: "PATCH", body: JSON.stringify(body) }, 1);
      if (r?.conflict) throw new Error("conflict");
      toast("Alıntı taslaktan çıkarıldı");
    } catch {
      toast.error("Geri alınamadı; taslak bu arada değişmiş. Kartı taslaktan elle kaldırabilirsin.");
    }
  }

  async function send(cid: string, title: string, p: Pending, link: boolean) {
    const full = p.text.trim().replace(/\s+/g, " ");
    const truncated = full.length > MAX_CHARS;
    const text = full.slice(0, MAX_CHARS);
    if (!text) return false;
    try {
      if (link) {
        await api(`/collections/${cid}/documents`, { method: "POST", body: JSON.stringify({ document_ids: [doc.id] }) }, 1);
      }
      const r = await api(`/collections/${cid}/draft/blocks`, {
        method: "POST",
        body: JSON.stringify({ blocks: [{ type: "quote", text, source: doc?.title || "Kaynak", page: p.page, document_id: doc.id }] }),
      }, 1);
      const ids: string[] = Array.isArray(r?.block_ids) ? r.block_ids : [];
      if (truncated) {
        toast.info(`Taslağa eklendi · ${title} — seçim uzun olduğu için ilk ${MAX_CHARS} karakteri alındı`, {
          action: ids.length
            ? { label: "Geri al", run: () => removeBlocks(cid, ids) }
            : { label: "Taslağı aç", run: () => router.push(`/collections/${cid}?tab=taslak`) },
        });
      } else {
        toast(`Taslağa eklendi · ${title}`, {
          action: { label: "Taslağı aç", run: () => router.push(`/collections/${cid}?tab=taslak`) },
        });
      }
      return true;
    } catch (e) {
      toast.error(errorMessage(e, "Taslağa eklenemedi. Birkaç saniye sonra tekrar dene."));
      return false;
    }
  }

  function openPicker(p: Pending) {
    setPending(p);
    if (cols === null) {
      api("/collections", {}, 1)
        .then((list: any[]) => setCols(Array.isArray(list) ? list.map((c) => ({ id: String(c.id), title: c.title || "Defter" })) : []))
        .catch(() => setCols([]));
    }
  }

  /** Seçimi taslağa ekle. page: PDF sayfası / bölüm numarası. */
  function addToDraft(text: string, page: number | null) {
    if (!text.trim() || !doc?.id) return;
    const p = { text, page };
    const from = fromParam();
    // ?from= ile gelindiyse (ve gecerliyse) sormadan o deftere
    if (from && ctx.id === from) { send(ctx.id, ctx.title || "Defter", p, false); return; }
    // Bu oturumda daha once secildiyse yine sorma
    const mem = remembered();
    if (mem && inDoc.has(mem)) { send(mem, ctx.id === mem ? (ctx.title || "Defter") : "Defter", p, false); return; }
    // Tek defterdeyse o defter; birden cok defterdeyse ya da hic yoksa secici
    if (docIds.length === 1 && ctx.id) { send(ctx.id, ctx.title || "Defter", p, false); return; }
    openPicker(p);
  }

  async function pick(c: Col) {
    if (!pending) return;
    setBusy(c.id);
    const ok = await send(c.id, c.title, pending, !inDoc.has(c.id) && linkToo);
    setBusy(null);
    if (ok) { remember(c.id); setPending(null); }
  }

  const multi = docIds.length > 1;
  const sorted = (cols || []).slice().sort((a, b) => Number(inDoc.has(b.id)) - Number(inDoc.has(a.id)));
  const picker = (
    <Modal open={!!pending} onClose={() => setPending(null)} title="Hangi defterin taslağına?" size="sm">
      <p className="mb-3 text-sm text-text-secondary">
        {multi ? "Bu kaynak birden çok defterde. Alıntının hangi defterin taslağına gideceğini seç; bu seçim bu oturumda hatırlanır."
               : "Bu kaynak henüz bir defterde değil. Alıntıyı eklemek istediğin defteri seç."}
      </p>
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
            {sorted.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => pick(c)} disabled={!!busy}
                        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border bg-surface px-3 text-left text-sm hover:border-accent-purple/50 disabled:opacity-60">
                  {busy === c.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <PenLine size={15} aria-hidden className="text-text-secondary" />}
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  {inDoc.has(c.id) && <span className="shrink-0 text-xs text-text-secondary">kaynak bu defterde</span>}
                </button>
              </li>
            ))}
          </ul>
          {!multi && (
            <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={linkToo} onChange={(e) => setLinkToo(e.target.checked)} className="h-5 w-5" />
              Kaynağı da bu deftere ekle
            </label>
          )}
        </>
      )}
    </Modal>
  );

  return { addToDraft, picker };
}
