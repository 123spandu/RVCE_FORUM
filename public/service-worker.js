// service-worker.js - Campus Connect PWA cache
const STATIC_CACHE = 'cc-static-v5';
const RUNTIME_CACHE = 'cc-runtime-v5';
const POSTS_CACHE = 'cc-posts-v4';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.html',
  '/offline.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/api.js',
  '/js/login.js',
  '/js/app.js',
  '/js/sw-register.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // CDN assets (Bootstrap)
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css'
];

// Install: pre-cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(err => {
        // Don't break install if a CDN asset fails — cache what we can
        console.warn('SW pre-cache partial:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => ![STATIC_CACHE, RUNTIME_CACHE, POSTS_CACHE].includes(k))
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//  - GET /api/posts        -> Network first, fall back to cached posts (so viewers can read offline)
//  - Other GET /api/*      -> Network only (no caching of mutable user data we shouldn't cache)
//  - Non-GET API calls     -> Network only
//  - Same-origin static    -> Cache first, then network
//  - Cross-origin (CDN)    -> Stale-while-revalidate
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return; // let non-GET hit the network normally

  // Posts feed: network first, then cache, then offline page fallback (handled by client)
  if (url.pathname === '/api/posts') {
    event.respondWith(networkFirstWithCache(req, POSTS_CACHE));
    return;
  }

  // Other API GETs: just go to the network (auth, users list, etc.)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests: serve cached shell offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then(r => r || caches.match('/offline.html')))
    );
    return;
  }

  // Cross-origin (CDN) — stale-while-revalidate
  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // Same-origin static assets — cache first
  event.respondWith(cacheFirst(req, STATIC_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirstWithCache(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ posts: [], offline: true }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    );
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || networkPromise;
}
