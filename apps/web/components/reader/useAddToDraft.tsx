"use client";
/**
 * Okuyucudan "Taslağa ekle": seçili metni kaynak adı ve sayfasıyla bir alıntı olarak bir taslağın SONUNA ekler
 * (sunucuda atomik). Vurgular zaten kendiliğinden birikir; bu yol vurgu yapmadan alıntı eklemek içindir.
 * Hedef:
 *   - varsayılan: "Bu kaynağın taslağı" (belge taslağı · POST /documents/{id}/draft/blocks);
 *   - bildirimdeki "Hedefi değiştir" ile seçici açılır: belge taslağı + defterler (POST /collections/{cid}/draft/blocks).
 *     Seçim bu oturumda bu kaynak için hatırlanır. Kaynağın olmadığı deftere istenirse kaynak da eklenir.
 * 4000 karakterden uzun seçim kesilir; bildirimde söylenir ve "Geri al" ile eklenen alıntı çıkarılır.
 * Yapay zekâ kullanmaz (ücretsiz).
 */
import { useState } from "react";
import { Check, FileText, Loader2, PenLine } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { toast } from "@/components/Toast";
import Modal from "@/components/Modal";
import { notebookIdsOf, type NotebookCtx } from "@/components/reader/ReaderHeader";
import { blocksUrl, fetchDraft, saveDraft, type DraftScope } from "@/components/draft/scope";

const MAX_CHARS = 4000;
const DOC = "doc";   // hatirlanan hedef: belge taslagi

type Pending = { text: string; page: number | null };
type Col = { id: string; title: string };

