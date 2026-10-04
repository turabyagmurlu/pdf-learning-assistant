/**
 * Ses için tek kaynak (T5-ses 2.1 / 2.7 / 2.8):
 *  - SPEEDS + tek hız anahtarı (`audio.speed`; eski `lecture.speed`/`reader.rate` bir kez taşınır)
 *  - ttsPrepareClient(): sunucudaki `tts_prepare`'in TS kopyası — cihaz sesine (Web Speech) giden
 *    her metin buradan geçer (tire, atıf, şekil/tablo, kısaltma, sayı → yazı, noktalama)
 *  - splitSentencesSafe(): kısaltma güvenli cümle bölme (cihaz sesi, cümle vurgusu)
 *  - deriveChapters(): paragraf bazlı bölümler (kota 0) ve zaman eşlemesi
 *  - LISTEN_EVENT / requestListen(): "Sesli dinle" olayı (Sor cevabı → ListenDock)
 */

export const SPEEDS = [0.8, 0.9, 1, 1.15, 1.3, 1.5];
export const SPEED_KEY = "audio.speed";

export function loadSpeed(): number {
  if (typeof window === "undefined") return 1;
  try {
    const v = parseFloat(localStorage.getItem(SPEED_KEY) || "");
    if (v > 0) return nearestSpeed(v);
    // eski anahtarlardan bir kez taşı
    const old = parseFloat(localStorage.getItem("lecture.speed") || localStorage.getItem("reader.rate") || "");
    if (old > 0) { const n = nearestSpeed(old); localStorage.setItem(SPEED_KEY, String(n)); return n; }
  } catch {}
  return 1;
}
export function saveSpeed(n: number) {
  try { localStorage.setItem(SPEED_KEY, String(n)); } catch {}
}
export function nearestSpeed(v: number): number {
  return SPEEDS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), SPEEDS[0]);
}

// ---- "Sesli dinle" olayı ---------------------------------------------------------------------
export const LISTEN_EVENT = "typdf:listen";
export type ListenRequest = { text: string; title?: string; subtitle?: string; voice?: string; device?: boolean; id?: string };
/** Herhangi bir yerden: `requestListen({ text, title })` → ListenDock metni hazırlar ve çalar. Tıklama içinde çağır. */
export function requestListen(req: ListenRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ListenRequest>(LISTEN_EVENT, { detail: req }));
}

// ---- Sayı → Türkçe yazı ------------------------------------------------------------------------
const ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
const SCALES: [number, string][] = [[1e12, "trilyon"], [1e9, "milyar"], [1e6, "milyon"], [1000, "bin"]];
const VOWELS = "aeıioöuü";

function under1000(n: number): string {
  const out: string[] = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) out.push(h === 1 ? "yüz" : ONES[h] + " yüz");
  const t = Math.floor(r / 10), o = r % 10;
  if (t) out.push(TENS[t]);
  if (o) out.push(ONES[o]);
  return out.join(" ");
}
export function numToWords(n: number): string {
  if (!isFinite(n)) return String(n);
  if (n < 0) return "eksi " + numToWords(-n);
  if (n === 0) return "sıfır";
  if (n >= 1e15) return String(n);
  const parts: string[] = [];
  for (const [val, name] of SCALES) {
    const q = Math.floor(n / val); n = n % val;
    if (q) parts.push(q === 1 && val === 1000 ? name : under1000(q) + " " + name);
  }
  if (n) parts.push(under1000(n));
  return parts.join(" ");
}
function lastVowel(w: string) { for (let i = w.length - 1; i >= 0; i--) if (VOWELS.includes(w[i])) return w[i]; return "e"; }
function harmony(v: string) { return "aı".includes(v) ? "ı" : "ei".includes(v) ? "i" : "ou".includes(v) ? "u" : "ü"; }
export function ordinalWords(n: number): string {
  let w = numToWords(n);
  if (w.endsWith("dört")) w = w.slice(0, -1) + "d";
  const hv = harmony(lastVowel(w));
  return VOWELS.includes(w[w.length - 1]) ? w + "nc" + hv : w + hv + "nc" + hv;
}
const words = (s: string) => { const n = parseInt(s, 10); return isNaN(n) ? s : numToWords(n); };
const soften = (w: string, suffix: string) => (suffix && VOWELS.includes(suffix[0]) && w.endsWith("dört") ? w.slice(0, -1) + "d" : w);

