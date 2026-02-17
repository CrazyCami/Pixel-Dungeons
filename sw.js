const CACHE_VERSION = "pixel-dungeons-v2";
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const pageCache = await caches.open(PAGE_CACHE);
    await pageCache.addAll(["./", "./index.html", "./src/main.js"]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => !name.startsWith(CACHE_VERSION))
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

function shouldCacheAsset(requestUrl) {
  const pathname = requestUrl.pathname.toLowerCase();
  return (
    pathname.endsWith(".png")
    || pathname.endsWith(".jpg")
    || pathname.endsWith(".jpeg")
    || pathname.endsWith(".webp")
    || pathname.endsWith(".json")
    || pathname.endsWith(".csv")
    || pathname.endsWith(".js")
    || pathname.endsWith(".mjs")
    || pathname.endsWith(".css")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(PAGE_CACHE);
      try {
        const fresh = await fetch(request);
        cache.put(request, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        const shell = await cache.match("./index.html");
        if (shell) return shell;
        return new Response("Offline", {
          status: 503,
          statusText: "Offline",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })());
    return;
  }

  if (!shouldCacheAsset(requestUrl)) return;
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      throw new Error(`Asset unavailable: ${request.url}`);
    }
  })());
});
