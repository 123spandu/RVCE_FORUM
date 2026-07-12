// sw-register.js — Service Worker registration + Offline Sync (IndexedDB drafts)
// Feature 28: write drafts offline → auto-sync when connectivity returns.

const CC_DB_NAME = 'cc-offline-sync';
const CC_DB_VERSION = 3;
const CC_STORE = 'offline_drafts';
const CC_ACTIONS = 'pending_actions';

function ccOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CC_DB_NAME, CC_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CC_STORE)) {
        const store = db.createObjectStore(CC_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(CC_ACTIONS)) {
        const actions = db.createObjectStore(CC_ACTIONS, { keyPath: 'id', autoIncrement: true });
        actions.createIndex('status', 'status', { unique: false });
        actions.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function ccTxDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

window.CCQueue = {
  /**
   * Save a compose payload as an offline draft awaiting sync.
   * @returns {Promise<number>} draft id
   */
  async savePendingPost(payload, meta = {}) {
    const token = localStorage.getItem('cc_token');
    const user = JSON.parse(localStorage.getItem('cc_user') || 'null');
    const db = await ccOpenDB();
    const tx = db.transaction(CC_STORE, 'readwrite');
    const record = {
      token,
      payload,
      title: (payload && payload.title) || 'Untitled draft',
      status: 'pending', // pending | syncing | failed
      attempts: 0,
      lastError: null,
      savedAt: Date.now(),
      userId: user && user.id,
      ...meta
    };
    const req = tx.objectStore(CC_STORE).add(record);
    const id = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await ccTxDone(tx);
    this._emit({ type: 'draft-saved', id, count: await this.count() });
    return id;
  },

  async getPendingPosts() {
    const db = await ccOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CC_STORE, 'readonly');
      const req = tx.objectStore(CC_STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result || []).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async count() {
    const rows = await this.getPendingPosts();
    return rows.length;
  },

  async updateDraft(id, patch) {
    const db = await ccOpenDB();
    const tx = db.transaction(CC_STORE, 'readwrite');
    const store = tx.objectStore(CC_STORE);
    const existing = await new Promise((resolve, reject) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!existing) return;
    Object.assign(existing, patch);
    store.put(existing);
    await ccTxDone(tx);
    this._emit({ type: 'draft-updated', id, status: existing.status });
  },

  async deletePendingPost(id) {
    const db = await ccOpenDB();
    const tx = db.transaction(CC_STORE, 'readwrite');
    tx.objectStore(CC_STORE).delete(id);
    await ccTxDone(tx);
    this._emit({ type: 'draft-deleted', id, count: await this.count() });
  },

  async registerSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && 'sync' in reg) {
        await reg.sync.register('sync-pending-posts');
        return true;
      }
    } catch (e) {
      console.warn('Background sync registration failed:', e);
    }
    return false;
  },

  /**
   * Flush all pending drafts to the server. Safe to call multiple times.
   * Uses live token from localStorage when available (avoids stale JWT).
   */
  async syncAll({ token: liveToken, onProgress } = {}) {
    if (!navigator.onLine) {
      return { published: 0, failed: 0, remaining: await this.count(), offline: true };
    }
    const pending = await this.getPendingPosts();
    let published = 0;
    let failed = 0;
    const auth = liveToken || localStorage.getItem('cc_token');

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      if (onProgress) onProgress({ current: i + 1, total: pending.length, title: item.title, status: 'syncing' });
      await this.updateDraft(item.id, { status: 'syncing' });
      try {
        const res = await fetch('/api/posts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (auth || item.token || '')
          },
          body: JSON.stringify(item.payload)
        });
        if (res.ok) {
          await this.deletePendingPost(item.id);
          published++;
          if (onProgress) onProgress({ current: i + 1, total: pending.length, title: item.title, status: 'synced' });
        } else {
          const data = await res.json().catch(() => ({}));
          const errMsg = data.error || ('HTTP ' + res.status);
          // Auth errors: keep draft, stop so user can re-login
          await this.updateDraft(item.id, {
            status: 'failed',
            attempts: (item.attempts || 0) + 1,
            lastError: errMsg
          });
          failed++;
          if (res.status === 401 || res.status === 403) break;
        }
      } catch (e) {
        await this.updateDraft(item.id, {
          status: 'pending',
          attempts: (item.attempts || 0) + 1,
          lastError: 'Network error'
        });
        failed++;
        break; // likely offline again
      }
    }

    const remaining = await this.count();
    this._emit({ type: 'sync-complete', published, failed, remaining });
    if (remaining > 0) await this.registerSync();
    return { published, failed, remaining, offline: false };
  },

  _listeners: [],
  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  },
  _emit(event) {
    this._listeners.forEach(fn => {
      try { fn(event); } catch (e) { /* ignore */ }
    });
  }
};