export function useAddToDraft(doc: any, ctx: NotebookCtx) {
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState<Col[] | null>(null);
  const [linkToo, setLinkToo] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const docIds: string[] = notebookIdsOf(doc);
  const inDoc = new Set(docIds);
  const memKey = () => "typdf.draftTarget." + doc?.id;
  const remember = (t: string) => { try { sessionStorage.setItem(memKey(), t); } catch {} };
  const remembered = (): string | null => { try { return sessionStorage.getItem(memKey()); } catch { return null; } };
  const colTitle = (cid: string) => (cols || []).find((c) => c.id === cid)?.title || (ctx.id === cid ? ctx.title : null) || "Defter";

  /** Eklenen alıntıyı geri çıkarır: taslağı okur, bloğu atar, aynı sürüme koşullu yazar. */
  async function removeBlocks(scope: DraftScope, ids: string[]) {
    try {
      const cur = await fetchDraft(scope);
      const j = cur.draft ? JSON.parse(cur.draft) : null;
      if (!j || !Array.isArray(j.blocks)) return;
      const blocks = j.blocks.filter((b: any) => !ids.includes(b?.id));
      const r = await saveDraft(scope, JSON.stringify({ v: 1, blocks }), cur.draft_rev);
      if (!r.ok) throw new Error("conflict");
      toast("Alıntı taslaktan çıkarıldı");
    } catch {
      toast.error("Geri alınamadı; taslak bu arada değişmiş. Alıntıyı taslaktan elle kaldırabilirsin.");
    }
  }

  /** target: DOC ya da defter kimliği */
  async function send(target: string, p: Pending, link: boolean) {
    const full = p.text.trim().replace(/\s+/g, " ");
    const truncated = full.length > MAX_CHARS;
    const text = full.slice(0, MAX_CHARS);
    if (!text || !doc?.id) return false;
    const scope: DraftScope = target === DOC ? { kind: "document", id: String(doc.id) } : { kind: "collection", id: target };
    const where = target === DOC ? "bu kaynağın taslağına" : `«${colTitle(target)}» taslağına`;
    try {
      if (link && target !== DOC) {
        await api(`/collections/${target}/documents`, { method: "POST", body: JSON.stringify({ document_ids: [doc.id] }) }, 1);
      }
      const r = await api(blocksUrl(scope), {
        method: "POST",
        body: JSON.stringify({ blocks: [{ type: "quote", text, source: doc?.title || "Kaynak", page: p.page, document_id: doc.id }] }),
      }, 1);
      const ids: string[] = Array.isArray(r?.block_ids) ? r.block_ids : [];
      const change = { label: "Hedefi değiştir", run: () => choose() };
      if (truncated) {
        toast.info(`Alıntı ${where} eklendi — seçim uzun olduğu için ilk ${MAX_CHARS} karakteri alındı`, {
          action: ids.length ? { label: "Geri al", run: () => removeBlocks(scope, ids) } : change,
        });
      } else {
        toast(`Alıntı ${where} eklendi`, { action: change });
      }
      return true;
    } catch (e) {
      toast.error(errorMessage(e, "Taslağa eklenemedi. Birkaç saniye sonra tekrar dene."));
      return false;
    }
  }

  function loadCols() {
    if (cols !== null) return;
    api("/collections", {}, 1)
      .then((list: any[]) => setCols(Array.isArray(list) ? list.map((c) => ({ id: String(c.id), title: c.title || "Defter" })) : []))
      .catch(() => setCols([]));
  }
  /** Hedef seçiciyi yalnız hedef belirlemek için aç (sonraki alıntılar oraya gider). */
  function choose() { setOpen(true); loadCols(); }

  /** Seçimi taslağa ekle. page: PDF sayfası / bölüm numarası. */
  function addToDraft(text: string, page: number | null) {
    if (!text.trim() || !doc?.id) return;
    const p = { text, page };
    const mem = remembered();
    // Bu oturumda secilen hedef (belge taslagi ya da kaynagin bulundugu / secilen defter); yoksa belge taslagi
    if (mem && mem !== DOC) { send(mem, p, false); return; }
    send(DOC, p, false);
  }

  async function pick(target: string) {
    const link = target !== DOC && !inDoc.has(target) && linkToo;
    if (link) {
      // yalniz hedef seciliyor: kaynagi deftere simdiden bagla ki sonraki alintilar kaynagiyla birlikte dursun
      setBusy(target);
      try { await api(`/collections/${target}/documents`, { method: "POST", body: JSON.stringify({ document_ids: [doc.id] }) }, 1); }
      catch (e) { setBusy(null); toast.error(errorMessage(e, "Kaynak deftere eklenemedi; birazdan tekrar dene.")); return; }
      setBusy(null);
    }
    remember(target);
    toast(target === DOC ? "Bundan sonraki alıntılar bu kaynağın taslağına gidecek" : `Bundan sonraki alıntılar «${colTitle(target)}» taslağına gidecek`);
    setOpen(false);
  }

  const cur = remembered() || DOC;
  const sorted = (cols || []).slice().sort((a, b) => Number(inDoc.has(b.id)) - Number(inDoc.has(a.id)));
  const needsLink = sorted.some((c) => !inDoc.has(c.id));
  const row = (key: string, label: string, hint: string | null, Icon: typeof PenLine) => (
    <li key={key}>
      <button type="button" onClick={() => pick(key)} disabled={!!busy} aria-current={cur === key ? "true" : undefined}
              className={"flex min-h-[44px] w-full items-center gap-2 rounded-lg border px-3 text-left text-sm hover:border-accent-purple/50 disabled:opacity-60 "
                + (cur === key ? "border-accent-purple/50 bg-accent-soft" : "bg-surface")}>
        {busy === key ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Icon size={15} aria-hidden className="text-text-secondary" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint && <span className="shrink-0 text-xs text-text-secondary">{hint}</span>}
        {cur === key && <Check size={15} aria-hidden className="shrink-0 text-accent-purple" />}
      </button>
    </li>
  );
  const picker = (
    <Modal open={open} onClose={() => setOpen(false)} title="Alıntılar hangi taslağa gitsin?" size="sm">
      <p className="mb-3 text-sm text-text-secondary">
        Vurguların zaten kendiliğinden bu kaynağın ve defterlerinin taslağına düşer. “Taslağa ekle” ile eklediğin alıntıların nereye gideceğini seç; bu seçim bu oturumda hatırlanır.
      </p>
      <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
        {row(DOC, "Bu kaynağın taslağı", "varsayılan", FileText)}
        {cols === null ? (
          <li role="status" className="flex min-h-[44px] items-center gap-2 px-3 text-sm text-text-secondary"><Loader2 size={15} className="animate-spin" aria-hidden /> Defterlerin yükleniyor…</li>
        ) : sorted.map((c) => row(c.id, c.title, inDoc.has(c.id) ? "kaynak bu defterde" : null, PenLine))}
      </ul>
      {cols !== null && needsLink && (
        <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={linkToo} onChange={(e) => setLinkToo(e.target.checked)} className="h-5 w-5" />
          Seçtiğim defterde bu kaynak yoksa onu da ekle
        </label>
      )}
    </Modal>
  );

  return { addToDraft, picker };
}
