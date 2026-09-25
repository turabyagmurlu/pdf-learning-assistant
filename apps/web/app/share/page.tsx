"use client";
/**
 * Paylaşım hedefi sayfası (T-6, Android Web Share Target).
 * Akis: baska uygulamada "Paylaş → TY PDF" → manifest share_target POST /share →
 * service worker (public/sw.js) form verisini "typdf-share" onbellegine yazar ve buraya
 * (/share?received=1) yonlendirir → bu sayfa link / metin / dosyalari okur, defter secimi
 * sorar ve ekler. Dogrudan acilirsa (veri yoksa) kisa bir aciklama gosterir.
 *
 * iOS Safari paylasim hedefini desteklemez; orada AddSourceDialog'daki "Panodan yapıştır" kullanilir.
 * Not (TS ajani): AddSourceDialog `initial?: { files?: File[]; url?: string; text?: string }`
 * alirsa bu sayfa veriyi dogrudan ona verebilir; simdilik kendi kucuk formu var.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Share2, Link2, StickyNote, FileText, Check } from "lucide-react";
import { api, errorMessage, getToken } from "@/lib/api";
import { isYoutubeUrl, linkedExistingText } from "@/components/YoutubeAdd";
import { rejectReason } from "@/lib/sources";
import ToastHost, { toast } from "@/components/Toast";

const SHARE_CACHE = "typdf-share";
type Meta = { title: string; text: string; url: string; files: { key: string; name: string; type: string; size: number }[]; at: number };
type Col = { id: string; title: string };
type Item = { kind: "url"; url: string } | { kind: "text"; text: string } | { kind: "file"; file: File };

const URL_RE = /https?:\/\/[^\s<>"']+/i;

async function readShare(): Promise<Item[]> {
  if (typeof caches === "undefined") return [];
  const c = await caches.open(SHARE_CACHE);
  const m = await c.match("/share/meta");
  if (!m) return [];
  const meta = (await m.json()) as Meta;
  const items: Item[] = [];
  for (const f of meta.files || []) {
    const r = await c.match(f.key);
    if (!r) continue;
    const blob = await r.blob();
    items.push({ kind: "file", file: new File([blob], f.name, { type: f.type || blob.type }) });
  }
  // link: url alani, yoksa metin/baslik icindeki ilk adres (Chrome bazi uygulamalarda linki text'e koyar)
  const url = (meta.url || "").trim() || (meta.text.match(URL_RE)?.[0] || "") || (meta.title.match(URL_RE)?.[0] || "");
  if (url) items.push({ kind: "url", url });
  else {
    const text = [meta.title, meta.text].filter(Boolean).join("\n\n").trim();
    if (text) items.push({ kind: "text", text });
  }
  return items;
}
async function clearShare() {
  try { const c = await caches.open(SHARE_CACHE); for (const k of await c.keys()) await c.delete(k); } catch { /* yok say */ }
}