// ---- Offline engagement queue (likes + bookmarks) ----
window.CCEngage = {
  async enqueue(action, postId, desired = {}) {
    const token = localStorage.getItem('cc_token');
    const db = await ccOpenDB();
    const tx = db.transaction(CC_ACTIONS, 'readwrite');
    const record = {
      action, // 'like' | 'bookmark'
      postId: Number(postId),
      liked: typeof desired.liked === 'boolean' ? desired.liked : undefined,
      bookmarked: typeof desired.bookmarked === 'boolean' ? desired.bookmarked : undefined,
      token,
      status: 'pending',
      savedAt: Date.now()
    };
    const req = tx.objectStore(CC_ACTIONS).add(record);
    const id = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await ccTxDone(tx);
    await this.registerSync();
    return id;
  },

  async list() {
    const db = await ccOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CC_ACTIONS, 'readonly');
      const req = tx.objectStore(CC_ACTIONS).getAll();
      req.onsuccess = () => {
        resolve((req.result || []).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0)));
      };
      req.onerror = () => reject(req.error);
    });
  },

  async remove(id) {
    const db = await ccOpenDB();
    const tx = db.transaction(CC_ACTIONS, 'readwrite');
    tx.objectStore(CC_ACTIONS).delete(id);
    await ccTxDone(tx);
  },

  async registerSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && 'sync' in reg) {
        await reg.sync.register('sync-pending-actions');
        return true;
      }
    } catch (e) {
      console.warn('Engage sync registration failed:', e);
    }
    return false;
  },

  async syncAll({ token: liveToken } = {}) {
    if (!navigator.onLine) {
      return { synced: 0, failed: 0, remaining: (await this.list()).length, offline: true };
    }
    const pending = await this.list();
    const auth = liveToken || localStorage.getItem('cc_token');
    let synced = 0;
    let failed = 0;

    for (const item of pending) {
      const path = item.action === 'bookmark'
        ? `/api/posts/${item.postId}/bookmark`
        : `/api/posts/${item.postId}/like`;
      const body = item.action === 'bookmark'
        ? (typeof item.bookmarked === 'boolean' ? { bookmarked: item.bookmarked } : {})
        : (typeof item.liked === 'boolean' ? { liked: item.liked } : {});
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + (auth || item.token || ''),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
        if (res.ok) {
          await this.remove(item.id);
          synced++;
        } else {
          failed++;
          if (res.status === 401 || res.status === 403) break;
          // Drop permanently failed actions after several tries would need attempt count;
          // keep for retry on next online.
        }
      } catch (_) {
        failed++;
        break;
      }
    }
    const remaining = (await this.list()).length;
    if (remaining > 0) await this.registerSync();
    return { synced, failed, remaining, offline: false };
  }
};

// Migrate any legacy drafts from the old DB name (best-effort, once).
(async function migrateLegacyQueue() {
  try {
    const legacy = indexedDB.open('cc-db', 1);
    legacy.onsuccess = async () => {
      const oldDb = legacy.result;
      if (!oldDb.objectStoreNames.contains('pending_posts')) {
        oldDb.close();
        return;
      }
      const tx = oldDb.transaction('pending_posts', 'readonly');
      const req = tx.objectStore('pending_posts').getAll();
      req.onsuccess = async () => {
        const rows = req.result || [];
        for (const row of rows) {
          if (row && row.payload) {
            await window.CCQueue.savePendingPost(row.payload, { migrated: true });
          }
        }
        oldDb.close();
        // Clear legacy store
        const del = indexedDB.deleteDatabase('cc-db');
        del.onsuccess = () => console.log('Migrated legacy offline drafts');
      };
    };
  } catch (e) { /* ignore */ }
})();

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
      navigator.serviceWorker.addEventListener('controllerchange', sendRoleToSW);

      // Re-register Background Sync if drafts / engagement actions are waiting
      try {
        const user = JSON.parse(localStorage.getItem('cc_user') || 'null');
        if (user && (user.role === 'publisher' || user.role === 'admin')) {
          const pending = await window.CCQueue.getPendingPosts();
          if (pending.length > 0) await window.CCQueue.registerSync();
        }
        if (window.CCEngage) {
          const actions = await window.CCEngage.list();
          if (actions.length > 0) await window.CCEngage.registerSync();
        }
      } catch (e) { /* ignore */ }
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  });

  window.addEventListener('online', () => {
    if (window.CCEngage) window.CCEngage.syncAll().catch(() => {});
  });
}
