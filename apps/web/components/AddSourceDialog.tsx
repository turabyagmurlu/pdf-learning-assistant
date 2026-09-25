"use client";
/**
 * Tek "Kaynak ekle" penceresi (segmentli): Dosya · Link/YouTube · Metin yapıştır · Web'de bul · Kütüphaneden seç.
 * - Bos durum kartlari ilgili segmenti dogrudan acar (`segment` prop'u).
 * - Hangi yoldan eklenirse eklensin davranis ayni: pencere kapanir, bildirim cikar, liste tazelenir.
 * - Kaynaklar ortak: Kutuphaneden secmek kaynagi baska defterden CIKARMAZ, yalniz bu deftere baglar.
 */
import { DragEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Loader2, Link2, StickyNote, Globe, Library, Square, CheckSquare, Upload, X } from "lucide-react";
import Modal from "@/components/Modal";
import YoutubeAdd, { linkedExistingText } from "@/components/YoutubeAdd";
import TextAdd from "@/components/TextAdd";
import DiscoverPanel from "@/components/DiscoverPanel";
import SourceIcon from "@/components/SourceIcon";
import { toast } from "@/components/Toast";
import { api } from "@/lib/api";
import { ACCEPT, TYPES_HINT, LIMIT_HINT } from "@/lib/sources";

export type AddSegment = "dosya" | "link" | "metin" | "web" | "kutuphane";

const SEGMENTS: [AddSegment, string, typeof Plus][] = [
  ["dosya", "Dosya", Upload],
  ["link", "Link / YouTube", Link2],
  ["metin", "Metin yapıştır", StickyNote],
  ["web", "Web'de bul", Globe],
  ["kutuphane", "Kütüphaneden seç", Library],
];

type LibDoc = { id: string; title: string; short_summary?: string | null; source_type?: string | null;
  collection_ids?: string[] | null; collection_id?: string | null; status?: string };

