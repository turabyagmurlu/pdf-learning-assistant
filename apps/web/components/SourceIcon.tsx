"use client";
import { FileText, FileSpreadsheet, Presentation, Globe, StickyNote, BookOpen, FileCode, Mic } from "lucide-react";
import { YoutubeIcon } from "@/components/YoutubeAdd";

/** Kaynak turune gore simge + renk. */
export function sourceColor(kind?: string | null) {
  switch (kind) {
    case "youtube": return "text-red-600";
    case "audio": return "text-violet-600";
    case "docx": return "text-blue-600";
    case "xlsx": case "csv": return "text-emerald-600";
    case "pptx": return "text-orange-600";
    case "web": case "html": return "text-sky-600";
    case "text": case "md": case "txt": case "rtf": return "text-amber-600";
    case "epub": return "text-fuchsia-600";
    default: return "text-accent-purple";
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
