// pdf.js worker'ini paketten public/ altina kopyalar (TK-6: ucuncu taraf CDN'e bagimlilik yok).
// `npm install` sonrasi otomatik calisir (package.json "postinstall"); elle: `node scripts/copy-worker.mjs`.
// pdfjs-dist, react-pdf ile birlikte gelir; surumu react-pdf belirler.
// Kaynak: node_modules/pdfjs-dist/build/pdf.worker.min.mjs (v4+) ya da pdf.worker.min.js (eski surumler).
// Hedef: public/pdf.worker.min.mjs (PdfReader: pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs").
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const publicDir = join(root, "public");

// pdfjs-dist react-pdf'in bagimliligi: once dogrudan, olmazsa react-pdf uzerinden bul.
function findBuildDir() {
  const req = createRequire(join(root, "package.json"));
  const tries = [
    () => dirname(req.resolve("pdfjs-dist/package.json")),
    () => {
      const rp = dirname(req.resolve("react-pdf/package.json"));
      const nested = join(rp, "node_modules", "pdfjs-dist");
      if (existsSync(join(nested, "package.json"))) return nested;
      const r2 = createRequire(join(rp, "package.json"));
      return dirname(r2.resolve("pdfjs-dist/package.json"));
    },
  ];
  for (const t of tries) {
    try {
      const d = join(t(), "build");
      if (existsSync(d)) return d;
    } catch { /* siradakini dene */ }
  }
  return null;
}

const build = findBuildDir();
if (!build) {
  console.warn("[copy-worker] pdfjs-dist bulunamadı; worker kopyalanmadı (npm install tamamlandı mı?).");
  process.exit(0);
}

const candidates = ["pdf.worker.min.mjs", "pdf.worker.mjs", "pdf.worker.min.js", "pdf.worker.js"];
const src = candidates.map((n) => join(build, n)).find((p) => existsSync(p));
if (!src) {
  console.warn(`[copy-worker] ${build} içinde worker dosyası yok: ${readdirSync(build).join(", ")}`);
  process.exit(0);
}

mkdirSync(publicDir, { recursive: true });
// Eski kopyalar kalmasin (surum degisince farkli ad olabilir)
for (const n of candidates) {
  const p = join(publicDir, n);
  if (existsSync(p)) unlinkSync(p);
}
// Hedef adi sabit: react-pdf 9 / pdfjs-dist 4 yalniz .mjs uretir; eski bir surum .js verirse de ayni adla
// sunulur (PdfReader tek bir yola bakar). Uyumsuzluk cikarsa react-pdf surumuyle birlikte burasi guncellenir.
const dest = join(publicDir, "pdf.worker.min.mjs");
copyFileSync(src, dest);
console.log(`[copy-worker] ${src} -> ${dest}`);
