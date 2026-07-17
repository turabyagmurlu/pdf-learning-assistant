"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API, getToken } from "@/lib/api";
import { UploadCloud, Search, Star, Trash2, Pencil, LayoutGrid, List, MoreVertical, X, FileText, FolderOpen, FolderPlus, Check } from "lucide-react";

type Doc = {
  id: string; title: string; status: string; processing_stage?: string | null;
  page_count?: number | null; short_summary?: string | null; difficulty_level?: string | null;
  key_concepts?: any; category?: string | null; tags?: any; is_favorite?: boolean; collection_id?: string | null; created_at?: string;
};

const cx = (...a: any[]) => a.filter(Boolean).join(" ");

function toArr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

const VIEW_KEY = "lib.view", DENS_KEY = "lib.density", SORT_KEY = "lib.sort";

export default function LibraryPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [tag, setTag] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [sort, setSort] = useState<"recent" | "title" | "fav">("recent");
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [collections, setCollections] = useState<{ id: string; title: string }[]>([]);
  const [folder, setFolder] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() { try { const d = await api("/documents"); setDocs(d as Doc[]); } catch {} try { const cs = await fetch(API + "/collections", { headers: { Authorization: "Bearer " + getToken() } }); if (cs.ok) setCollections(await cs.json()); } catch {} setLoading(false); }
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY); if (v === "grid" || v === "list") setView(v);
      const de = localStorage.getItem(DENS_KEY); if (de === "comfortable" || de === "compact") setDensity(de);
      const s = localStorage.getItem(SORT_KEY); if (s === "recent" || s === "title" || s === "fav") setSort(s);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch {} }, [view]);
  useEffect(() => { try { localStorage.setItem(DENS_KEY, density); } catch {} }, [density]);
  useEffect(() => { try { localStorage.setItem(SORT_KEY, sort); } catch {} }, [sort]);
  useEffect(() => {
    const anyProc = docs.some((d) => d.status !== "ready" && d.status !== "failed");
    if (!anyProc) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [docs]);

  const categories = useMemo(() => { const s = new Set<string>(); docs.forEach((d) => { if (d.category) s.add(d.category); }); return Array.from(s).sort(); }, [docs]);
  const allTags = useMemo(() => { const s = new Set<string>(); docs.forEach((d) => toArr(d.tags).forEach((t) => s.add(String(t)))); return Array.from(s).sort(); }, [docs]);

  const filtered = useMemo(() => {
    let list = [...docs];
    if (favOnly) list = list.filter((d) => d.is_favorite);
    if (cat) list = list.filter((d) => d.category === cat);
    if (tag) list = list.filter((d) => toArr(d.tags).map(String).includes(tag));
    if (folder) list = list.filter((d) => d.collection_id === folder);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((d) => (d.title || "").toLowerCase().includes(s) || (d.short_summary || "").toLowerCase().includes(s) || toArr(d.tags).some((t) => String(t).toLowerCase().includes(s)));
    }
    if (sort === "title") list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    else if (sort === "fav") list.sort((a, b) => Number(!!b.is_favorite) - Number(!!a.is_favorite));
    return list;
  }, [docs, favOnly, cat, tag, q, sort, folder]);

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) continue;
      const fd = new FormData(); fd.append("file", f);
      try { await fetch(API + "/documents", { method: "POST", headers: { Authorization: "Bearer " + getToken() }, body: fd }); } catch {}
    }
    setUploading(false); reload();
  }

  async function patchDoc(id: string, body: any) {
    const prevDocs = docs;
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...body } : d)));
    try { const r = await fetch(API + "/documents/" + id, { method: "PATCH", headers: { Authorization: "Bearer " + getToken(), "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) setDocs(prevDocs); } catch { setDocs(prevDocs); }
  }
  async function removeDoc(id: string) {
    const prevDocs = docs;
    setDocs((prev) => prev.filter((d) => d.id !== id));
    try { const r = await fetch(API + "/documents/" + id, { method: "DELETE", headers: { Authorization: "Bearer " + getToken() } }); if (!r.ok) setDocs(prevDocs); } catch { setDocs(prevDocs); }
  }

  async function createFolder() { const t = newFolder.trim(); if (!t) { setCreatingFolder(false); return; } try { const r = await fetch(API + "/collections", { method: "POST", headers: { Authorization: "Bearer " + getToken(), "Content-Type": "application/json" }, body: JSON.stringify({ title: t }) }); if (r.ok) { setNewFolder(""); setCreatingFolder(false); reload(); } } catch {} }

  const gap = density === "compact" ? "gap-2" : "gap-4";
  const pad = density === "compact" ? "p-3" : "p-4";

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8" onClick={() => setMenuFor(null)}>
      <div className="mb-1">
        <h1 className="font-heading text-3xl">Kütüphane</h1>
        <p className="mt-1 text-sm text-text-secondary">PDF'lerini yükle, düzenle, kategorilere ayır; sana çalışılabilir hale getireyim.</p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border bg-surface px-3">
          <Search size={16} className="text-text-secondary" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: başlık, özet, etiket…" aria-label="Belgelerde ara" className="w-full bg-transparent py-2 text-sm outline-none" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sırala" className="rounded-xl border bg-surface px-3 py-2 text-sm">
          <option value="recent">En yeni</option>
          <option value="title">Başlık (A-Z)</option>
          <option value="fav">Favoriler önce</option>
        </select>
        <button onClick={() => setFavOnly((v) => !v)} aria-pressed={favOnly} aria-label="Sadece favoriler" className={cx("flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm", favOnly ? "border-accent-purple text-accent-purple" : "bg-surface text-text-secondary")}>
          <Star size={15} className={favOnly ? "fill-current" : ""} /> Favoriler
        </button>
        <div className="flex items-center rounded-xl border bg-surface">
          <button onClick={() => setView("grid")} aria-label="Izgara görünüm" aria-pressed={view === "grid"} className={cx("rounded-l-xl p-2", view === "grid" ? "text-accent-purple" : "text-text-secondary")}><LayoutGrid size={16} /></button>
          <button onClick={() => setView("list")} aria-label="Liste görünüm" aria-pressed={view === "list"} className={cx("rounded-r-xl p-2", view === "list" ? "text-accent-purple" : "text-text-secondary")}><List size={16} /></button>
        </div>
        <button onClick={() => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"))} aria-label="Yoğunluk değiştir" className="rounded-xl border bg-surface px-3 py-2 text-sm text-text-secondary">
          {density === "comfortable" ? "Sık" : "Ferah"}
        </button>
      </div>

      {(categories.length > 0 || allTags.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {cat && <button onClick={() => setCat("")} className="rounded-full bg-accent-purple/15 px-2.5 py-1 text-xs text-accent-purple">kategori: {cat} ✕</button>}
          {!cat && categories.map((c) => (
            <button key={c} onClick={() => setCat(c)} className="rounded-full border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-purple/50">{c}</button>
          ))}
          {tag && <button onClick={() => setTag("")} className="rounded-full bg-accent-amber/20 px-2.5 py-1 text-xs text-accent-amber">#{tag} ✕</button>}
          {!tag && allTags.slice(0, 12).map((t) => (
            <button key={t} onClick={() => setTag(t)} className="rounded-full border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-purple/50">#{t}</button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1 text-xs text-text-secondary"><FolderOpen size={13} /> Klasörler:</span>
        <button onClick={() => setFolder("")} className={cx("rounded-full px-2.5 py-1 text-xs", folder === "" ? "bg-accent-purple/15 text-accent-purple" : "border bg-surface text-text-secondary")}>Tümü</button>
        {collections.map((c) => (
          <button key={c.id} onClick={() => setFolder(c.id)} className={cx("rounded-full px-2.5 py-1 text-xs", folder === c.id ? "bg-accent-purple/15 text-accent-purple" : "border bg-surface text-text-secondary hover:border-accent-purple/50")}>{c.title}</button>
        ))}
        {creatingFolder ? (
          <span className="flex items-center gap-1">
            <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setCreatingFolder(false); }} placeholder="Klasör adı" aria-label="Yeni klasör adı" className="w-28 rounded-full border bg-surface px-2.5 py-1 text-xs outline-none focus:border-accent-purple" />
            <button onClick={createFolder} aria-label="Klasörü oluştur" className="rounded-full bg-accent-purple p-1 text-white"><Check size={12} /></button>
          </span>
        ) : (
          <button onClick={() => setCreatingFolder(true)} aria-label="Yeni klasör" className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-text-secondary hover:border-accent-purple/50"><FolderPlus size={13} /> Yeni</button>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
        aria-label="PDF yükle"
        className={cx("mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed py-10 transition", drag ? "border-accent-purple bg-accent-purple/5" : "border-black/15")}
      >
        <UploadCloud size={26} className="text-accent-purple" />
        <p className="mt-2 text-sm text-text-secondary">{uploading ? "Yükleniyor…" : "PDF yüklemek için tıkla veya sürükle"}</p>
        <input ref={fileRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </div>

      {loading ? (
        <p className="mt-8 text-center text-sm text-text-secondary">Yükleniyor…</p>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-2xl border bg-surface p-10 text-center text-sm text-text-secondary">
          {docs.length === 0 ? "Henüz bir PDF yüklemedin. İlk belgeni yükle; senin için özetleyeyim ve çalışılabilir hale getireyim." : "Filtreyle eşleşen belge yok."}
        </div>
      ) : (
        <div className={view === "grid" ? "mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 " + gap : "mt-6 flex flex-col " + gap}>
          {filtered.map((d) => (
            <div key={d.id} onClick={() => router.push("/documents/" + d.id)} role="button" tabIndex={0}
                 onKeyDown={(e) => { if (e.key === "Enter") router.push("/documents/" + d.id); }}
                 className={cx("group relative cursor-pointer rounded-2xl border bg-surface", pad, "transition hover:border-accent-purple/50 hover:shadow-sm")}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText size={16} className="shrink-0 text-accent-purple" />
                  <h3 className="truncate font-medium text-text-primary">{d.title}</h3>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button onClick={(e) => { e.stopPropagation(); patchDoc(d.id, { is_favorite: !d.is_favorite }); }} aria-label={d.is_favorite ? "Favoriden çıkar" : "Favori yap"} className={cx("rounded-md p-1", d.is_favorite ? "text-accent-amber" : "text-text-secondary opacity-0 group-hover:opacity-100")}>
                    <Star size={15} className={d.is_favorite ? "fill-current" : ""} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === d.id ? null : d.id); }} aria-label="Belge menüsü" className="rounded-md p-1 text-text-secondary opacity-0 group-hover:opacity-100">
                    <MoreVertical size={15} />
                  </button>
                </div>
              </div>
              {d.short_summary && <p className="mt-1.5 line-clamp-2 text-sm text-text-secondary">{d.short_summary}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className={cx("rounded-full px-2 py-0.5", d.status === "ready" ? "bg-green-100 text-green-700" : d.status === "failed" ? "bg-red-100 text-red-700" : "bg-surface-muted text-text-secondary")}>{d.status === "ready" ? "Hazır" : d.status === "failed" ? "Hata" : "İşleniyor"}</span>
                {d.category && <span className="rounded-full bg-accent-purple/10 px-2 py-0.5 text-accent-purple">{d.category}</span>}
                {d.difficulty_level && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-text-secondary">{d.difficulty_level}</span>}
                {d.page_count ? <span className="rounded-full bg-surface-muted px-2 py-0.5 text-text-secondary">{d.page_count} sayfa</span> : null}
                {toArr(d.tags).slice(0, 4).map((t, i) => <span key={i} className="rounded-full bg-accent-amber/15 px-2 py-0.5 text-accent-amber">#{String(t)}</span>)}
              </div>
              {menuFor === d.id && (
                <div onClick={(e) => e.stopPropagation()} className="absolute right-3 top-11 z-20 w-40 overflow-hidden rounded-xl border bg-surface shadow-lg">
                  <button onClick={() => { setEditing(d); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-muted"><Pencil size={14} /> Düzenle</button>
                  <button onClick={() => { removeDoc(d.id); setMenuFor(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-surface-muted"><Trash2 size={14} /> Sil</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && <EditModal doc={editing} collections={collections} onClose={() => setEditing(null)} onSave={(b) => { patchDoc(editing.id, b); setEditing(null); }} />}
    </div>
  );
}

function EditModal({ doc, collections, onClose, onSave }: { doc: Doc; collections: { id: string; title: string }[]; onClose: () => void; onSave: (b: any) => void }) {
  const [title, setTitle] = useState(doc.title || "");
  const [category, setCategory] = useState(doc.category || "");
  const [tagsStr, setTagsStr] = useState(toArr(doc.tags).join(", "));
  const [fav, setFav] = useState(!!doc.is_favorite);
  const [col, setCol] = useState(doc.collection_id || "");
  return (
    <div role="dialog" aria-modal="true" aria-label="Belgeyi düzenle" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-lg">Belgeyi düzenle</h3>
          <button onClick={onClose} aria-label="Kapat" className="rounded-md p-1 hover:bg-surface-muted"><X size={16} /></button>
        </div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">Başlık</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="mb-3 w-full rounded-lg border bg-surface-muted px-3 py-2 text-sm outline-none focus:border-accent-purple" />
        <label className="mb-1 block text-xs font-medium text-text-secondary">Kategori</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="ör. Tarih, Makale, Ders" className="mb-3 w-full rounded-lg border bg-surface-muted px-3 py-2 text-sm outline-none focus:border-accent-purple" />
        <label className="mb-1 block text-xs font-medium text-text-secondary">Etiketler (virgülle)</label>
        <input value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} placeholder="ör. sınav, önemli" className="mb-3 w-full rounded-lg border bg-surface-muted px-3 py-2 text-sm outline-none focus:border-accent-purple" />
        <label className="mb-1 block text-xs font-medium text-text-secondary">Klasör</label>
        <select value={col} onChange={(e) => setCol(e.target.value)} aria-label="Klasör" className="mb-3 w-full rounded-lg border bg-surface-muted px-3 py-2 text-sm outline-none focus:border-accent-purple">
          <option value="">(Klasörsüz)</option>
          {collections.map((c) => (<option key={c.id} value={c.id}>{c.title}</option>))}
        </select>
        <label className="mb-4 flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} /> Favori
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-muted">Vazgeç</button>
          <button onClick={() => onSave({ title: title.trim() || doc.title, category: category.trim(), tags: tagsStr.split(",").map((s) => s.trim()).filter(Boolean), is_favorite: fav, collection_id: col })} className="rounded-lg bg-accent-purple px-4 py-1.5 text-sm text-white">Kaydet</button>
        </div>
      </div>
    </div>
  );
}