// ---- Kurallar (sunucu `tts_prepare` ile aynı sıra) -------------------------------------------
const L = "a-zçğıöşüâîû", U = "A-ZÇĞİÖŞÜÂÎÛ";
/** JS'te \b yalnız ASCII sınırıdır: Ö/Ü/İ/Ç/Ş ile başlayan kısaltmalar için sınır elle kurulur (lookbehind yok). */
function abbr(src: string, rep: string): [RegExp, string] {
  if (/^\\b[^\x00-\x7f]/.test(src)) return [new RegExp("(^|[^\\p{L}\\p{N}])" + src.slice(2), "gu"), "$1" + rep];
  return [new RegExp(src, "gu"), rep];
}
const ABBREV: [RegExp, string][] = [
  abbr(String.raw`\bProf\.\s*Dr\.`, "Profesör Doktor"),
  abbr(String.raw`\bDoç\.\s*Dr\.`, "Doçent Doktor"),
  abbr(String.raw`\bYrd\.\s*Doç\.(\s*Dr\.)?`, "Yardımcı Doçent"),
  abbr(String.raw`\bÖğr\.\s*Gör\.`, "Öğretim Görevlisi"),
  abbr(String.raw`\bArş\.\s*Gör\.`, "Araştırma Görevlisi"),
  abbr(String.raw`\bProf\.`, "Profesör"),
  abbr(String.raw`\bDoç\.`, "Doçent"),
  abbr(String.raw`\bDr\.`, "Doktor"),
  abbr(String.raw`\bAv\.`, "Avukat"),
  abbr(String.raw`\bUzm\.`, "Uzman"),
  abbr(String.raw`\bM\.\s*Ö\.|\bMÖ\b(?=\s*\d)`, "milattan önce"),
  abbr(String.raw`\bM\.\s*S\.|\bMS\b(?=\s*\d)`, "milattan sonra"),
  abbr(String.raw`\bT\.\s*C\.`, "Türkiye Cumhuriyeti"),
  abbr(String.raw`\bHz\.`, "Hazreti"),
  abbr(String.raw`\bvb\.|\bv\.b\.|\bvb\b`, "ve benzeri"),
  abbr(String.raw`\bvs\.|\bv\.s\.|\bvs\b`, "vesaire"),
  abbr(String.raw`\bvd\.`, "ve diğerleri"),
  abbr(String.raw`\bve\s+ark\.`, "ve arkadaşları"),
  abbr(String.raw`\bark\.`, "arkadaşları"),
  abbr(String.raw`\byy\.`, "yüzyıl"),
  abbr(String.raw`\börn\.|\bör\.`, "örneğin"),
  abbr(String.raw`\byak\.`, "yaklaşık"),
  abbr(String.raw`\bkrş\.`, "karşılaştır"),
  abbr(String.raw`\bçev\.`, "çeviren"),
  abbr(String.raw`\bed\.`, "editör"),
  abbr(String.raw`\bhaz\.`, "hazırlayan"),
  abbr(String.raw`\byay\.`, "yayınları"),
  abbr(String.raw`\bYay\.`, "Yayınları"),
  abbr(String.raw`\bÜniv\.`, "Üniversitesi"),
  abbr(String.raw`\bFak\.`, "Fakültesi"),
  abbr(String.raw`\bEnst\.`, "Enstitüsü"),
  abbr(String.raw`\bAns\.`, "Ansiklopedisi"),
  abbr(String.raw`\bBöl\.|\bBl\.`, "Bölüm"),
  abbr(String.raw`\bmad\.|\bmd\.`, "madde"),
  abbr(String.raw`\bc\.(?=\s*\d)`, "cilt"),
  abbr(String.raw`\bNo\.|\bNr\.`, "numara"),
  abbr(String.raw`\bTel\.`, "telefon"),
  abbr(String.raw`\bCad\.`, "Caddesi"),
  abbr(String.raw`\bSok\.|\bSk\.`, "Sokak"),
  abbr(String.raw`\bMah\.`, "Mahallesi"),
  abbr(String.raw`\bApt\.`, "Apartmanı"),
  abbr(String.raw`\bBulv\.`, "Bulvarı"),
  abbr(String.raw`\bdk\.`, "dakika"),
  abbr(String.raw`\bsn\.`, "saniye"),
  abbr(String.raw`\bSn\.`, "Sayın"),
  abbr(String.raw`\bsa\.(?=\s*\d)`, "saat"),
  abbr(String.raw`\bİng\.`, "İngilizce"),
  abbr(String.raw`\bFr\.`, "Fransızca"),
  abbr(String.raw`\bAlm\.`, "Almanca"),
  abbr(String.raw`\bLat\.`, "Latince"),
  abbr(String.raw`\bAr\.`, "Arapça"),
  abbr(String.raw`\bFar\.`, "Farsça"),
  abbr(String.raw`\bOsm\.`, "Osmanlıca"),
  abbr(String.raw`\bYun\.`, "Yunanca"),
  abbr(String.raw`(\d)\s*km²`, "$1 kilometrekare"),
  abbr(String.raw`(\d)\s*m²`, "$1 metrekare"),
  abbr(String.raw`(\d)\s*km\b`, "$1 kilometre"),
  abbr(String.raw`(\d)\s*cm\b`, "$1 santimetre"),
  abbr(String.raw`(\d)\s*mm\b`, "$1 milimetre"),
  abbr(String.raw`(\d)\s*kg\b`, "$1 kilogram"),
  abbr(String.raw`(\d)\s*°C`, "$1 derece"),
  abbr(String.raw`(\d)\s*TL\b`, "$1 lira"),
  abbr(String.raw`\bTL\b`, "lira"),
  abbr(String.raw`%\s*(\d)`, "yüzde $1"),
  abbr(String.raw`(\d)\s*%`, "$1 yüzde"),
];
const EXPANDED_APOS = new RegExp(`\\b(yüzyıl|lira|derece|kilometrekare|metrekare|kilometre|santimetre|milimetre|kilogram|dakika|saniye|saat|madde|cilt|numara)['’]([${L}]+)`, "g");
const ORDINAL_CAPS = new Set(["Dünya", "Cumhuriyet", "Meşrutiyet", "Bölüm", "Kısım", "Madde", "Yüzyıl", "Ordu", "Haçlı", "Murat", "Mehmet", "Selim",
  "Bayezid", "Beyazıt", "Ahmet", "Mustafa", "Osman", "Abdülhamit", "Abdülhamid", "Mahmut", "Süleyman", "Kolordu", "Tümen", "Sınıf", "Kat", "Ünite",
  "Basamak", "Fasıl", "Perde", "Sahne", "Cilt", "Baskı", "Aşama", "Adım", "Evre", "Nesil", "Kuşak", "Dönem", "Yarıyıl", "Çeyrek", "Yarı", "Tur", "Lig",
  "Dalga", "Kongre", "Kurultay", "Sezon"]);
