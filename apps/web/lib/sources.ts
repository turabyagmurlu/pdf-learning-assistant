/** Desteklenen kaynak turleri (yukleme ve gosterim icin tek yer). */
export const ACCEPT =
  ".pdf,.docx,.xlsx,.xlsm,.csv,.tsv,.pptx,.md,.markdown,.txt,.rtf,.epub,.html,.htm," +
  "application/pdf,text/plain,text/markdown,text/csv";

const EXT = ["pdf", "docx", "xlsx", "xlsm", "csv", "tsv", "pptx", "md", "markdown", "txt", "rtf", "epub", "html", "htm"];
const OLD: Record<string, string> = {
  doc: "Word .doc eski biçim; Word'de 'Farklı kaydet → .docx' yapıp yükle.",
  xls: "Excel .xls eski biçim; '.xlsx' olarak kaydedip yükle.",
  ppt: "PowerPoint .ppt eski biçim; '.pptx' olarak kaydedip yükle.",
};

export function fileExt(name: string) {
  const i = (name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
/** null -> kabul; string -> neden kabul edilmedigi */
export function rejectReason(f: File): string | null {
  const e = fileExt(f.name);
  if (EXT.includes(e) || f.type === "application/pdf") return null;
  return OLD[e] || `“${f.name}” desteklenmiyor.`;
}

export const KIND_LABEL: Record<string, string> = {
  pdf: "PDF", youtube: "Video", docx: "Word", xlsx: "Excel", csv: "Tablo", pptx: "Sunum",
  md: "Markdown", txt: "Metin", rtf: "Metin", epub: "E-kitap", html: "Web", web: "Web", text: "Not",
};

export const TYPES_HINT = "PDF · Word · Excel/CSV · PowerPoint · Markdown/TXT/RTF · EPUB · HTML";
