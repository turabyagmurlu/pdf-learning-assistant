"use client";
import { FileText, FileSpreadsheet, Presentation, Globe, StickyNote, BookOpen, FileCode, Mic } from "lucide-react";
import { YoutubeIcon } from "@/components/YoutubeAdd";

/** Kaynak turune gore simge + renk. */
export function sourceColor(kind?: string | null) {
  // Acik temada >= 4.5:1 (700 tonlari), koyu temada 300 tonlari (WCAG AA; rozet yazilari 11-12px).
  switch (kind) {
    case "youtube": return "text-red-700 dark:text-red-300";
    case "audio": return "text-violet-700 dark:text-violet-300";
    case "docx": return "text-blue-700 dark:text-blue-300";
    case "xlsx": case "csv": return "text-emerald-700 dark:text-emerald-300";
    case "pptx": return "text-orange-700 dark:text-orange-300";
    case "web": case "html": return "text-sky-700 dark:text-sky-300";
    case "text": case "md": case "txt": case "rtf": return "text-amber-800 dark:text-amber-300";
    case "epub": return "text-fuchsia-700 dark:text-fuchsia-300";
    default: return "text-accent-purple";
  }
}

/** Kart kapagi icin acik ton (karanlik modda saydam) */
export function sourceTint(kind?: string | null) {
  switch (kind) {
    case "youtube": return "bg-red-100 dark:bg-red-500/15";
    case "audio": return "bg-violet-100 dark:bg-violet-500/15";
    case "docx": return "bg-blue-100 dark:bg-blue-500/15";
    case "xlsx": case "csv": return "bg-emerald-100 dark:bg-emerald-500/15";
    case "pptx": return "bg-orange-100 dark:bg-orange-500/15";
    case "web": case "html": return "bg-sky-100 dark:bg-sky-500/15";
    case "text": case "md": case "txt": case "rtf": return "bg-amber-100 dark:bg-amber-500/15";
    case "epub": return "bg-fuchsia-100 dark:bg-fuchsia-500/15";
    default: return "bg-violet-100 dark:bg-violet-500/15";
  }
}

export function sourceLabel(kind?: string | null, pages?: number | null) {
  switch (kind) {
    case "youtube": return "Video";
    case "audio": return "Ses kaydı";
    case "docx": return "Word";
    case "xlsx": return "Excel";
    case "csv": return "CSV";
    case "pptx": return "Sunum";
    case "web": case "html": return "Web";
    case "text": return "Yapıştırılan metin";
    case "md": return "Markdown";
    case "txt": case "rtf": return "Metin";
    case "epub": return "E-kitap";
    case "image": return "Görsel";
    default: return pages ? `PDF · ${pages} s.` : "PDF";
  }
}

export default function SourceIcon({ kind, size = 16, className = "" }: { kind?: string | null; size?: number; className?: string }) {
  const c = "shrink-0 " + sourceColor(kind) + " " + className;
  switch (kind) {
    case "youtube": return <YoutubeIcon size={size} className={c} />;
    case "audio": return <Mic size={size} className={c} />;
    case "xlsx": case "csv": return <FileSpreadsheet size={size} className={c} />;
    case "pptx": return <Presentation size={size} className={c} />;
    case "web": case "html": return <Globe size={size} className={c} />;
    case "text": return <StickyNote size={size} className={c} />;
    case "md": return <FileCode size={size} className={c} />;
    case "epub": return <BookOpen size={size} className={c} />;
    default: return <FileText size={size} className={c} />;
  }
}
