// service-worker.js — CampusConnect PWA: hybrid caching + background sync + push
const SHELL_CACHE = 'cc-shell-v27';   // App shell (HTML, CSS, JS, icons, fonts)
const POSTS_CACHE = 'cc-posts-v3';   // API GET responses (posts/channels)
const OFFLINE_QUEUE = 'cc-queue-v1'; // Reserved cache name (queue itself lives in IndexedDB)

const CDN_SHELL = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js'
];

const SHELL_ASSETS = [
  '/', '/index.html', '/app.html', '/offline.html',
  '/login-admin.html', '/login-publisher.html', '/login-viewer.html',
  '/css/styles.css',
  '/js/app.js', '/js/api.js', '/js/login.js', '/js/sw-register.js', '/js/theme.js', '/js/pwa-extras.js',
  '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png',
  ...CDN_SHELL
];

// ---- Install: pre-cache the app shell (Cache First targets) ----
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS).catch(err => {
        // Don't fail the whole install if one CDN asset is unreachable.
        console.warn('SW pre-cache partial:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// ---- Activate: drop ALL stale caches (clears poisoned image/HTML entries) ----
self.addEventListener('activate', event => {
  const keep = [SHELL_CACHE, POSTS_CACHE, OFFLINE_QUEUE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---- Fetch routing ----
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle http(s). Schemes like chrome-extension: can't be stored in the
  // Cache API (put() throws), so let the browser handle them directly.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // POST /api/posts is intentionally NOT intercepted here. When offline the
  // request must fail so the page's compose handler catches it and persists the
  // payload to IndexedDB (window.CCQueue). The queue is replayed by Background
  // Sync (asks open clients to flush) and/or the page's own reconnect flush.
  if (req.method !== 'GET') return; // writes: network only (page handles offline queueing)

  // CRITICAL: never intercept /uploads — a prior SW cached HTML 404s as "images"
  // and broke every poster in the feed. Let the browser load them from the network.
  if (url.pathname.startsWith('/uploads/')) return;

  // Known CDN shell assets: serve from cache so offline UI keeps Bootstrap styles/scripts.
  if (url.origin !== self.location.origin) {
    const isShellCdn = CDN_SHELL.some(u => url.href === u || url.href.startsWith(u.split('?')[0]));
    const isBootstrapIconFont = url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('bootstrap-icons');
    if (isShellCdn || isBootstrapIconFont) {
      event.respondWith(cacheFirst(req, SHELL_CACHE));
      return;
    }
    // Other cross-origin (placeholders, etc.): let the browser handle directly.
    return;
  }

  // Posts & channels feeds: Network First, fall back to cache.
  if (url.pathname.startsWith('/api/posts') || url.pathname.startsWith('/api/channels')) {
    event.respondWith(networkFirst(req, POSTS_CACHE));
    return;
  }

  // All other API GETs: network only (do not cache mutable/sensitive data).
  if (url.pathname.startsWith('/api/')) return;

  // App icons (small, static): cache-first
  if (url.pathname.startsWith('/icons/') || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // HTML/JS/CSS must be network-first so Analytics/UI updates aren't stuck on a stale SW cache.
  if (
    url.pathname.endsWith('.html') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/css/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/service-worker.js'
  ) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // Navigation requests: network first, else cached shell / offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(r => r || caches.match('/offline.html'))
        )
    );
    return;
  }

  // Everything else (remaining same-origin assets): Cache First, refresh in background.
  event.respondWith(cacheFirst(req, SHELL_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) {
    // Update in the background (don't await).
    fetch(req).then(res => {
      if (res && res.ok) caches.open(cacheName).then(c => c.put(req, res.clone()));
    }).catch(() => { });
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    // Never return Response.error() — Chrome logs a FetchEvent network error.
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

async function networkFirst(req, cacheName) {
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
    // Graceful empty payload so the UI doesn't hard-crash offline.
    return new Response(JSON.stringify({ posts: [], channels: [], offline: true }), {
      headers: { 'Content-Type': 'application/json' }, status: 200
    });
  }
}

// ---- Background Sync: ask open app windows to flush IndexedDB queue ----
// The page owns the flush (maybeFlushQueue) so JWT + payload stay consistent.
// Sync wakes those clients when connectivity returns even if the tab was idle.
self.addEventListener('sync', event => {
  if (event.tag === 'sync-pending-posts') {
    event.waitUntil(notifyClientsFlush('FLUSH_PENDING_POSTS', '/app.html?tab=compose&sync=1'));
    return;
  }
  if (event.tag === 'sync-pending-actions') {
    event.waitUntil(notifyClientsFlush('FLUSH_PENDING_ACTIONS', '/app.html?sync=actions'));
  }
});

async function notifyClientsFlush(messageType, fallbackUrl) {
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clientsList.length) {
    clientsList.forEach(client => {
      client.postMessage({ type: messageType });
    });
    return;
  }
  if (self.clients && self.clients.openWindow) {
    await self.clients.openWindow(fallbackUrl);
  }
}

// ---- Periodic Background Sync: refresh feed/channel caches while installed ----
self.addEventListener('periodicsync', event => {
  if (event.tag !== 'cc-refresh-feeds') return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(POSTS_CACHE);
      const endpoints = ['/api/posts', '/api/channels'];
      await Promise.all(endpoints.map(async (path) => {
        try {
          const res = await fetch(path, { credentials: 'include' });
          if (res && res.ok) await cache.put(path, res.clone());
        } catch (_) { /* ignore individual failures */ }
      }));
    } catch (e) {
      console.warn('Periodic feed refresh failed:', e);
    }
  })());
});

// ---- Push notifications ----
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'RVCE Connect';
  const options = {
    body: data.body || 'New announcement on RVCE Connect',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { postId: data.postId || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const postId = event.notification.data && event.notification.data.postId;
  const target = '/app.html' + (postId ? ('?post=' + encodeURIComponent(postId)) : '');
  event.waitUntil(self.clients.openWindow(target));
});

// Page → SW messages (role hint is advisory only; unused by fetch routing today)
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SET_ROLE') {
    self.__ccRole = data.role || null;
  }
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
});
