/**
 * Desteklenen kaynak turleri (yukleme ve gosterim icin tek yer).
 * Uzanti listeleri tek kaynaktan turetilir; ACCEPT (input accept=) ve rejectReason ayni listeyi kullanir.
 */
const DOC_EXT = ["pdf", "docx", "xlsx", "xlsm", "csv", "tsv", "pptx", "md", "markdown", "txt", "rtf", "epub", "html", "htm"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif"];
const AUDIO_EXT = ["mp3", "m4a", "wav", "ogg", "oga", "opus", "aac", "flac", "webm", "amr", "3gp"];
const EXT = [...DOC_EXT, ...IMAGE_EXT, ...AUDIO_EXT];

export const ACCEPT =
  EXT.map((e) => "." + e).join(",") + ",application/pdf,text/plain,text/markdown,text/csv,image/*,audio/*";
const OLD: Record<string, string> = {
  doc: "Word .doc eski biçim; Word'de 'Farklı kaydet → .docx' yapıp yükle.",
  xls: "Excel .xls eski biçim; '.xlsx' olarak kaydedip yükle.",
  ppt: "PowerPoint .ppt eski biçim; '.pptx' olarak kaydedip yükle.",
};

/** Sunucudaki sinirlarla ayni (api config.max_upload_mb=50, ses 100). */
export const MAX_MB = 50;
export const AUDIO_MAX_MB = 100;

function fileExt(name: string) {
  const i = (name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
/** null -> kabul; string -> neden kabul edilmedigi (tur ya da boyut; yuklemeden once) */
export function rejectReason(f: File): string | null {
  const e = fileExt(f.name);
  const isAudio = AUDIO_EXT.includes(e) || f.type.startsWith("audio/");
  const ok = EXT.includes(e) || f.type === "application/pdf" || f.type.startsWith("image/") || isAudio;
  if (!ok) return OLD[e] || `“${f.name}” desteklenmiyor. ${TYPES_HINT} yükleyebilirsin.`;
  const max = isAudio ? AUDIO_MAX_MB : MAX_MB;
  if (f.size > max * 1024 * 1024) {
    const mb = Math.round(f.size / (1024 * 1024));
    return `“${f.name}” çok büyük (${mb} MB). En fazla ${max} MB yükleyebilirsin; dosyayı bölerek ya da sıkıştırarak dene.`;
  }
  return null;
}

export const KIND_LABEL: Record<string, string> = {
  pdf: "PDF", youtube: "Video", docx: "Word", xlsx: "Excel", csv: "Tablo", pptx: "Sunum",
  md: "Markdown", txt: "Metin", rtf: "Metin", epub: "E-kitap", html: "Web", web: "Web",
  text: "Yapıştırılan metin", audio: "Ses kaydı", image: "Görsel",
};

export const TYPES_HINT = "PDF · Word · Excel/CSV · PowerPoint · Markdown/TXT · EPUB · HTML · Fotoğraf/taranmış sayfa · Ses kaydı";
/** Boyut siniri dahil kisa ipucu (yukleme alanlarinin altinda) */
export const LIMIT_HINT = `En fazla ${MAX_MB} MB (ses kaydı ${AUDIO_MAX_MB} MB)`;