export default function SharePage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [cols, setCols] = useState<Col[]>([]);
  const [target, setTarget] = useState<string>("");          // "" = yalniz Kutuphane
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ n: number; cid: string } | null>(null);
  const [err, setErr] = useState("");
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setAuthed(!!getToken());
    readShare().then(setItems).catch(() => setItems([]));
    api("/collections").then((cs) => {
      const list = (Array.isArray(cs) ? cs : []) as Col[];
      setCols(list.map((c) => ({ id: c.id, title: c.title })));
      try { const last = localStorage.getItem("share.lastCollection"); if (last && list.some((c) => c.id === last)) setTarget(last); } catch { /* yok say */ }
    }).catch(() => {});
  }, []);

  const summary = useMemo(() => (items || []).map((it) =>
    it.kind === "url" ? { icon: Link2, text: it.url }
      : it.kind === "text" ? { icon: StickyNote, text: it.text.length > 160 ? it.text.slice(0, 160) + "…" : it.text }
      : { icon: FileText, text: `${it.file.name} · ${Math.max(1, Math.round(it.file.size / 1024))} KB` }), [items]);

  async function add() {
    if (!items || !items.length || busy) return;
    setBusy(true); setErr("");
    const cid = target || null;
    let n = 0;
    const errs: string[] = [];
    for (const it of items) {
      try {
        if (it.kind === "url") {
          const r = await api(isYoutubeUrl(it.url) ? "/documents/youtube" : "/documents/web",
            { method: "POST", body: JSON.stringify({ url: it.url, collection_id: cid }) }, 1);
          if (r?.linked_existing) toast.info(linkedExistingText(!!cid));
          n++;
        } else if (it.kind === "text") {
          if (it.text.trim().length < 40) { errs.push("Paylaşılan metin çok kısa (en az 40 karakter)."); continue; }
          await api("/documents/text", { method: "POST", body: JSON.stringify({ text: it.text, collection_id: cid }) }, 1);
          n++;
        } else {
          const why = rejectReason(it.file);
          if (why) { errs.push(why); continue; }
          const fd = new FormData();
          fd.append("file", it.file);
          if (cid) fd.append("collection_id", cid);
          const r = await api("/documents", { method: "POST", body: fd }, 1);
          if (r?.linked_existing) toast.info(linkedExistingText(!!cid));
          n++;
        }
      } catch (e) { errs.push(errorMessage(e)); }
    }
    setBusy(false);
    if (errs.length) setErr(errs.join(" "));
    if (n) {
      try { if (cid) localStorage.setItem("share.lastCollection", cid); } catch { /* yok say */ }
      await clearShare();
      setDone({ n, cid: cid || "" });
    }
  }

  const card = "mx-auto w-full max-w-md rounded-2xl border bg-surface p-5 shadow-medium";
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-text-primary"
          style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
      <ToastHost />
      <div className={card}>
        <h1 className="flex items-center gap-2 font-heading text-xl"><Share2 size={20} className="text-accent-purple" aria-hidden /> Paylaşılanı kaynak yap</h1>

        {authed === false ? (
          <p className="mt-3 text-sm text-text-secondary">
            Önce giriş yapman gerekiyor. <Link href="/login?next=/share?received=1" className="text-accent-purple underline underline-offset-2">Giriş yap</Link>; paylaşılan içerik bekliyor olacak.
          </p>
        ) : done ? (
          <div className="mt-3" role="status">
            <p className="flex items-center gap-2 text-sm"><Check size={16} className="text-success" aria-hidden /> {done.n} kaynak eklendi; hazırlanıyor.</p>
            <div className="mt-4 flex flex-col gap-2">
              {done.cid ? (
                <button type="button" onClick={() => router.push("/collections/" + done.cid)} className="min-h-[44px] rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent">Defteri aç</button>
              ) : null}
              <Link href="/library" className="flex min-h-[44px] items-center justify-center rounded-xl border px-4 text-sm hover:bg-surface-muted">Kütüphane&apos;ye git</Link>
            </div>
          </div>
        ) : items === null ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-text-secondary" role="status"><Loader2 size={16} className="animate-spin" aria-hidden /> Paylaşılan içerik okunuyor…</p>
        ) : items.length === 0 ? (
          <div className="mt-3 text-sm text-text-secondary">
            <p>Paylaşılan bir içerik bulunamadı. Android&apos;de başka bir uygulamadan <b>Paylaş → TY PDF</b> deyince link, metin ya da dosya buraya gelir ve kaynak olur.</p>
            <p className="mt-2">iPhone&apos;da paylaşım hedefi çalışmaz; <b>Kaynak ekle → Panodan yapıştır</b> kullan.</p>
            <Link href="/library" className="mt-4 flex min-h-[44px] items-center justify-center rounded-xl border px-4 hover:bg-surface-muted">Kütüphane&apos;ye git</Link>
          </div>
        ) : (
          <>
            <ul className="mt-3 space-y-1.5" aria-label="Paylaşılan içerik">
              {summary.map((s, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2 text-sm">
                  <s.icon size={15} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden />
                  <span className="min-w-0 break-words">{s.text}</span>
                </li>
              ))}
            </ul>
            <label htmlFor="share-target" className="mt-4 block text-xs font-medium text-text-secondary">Hangi deftere?</label>
            <select id="share-target" value={target} onChange={(e) => setTarget(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border bg-surface px-3 text-[16px] md:text-sm">
              <option value="">Yalnız Kütüphane&apos;ye (deftere sonra eklerim)</option>
              {cols.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={async () => { await clearShare(); router.push("/library"); }} disabled={busy}
                      className="min-h-[44px] rounded-xl border px-4 text-sm hover:bg-surface-muted">Vazgeç</button>
              <button type="button" onClick={add} disabled={busy}
                      className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-accent-purple px-4 text-sm font-medium text-on-accent disabled:opacity-60">
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden />} Kaynak olarak ekle
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
