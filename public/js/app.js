// app.js — main client controller for Campus Connect
(function () {

  // ---------- Guard: must be logged in ----------
  const user = API.getUser();
  const token = API.getToken();
  if (!token || !user) { location.replace('/'); return; }

  // ---------- DOM refs ----------
  const whoAmI = document.getElementById('whoAmI');
  const logoutBtn = document.getElementById('logoutBtn');
  const offlineBadge = document.getElementById('offlineBadge');
  const tabs = document.querySelectorAll('#mainTabs [data-tab]');
  const panes = document.querySelectorAll('[data-pane]');
  const tabCompose = document.getElementById('tabCompose');
  const tabAdmin = document.getElementById('tabAdmin');

  // Feed
  const feedList = document.getElementById('feedList');
  const feedStatus = document.getElementById('feedStatus');
  const refreshFeedBtn = document.getElementById('refreshFeedBtn');

  // Compose
  const composeForm = document.getElementById('composeForm');
  const composeBtn = document.getElementById('composeBtn');
  const composeError = document.getElementById('composeError');
  const composeOk = document.getElementById('composeOk');
  const audAll = document.getElementById('audAll');
  const audDept = document.getElementById('audDept');
  const deptPickerWrap = document.getElementById('deptPickerWrap');
  const deptPicker = document.getElementById('deptPicker');

  // Subs
  const publisherList = document.getElementById('publisherList');

  // Admin
  const addUserForm = document.getElementById('addUserForm');
  const addDeptForm = document.getElementById('addDeptForm');
  const usersTbody = document.getElementById('usersTbody');
  const refreshUsersBtn = document.getElementById('refreshUsersBtn');
  const auDept = document.getElementById('auDept');

  // ---------- Init UI based on role ----------
  whoAmI.textContent = `${user.full_name} · ${user.role}`;
  if (user.role === 'publisher' || user.role === 'admin') tabCompose.classList.remove('d-none');
  if (user.role === 'admin') tabAdmin.classList.remove('d-none');

  // ---------- Network status ----------
  function updateOnline() {
    offlineBadge.classList.toggle('d-none', navigator.onLine);
  }
  window.addEventListener('online', () => { updateOnline(); loadFeed(); });
  window.addEventListener('offline', updateOnline);
  updateOnline();

  // ---------- Tabs ----------
  let departmentsCache = null;
  let subscriptionsCache = new Set();

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const name = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      panes.forEach(p => p.classList.toggle('d-none', p.dataset.pane !== name));
      if (name === 'feed') loadFeed();
      if (name === 'compose') prepareCompose();
      if (name === 'subs') loadPublishers();
      if (name === 'admin') { loadDepartmentsForAdmin(); loadUsers(); }
    });
  });

  logoutBtn.addEventListener('click', () => {
    API.clearToken();
    location.replace('/');
  });

  // ---------- Helpers ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('') || '?';
  }
  function timeAgo(ts) {
    const d = new Date(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' d ago';
    return d.toLocaleDateString();
  }
  function showAlert(el, msg, kind) {
    el.textContent = msg;
    el.className = 'alert small ' + (kind === 'ok' ? 'alert-success' : 'alert-danger');
    el.classList.remove('d-none');
    setTimeout(() => el.classList.add('d-none'), 4000);
  }

  // ---------- Feed ----------
  async function loadFeed() {
    feedList.innerHTML = `<div class="text-center text-muted py-5"><div class="spinner-border" role="status"></div></div>`;
    feedStatus.classList.add('d-none');
    try {
      const data = await API.get('/api/posts');
      if (data.offline) {
        feedStatus.textContent = 'You are offline — showing posts from the last sync.';
        feedStatus.classList.remove('d-none');
      }
      renderFeed(data.posts || []);
    } catch (err) {
      feedList.innerHTML = `<div class="alert alert-danger small">Could not load posts: ${escapeHtml(err.message)}</div>`;
    }
  }
  refreshFeedBtn.addEventListener('click', loadFeed);

  function renderFeed(posts) {
    if (!posts.length) {
      feedList.innerHTML = `<div class="text-center text-muted py-5">No posts yet.</div>`;
      return;
    }
    feedList.innerHTML = posts.map(p => postCardHtml(p)).join('');
    // wire up like buttons
    feedList.querySelectorAll('.like-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleLike(btn));
    });
    // wire up delete buttons (publisher of own post, or admin)
    feedList.querySelectorAll('.delete-post-btn').forEach(btn => {
      btn.addEventListener('click', () => deletePost(btn.dataset.id));
    });
  }

  function postCardHtml(p) {
    const targets = p.target_type === 'department'
      ? (p.target_departments || []).map(d => `<span class="badge badge-target me-1">${escapeHtml(d.name)}</span>`).join('')
      : `<span class="badge badge-target">Everyone</span>`;

    const canDelete = (p.publisher_id === user.id) || user.role === 'admin';

    return `
      <article class="post-card p-3">
        <div class="d-flex gap-3">
          <div class="publisher-avatar">${escapeHtml(initials(p.publisher_name))}</div>
          <div class="flex-grow-1">
            <div class="d-flex flex-wrap align-items-baseline gap-2">
              <strong>${escapeHtml(p.publisher_name)}</strong>
              ${p.publisher_department ? `<span class="text-muted small">· ${escapeHtml(p.publisher_department)}</span>` : ''}
              <span class="text-muted small ms-auto">${escapeHtml(timeAgo(p.created_at))}</span>
            </div>
            <h3 class="h6 mt-2 mb-1">${escapeHtml(p.title)}</h3>
            <div class="post-content small">${escapeHtml(p.content)}</div>
            <div class="mt-2">${targets}</div>
            <div class="mt-2 d-flex align-items-center gap-2">
              <button class="like-btn ${p.liked_by_me ? 'liked' : ''}" data-id="${p.id}" type="button">
                <i class="bi ${p.liked_by_me ? 'bi-heart-fill' : 'bi-heart'}"></i>
                <span class="like-count">${p.like_count}</span>
              </button>
              ${canDelete ? `
                <button class="btn btn-sm btn-link text-danger delete-post-btn ms-auto" data-id="${p.id}" type="button">
                  <i class="bi bi-trash"></i>
                </button>` : ''}
            </div>
          </div>
        </div>
      </article>`;
  }

  async function toggleLike(btn) {
    const id = btn.dataset.id;
    btn.disabled = true;
    try {
      const r = await API.post(`/api/posts/${id}/like`);
      btn.classList.toggle('liked', r.liked);
      btn.querySelector('i').className = 'bi ' + (r.liked ? 'bi-heart-fill' : 'bi-heart');
      btn.querySelector('.like-count').textContent = r.like_count;
    } catch (err) {
      alert('Could not like: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function deletePost(id) {
    if (!confirm('Delete this post?')) return;
    try {
      await API.del(`/api/posts/${id}`);
      loadFeed();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  // ---------- Compose ----------
  async function loadDepartments() {
    if (departmentsCache) return departmentsCache;
    const data = await API.get('/api/departments');
    departmentsCache = data.departments || [];
    return departmentsCache;
  }

  async function prepareCompose() {
    try {
      const deps = await loadDepartments();
      deptPicker.innerHTML = deps.length
        ? deps.map(d => `
            <div class="form-check">
              <input class="form-check-input dept-cb" type="checkbox" value="${d.id}" id="dep_${d.id}">
              <label class="form-check-label" for="dep_${d.id}">${escapeHtml(d.name)}</label>
            </div>`).join('')
        : `<div class="text-muted small">No departments yet.</div>`;
    } catch (err) {
      deptPicker.innerHTML = `<div class="text-danger small">Could not load departments.</div>`;
    }
  }

  [audAll, audDept].forEach(r => r.addEventListener('change', () => {
    deptPickerWrap.classList.toggle('d-none', !audDept.checked);
  }));

  composeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    composeError.classList.add('d-none');
    composeOk.classList.add('d-none');
    composeBtn.disabled = true;

    const title = document.getElementById('postTitle').value.trim();
    const content = document.getElementById('postContent').value.trim();
    const target_type = audDept.checked ? 'department' : 'all';
    let department_ids = [];
    if (target_type === 'department') {
      department_ids = [...deptPicker.querySelectorAll('.dept-cb:checked')].map(c => Number(c.value));
      if (department_ids.length === 0) {
        showAlert(composeError, 'Select at least one department.');
        composeBtn.disabled = false;
        return;
      }
    }

    try {
      await API.post('/api/posts', { title, content, target_type, department_ids });
      composeForm.reset();
      audAll.checked = true;
      deptPickerWrap.classList.add('d-none');
      showAlert(composeOk, 'Posted!', 'ok');
    } catch (err) {
      showAlert(composeError, err.message);
    } finally {
      composeBtn.disabled = false;
    }
  });

  // ---------- Subscriptions ----------
  async function loadPublishers() {
    publisherList.innerHTML = `<div class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm" role="status"></div></div>`;
    try {
      const [{ publishers }, { subscriptions }] = await Promise.all([
        API.get('/api/users/publishers/list'),
        API.get('/api/subscriptions')
      ]);
      subscriptionsCache = new Set(subscriptions.map(s => s.publisher_id));

      const others = publishers.filter(p => p.id !== user.id);
      if (!others.length) {
        publisherList.innerHTML = `<div class="text-center text-muted py-3">No publishers available.</div>`;
        return;
      }
      publisherList.innerHTML = others.map(p => {
        const subscribed = subscriptionsCache.has(p.id);
        return `
          <div class="card shadow-sm">
            <div class="card-body d-flex align-items-center gap-3">
              <div class="publisher-avatar">${escapeHtml(initials(p.full_name))}</div>
              <div class="flex-grow-1">
                <div class="fw-semibold">${escapeHtml(p.full_name)}</div>
                <div class="text-muted small">${escapeHtml(p.department_name || 'No department')}</div>
              </div>
              <button class="btn btn-sm ${subscribed ? 'btn-outline-secondary' : 'btn-primary'} sub-btn"
                      data-id="${p.id}" data-subscribed="${subscribed ? 1 : 0}">
                <i class="bi ${subscribed ? 'bi-bell-slash' : 'bi-bell'}"></i>
                ${subscribed ? 'Unsubscribe' : 'Subscribe'}
              </button>
            </div>
          </div>`;
      }).join('');
      publisherList.querySelectorAll('.sub-btn').forEach(b => {
        b.addEventListener('click', () => toggleSubscription(b));
      });
    } catch (err) {
      publisherList.innerHTML = `<div class="alert alert-danger small">Could not load publishers: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function toggleSubscription(btn) {
    const id = Number(btn.dataset.id);
    const subscribed = btn.dataset.subscribed === '1';
    btn.disabled = true;
    try {
      if (subscribed) await API.del('/api/subscriptions/' + id);
      else await API.post('/api/subscriptions', { publisher_id: id });
      loadPublishers();
    } catch (err) {
      alert('Failed: ' + err.message);
      btn.disabled = false;
    }
  }

  // ---------- Admin ----------
  async function loadDepartmentsForAdmin() {
    try {
      departmentsCache = null;
      const deps = await loadDepartments();
      auDept.innerHTML = '<option value="">— None —</option>' +
        deps.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    } catch (err) {
      console.warn(err);
    }
  }

  async function loadUsers() {
    usersTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">Loading…</td></tr>`;
    try {
      const { users } = await API.get('/api/users');
      if (!users.length) {
        usersTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No users.</td></tr>`;
        return;
      }
      usersTbody.innerHTML = users.map(u => `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.full_name)}</td>
          <td><span class="badge bg-secondary">${escapeHtml(u.role)}</span></td>
          <td>${escapeHtml(u.department_name || '—')}</td>
          <td class="text-end">
            ${u.id === user.id ? '<span class="text-muted small">you</span>' :
              `<button class="btn btn-sm btn-outline-danger del-user" data-id="${u.id}">
                <i class="bi bi-trash"></i>
              </button>`}
          </td>
        </tr>`).join('');
      usersTbody.querySelectorAll('.del-user').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('Delete this user?')) return;
          try { await API.del('/api/users/' + b.dataset.id); loadUsers(); }
          catch (err) { alert('Delete failed: ' + err.message); }
        });
      });
    } catch (err) {
      usersTbody.innerHTML = `<tr><td colspan="5" class="text-danger small">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  refreshUsersBtn?.addEventListener('click', loadUsers);

  addUserForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('auError');
    const ok = document.getElementById('auOk');
    err.classList.add('d-none'); ok.classList.add('d-none');
    const body = {
      username: document.getElementById('auUsername').value.trim(),
      full_name: document.getElementById('auFullName').value.trim(),
      password: document.getElementById('auPassword').value,
      role: document.getElementById('auRole').value,
      department_id: document.getElementById('auDept').value || null
    };
    try {
      await API.post('/api/users', body);
      addUserForm.reset();
      showAlert(ok, 'User created', 'ok');
      loadUsers();
    } catch (e2) {
      showAlert(err, e2.message);
    }
  });

  addDeptForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('adName').value.trim();
    const msg = document.getElementById('adMsg');
    try {
      await API.post('/api/departments', { name });
      msg.innerHTML = '<span class="text-success">Department added.</span>';
      addDeptForm.reset();
      departmentsCache = null;
      loadDepartmentsForAdmin();
    } catch (err) {
      msg.innerHTML = '<span class="text-danger">' + escapeHtml(err.message) + '</span>';
    }
  });

  // ---------- Kick things off ----------
  loadFeed();
})();