export const PRIVACY_NOTE =
  "Sorularını ve kaynak metinlerini yanıt üretmek için Google Gemini'ye gönderiyoruz. Ücretsiz katmanda Google bu içeriği hizmetlerini geliştirmek için kullanabilir; gizli/kişisel belge yükleme.";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export default function AddSourceDialog({ open, onClose, collectionId, segment, onSegment, existingIds, onAdded, onUpload, upBusy }: {
  open: boolean;
  onClose: () => void;
  collectionId: string;
  segment: AddSegment;
  onSegment: (s: AddSegment) => void;
  /** Bu defterde zaten olan kaynaklar (kutuphane listesinde gosterilmez) */
  existingIds: string[];
  /** Link / metin / web / kutuphane eklemesinden sonra (liste tazelensin) */
  onAdded: () => Promise<void> | void;
  /** Dosya yukleme (sayfadaki yukleyici; pencere kapansa da surer) */
  onUpload: (files: FileList | File[]) => Promise<number>;
  upBusy: { done: number; total: number } | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  async function afterAdd(msg: string, info = false) {
    onClose();
    (info ? toast.info : toast)(msg);
    await onAdded();
  }

  function segKeys(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = SEGMENTS.findIndex((s) => s[0] === segment);
    const j = (i + (e.key === "ArrowRight" ? 1 : -1) + SEGMENTS.length) % SEGMENTS.length;
    onSegment(SEGMENTS[j][0]);
    setTimeout(() => document.getElementById("addseg-" + SEGMENTS[j][0])?.focus(), 0);
  }

  async function files(list: FileList | File[] | null) {
    if (!list || !Array.from(list).length) return;
    const n = await onUpload(list);
    if (n > 0) onClose();            // basarili yuklemede pencere kapanir (link eklemeyle ayni davranis)
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); files(e.dataTransfer.files); };

  return (
    <Modal open={open} onClose={onClose} labelledBy="addsrc-title" size="lg" className="p-0">
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
          <h2 id="addsrc-title" className="font-heading text-lg">Kaynak ekle</h2>
          <button type="button" onClick={onClose} aria-label="Kapat" data-modal-close=""
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
            <X size={18} />
          </button>
        </div>
        <div role="tablist" aria-label="Kaynak ekleme yolu" onKeyDown={segKeys}
             className="flex gap-1 overflow-x-auto border-b px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SEGMENTS.map(([k, label, Icon]) => (
            <button key={k} id={"addseg-" + k} role="tab" aria-selected={segment === k} aria-controls={"addpanel-" + k}
                    tabIndex={segment === k ? 0 : -1} onClick={() => onSegment(k)}
                    className={cx("flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm",
                      segment === k ? "bg-accent-purple/10 font-semibold text-text-primary ring-1 ring-accent-purple/40" : "text-text-secondary hover:bg-surface-muted")}>
              <Icon size={15} aria-hidden /> {label}
            </button>
          ))}
        </div>

        <div id={"addpanel-" + segment} role="tabpanel" aria-labelledby={"addseg-" + segment} className="px-4 py-4">
          {segment === "dosya" && (
            <div>
              <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden
                     onChange={(e) => { files(e.target.files); if (fileRef.current) fileRef.current.value = ""; }} />
              <button type="button" data-autofocus onClick={() => !upBusy && fileRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
                      aria-busy={!!upBusy}
                      className={cx("flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 py-5 text-left transition",
                        drag ? "border-accent-purple bg-accent-purple/10" : "border-accent-purple/40 hover:bg-accent-purple/5")}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-purple/10 text-accent-purple">
                  {upBusy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {upBusy ? `Yükleniyor… ${upBusy.done}/${upBusy.total}` : "Bilgisayardan dosya seç ya da buraya bırak"}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-secondary">
                    {upBusy ? "Pencereyi kapatabilirsin; yükleme sürer. Sayfadan ayrılma." : `${TYPES_HINT} · ${LIMIT_HINT} · çoklu seçim`}
                  </span>
                </span>
              </button>
              <p className="mt-3 text-xs text-text-secondary">
                {PRIVACY_NOTE} <Link href="/gizlilik" className="underline underline-offset-2 hover:text-accent-purple">Gizlilik</Link>
              </p>
            </div>
          )}

          {segment === "link" && (
            <YoutubeAdd collectionId={collectionId} autoFocus quiet
                        onAdded={(r) => afterAdd(r?.linked_existing ? linkedExistingText(true) : `“${r?.title || "Kaynak"}” eklendi; hazırlanıyor.`, !!r?.linked_existing)} />
          )}

          {segment === "metin" && (
            <TextAdd collectionId={collectionId} startOpen quiet
                     onAdded={(r) => afterAdd(r?.linked_existing ? linkedExistingText(true) : `“${r?.title || "Metin"}” kaynak olarak eklendi.`, !!r?.linked_existing)} />
          )}

          {segment === "web" && (
            <DiscoverPanel collectionId={collectionId} autoFocus
                           onAdded={(n, linked) => afterAdd(
                             [n ? `${n} kaynak deftere eklendi; hazırlanıyor.` : "", linked ? `${linked} kaynak zaten kütüphanende vardı, deftere bağlandı.` : ""].filter(Boolean).join(" "))} />
          )}

          {segment === "kutuphane" && (
            <LibraryPicker collectionId={collectionId} existingIds={existingIds}
                           onDone={(n) => afterAdd(`${n} kaynak deftere eklendi. Diğer defterlerinde de kalmaya devam eder.`)}
                           onCancel={onClose} />
          )}
        </div>
      </div>
    </Modal>
  );
}

