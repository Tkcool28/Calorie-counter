const CACHE = "calorie-quest-v9"; // Updated version
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./sw.js"
];

// Install: cache core
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE))
  );
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));
      await self.clients.claim();
    })()
  );
});

// Fetch strategy:
// - Navigation (HTML): network-first (so updates appear)
// - Static files: cache-first + background refresh
// - API calls: network-only (never cache API responses)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Don't intercept cross-origin requests (API calls, external resources)
  if (url.origin !== location.origin) {
    // Let browser handle external requests naturally
    return;
  }

  // Network-first for navigation
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match("./index.html");
          return cached || new Response("Offline", { status: 200 });
        }
      })()
    );
    return;
  }

  // Cache-first for assets
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const cache = await caches.open(CACHE);

      const fetchAndUpdate = fetch(req)
        .then((res) => {
          // Only cache good responses
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      // Return cached immediately, refresh in background
      if (cached) {
        event.waitUntil(fetchAndUpdate);
        return cached;
      }

      // No cache: use network
      const fresh = await fetchAndUpdate;
      return fresh || new Response("Offline", { status: 200 });
    })()
  );
});
