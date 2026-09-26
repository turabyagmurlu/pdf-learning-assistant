"use client";
/**
 * Çöp kutusu (Ajan P): silinen kaynak / defter / not-vurgu / sohbet 30 gün burada durur.
 * "Geri getir" aynı kimlikle geri getirir (bağlar da döner); "Kalıcı sil" ve "Çöpü boşalt" onaylıdır.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { CardSkeleton } from "@/components/Skeleton";
import { useRefreshOn } from "@/components/Wake";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import Button from "@/components/ui/Button";
import SourceIcon, { sourceLabel } from "@/components/SourceIcon";
import { darken } from "@/lib/reader";
import { Notebook, StickyNote, Highlighter, Underline, MessageSquare, RotateCcw, Trash2, Clock } from "lucide-react";

type Kind = "document" | "collection" | "note" | "chat";
type Item = {
  kind: Kind; id: string; title: string; deleted_at: string; expires_at?: string | null;
  size?: number | null; page_count?: number | null; source_type?: string | null; notebook_count?: number;
  source_count?: number; with_sources?: number; chat_count?: number;
  page_number?: number | null; note_content?: string | null; highlight_color?: string | null; style?: "highlight" | "underline" | "sticky";
  parent_title?: string | null; parent_id?: string | null; message_count?: number;
};
type Data = { items: Item[]; counts: Record<Kind, number>; total: number; days: number };

const TABS: { key: "all" | Kind; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "document", label: "Kaynaklar" },
  { key: "collection", label: "Defterler" },
  { key: "note", label: "Notlar" },
  { key: "chat", label: "Sohbetler" },
];
const KIND_LABEL: Record<Kind, string> = { document: "Kaynak", collection: "Defter", note: "Not", chat: "Sohbet" };

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "az önce";
  if (d < 3600) return `${Math.round(d / 60)} dk önce`;
  if (d < 86400) return `${Math.round(d / 3600)} sa önce`;
  return `${Math.round(d / 86400)} gün önce`;
}
function daysLeft(iso?: string | null) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}
function fmtSize(n?: number | null) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export default function TrashPage() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [tab, setTab] = useState<"all" | Kind>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    setLoadErr("");
    try { setData(await api("/trash")); }
    catch (e) { setLoadErr(errorMessage(e, "Çöp kutusu yüklenemedi. Birkaç saniye sonra tekrar dene.")); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useRefreshOn(load);
  const changed = () => { window.dispatchEvent(new Event("typdf:trash-changed")); };

  const items = useMemo(() => (data?.items || []).filter((x) => tab === "all" || x.kind === tab), [data, tab]);

  function openHref(it: Item): string | null {
    if (it.kind === "document") return `/documents/${it.id}`;
    if (it.kind === "collection") return `/collections/${it.id}`;
    if (it.kind === "note" && it.parent_id) return `/documents/${it.parent_id}${it.page_number ? `?page=${it.page_number}` : ""}`;
    if (it.kind === "chat" && it.parent_id) return `/collections/${it.parent_id}`;
    return null;
  }

  async function restore(it: Item) {
    setBusy(it.id);
    const prev = data;
    setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== it.id), total: d.total - 1,
                           counts: { ...d.counts, [it.kind]: Math.max(0, d.counts[it.kind] - 1) } } : d));
    try {
      await api(`/trash/${it.kind}/${it.id}/restore`, { method: "POST" });
      changed();
      const href = openHref(it);
      const extra = it.kind === "collection" && it.with_sources ? ` Birlikte silinen ${it.with_sources} kaynak da geri geldi.` : "";
      toast(`${KIND_LABEL[it.kind]} geri getirildi.${extra}`, href ? { action: { label: "Aç", run: () => router.push(href) } } : undefined);
      if (it.kind === "collection" && it.with_sources) load();
    } catch (e) {
      setData(prev);
      toast.error("Geri getirilemedi. " + errorMessage(e));
    } finally { setBusy(null); }
  }

  async function purge(it: Item) {
    const ok = await confirm({
      title: `“${it.title}” kalıcı olarak silinsin mi?`,
      description: "Bu işlem geri alınamaz; çöp kutusundan da kalkar.",
      losses: it.kind === "document" ? ["Dosya, notların, vurguların ve sohbet geçmişi tamamen silinir"]
        : it.kind === "collection" ? ["Defterin sohbetleri, taslağı, sözlüğü, haritası ve zaman çizelgesi tamamen silinir"]
        : it.kind === "chat" ? [`${it.message_count || 0} mesaj tamamen silinir`]
        : ["Not tamamen silinir"],
      keeps: it.kind === "collection" && it.with_sources
        ? [`Defterle birlikte silinen ${it.with_sources} kaynak çöp kutusunda kalır; onları ayrıca geri getirebilir ya da silebilirsin`] : undefined,
      confirmLabel: "Kalıcı olarak sil", danger: true,
    });
    if (!ok) return;
    setBusy(it.id);
    const prev = data;
    setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== it.id), total: d.total - 1,
                           counts: { ...d.counts, [it.kind]: Math.max(0, d.counts[it.kind] - 1) } } : d));
    try { await api(`/trash/${it.kind}/${it.id}`, { method: "DELETE" }); changed(); toast("Kalıcı olarak silindi."); }
    catch (e) { setData(prev); toast.error("Silinemedi. " + errorMessage(e)); }
    finally { setBusy(null); }
  }

  async function emptyAll() {
    if (!data?.total) return;
    const onlyKind = tab !== "all" ? tab : null;
    const n = onlyKind ? data.counts[onlyKind] : data.total;
    const what = onlyKind ? TABS.find((t) => t.key === onlyKind)?.label.toLowerCase() : "öğe";
    const ok = await confirm({
      title: onlyKind ? `Çöpteki ${n} ${what} kalıcı olarak silinsin mi?` : `Çöp kutusu boşaltılsın mı? (${n} öğe)`,
      description: "Bu işlem geri alınamaz. Dosyalar, notlar ve sohbetler tamamen silinir.",
      confirmLabel: onlyKind ? "Kalıcı olarak sil" : "Çöpü boşalt", danger: true,
      typeToConfirm: "sil",
    });
    if (!ok) return;
    setBusy("all");
    try {
      await api(`/trash${onlyKind ? `?kind=${onlyKind}` : ""}`, { method: "DELETE" });
      changed();
      toast(onlyKind ? "Kalıcı olarak silindi." : "Çöp kutusu boşaltıldı.");
      await load();
    } catch (e) { toast.error("Boşaltılamadı. " + errorMessage(e)); }
    finally { setBusy(null); }
  }

  const days = data?.days ?? 30;
  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-6 md:py-8">
      <PageHeader eyebrow="Silinenler" title="Çöp kutusu"
                  subtitle={`Sildiğin kaynak, defter, not ve sohbetler ${days} gün burada durur; sonra kendiliğinden kalıcı silinir. Geri getirince bağlı olduğu defterlere de döner.`}
                  right={data && data.total > 0 ? (
                    <Button variant="secondary" tone="danger" size="lg" onClick={emptyAll} disabled={busy === "all"} className="sm:h-10">
                      <Trash2 size={16} aria-hidden /> {tab === "all" ? "Çöpü boşalt" : "Bu sekmedekileri sil"}
                    </Button>
                  ) : undefined} />

      {loadErr ? (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-bg p-4 text-sm">
          <p>{loadErr}</p>
          <Button variant="secondary" size="md" onClick={load} className="mt-3">Tekrar dene</Button>
        </div>
      ) : !data ? (
        <CardSkeleton n={3} />
      ) : data.total === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <Trash2 size={28} aria-hidden className="mx-auto mb-3 text-text-secondary" />
          <p className="font-heading text-lg">Çöp kutusu boş</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
            Bir kaynağı, defteri, vurguyu ya da sohbeti sildiğinde burada {days} gün bekler; yanlışlıkla sildiysen buradan geri getirirsin.
          </p>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Öğe türü" className="mb-4 flex flex-wrap gap-1.5">
            {TABS.map((t) => {
              const n = t.key === "all" ? data.total : data.counts[t.key];
              const on = tab === t.key;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                        className={cx("flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm transition",
                          on ? "border-accent-purple bg-accent-purple/10 font-medium text-text-primary" : "text-text-secondary hover:bg-surface-muted")}>
                  {t.label}
                  <span className={cx("rounded-full px-1.5 text-xs", on ? "bg-accent-purple/15" : "bg-surface-muted")}>{n}</span>
                </button>
              );
            })}
          </div>

          {items.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-text-secondary">Bu türde silinmiş öğe yok.</p>
          ) : (
            <ul className="space-y-2" aria-label="Silinen öğeler">
              {items.map((it) => {
                const left = daysLeft(it.expires_at);
                const soon = left !== null && left <= 3;
                return (
                  <li key={it.kind + it.id}
                      className="flex flex-col gap-3 rounded-xl border bg-surface p-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary" aria-hidden>
                        <ItemIcon it={it} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-primary" title={it.title}>
                          <span className="sr-only">{KIND_LABEL[it.kind]}: </span>
                          {it.kind === "note" && it.style !== "sticky" ? <span className="rounded px-1" style={noteQuoteStyle(it)}>{it.title}</span> : it.title}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary">
                          <span>{meta(it)}</span>
                          <span aria-hidden>·</span>
                          <span>{ago(it.deleted_at)} silindi</span>
                          {left !== null && (
                            <>
                              <span aria-hidden>·</span>
                              <span className={cx("flex items-center gap-1", soon && "font-medium text-danger")}>
                                <Clock size={12} aria-hidden /> {left === 0 ? "bugün kalıcı silinecek" : `${left} gün sonra kalıcı silinir`}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 sm:justify-end">
                      <Button variant="secondary" size="md" onClick={() => restore(it)} disabled={busy === it.id}
                              className="min-h-[44px] flex-1 sm:flex-none" aria-label={`Geri getir: ${it.title}`}>
                        <RotateCcw size={15} aria-hidden /> Geri getir
                      </Button>
                      <Button variant="ghost" size="md" tone="danger" onClick={() => purge(it)} disabled={busy === it.id}
                              className="min-h-[44px] flex-1 sm:flex-none" aria-label={`Kalıcı sil: ${it.title}`}>
                        <Trash2 size={15} aria-hidden /> Kalıcı sil
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {dialog}
    </div>
  );
}

function ItemIcon({ it }: { it: Item }) {
  if (it.kind === "document") return <SourceIcon kind={it.source_type} size={18} />;
  if (it.kind === "collection") return <Notebook size={18} />;
  if (it.kind === "chat") return <MessageSquare size={18} />;
  if (it.style === "sticky") return <StickyNote size={18} />;
  if (it.style === "underline") return <Underline size={18} style={{ color: darken(it.highlight_color || "#FFE78A") }} />;
  return <Highlighter size={18} />;
}
function noteQuoteStyle(it: Item): React.CSSProperties {
  const c = it.highlight_color || "#FFE78A";
  return it.style === "underline" ? { borderBottom: `2px solid ${darken(c)}`, borderRadius: 0 } : { background: c, color: "#1F1D1A" };
}
function meta(it: Item): string {
  if (it.kind === "document") {
    const parts = [sourceLabel(it.source_type, it.page_count)];
    const sz = fmtSize(it.size);
    if (sz) parts.push(sz);
    if (it.notebook_count) parts.push(`${it.notebook_count} defterde`);
    return parts.filter(Boolean).join(" · ");
  }
  if (it.kind === "collection") {
    const parts: string[] = [];
    if (it.source_count) parts.push(`${it.source_count} kaynak`);
    if (it.with_sources) parts.push(`${it.with_sources} kaynak birlikte silindi`);
    if (it.chat_count) parts.push(`${it.chat_count} sohbet`);
    return parts.join(" · ") || "Boş defter";
  }
  if (it.kind === "chat") return `${it.parent_title || "Defter"} · ${it.message_count || 0} mesaj`;
  const k = it.style === "sticky" ? "Kenar notu" : it.style === "underline" ? "Altı çizili" : "Vurgu";
  return `${k} · ${it.parent_title || "Kaynak"}${it.page_number ? ` · s.${it.page_number}` : ""}`;
}
