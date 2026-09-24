"use client";
/**
 * Komut paleti (Ctrl+K / Cmd+K): defterlere, kaynaklara ve sayfalara tek kutudan git.
 * Veriler ilk acilista bir kez cekilir; yapay zeka kullanmaz (0 kota).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Notebook, Library, Moon, Keyboard, CornerDownLeft } from "lucide-react";
import { api } from "@/lib/api";
import SourceIcon from "@/components/SourceIcon";
import { useTheme } from "@/components/ThemeToggle";

type Item = { id: string; group: string; label: string; hint?: string; icon: React.ReactNode; run: () => void };

function norm(t: string) {
  return (t || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase()
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" } as any)[c]);
}

export function openPalette() { window.dispatchEvent(new Event("typdf:palette")); }

export default function CommandPalette() {
  const router = useRouter();
  const { dark, set: setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [cols, setCols] = useState<any[] | null>(null);
  const [docs, setDocs] = useState<any[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("typdf:palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("typdf:palette", onOpen); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ(""); setSel(0);
    setTimeout(() => inputRef.current?.focus(), 20);
    if (cols === null) api("/collections", {}, 1).then((r: any) => setCols(r?.collections || r || [])).catch(() => setCols([]));
    if (docs === null) api("/documents", {}, 1).then((r: any) => setDocs(r || [])).catch(() => setDocs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const go = (href: string) => { setOpen(false); router.push(href); };

  const items: Item[] = useMemo(() => {
    const nq = norm(q.trim());
    const hit = (s: string) => !nq || norm(s).includes(nq);
    const out: Item[] = [];
    (cols || []).filter((c) => hit(c.title || c.name || "")).slice(0, nq ? 6 : 4).forEach((c) =>
      out.push({ id: "c" + c.id, group: "Defterler", label: c.title || c.name, hint: c.document_count != null ? `${c.document_count} kaynak` : undefined,
                 icon: <Notebook size={16} className="text-accent-purple" />, run: () => go("/collections/" + c.id) }));
    (docs || []).filter((d) => hit(d.title || "")).slice(0, nq ? 8 : 4).forEach((d) =>
      out.push({ id: "d" + d.id, group: "Kaynaklar", label: d.title, hint: d.status !== "ready" ? "işleniyor" : undefined,
                 icon: <SourceIcon kind={d.source_type} size={16} />, run: () => go("/documents/" + d.id) }));
    const acts: Item[] = [
      { id: "a1", group: "Git", label: "Defterler", icon: <Notebook size={16} />, run: () => go("/notebooks") },
      { id: "a2", group: "Git", label: "Kütüphane", icon: <Library size={16} />, run: () => go("/library") },
      { id: "a3", group: "Git", label: "Araştır (tüm kaynaklarda ara)", icon: <Search size={16} />, run: () => go("/search") },
      { id: "a4", group: "Eylemler", label: "Açık / koyu temaya geç", icon: <Moon size={16} />, run: () => { setOpen(false); setTheme(dark ? "light" : "dark"); } },
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

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 px-3 pt-[12vh]" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Komut paleti"
           className="w-full max-w-xl overflow-hidden rounded-2xl border bg-surface shadow-medium">
        <div className="flex items-center gap-2.5 border-b px-4">
          <Search size={17} className="shrink-0 text-text-secondary" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
                   else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                   else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
                 }}
                 placeholder="Defter, kaynak ya da komut ara"
                 className="h-12 w-full bg-transparent text-[15px] outline-none" />
          <kbd className="hidden rounded border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary sm:block">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-1.5">
          {(cols === null || docs === null) && !items.length ? (
            <p className="p-6 text-center text-sm text-text-secondary">Yükleniyor…</p>
          ) : !items.length ? (
            <p className="p-6 text-center text-sm text-text-secondary">“{q}” için sonuç yok.</p>
          ) : items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : "";
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head && <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium text-text-secondary">{head}</p>}
                <button data-i={i} onMouseEnter={() => setSel(i)} onClick={it.run}
                        className={"flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm " + (i === sel ? "bg-accent-purple/10 text-accent-purple" : "")}>
                  <span className="shrink-0">{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="shrink-0 text-[11px] text-text-secondary">{it.hint}</span>}
                  {i === sel && <CornerDownLeft size={13} className="shrink-0 opacity-60" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