const MARK = "⁣";
const mark = (s: string) => MARK + s + MARK;

function isHeadingLine(s: string) {
  s = s.trim(); if (s.length > 80) return false;
  const letters = s.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && letters === letters.toLocaleUpperCase("tr");
}
function cleanLines(text: string): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const ln = raw.replace(/\s+$/, "");
    if (!ln.trim()) { out.push(""); continue; }
    if (/^\s*[-–]?\s*\d{1,4}\s*[-–]?\s*$/.test(ln) || /ISSN|ISBN|DOI\b|doi:|https?:\/\/|www\./i.test(ln) || /\||\t.*\t/.test(ln)
        || /^\s*(?:[-+]?\d[\d.,%]*\s+){3,}[-+]?\d[\d.,%]*\s*$/.test(ln) || /^\s*(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\d{1,2}\s*[)\]])\s*\S/.test(ln) || isHeadingLine(ln)) continue;
    let s = ln.replace(/^\s*#{1,6}\s*/, "");
    const m = s.match(/^\s*(\d{1,2})[.)]\s+(\S+)/);
    if (!(m && ORDINAL_CAPS.has(m[2]))) s = s.replace(/^\s*(?:\d{1,2}[.)]|[-–•*▪●])\s+/, "");
    out.push(s);
  }
  return out.join("\n");
}
function dehyphenate(t: string) {
  return t.replace(/(\w)-\s*\n\s*(\w)/g, "$1$2").replace(new RegExp(`([${L}])-\\s+([${L}])`, "g"), "$1$2").replace(new RegExp(`([${L}])-([${L}])`, "g"), "$1$2");
}
function stripCitations(t: string) {
  return t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, "")
    .replace(/\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\]/g, "")
    .replace(/\(\s*\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*\s*\)/g, "")
    .replace(/\(\s*(\d{4})\s*[-–]\s*(\d{4})\s*\)/g, ", $1-$2,")
    .replace(new RegExp(`\\(\\s*(?:[${U}][^()]{0,40}?,?\\s*(?:vd\\.|ve ark\\.|et al\\.?)?\\s*,?\\s*\\d{4}[a-z]?(?:\\s*[:;,]\\s*[\\d\\s,;–-]+)?)(?:\\s*;[^()]{1,60})*\\s*\\)`, "g"), "")
    .replace(/\(\s*\d{4}[a-z]?(?:\s*[:;,]\s*[\d\s,;–-]+)?\s*\)/g, "")
    .replace(new RegExp(`([${L}\\)\\]"”’][.!?,;])(\\d{1,2})(?=\\s|$)`, "g"), "$1");
}
function stripVisualRefs(t: string) {
  return t.replace(/\(\s*(?:bkz\.?|bk\.|a\.g\.e\.|age\.)[^()]*\)/gi, "")
    .replace(/\b(?:bkz|bk)\.?\s*[^.;,!?\n()]*/gi, "")
    .replace(new RegExp(`(^|[^\\p{L}\\p{N}])(?:Şekil|Tablo|Grafik|Resim|Harita|Çizelge|Fotoğraf|Görsel|Diyagram)\\s*\\d+(?:\\.\\d+)?(?:['’][${L}]+)?\\s*(?:(?:görüldüğü|gösterildiği|verildiği|belirtildiği|izlendiği|özetlendiği)\\s+(?:gibi|üzere)|verilen|sunulan|gösterilen)?\\s*,?\\s*`, "giu"), "$1")
    .replace(/\b(?:ss?\.|sayfa|sf\.)\s*\d+(?:\s*[-–]\s*\d+)?\s*[.,;]?\s*/gi, "")
    .replace(/\b(?:a\.\s*g\.\s*e\.|age\.|a\.\s*g\.\s*m\.|agm\.|ibid\.?|op\.\s*cit\.)\s*/gi, "");
}
function expandAbbrev(t: string) {
  for (const [rx, rep] of ABBREV) t = t.replace(rx, rep);
  return t.replace(EXPANDED_APOS, "$1$2");
}
function numbersToWords(t: string) {
  t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, a, b) => mark(words(a) + " " + words(b)));
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+\b(?!\.\d)/g, (m) => m.replace(/\./g, ""));
  t = t.replace(/\b(\d+),(\d+)\b/g, (_m, a, b) => mark(words(a) + " virgül " + words(b)));
  t = t.replace(/\b(\d+)\.(\d+)\b/g, (_m, a, b) => mark(words(a) + " nokta " + words(b)));
  t = t.replace(/\b(\d+)\s*[-–]\s*(\d+)\b(\s+(?:arasında|arası|arasını|arasındaki|yılları|yıllarında))?/g,
    (_m, a, b, tail) => mark(`${words(a)} ile ${words(b)}`) + (tail ? tail : " arası"));
  t = t.replace(/\b(\d+)['’]?\s*(?:inci|ıncı|uncu|üncü|nci|ncı|ncu|ncü)\b/g, (_m, a) => mark(ordinalWords(parseInt(a, 10))));
  t = t.replace(new RegExp(`\\b(\\d+)\\.\\s+(?=([${U}${L}]+))`, "g"), (m: string, a: string, nxt: string) => {
    if (nxt && (nxt[0] === nxt[0].toLocaleLowerCase("tr") || ORDINAL_CAPS.has(nxt))) return mark(ordinalWords(parseInt(a, 10))) + " ";
    return m;
  });
  t = t.replace(new RegExp(`\\b(\\d+)['’]([${L}]+)`, "g"), (_m, a, suf) => mark(soften(words(a), suf) + suf));
  t = t.replace(/\b\d+\b/g, (m) => (m.length <= 15 ? mark(words(m)) : m));
  return t.split(MARK).join("");
}
const trUpper = (c: string) => (c === "i" ? "İ" : c.toLocaleUpperCase("tr"));
function punctuation(t: string) {
  t = t.replace(/[*_#`~]+/g, "").replace(/["“”«»„‟]/g, "").replace(/…|\.{3,}/g, ".").replace(/\s*[—–]\s*/g, ", ");
  t = t.replace(/\(\s*([^()]{1,160}?)\s*\)/g, ", $1,").replace(/[()\[\]{}]/g, "");
  t = t.replace(new RegExp(`:\\s+(?=[${U}])`, "g"), ". ").replace(new RegExp(`:\\s+(?=[${L}\\d])`, "g"), ", ");
  t = t.replace(new RegExp(`([${L}\\d])\\.([${U}])`, "g"), "$1. $2").replace(new RegExp(`([${L}\\d]),([${U}${L}])`, "g"), "$1, $2");
  t = t.replace(/[ \t   ]+/g, " ").replace(/\s+([.,;!?])/g, "$1").replace(/([,;])\s*(?:[,;]\s*)+/g, "$1 ").replace(/[,;]\s*([.!?])/g, "$1");
  t = t.replace(/[ \t]+/g, " ").replace(/^\s*[,;.]+\s*/, "").trim();
  t = t.replace(new RegExp(`([.!?] )([${L}])`, "g"), (_m, a, b) => a + trUpper(b));
  if (t && t[0] !== trUpper(t[0])) t = trUpper(t[0]) + t.slice(1);
  return t;
}
function prepareParagraph(p: string) {
  p = punctuation(numbersToWords(expandAbbrev(stripVisualRefs(stripCitations(p)))));
  if (p && !/[.!?]$/.test(p)) p += ".";
  return p;
}
const DIALOG_LINE = /^\s*(Ayşe|Ayse|Kerem)\s*:\s*(.*)$/i;

/** Sunucudaki `tts_prepare` ile aynı kurallar; cihaz sesine (Web Speech) giden her metin buradan geçer. */
export function ttsPrepareClient(text: string, dialog = false): string {
  text = (text || "").replace(/\r\n?/g, "\n").replace(/­/g, "");
  if (!text.trim()) return "";
  if (dialog) {
    const out: string[] = [];
    for (const ln of text.split("\n")) {
      if (!ln.trim()) continue;
      const m = ln.match(DIALOG_LINE);
      if (m) { const who = m[1].toLowerCase().startsWith("k") ? "Kerem" : "Ayşe"; const b = prepareParagraph(dehyphenate(m[2])); if (b) out.push(`${who}: ${b}`); }
      else { const b = prepareParagraph(dehyphenate(ln)); if (b) out.push(b); }
    }
    return out.join("\n");
  }
  text = dehyphenate(cleanLines(text));
  const paras: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const joined = block.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    if (!joined) continue;
    const p = prepareParagraph(joined);
    if (p && /\p{L}/u.test(p)) paras.push(p);
  }
  return paras.join("\n\n");
}

// ---- Cümle bölme (kısaltma güvenli; lookbehind yok, eski iOS Safari ile uyumlu) -------------
const ABBR_TAIL = /(?:\b(?:vb|vs|yy|Dr|Prof|Doç|bkz|örn|vd|ark|M\.Ö|M\.S)|\b\d{1,3})\.$/;
export function splitSentencesSafe(text: string, maxLen = 220): string[] {
  const out: string[] = [];
  // noktalama + boşluk + büyük harf/rakam/tırnak = aday sınır; kısaltma ya da "16." ile bitiyorsa birleştir
  const parts = ((text || "").match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) || [text]);
  let cur = "";
  for (const raw of parts) {
    const s = raw.trim(); if (!s) continue;
    cur = cur ? cur + " " + s : s;
    if (ABBR_TAIL.test(cur)) continue;              // "vb." / "16." gibi: cümle bitmedi
    push(cur); cur = "";
  }
  if (cur) push(cur);
  function push(s: string) {
    while (s.length > maxLen) {
      let cut = s.lastIndexOf(" ", maxLen); if (cut < maxLen / 2) cut = maxLen;
      out.push(s.slice(0, cut).trim()); s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

// ---- Bölümler (paragraf bazlı, kota 0) -----------------------------------------------------
export type Chapter = { chunk: number; offset: number; start: number; title: string };

export function chapterTitle(text: string, words = 6): string {
  const first = (text.trim().match(/^[^.!?]+(?:[.!?]+|$)/) || [text.trim()])[0];
  const ws = first.split(/\s+/).filter(Boolean);
  const t = ws.slice(0, words).join(" ");
  return ws.length > words ? t + "…" : t.replace(/[.!?]+$/, "");
}

/** Parça metinlerinden bölümler: tekli anlatımda her paragraf, sohbette Ayşe'nin her 3. repliği.
 *  `start`: kayıt içinde saniye (karakter orantılı; parça = paragraf sınırı olduğunda parça başı kesin). */
export function deriveChapters(chunks: { text: string }[], durations: number[], offsets: number[]): Chapter[] {
  const out: Chapter[] = [];
  chunks.forEach((c, ci) => {
    const text = c.text || ""; const dur = durations[ci] || 0; const base = offsets[ci] || 0;
    const total = Math.max(1, text.length);
    const dialog = /^\s*(Ayşe|Ayse|Kerem)\s*:/im.test(text);
    if (dialog) {
      let pos = 0, k = 0;
      for (const ln of text.split("\n")) {
        if (/^\s*ay[sş]e\s*:/i.test(ln)) {
          if (k % 3 === 0) out.push({ chunk: ci, offset: pos, start: base + (pos / total) * dur, title: chapterTitle(ln.split(":").slice(1).join(":")) });
          k++;
        }
        pos += ln.length + 1;
      }
    } else {
      let pos = 0;
      for (const para of text.split(/(\n\s*\n)/)) {
        if (para.trim()) out.push({ chunk: ci, offset: pos, start: base + (pos / total) * dur, title: chapterTitle(para) });
        pos += para.length;
      }
    }
  });
  return out.slice(0, 200);
}

// ---- Uyku zamanlayıcısı -------------------------------------------------------------------
export type SleepMode = "off" | "15" | "30" | "45" | "chapter";
export const SLEEP_OPTIONS: { id: SleepMode; label: string }[] = [
  { id: "off", label: "Kapalı" }, { id: "15", label: "15 dakika" }, { id: "30", label: "30 dakika" },
  { id: "45", label: "45 dakika" }, { id: "chapter", label: "Bölüm sonunda" },
];

// ---- İndir -------------------------------------------------------------------------------
/** Hazır parçaları tek dosyada indirir (MP3 çerçeveleri art arda eklenebilir). http adreslerine yetki başlığı eklenir. */
export async function downloadChunks(chunks: { url?: string }[], title: string, authHeader?: string): Promise<boolean> {
  const urls = chunks.map((c) => c.url).filter(Boolean) as string[];
  if (!urls.length || urls.length < chunks.length) return false;
  const blobs: Blob[] = [];
  for (const u of urls) {
    const res = await fetch(u, u.startsWith("blob:") || !authHeader ? undefined : { headers: { Authorization: authHeader } });
    if (!res.ok) return false;
    blobs.push(await res.blob());
  }
  const type = blobs[0]?.type || "audio/mpeg";
  const ext = type.includes("wav") ? "wav" : "mp3";
  const all = new Blob(blobs, { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(all);
  a.download = (title || "sesli-ozet").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) + "." + ext;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}
