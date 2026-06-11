// sw-register.js — registers the service worker, shares the user role with it,
// and exposes a small IndexedDB-backed offline queue (window.CCQueue) for posts.

// ---- IndexedDB offline post queue (shared store with the service worker) ----
const CC_DB_NAME = 'cc-db';
const CC_STORE = 'pending_posts';

function ccOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CC_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(CC_STORE)) {
        req.result.createObjectStore(CC_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

window.CCQueue = {
  async savePendingPost(payload) {
    const token = localStorage.getItem('cc_token');
    const db = await ccOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CC_STORE, 'readwrite');
      tx.objectStore(CC_STORE).add({ token, payload, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async getPendingPosts() {
    const db = await ccOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CC_STORE, 'readonly');
      const req = tx.objectStore(CC_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  async registerSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('sync' in reg) {
        await reg.sync.register('sync-pending-posts');
      }
    } catch (e) {
      console.warn('Background sync registration failed:', e);
    }
  }
};

// Tell the service worker which role is active (controls caching/queue behavior).
function sendRoleToSW() {
  try {
    const user = JSON.parse(localStorage.getItem('cc_user') || 'null');
    if (user && user.role && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_ROLE', role: user.role });
    }
  } catch (e) { /* ignore */ }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      console.log('SW registered:', reg.scope);

      sendRoleToSW();
      // controllerchange fires when a new SW takes control — resend the role.
      navigator.serviceWorker.addEventListener('controllerchange', sendRoleToSW);

      // If a publisher has queued posts, make sure a sync is registered.
      try {
        const user = JSON.parse(localStorage.getItem('cc_user') || 'null');
        if (user && user.role === 'publisher') {
          const pending = await window.CCQueue.getPendingPosts();
          if (pending.length > 0) await window.CCQueue.registerSync();
        }
      } catch (e) { /* ignore */ }
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  });
}
