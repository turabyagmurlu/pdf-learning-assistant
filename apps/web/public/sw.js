/* TY PDF service worker — yüklenebilirlik + hafif önbellek.
   Uygulama kabuğu (JS/CSS/ikon) cache-first, API ve PDF'ler her zaman ağdan. */
const CACHE = "typdf-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // sadece kendi origin'imiz; API/PDF/onrender istekleri dokunulmaz
  if (url.origin !== self.location.origin) return;
  const isShell = url.pathname.startsWith("/_next/static/") || url.pathname === "/icon" ||
                  url.pathname === "/apple-icon" || url.pathname === "/manifest.webmanifest";
  if (!isShell) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
