/* wenFSD service worker — minimal, network-FIRST.
 * Purpose: make the site installable (PWA / "Add to Home Screen") and resilient offline.
 * Deliberately network-first so we never serve stale JS/CSS (the app ships fresh code often);
 * the cache is only a fallback when the network is unavailable. */
const CACHE = "wenfsd-v1";
const SHELL = ["/", "/styles.css"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                       // never cache writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // only our own origin
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return; // never cache API/auth
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (req.mode === "navigate" || SHELL.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
  );
});
