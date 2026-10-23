/* Offline cache for the web version, named after the version in version.js. Map tiles live in their own cache ("wander-tiles"), managed by the app. */
importScripts("version.js");
const VERSION = "wander-shell-" + self.WANDER_VERSION;
const SHELL = ["./", "index.html", "app.js", "cards.js", "ui.js", "core.js", "version.js", "manifest.webmanifest",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "fonts/bricolage-grotesque.woff2", "fonts/figtree-400.woff2", "fonts/figtree-600.woff2",
  "fonts/figtree-700.woff2", "fonts/figtree-800.woff2", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("wander-shell-") && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