function LibraryPicker({ collectionId, existingIds, onDone, onCancel }: {
  collectionId: string; existingIds: string[]; onDone: (n: number) => void; onCancel: () => void;
}) {
  const [docs, setDocs] = useState<LibDoc[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, cols] = await Promise.all([api("/documents"), api("/collections").catch(() => [])]);
        if (!alive) return;
        setDocs((d || []) as LibDoc[]);
        const t: Record<string, string> = {};
        for (const c of (cols || []) as { id: string; title: string }[]) t[c.id] = c.title;
        setTitles(t);
      } catch (e: any) { if (alive) { setDocs([]); setErr(e?.message || "Kütüphane yüklenemedi; tekrar dene."); } }
    })();
    return () => { alive = false; };
  }, []);

  const mine = new Set(existingIds);
  const list = (docs || [])
    .filter((d) => !mine.has(d.id))
    .filter((d) => !q.trim() || (d.title || "").toLocaleLowerCase("tr").includes(q.trim().toLocaleLowerCase("tr")));
  const ids = Object.keys(picked).filter((k) => picked[k]);

  async function add() {
    if (!ids.length) return;
    setBusy(true); setErr("");
    try {
      const r = await api(`/collections/${collectionId}/documents`, { method: "POST", body: JSON.stringify({ document_ids: ids }) }, 1);
      onDone(typeof r?.added === "number" ? r.added : ids.length);
    } catch (e: any) { setErr(e?.message || "Kaynaklar eklenemedi; tekrar dene."); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-0 flex-col">
      <p className="mb-2 text-xs text-text-secondary">
        Kütüphanendeki bir kaynağı bu deftere bağlar. Kaynak başka defterlerde de varsa oradan çıkmaz; aynı kaynak birden çok defterde olabilir.
      </p>
      <input value={q} onChange={(e) => setQ(e.target.value)} data-autofocus
             placeholder="Kaynak ara…" aria-label="Kütüphanede kaynak ara"
             className="w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-purple" />
      <div className="mt-2 max-h-[45dvh] overflow-y-auto" role="group" aria-label="Kütüphanedeki kaynaklar">
        {docs === null ? (
          <p className="p-6 text-center text-sm text-text-secondary"><Loader2 size={16} className="mr-1 inline animate-spin" /> Yükleniyor…</p>
        ) : !list.length ? (
          <p className="p-6 text-center text-sm text-text-secondary">
            {docs.length === 0 ? "Kütüphanende hiç kaynak yok." : q.trim() ? "Aramayla eşleşen kaynak yok." : "Kütüphanendeki tüm kaynaklar zaten bu defterde."}
          </p>
        ) : list.map((d) => {
          const on = !!picked[d.id];
          const others = (d.collection_ids && d.collection_ids.length ? d.collection_ids : d.collection_id ? [d.collection_id] : [])
            .filter((c) => c !== collectionId);
          return (
            <button key={d.id} type="button" role="checkbox" aria-checked={on}
                    onClick={() => setPicked((p) => ({ ...p, [d.id]: !on }))}
                    className={cx("flex min-h-[44px] w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition",
                      on ? "bg-accent-purple/10" : "hover:bg-surface-muted")}>
              {on ? <CheckSquare size={18} className="mt-0.5 shrink-0 text-accent-purple" aria-hidden />
                  : <Square size={18} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden />}
              <SourceIcon kind={d.source_type || "pdf"} size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{d.title}</span>
                {d.short_summary && <span className="mt-0.5 line-clamp-1 text-xs text-text-secondary">{d.short_summary}</span>}
                {others.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {others.slice(0, 3).map((c) => (
                      <span key={c} className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-text-secondary">
                        {titles[c] ? `${titles[c]} defterinde` : "başka bir defterde"}
                      </span>
                    ))}
                    {others.length > 3 && <span className="text-[11px] text-text-secondary">+{others.length - 3} defter</span>}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3">
        <button onClick={onCancel} disabled={busy}
                className="min-h-[40px] rounded-lg px-3 text-sm text-text-secondary hover:bg-surface-muted disabled:opacity-60">Vazgeç</button>
        <button onClick={add} disabled={busy || !ids.length}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-accent-purple px-4 text-sm text-white disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {ids.length ? `${ids.length} kaynağı deftere ekle` : "Kaynak seç"}
        </button>
      </div>
    </div>
  );
}
