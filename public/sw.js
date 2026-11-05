// v3: network responses stream straight to the page; caching happens in the background.
// The private cache keeps its name on purpose: its contents are unchanged, and renaming it
// would make activate() delete every route saved for offline use.
const CACHE_VERSION = "finance-tracker-shell-v3";
const PRIVATE_CACHE_VERSION = "finance-tracker-private-v2";
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key !== CACHE_VERSION && key !== PRIVATE_CACHE_VERSION)
              .map((key) => caches.delete(key))
          )
        ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_PRIVATE_ROUTES") {
    event.waitUntil(caches.delete(PRIVATE_CACHE_VERSION));
  }
  if (event.data?.type === "CACHE_ROUTES" && Array.isArray(event.data.routes)) {
    event.waitUntil(cacheRoutes(event.data.routes));
  }
});

async function networkFirst(event, request, fallbackToOffline = true, cacheName = CACHE_VERSION) {
  try {
    // Next.js cancels some RSC/prefetch streams once it has what it needs. Now that the page
    // reads the stream directly, that cancel would also abort this fetch and the background
    // cache write, so offline navigation would lose those payloads. Fetch with a signal of the
    // worker's own so the body is still downloaded and cached, as it was before v3.
    // Navigation requests keep the original request: their mode can't be copied.
    const networkRequest =
      request.mode === "navigate" ? request : new Request(request, { signal: new AbortController().signal });
    const response = await fetch(networkRequest);
    if (response.ok) {
      // Return the response as soon as its headers arrive so streamed HTML/RSC reaches the
      // page chunk by chunk. cache.put() only settles after the whole body has been read, so
      // it runs in the background; waitUntil keeps the worker alive until it finishes.
      const copy = response.clone();
      event.waitUntil(
        caches
          .open(cacheName)
          .then((cache) => cache.put(request, copy))
          .catch(() => {
            // Some build-specific responses cannot be stored. The network response is still valid.
          })
      );
    }
    return response;
  } catch {
    const cache = await caches.open(cacheName);
    const cached =
      (await cache.match(request)) ||
      (request.mode === "navigate" ? await cache.match(request, { ignoreSearch: true }) : null);
    if (cached) return cached;
    if (fallbackToOffline) {
      const shell = await caches.open(CACHE_VERSION);
      return shell.match(OFFLINE_URL);
    }
    return Response.error();
  }
}

async function cacheRoutes(routes) {
  const cache = await caches.open(PRIVATE_CACHE_VERSION);
  const safeRoutes = [...new Set(routes)].filter(
    (route) => typeof route === "string" && route.startsWith("/") && !route.startsWith("//")
  );

  await Promise.all(
    safeRoutes.map(async (route) => {
      try {
        const request = new Request(route, {
          credentials: "include",
          headers: { Accept: "text/html" },
        });
        const response = await fetch(request);
        if (!response.ok || response.redirected) return;
        await cache.put(request, response.clone());

        const html = await response.text();
        const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)]
          .map((match) => match[1])
          .filter((url) => url.startsWith("/"));
        await Promise.all(
          [...new Set(assets)].map(async (asset) => {
            const assetResponse = await fetch(asset);
            if (assetResponse.ok) await cache.put(asset, assetResponse);
          })
        );
      } catch {
        // The route remains available through its existing runtime cache.
      }
    })
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const privateCache = await caches.open(PRIVATE_CACHE_VERSION);
  const cached = (await cache.match(request)) || (await privateCache.match(request));
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    try {
      await cache.put(request, response.clone());
    } catch {
      // Return the response even when a browser declines to cache it.
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Cache Next.js route payloads separately from documents (the response Vary header
  // distinguishes them). This keeps previously prefetched client navigations available offline.
  if (request.headers.get("RSC") === "1") {
    event.respondWith(networkFirst(event, request, false, PRIVATE_CACHE_VERSION));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, request, true, PRIVATE_CACHE_VERSION));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:css|js|woff2|png|svg)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request));
  }
});

