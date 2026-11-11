// v7: brand logo (.webp under /assets/) is now served cache-first so it renders offline.
// v6: route warming is single-flight, bounded, and avoids duplicate private asset copies.
// The private cache keeps its name on purpose: its contents are unchanged, and renaming it
// would make activate() delete every route saved for offline use.
const CACHE_VERSION = "account-tracker-shell-v2";
const PRIVATE_CACHE_VERSION = "account-tracker-private-v1";
const ROUTE_CACHE_CONCURRENCY = 2;
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon.png",
  "/assets/account-tracker-mark-256.webp",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];
const inFlightRouteCacheJobs = new Map();
let privateCacheGeneration = 0;
let privateCacheReset = Promise.resolve();

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
    const replyPort = event.ports?.[0];
    privateCacheGeneration += 1;
    const previousReset = privateCacheReset;
    const jobs = [...inFlightRouteCacheJobs.values()];
    jobs.forEach((job) => job.controller.abort());
    inFlightRouteCacheJobs.clear();
    privateCacheReset = Promise.allSettled([previousReset, ...jobs.map((job) => job.promise)])
      .then(() => caches.delete(PRIVATE_CACHE_VERSION))
      .then(() => undefined);
    const completed = privateCacheReset.finally(() => replyPort?.postMessage({ cleared: true }));
    event.waitUntil(completed);
  }
  if (event.data?.type === "CACHE_ROUTES" && Array.isArray(event.data.routes)) {
    const generation = privateCacheGeneration;
    event.waitUntil(
      privateCacheReset.then(() => {
        if (generation !== privateCacheGeneration) return;
        return getRouteCacheJob(event.data.routes, generation);
      })
    );
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

function safeSortedRoutes(routes) {
  return [...new Set(routes)]
    .filter(
      (route) => typeof route === "string" && route.startsWith("/") && !route.startsWith("//")
    )
    .sort();
}

function getRouteCacheJob(routes, generation) {
  const safeRoutes = safeSortedRoutes(routes);
  const signature = safeRoutes.join("\n");
  const current = inFlightRouteCacheJobs.get(signature);
  if (current) return current.promise;

  const controller = new AbortController();
  const entry = {
    controller,
    promise: cacheRoutes(safeRoutes, generation, controller.signal).finally(() => {
      if (inFlightRouteCacheJobs.get(signature) === entry) {
        inFlightRouteCacheJobs.delete(signature);
      }
    }),
  };
  inFlightRouteCacheJobs.set(signature, entry);
  return entry.promise;
}

async function runWithConcurrency(items, worker) {
  let nextIndex = 0;
  const workerCount = Math.min(ROUTE_CACHE_CONCURRENCY, items.length);

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

async function cacheRoutes(safeRoutes, generation, signal) {
  const cache = await caches.open(PRIVATE_CACHE_VERSION);
  const shellCache = await caches.open(CACHE_VERSION);
  const assets = new Set();

  await runWithConcurrency(safeRoutes, async (route) => {
    try {
      if (generation !== privateCacheGeneration) return;
      const request = new Request(route, {
        credentials: "include",
        headers: { Accept: "text/html" },
        signal,
      });
      const response = await fetch(request);
      if (!response.ok || response.redirected || generation !== privateCacheGeneration) return;

      const html = await response.clone().text();
      if (generation !== privateCacheGeneration) return;
      await cache.put(request, response);

      for (const match of html.matchAll(
        /(?:src|href)=["']([^"']+\.(?:js|css|woff2?|png|jpe?g|webp|avif|svg|ico))(?:\?[^"']*)?["']/gi
      )) {
        const asset = match[1];
        if (asset.startsWith("/") && !asset.startsWith("//")) assets.add(asset);
      }
    } catch {
      // The route remains available through its existing runtime cache.
    }
  });

  await runWithConcurrency([...assets].sort(), async (asset) => {
    try {
      if (generation !== privateCacheGeneration) return;
      if ((await shellCache.match(asset)) || (await cache.match(asset))) return;
      const response = await fetch(new Request(asset, { credentials: "include", signal }));
      if (response.ok && generation === privateCacheGeneration) {
        await shellCache.put(asset, response);
      }
    } catch {
      // A later runtime request can still cache this asset.
    }
  });
}

async function cacheFirst(request, cacheWork) {
  const cache = await caches.open(CACHE_VERSION);
  const privateCache = await caches.open(PRIVATE_CACHE_VERSION);
  const cached = (await cache.match(request)) || (await privateCache.match(request));
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    cacheWork.promise = cache.put(request, copy).catch(() => {
      // Return the response even when a browser declines to cache it.
    });
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
    url.pathname.startsWith("/assets/") ||
    /\.(?:css|js|woff2|png|svg|webp|ico)$/.test(url.pathname)
  ) {
    const cacheWork = { promise: Promise.resolve() };
    const response = cacheFirst(request, cacheWork);
    event.respondWith(response);
    // Register the lifetime extension synchronously for Safari. cacheFirst assigns the real
    // write before its response promise resolves, so the response itself does not await it.
    event.waitUntil(response.then(() => cacheWork.promise));
  }
});

