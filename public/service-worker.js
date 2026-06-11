// service-worker.js — CampusConnect PWA: role-aware hybrid caching + background sync
const SHELL_CACHE = 'cc-shell-v1';   // App shell (HTML, CSS, JS, icons, fonts)
const POSTS_CACHE = 'cc-posts-v1';   // API GET responses (posts/channels)
const OFFLINE_QUEUE = 'cc-queue-v1'; // Reserved cache name (queue itself lives in IndexedDB)

const SHELL_ASSETS = [
  '/', '/index.html', '/app.html', '/offline.html',
  '/css/styles.css',
  '/js/app.js', '/js/api.js', '/js/login.js', '/js/sw-register.js',
  '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css'
];

// Current user role, set at runtime via postMessage from sw-register.js.
let currentRole = 'viewer';

// ---- IndexedDB helpers (shared store with the page) ----
const DB_NAME = 'cc-db';
const STORE = 'pending_posts';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

function idbDelete(id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

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

// ---- Activate: drop stale caches ----
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => ![SHELL_CACHE, POSTS_CACHE, OFFLINE_QUEUE].includes(k))
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---- Receive role from the page ----
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SET_ROLE') {
    currentRole = event.data.role || 'viewer';
  }
});

// ---- Fetch routing ----
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // POST /api/posts while offline → queue for background sync (publishers only).
  if (req.method === 'POST' && url.pathname === '/api/posts') {
    event.respondWith(handlePostCreation(req));
    return;
  }

  if (req.method !== 'GET') return; // other writes: network only

  // Posts & channels feeds: Network First, fall back to cache.
  if (url.pathname.startsWith('/api/posts') || url.pathname.startsWith('/api/channels')) {
    event.respondWith(networkFirst(req, POSTS_CACHE));
    return;
  }

  // All other API GETs: network only (do not cache mutable/sensitive data).
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: serve cached shell, else offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then(r => r || caches.match('/offline.html'))
      )
    );
    return;
  }

  // Everything else (shell + CDN): Cache First, refresh in background.
  event.respondWith(cacheFirst(req, SHELL_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) {
    // Update in the background (don't await).
    fetch(req).then(res => {
      if (res && res.ok) caches.open(cacheName).then(c => c.put(req, res.clone()));
    }).catch(() => {});
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
    return cached || Response.error();
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

// Try the network; if offline, queue the post (publisher) for background sync.
async function handlePostCreation(req) {
  try {
    return await fetch(req.clone());
  } catch (err) {
    // Admins never queue writes — mutating actions are network-only for them.
    if (currentRole === 'admin') {
      return new Response(JSON.stringify({ error: 'Offline — Admin actions unavailable' }), {
        headers: { 'Content-Type': 'application/json' }, status: 503
      });
    }
    // The page (CCQueue) is responsible for persisting the payload to IndexedDB
    // and registering the sync tag. Here we just acknowledge offline acceptance.
    try { await self.registration.sync.register('sync-pending-posts'); } catch (e) {}
    return new Response(JSON.stringify({ queued: true, offline: true }), {
      headers: { 'Content-Type': 'application/json' }, status: 202
    });
  }
}

// ---- Background Sync: replay queued posts ----
self.addEventListener('sync', event => {
  if (event.tag === 'sync-pending-posts') {
    event.waitUntil(syncPendingPosts());
  }
});

async function syncPendingPosts() {
  const pending = await idbGetAll();
  for (const item of pending) {
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(item.token ? { 'Authorization': 'Bearer ' + item.token } : {})
        },
        body: JSON.stringify(item.payload)
      });
      if (res.ok) await idbDelete(item.id);
    } catch (err) {
      // Still offline — keep the item and let the next sync retry.
      throw err;
    }
  }
}

// ---- Push notifications ----
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'CampusConnect';
  const options = {
    body: data.body || 'New announcement on CampusConnect',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { postId: data.postId || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const postId = event.notification.data && event.notification.data.postId;
  const target = '/app.html' + (postId ? ('?post=' + postId) : '');
  event.waitUntil(self.clients.openWindow(target));
});
