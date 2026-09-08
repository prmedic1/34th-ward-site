/*
 * Service worker for 34thward.com (the installable phone app shell).
 *
 * Strategy: NETWORK FIRST for everything, falling back to the last cached copy
 * only when offline. HTML pages are fetched with cache:'no-store' so a phone
 * always gets the freshly deployed page instead of a copy the browser's HTTP
 * cache is still holding (this site deploys many times a day). Versioned assets
 * (css/js with ?v=, data with ?d=) may come from the HTTP cache since their URL
 * changes when they change. The cache here exists only so the app still opens
 * on the train or with bad signal.
 */
const CACHE = '34thward-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['/', '/index.html']).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isDocument(req, url) {
  return req.mode === 'navigate' || req.destination === 'document' ||
    url.pathname === '/' || url.pathname.endsWith('.html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never intercept cross-origin requests (map tiles, APIs, fonts, analytics).
  if (url.origin !== self.location.origin) return;

  // HTML pages: always pull a FRESH copy from the server, bypassing the browser
  // HTTP cache, so structural updates reach phones right away. Fall back to the
  // last cached copy only when the network is unavailable.
  if (isDocument(req, url)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // Versioned assets and data: network first, but the HTTP cache may serve them
  // (their URLs carry ?v=/?d= cache-busting), falling back to cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
