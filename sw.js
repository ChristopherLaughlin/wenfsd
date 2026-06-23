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

// --- web push: show the "your update is close" notification, focus/open the app on click ---
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  const title = d.title || "wenFSD";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "Your Tesla update is getting close.",
    icon: "/icon-192.png", badge: "/icon-192.png",
    data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (c.url.indexOf(url) !== -1 && "focus" in c) return c.focus(); }
    return self.clients.openWindow ? self.clients.openWindow(url) : null;
  }));
});
