// Minimal service worker: enables "install to home screen". The app needs a
// live connection to be useful, so we use a network-first strategy and only
// fall back to a cached app shell for navigations when offline.
const CACHE = "werejugo-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Never intercept API or upload traffic.
  if (req.method !== "GET" || new URL(req.url).pathname.startsWith("/api")) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/")));
  }
});
