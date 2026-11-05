// Keeps its own copies of the transcript's inline images. The host in front of this server answers every
// response with "cache-control: no-store", which the browser's HTTP cache must honour, so a picture would be
// downloaded again on each render. This worker's Cache API storage is independent of those headers.
const CACHE = "omb-media-v2";
const MAX_ENTRIES = 500;
const PATTERNS = [
  /^\/assets\//,
  /^\/api\/attachments\//,
  /^\/api\/threads\/[^/]+\/messages\/[^/]+\/(image|file)(\?|$)/,
];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  const excess = keys.length - MAX_ENTRIES;
  for (const key of keys.slice(0, excess)) await cache.delete(key);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!PATTERNS.some((pattern) => pattern.test(url.pathname + url.search))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      cache.put(request, response.clone()).then(() => trim(cache)).catch(() => undefined);
    }
    return response;
  })());
});
