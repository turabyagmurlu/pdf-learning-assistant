"use client";
/**
 * Hızlı geçiş (Ctrl+K / Cmd+K): defterlere, kaynaklara ve sayfalara adıyla git.
 * İçerikte (metnin içinde) arama burada yapılmaz; "İçerikte ara →" satırı Araştır sayfasına
 * yazılan sözcükle (?q=) gider. Veriler ilk açılışta bir kez çekilir; yapay zekâ kullanmaz (ücretsiz).
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Notebook, Library, Moon, Keyboard, CornerDownLeft, TextSearch, Plus } from "lucide-react";
import { api } from "@/lib/api";
import SourceIcon from "@/components/SourceIcon";
import { useTheme } from "@/components/ThemeToggle";
import Modal from "@/components/Modal";

type Item = { id: string; group: string; label: string; hint?: string; icon: React.ReactNode; run: () => void };
type Col = { id: string; title?: string; name?: string; doc_count?: number };
type Doc = { id: string; title: string; status: string; source_type?: string | null };

const TR_ASCII: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
function norm(t: string) {
  return (t || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().replace(/[çğıöşü]/g, (c) => TR_ASCII[c] || c);
}

export function openPalette() { window.dispatchEvent(new Event("typdf:palette")); }

export default function CommandPalette() {
  const router = useRouter();
  const { dark, set: setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [cols, setCols] = useState<Col[] | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listId = `pal-list-${uid}`;
  const optId = (i: number) => `pal-opt-${uid}-${i}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("typdf:palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("typdf:palette", onOpen); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ(""); setSel(0);
    if (cols === null) api("/collections", {}, 1).then((r: unknown) => {
      const x = r as { collections?: Col[] } | Col[] | null;
      setCols(Array.isArray(x) ? x : x?.collections || []);
    }).catch(() => setCols([]));
    if (docs === null) api("/documents", {}, 1).then((r: unknown) => setDocs((r as Doc[]) || [])).catch(() => setDocs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const go = (href: string) => { setOpen(false); router.push(href); };

  const items: Item[] = useMemo(() => {
    const raw = q.trim();
    const nq = norm(raw);
    const hit = (s: string) => !nq || norm(s).includes(nq);
    const out: Item[] = [];
    if (raw) {
      out.push({ id: "q", group: "Ara", label: `İçerikte ara: “${raw}” →`, hint: "Araştır",
                 icon: <TextSearch size={16} className="text-accent-purple" />, run: () => { go("/search?q=" + encodeURIComponent(raw)); window.dispatchEvent(new CustomEvent("typdf:search", { detail: raw })); } });
    }
    (cols || []).filter((c) => hit(c.title || c.name || "")).slice(0, nq ? 6 : 4).forEach((c) =>
      out.push({ id: "c" + c.id, group: "Defterler", label: c.title || c.name || "Adsız defter", hint: c.doc_count != null ? `${c.doc_count} kaynak` : undefined,
                 icon: <Notebook size={16} className="text-accent-purple" />, run: () => go("/collections/" + c.id) }));
    (docs || []).filter((d) => hit(d.title || "")).slice(0, nq ? 8 : 4).forEach((d) =>
      out.push({ id: "d" + d.id, group: "Kaynaklar", label: d.title, hint: d.status !== "ready" ? "hazırlanıyor" : undefined,
                 icon: <SourceIcon kind={d.source_type} size={16} />, run: () => go("/documents/" + d.id) }));
    const acts: Item[] = [
      { id: "a1", group: "Git", label: "Defterler", icon: <Notebook size={16} />, run: () => go("/notebooks") },
      { id: "a2", group: "Git", label: "Kütüphane", icon: <Library size={16} />, run: () => go("/library") },
      { id: "a3", group: "Git", label: "Araştır (tüm kaynakların içinde ara)", icon: <Search size={16} />, run: () => go("/search") },
      { id: "a0", group: "Eylemler", label: "Yeni defter", icon: <Plus size={16} />, run: () => { go("/notebooks?new=1"); window.dispatchEvent(new Event("typdf:new-notebook")); } },
      { id: "a4", group: "Eylemler", label: dark ? "Açık temaya geç" : "Koyu temaya geç", icon: <Moon size={16} />, run: () => { setOpen(false); setTheme(dark ? "light" : "dark"); } },
      { id: "a5", group: "Eylemler", label: "Klavye kısayolları", icon: <Keyboard size={16} />, run: () => {
          setOpen(false); window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
        } },
    ];
    acts.filter((a) => hit(a.label)).forEach((a) => out.push(a));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cols, docs, dark]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  let lastGroup = "";
  const loading = (cols === null || docs === null) && !items.length;
  return (
    <Modal open={open} onClose={() => setOpen(false)} size="lg" align="top" className="p-0" ariaLabel="Hızlı geçiş">
      <div className="flex items-center gap-2.5 border-b px-4">
        <Search size={17} className="shrink-0 text-text-secondary" aria-hidden="true" />
        <input data-autofocus="" value={q} onChange={(e) => setQ(e.target.value)}
               role="combobox" aria-expanded={items.length > 0} aria-controls={listId} aria-autocomplete="list"
               aria-activedescendant={items[sel] ? optId(sel) : undefined}
               aria-label="Hızlı geçiş: defter, kaynak ya da sayfa adı yaz"
               onKeyDown={(e) => {
                 if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
                 else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                 else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
               }}
               placeholder="Defter, kaynak ya da sayfa adı yaz"
               className="h-12 w-full border-0 bg-transparent text-base outline-none md:text-sm" />
        <kbd className="hidden rounded border px-1.5 py-0.5 font-mono text-2xs text-text-secondary sm:block">Esc</kbd>
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label="Sonuçlar" className="max-h-[55vh] overflow-y-auto p-1.5">
        {loading ? (
          <p className="p-6 text-center text-sm text-text-secondary" role="status">Yükleniyor…</p>
        ) : !items.length ? (
          <p className="p-6 text-center text-sm text-text-secondary" role="status">“{q}” adında bir defter ya da kaynak yok.</p>
        ) : items.map((it, i) => {
          const head = it.group !== lastGroup ? it.group : "";
          lastGroup = it.group;
          return (
            <div key={it.id} role="presentation">
              {head && <p className="px-3 pb-1 pt-2.5 text-xs font-medium text-text-secondary" role="presentation">{head}</p>}
              <div id={optId(i)} data-i={i} role="option" aria-selected={i === sel} tabIndex={-1}
                   onMouseEnter={() => setSel(i)} onClick={it.run}
                   className={"flex min-h-[44px] w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm " + (i === sel ? "bg-accent-soft text-accent-purple" : "")}>
                <span className="shrink-0" aria-hidden="true">{it.icon}</span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint && <span className="shrink-0 text-xs text-text-secondary">{it.hint}</span>}
                {i === sel && <CornerDownLeft size={13} className="shrink-0 opacity-60" aria-hidden="true" />}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
