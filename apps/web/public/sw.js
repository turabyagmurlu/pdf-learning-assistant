/* TY PDF service worker — yüklenebilirlik + hafif önbellek + çevrimdışı yanıtı.
 *
 * - Sayfa gezinmeleri (HTML): önce ağ; ağ yoksa aynı sayfanın önbellekteki kabuğu,
 *   o da yoksa basit "İnternet bağlantısı yok · Tekrar dene" sayfası.
 * - /_next/static (adı içerik özetli, değişmez): önce önbellek.
 * - İkon / manifest: önbellekten hemen, arkada tazele (stale-while-revalidate).
 * - pdf.js worker (unpkg, sürüm numaralı adres, değişmez): önce önbellek; ikinci
 *   PDF açılışında ağ gerekmez.
 * - API ve PDF dosyaları (başka köken) hiç ele alınmaz; her zaman ağdan gelir.
 * - Next RSC istekleri ele alınmaz: çevrimdışıyken Next tam sayfa yüklemeye düşer,
 *   o da yukarıdaki çevrimdışı yanıtına gelir.
 *
 * - Web Share Target (Android): manifest `share_target` POST /share'i buraya getirir;
 *   form verisi (başlık, metin, link, dosyalar) "typdf-share" önbelleğine yazılır ve
 *   /share?received=1 sayfasına yönlendirilir; sayfa bunları okuyup kaynak olarak ekler.
 *   iOS Safari paylaşım hedefini desteklemez (orada "Panodan yapıştır" kullanılır).
 *
 * Yeni sürümde VERSION'ı artır: eski kabuk/statik önbellekleri activate'te silinir.
 * "typdf-audio" (defterdeki sesli özet önbelleği) ASLA silinmez.
 */
const VERSION = "v4";
const STATIC = `typdf-static-${VERSION}`;
const PAGES = `typdf-pages-${VERSION}`;
const CDN = "typdf-cdn-v1";            // sürümlü üçüncü taraf dosyalar (pdf.js worker)
const SHARE = "typdf-share";           // paylaşım hedefinden gelen geçici veri
const KEEP = new Set([STATIC, PAGES, CDN, SHARE, "typdf-audio"]);
const SHELL = ["/notebooks", "/library", "/search"];
const PAGE_LIMIT = 40;

const OFFLINE_HTML = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Çevrimdışı · TY PDF</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
       font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#FAF8F4;color:#1F1D1A;
       padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom))}
  @media (prefers-color-scheme:dark){body{background:#0F1420;color:#E9E7E2}p{color:#A6A29A}}
  main{max-width:360px;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:0 0 1.25rem;color:#5F5A52}
  button{min-height:48px;padding:0 1.5rem;border:0;border-radius:12px;background:#5B4BD6;color:#fff;font:inherit;font-weight:600;cursor:pointer}
  button:focus-visible{outline:3px solid #A99CFF;outline-offset:3px}
</style></head>
<body><main>
  <h1>İnternet bağlantısı yok</h1>
  <p>Bu sayfa çevrimdışıyken açılamıyor. Bağlantın gelince tekrar dene; kaynakların ve notların güvende.</p>
  <button type="button" onclick="location.reload()">Tekrar dene</button>
</main>
<script>addEventListener("online",function(){location.reload()})</script>
</body></html>`;

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503, statusText: "Offline",
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // temel sayfa kabuklarini onceden al (basarisiz olursa kurulum yine tamamlanir)
  e.waitUntil(
    caches.open(PAGES).then((c) =>
      Promise.all(SHELL.map((u) => fetch(u, { credentials: "same-origin" })
        .then((r) => (r.ok ? c.put(u, r) : null)).catch(() => null)))
    ).catch(() => null)
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("typdf") && !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  try {
    const c = await caches.open(cacheName);
    const keys = await c.keys();
    for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
  } catch (_) { /* yoksay */ }
}

async function networkFirstPage(req) {
  const url = new URL(req.url);
  const key = url.origin + url.pathname;          // sorgu parametreleri (?page=, ?from=) ayni kabuk
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") {
      const copy = res.clone();
      caches.open(PAGES).then((c) => c.put(key, copy)).then(() => trim(PAGES, PAGE_LIMIT));
    }
    return res;
  } catch (_) {
    const hit = await caches.match(key, { cacheName: PAGES });
    return hit || offlineResponse();
  }
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req, { cacheName });
  if (hit) return hit;
  const res = await fetch(req);
  // opak (no-cors) yanitlar da saklanabilir; hatali yanit saklanmaz
  if (res.ok || res.type === "opaque") {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy));
  }
  return res;
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(STATIC);
  const hit = await c.match(req);
  const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

/* Paylaşım hedefi: POST /share (multipart) -> önbelleğe yaz -> 303 /share?received=1 */
async function handleShare(req) {
  try {
    const fd = await req.formData();
    const c = await caches.open(SHARE);
    // eski paylaşım kalıntılarını temizle
    for (const k of await c.keys()) await c.delete(k);
    const meta = { title: String(fd.get("title") || ""), text: String(fd.get("text") || ""),
                   url: String(fd.get("url") || ""), files: [], at: Date.now() };
    const files = fd.getAll("files");
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f || typeof f === "string" || !f.size) continue;
      const key = `/share/file/${i}`;
      await c.put(key, new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream" } }));
      meta.files.push({ key, name: f.name || `paylasim-${i + 1}`, type: f.type || "", size: f.size });
    }
    await c.put("/share/meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
  } catch (_) { /* okunamadıysa sayfa boş açılır, kullanıcı elle ekler */ }
  return Response.redirect("/share?received=1", 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === "POST" && url.origin === self.location.origin && url.pathname === "/share") {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== "GET") return;

  // pdf.js worker (ve ayni paketteki cmap/font dosyalari): surumlu adres, degismez
  if (url.origin === "https://unpkg.com" && url.pathname.startsWith("/pdfjs-dist@")) {
    e.respondWith(cacheFirst(req, CDN).catch(() => Response.error()));
    return;
  }

  // diger kokenler (API, PDF dosyalari, YouTube...) dokunulmaz
  if (url.origin !== self.location.origin) return;

  // sayfa gezinmesi (HTML)
  if (req.mode === "navigate") {
    e.respondWith(networkFirstPage(req));
    return;
  }

  // Next RSC / onbellege alinmamasi gerekenler
  if (url.searchParams.has("_rsc") || req.headers.get("RSC") === "1") return;

  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(cacheFirst(req, STATIC));
    return;
  }
  if (url.pathname === "/icon" || url.pathname === "/apple-icon" || url.pathname === "/manifest.webmanifest" ||
      url.pathname.startsWith("/brand-")) {
    e.respondWith(staleWhileRevalidate(req));
  }
});
