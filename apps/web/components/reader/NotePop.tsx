"use client";
/**
 * Sayfa üstündeki not balonu (Ajan T6, iPad sadeleştirme).
 *
 *  - Balon: vurgu oluşur oluşmaz (ya da vurguya dokununca) vurgunun hemen yanında küçük "✎ Not" + "⋯".
 *    3 sn görünür, sonra solar (zamanlayıcı okuyucu sayfasında; CSS .note-pop-life).
 *  - "✎ Not"a dokununca balon yerinde satır içi küçük bir metin kutusuna döner (pencere açılmaz). Kutu odak alır;
 *    iPad'de kalemle (Scribble) doğrudan yazılabilir. Yazmayı bırakınca (1,2 sn) ve kutudan çıkınca kendiliğinden kaydeder.
 *    Esc: vazgeç (önceki not geri gelir). Boş kutu kapatılınca hiçbir şey kaydedilmez.
 *  - "⋯": rengi / biçimi değiştir ya da sil (küçük pencere).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal, PenLine } from "lucide-react";
import type { Annotation } from "@/lib/reader";

const AUTOSAVE_MS = 1200;

export default function NotePop({ ann, editing, onStartEdit, onSave, onDone, onCancel, onMore }: {
  ann: Annotation;
  /** true: satır içi metin kutusu; false: "✎ Not" balonu */
  editing: boolean;
  onStartEdit: () => void;
  /** yazarken ara kayıt (kutu açık kalır) */
  onSave: (text: string) => void;
  /** kutudan çıkıldı: son hâli kaydet ve kapat. original: kutu açıldığındaki not */
  onDone: (text: string, original: string) => void;
  /** Esc: vazgeç, notu kutu açılmadan önceki hâline döndür */
  onCancel: (original: string) => void;
  onMore: () => void;
}) {
  const original = useRef(ann.note_content || "");
  const [text, setText] = useState(ann.note_content || "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // kutu açılınca: o anki notu başlangıç say, odakla. Odak aynı dokunuş içinde verilir (useLayoutEffect):
  // iPad'de klavye / Scribble ancak kullanıcı dokunuşuyla açılır.
  useLayoutEffect(() => {
    if (!editing) return;
    original.current = ann.note_content || "";
    setText(ann.note_content || "");
    closed.current = false;
    taRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, ann.id]);
  // kutu açıkken bileşen kalkarsa (başka bir vurguya dokunuldu, panel kapandı) yazılan kaybolmasın
  const live = useRef({ editing, text, onDone });
  live.current = { editing, text, onDone };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    const l = live.current;
    if (l.editing && !closed.current) { closed.current = true; l.onDone(l.text, original.current); }
  }, []);

  // kutunun dışına dokununca kapat + kaydet (iPad'de odak hiç alınmadıysa blur gelmez)
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      const l = live.current;
      if (!closed.current) { closed.current = true; if (timer.current) { clearTimeout(timer.current); timer.current = null; } l.onDone(l.text, original.current); }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editing]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (!editing) {
    return (
      <div role="group" aria-label="Not ekle" onClick={stop} onPointerDown={stop}
           className="note-pop-life flex items-center gap-0.5 rounded-full border bg-surface p-0.5 text-text-primary shadow-lg">
        <button type="button" onClick={onStartEdit}
                className="flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium hover:bg-surface-muted"
                aria-label={ann.note_content ? "Notu düzenle" : "Bu vurguya not ekle"}>
          <PenLine size={16} aria-hidden className="text-accent-purple" /> Not
        </button>
        <button type="button" onClick={onMore} aria-label="Rengi değiştir ya da sil" title="Rengi değiştir ya da sil"
                className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-muted">
          <MoreHorizontal size={18} aria-hidden />
        </button>
      </div>
    );
  }

  const finish = () => {
    if (closed.current) return;
    closed.current = true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    onDone(text, original.current);
  };
  return (
    <div ref={rootRef} onClick={stop} onPointerDown={stop}
         className="w-[min(280px,80vw)] rounded-xl border bg-surface p-1.5 text-text-primary shadow-xl">
      <label htmlFor={`note-pop-${ann.id}`} className="sr-only">Not metni, sayfa {ann.page_number}</label>
      <textarea id={`note-pop-${ann.id}`} ref={taRef} value={text} rows={3}
                placeholder="Notunu yaz… (kalemle de yazabilirsin)"
                onChange={(e) => {
                  const v = e.target.value;
                  setText(v);
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(() => { timer.current = null; onSave(v); }, AUTOSAVE_MS);
                }}
                onBlur={finish}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault(); e.stopPropagation();
                    closed.current = true;
                    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
                    onCancel(original.current);
                  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault(); (e.target as HTMLTextAreaElement).blur();
                  }
                }}
                className="block w-full resize-none rounded-lg bg-surface-muted p-2 text-[15px] leading-snug outline-none focus:ring-2 focus:ring-accent-purple/40" />
      <p className="px-1 pt-1 text-xs text-text-secondary">Kendiliğinden kaydedilir · Esc ile vazgeç</p>
    </div>
  );
}
