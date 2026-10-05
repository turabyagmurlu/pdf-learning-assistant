"use client";
/**
 * Notlarım (Ajan T6, iPad sadeleştirme) — okuyucu yan panelinin ilk sekmesi.
 * Bu PDF'te kalemle yaptığın her şey sayfa sırasıyla, "s. N" ara başlıklarıyla:
 *  - Vurgu: vurgu renginde sol çubuk + alıntı + altında (varsa) notun. Alt çizgi: aynı, alıntının altı çizili.
 *  - Kenar notu: not kâğıdı görünümü. El yazısı: küçük resim (~80 px).
 * Öğeye dokun → o sayfaya gider, not kısa süre parlar. Sağdaki ⋯: Notu düzenle (yerinde kutu, kendiliğinden kaydolur) · Sil (geri alınabilir).
 * Üstte arama (metin içinde) ve "Dışa aktar" (Markdown, lib/reader exportMarkdown). Editör, blok, yapay zekâ düğmesi YOK.
 * Veri: useAnnotations (okuyucu sayfası verir).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, MoreHorizontal, Search, StickyNote, X } from "lucide-react";
import { Annotation, darken, exportMarkdown, pigmentOf } from "@/lib/reader";
import InkPreview from "@/components/reader/InkPreview";

/** Sayfa içindeki dikey konum (aynı sayfada yukarıdan aşağı sıralamak için) */
function yOf(a: Annotation): number {
  if (a.anchor.type === "sticky") return a.anchor.y ?? 0;
  if (a.anchor.type === "ink") return a.anchor.box ? a.anchor.box[1] / (a.anchor.r || 1.294) : 0;
  const r = a.anchor.rects || [];
  return r.length ? Math.min(...r.map((x) => x.y)) : 0;
}

