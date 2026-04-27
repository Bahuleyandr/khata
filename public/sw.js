// Minimal service worker — exists primarily so the dashboard is installable
// as a PWA. Strategy: network-first for navigations and static assets, with a
// cached copy as offline fallback. API requests are passed through untouched
// (always live) so we never serve stale expense data.
//
// Versioned cache name lets us invalidate on changes — bump the suffix when
// you ship a breaking shell change.

const CACHE = 'khata-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API and auth endpoints: always go to the network. Stale data here would
  // be actively misleading.
  if (url.pathname.startsWith('/api/')) return;

  // Only handle GET — POST/PUT/DELETE shouldn't be cached.
  if (event.request.method !== 'GET') return;

  // Cross-origin requests: passthrough.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(
          (cached) =>
            cached ||
            new Response('Offline', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            }),
        ),
      ),
  );
});
