// Network-first service worker: always fresh online, still opens offline (last good copy).
const CACHE = "commute-v2";
const SHELL = ["./", "app.css", "app.js", "manifest.webmanifest", "icon-192.png",
               "vendor/leaflet/leaflet.css", "vendor/leaflet/leaflet.js",
               "../fonts/SpaceGrotesk-var.woff2", "../fonts/JetBrainsMono-var.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