function fold(s: string): string {
  return s.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function MyNotes({ annotations, loading, title, onOpen, onSaveNote, onDelete }: {
  annotations: Annotation[];
  loading?: boolean;
  /** dışa aktarma başlığı (belge adı) */
  title: string;
  /** öğeye dokunuldu: o sayfaya git + parlat */
  onOpen: (a: Annotation) => void;
  onSaveNote: (a: Annotation, text: string) => void;
  /** Sil: çöp kutusuna (geri alınabilir) */
  onDelete: (a: Annotation) => void;
}) {
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...annotations].sort((a, b) => a.page_number - b.page_number || yOf(a) - yOf(b)),
    [annotations],
  );
  const shown = useMemo(() => {
    const f = fold(q.trim());
    if (!f) return sorted;
    return sorted.filter((a) => fold(`${a.selected_text || ""} ${a.note_content || ""}`).includes(f));
  }, [sorted, q]);
  const groups = useMemo(() => {
    const out: { page: number; items: Annotation[] }[] = [];
    for (const a of shown) {
      const last = out[out.length - 1];
      if (last && last.page === a.page_number) last.items.push(a);
      else out.push({ page: a.page_number, items: [a] });
    }
    return out;
  }, [shown]);

  function exportMd() {
    const md = exportMarkdown(title || "Notlarım", sorted);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `${(title || "notlarim").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "notlarim"} - notlar.md`;
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  if (!loading && annotations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <p className="max-w-[260px] text-sm leading-relaxed text-text-secondary">
          Okurken kalemle vurguladığın her şey burada sayfa sırasıyla toplanır.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">Notlarda ara</span>
          <Search size={15} aria-hidden className="pointer-events-none absolute left-2.5 text-text-secondary" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Notlarda ara"
                 className="h-11 w-full rounded-lg border bg-surface-muted pl-8 pr-2 text-[16px] outline-none focus:border-accent-purple sm:text-sm" />
        </label>
        <button type="button" onClick={exportMd} disabled={!sorted.length}
                className="flex h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary disabled:opacity-40"
                title="Notlarını Markdown dosyası olarak indir">
          <Download size={14} aria-hidden /> Dışa aktar
        </button>
      </div>
      <p className="shrink-0 px-3 pt-2 text-xs text-text-secondary" aria-live="polite">
        {q.trim() ? `${shown.length} / ${sorted.length} not` : `${sorted.length} not`}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {groups.length === 0 && q.trim() && (
          <p className="py-6 text-center text-sm text-text-secondary">“{q.trim()}” geçen not yok.</p>
        )}
        {groups.map((g) => (
          <section key={g.page} aria-label={`Sayfa ${g.page}`} className="mt-3">
            <h3 className="mb-1.5 text-xs font-semibold text-text-secondary">s. {g.page}</h3>
            <ul className="space-y-2">
              {g.items.map((a) => (
                <NoteItem key={a.id} a={a} editing={editId === a.id}
                          onOpen={() => onOpen(a)}
                          onEdit={() => setEditId(a.id)}
                          onDone={(text) => { setEditId(null); if (text !== (a.note_content || "")) onSaveNote(a, text); }}
                          onCancel={() => setEditId(null)}
                          onDelete={() => onDelete(a)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function NoteItem({ a, editing, onOpen, onEdit, onDone, onCancel, onDelete }: {
  a: Annotation; editing: boolean;
  onOpen: () => void; onEdit: () => void; onDone: (text: string) => void; onCancel: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMenu(false); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [menu]);

  const sticky = a.anchor.type === "sticky";
  const ink = a.anchor.type === "ink";
  const under = !sticky && !ink && a.anchor.style === "underline";
  const hex = pigmentOf(a.highlight_color);
  const kind = sticky ? "Kenar notu" : ink ? "El yazısı" : under ? "Alt çizgi" : "Vurgu";
  const quote = (a.selected_text || "").replace(/\s+/g, " ").trim();
  const note = (a.note_content || "").trim();

  return (
    <li ref={wrap} className="relative">
      <div className={`flex items-stretch overflow-hidden rounded-xl border ${sticky ? "note-paper" : "bg-surface"}`}>
        {!sticky && !ink && <span aria-hidden className="w-[3px] shrink-0" style={{ background: under ? darken(hex) : hex }} />}
        <button type="button" onClick={onOpen}
                className="min-w-0 flex-1 px-3 py-2.5 text-left hover:bg-black/[0.03]"
                aria-label={`${kind}, sayfa ${a.page_number}${quote ? `: ${quote.slice(0, 80)}` : ""}${note ? `. Not: ${note.slice(0, 80)}` : ""}. Sayfaya git`}>
          {sticky ? (
            <span className="flex items-start gap-2">
              <StickyNote size={15} aria-hidden className="mt-0.5 shrink-0 opacity-70" />
              <span className={`block whitespace-pre-wrap text-sm leading-relaxed ${note ? "" : "italic opacity-70"}`}>{note || "Boş kenar notu"}</span>
            </span>
          ) : ink ? (
            <span className="block">
              {a.anchor.strokes && <InkPreview strokes={a.anchor.strokes} box={a.anchor.box} maxHeight={80}
                                               label={`El yazısı notu · s. ${a.page_number}`} />}
              <span className="mt-1 block text-xs text-text-secondary">s. {a.page_number} · el yazısı</span>
            </span>
          ) : (
            <span className="block font-reading text-[15px] leading-relaxed text-text-primary line-clamp-3"
                  style={under ? { textDecorationLine: "underline", textDecorationColor: darken(hex), textDecorationThickness: 2, textUnderlineOffset: 3 } : undefined}>
              {quote || (under ? "Altı çizili yer" : "Vurgulanan yer")}
            </span>
          )}
          {!sticky && note && !editing && (
            <span className="mt-1.5 block whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{note}</span>
          )}
        </button>
        <button type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}
                aria-label={`${kind} için seçenekler`}
                className="flex w-11 shrink-0 items-start justify-center pt-2.5 text-text-secondary hover:bg-black/[0.04]">
          <MoreHorizontal size={18} aria-hidden />
        </button>
      </div>
      {editing && <InlineEdit initial={a.note_content || ""} onDone={onDone} onCancel={onCancel} />}
      {menu && (
        <div role="menu" aria-label={`${kind} seçenekleri`}
             className="absolute right-1 top-11 z-20 w-44 rounded-xl border bg-surface p-1 text-text-primary shadow-xl">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); onEdit(); }}
                  className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm hover:bg-surface-muted">
            Notu düzenle
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); onDelete(); }}
                  className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm text-danger hover:bg-surface-muted">
            Sil
          </button>
        </div>
      )}
    </li>
  );
}

/** Yerinde not kutusu: odak alır, dışarı çıkınca kaydeder; Esc vazgeçer. */
function InlineEdit({ initial, onDone, onCancel }: { initial: string; onDone: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  return (
    <div className="mt-1 flex items-start gap-1">
      <textarea autoFocus value={text} rows={3} aria-label="Not metni" placeholder="Notunu yaz…"
                onChange={(e) => setText(e.target.value)}
                onBlur={() => { if (!done.current) { done.current = true; onDone(text); } }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done.current = true; onCancel(); }
                  else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
                }}
                className="min-w-0 flex-1 resize-none rounded-lg border bg-surface-muted p-2 text-[16px] leading-snug outline-none focus:border-accent-purple sm:text-sm" />
      <button type="button" aria-label="Vazgeç" onMouseDown={(e) => e.preventDefault()}
              onClick={() => { done.current = true; onCancel(); }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
