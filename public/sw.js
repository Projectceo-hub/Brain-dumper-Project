/* MindCanvas service worker — plain JS, no Workbox.
 *
 * Cache strategy:
 *   - Navigation requests (HTML pages): network-first, fallback to cached
 *     app shell if offline. This gives users up-to-date content when online
 *     and a working UI when offline.
 *   - Static assets (JS/CSS/fonts/images from same origin): cache-first.
 *     These are fingerprinted by Next.js so a cached chunk is always
 *     byte-identical to the live one; safe to serve without revalidating.
 *   - `/api/*` requests: NOT cached. The UI handles API failure gracefully
 *     via Dexie's local cache — re-fetching from network every time keeps
 *     data fresh and avoids the service worker intercepting auth cookies.
 *
 * Versioning: bump CACHE_VERSION whenever a breaking SW change ships.
 * The browser will install the new SW, claim clients on the next navigation,
 * and evict old cache entries during activation.
 */

const CACHE_VERSION = "mindcanvas-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Resources to pre-cache on install. We keep this small because Next.js
// JS chunks are fingerprinted with long hashes — the runtime fetch handler
// caches them on first request. Just the absolute bare shell is here.
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      // Use addAll but tolerate individual failures so a single broken
      // asset doesn't prevent the SW from installing. The fetch handler
      // will fill these in lazily on next request.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await shellCache.add(url);
          } catch {
            // network or 4xx — ignore, will retry at runtime
          }
        }),
      );
      // Activate immediately rather than waiting for clients to close.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Purge caches from any previous SW version. Keeps storage small
      // and avoids serving stale shell chunks after a deploy.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// Helper: classify a request so the fetch handler picks the right strategy.
function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept") &&
      request.headers.get("accept").includes("text/html"))
  );
}

function isStaticAssetRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  // Next.js static assets live under /_next/static/. Everything else
  // (JS chunks, CSS, fonts, images) served from same-origin with a
  // hashed filename is also a good cache-first candidate.
  const pathname = url.pathname;
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/data/") ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(pathname)
  );
}

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Defensive: only handle GET. Anything else (POST/PUT/DELETE) we let
  // straight through to the network — service workers caching write
  // requests would silently break the app.
  if (request.method !== "GET") return;

  // /api/* — never cache, always go to network. Dexie handles offline
  // data; caching API responses here would risk stale auth or stale data.
  if (isApiRequest(url)) {
    return;
  }

  // Static assets — cache-first. If cached, serve immediately. If not,
  // fetch, cache, return. Stale-while-revalidate flavour.
  if (isStaticAssetRequest(request, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) {
          // Refresh cache in background, don't block the response.
          event.waitUntil(
            fetch(request).then((res) => {
              if (res && res.status === 200) {
                cache.put(request, res.clone());
              }
            }).catch(() => {
              // offline — keep serving cached version, no action needed
            }),
          );
          return cached;
        }
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          // Failed both cache and network — return an empty Response so
          // the browser sees a 0-byte asset rather than crashing.
          return new Response("", { status: 504, statusText: "Offline" });
        }
      })(),
    );
    return;
  }

  // Next.js RSC prefetch/navigation requests — serve from cache if offline
  if (url.searchParams.has("_rsc")) {
    event.respondWith(
      caches
        .match(url.pathname, { ignoreSearch: true })
        .then((cached) => cached || fetch(event.request))
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Navigation requests — network-first with cache fallback.
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const networkResponse = await fetch(request);
          // Cache the freshly-fetched HTML so future offline loads hit it.
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          // Offline — try the cached version of this exact URL first.
          const cached = await cache.match(request);
          if (cached) return cached;
          // Then fall back to the app shell "/" so the SPA can boot and
          // subsequent client-side routing takes over.
          const shell = await cache.match("/");
          if (shell) return shell;
          // Last resort: a plain offline indicator.
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>MindCanvas — offline</title>' +
              '<body style="font-family:system-ui;background:#F2EDE4;color:#1C1912;padding:2rem">' +
              '<h1>You are offline</h1><p>MindCanvas will load automatically when you reconnect.</p></body>',
            { status: 503, headers: { "Content-Type": "text/html" } },
          );
        }
      })(),
    );
    return;
  }

  // Everything else: let the browser handle it. The SW deliberately
  // doesn't intercept cross-origin requests, websockets, etc.
});

// Allow the page to trigger an immediate update when a new SW ships.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
