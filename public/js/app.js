/* app.js — Advanced Campus Connect Controller */
(function () {
  const user = API.getUser();
  const token = API.getToken();
  if (!token || !user) { location.replace('/'); return; }

  // --- Global References ---
  const whoAmI = document.getElementById('whoAmI');
  const logoutBtn = document.getElementById('logoutBtn');
  const tabs = document.querySelectorAll('#mainTabs [data-tab]');
  const panes = document.querySelectorAll('[data-pane]');
  const tabCompose = document.getElementById('tabCompose');
  const tabAdmin = document.getElementById('tabAdmin');
  const offlineBadge = document.getElementById('offlineBadge');
  const globalSearch = document.getElementById('globalSearch');

  // Panes
  const feedList = document.getElementById('feedList');
  const storiesContainer = document.getElementById('storiesContainer');
  const composeForm = document.getElementById('composeForm');
  const usersTbody = document.getElementById('usersTbody');
  const analyticsBoard = document.getElementById('analyticsBoard');
  const publisherList = document.getElementById('publisherList');
  const deptFilter = document.getElementById('deptFilter');

  let departmentsCache = [];
  let clubsCache = [];
  let currentFilters = { type: '', dept: '', q: '' };

  // --- Initialization ---
  whoAmI.textContent = user.full_name;
  if (user.role === 'publisher' || user.role === 'admin') tabCompose.classList.remove('d-none');
  if (user.role === 'admin') tabAdmin.classList.remove('d-none');

  // Init Data
  loadFeed();
  loadStories();
  loadMetadata(); // Load depts and clubs

  // --- Network ---
  window.addEventListener('online', () => { if (offlineBadge) offlineBadge.classList.add('d-none'); loadFeed(); });
  window.addEventListener('offline', () => { if (offlineBadge) offlineBadge.classList.remove('d-none'); });

  // --- Tab Navigation ---
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      panes.forEach(p => p.classList.toggle('d-none', p.dataset.pane !== target));
      
      if (target === 'feed') loadFeed();
      if (target === 'admin') loadAdminDashboard();
      if (target === 'subs') loadPublishers();
      if (target === 'compose') prepareCompose();
    });
  });

  logoutBtn.addEventListener('click', () => { API.clearToken(); location.replace('/'); });

  // --- Metadata (Depts/Clubs) ---
  async function loadMetadata() {
    try {
      const [{ departments }, { clubs }] = await Promise.all([
        API.get('/api/departments'),
        API.get('/api/clubs')
      ]);
      departmentsCache = departments;
      clubsCache = clubs;
      
      deptFilter.innerHTML = '<option value="">All Departments</option>' + 
        departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    } catch (err) { console.error('Meta load fail', err); }
  }

  // --- Feed & Stories ---
  async function loadFeed() {
    const query = new URLSearchParams(currentFilters).toString();
    feedList.innerHTML = `<div class="col-12 text-center py-5"><div class="spinner-border text-primary"></div></div>`;
    try {
      const data = await API.get(`/api/posts?${query}`);
      renderFeed(data.posts || []);
    } catch (err) {
      feedList.innerHTML = `<div class="alert alert-danger mx-3">Could not load feed</div>`;
    }
  }

  async function loadStories() {
    try {
      const data = await API.get('/api/posts/stories');
      const stories = data.stories || [];
      const addBtn = document.getElementById('addStoryBtn');
      
      storiesContainer.innerHTML = '';
      storiesContainer.appendChild(addBtn);
      
      stories.forEach(s => {
        const div = document.createElement('div');
        div.className = 'story-item';
        div.innerHTML = `
          <div class="story-circle">
            <img src="${s.media_url}" alt="Story">
          </div>
          <span class="story-name">${escapeHtml(s.publisher_name.split(' ')[0])}</span>
        `;
        div.onclick = () => showStoryModal(s);
        storiesContainer.appendChild(div);
      });
    } catch (e) {}
  }

  function renderFeed(posts) {
    if (!posts.length) {
      feedList.innerHTML = `<div class="col-12 text-center py-5"><img src="https://cdni.iconscout.com/illustration/premium/thumb/empty-state-2130362-1800505.png" style="width:200px" class="mb-3 opacity-50"><br><span class="text-muted">No posts found.</span></div>`;
      return;
    }
    feedList.innerHTML = posts.map(p => postCardHtml(p)).join('');
    // Wire up events
    feedList.querySelectorAll('.read-more').forEach(btn => {
      btn.onclick = () => showPostModal(posts.find(x => x.id == btn.dataset.id));
    });
    feedList.querySelectorAll('.like-btn').forEach(btn => {
      btn.onclick = () => toggleLike(btn);
    });
    feedList.querySelectorAll('.bookmark-btn').forEach(btn => {
       btn.onclick = () => toggleBookmark(btn);
    });
  }

  function postCardHtml(p) {
    const avatar = initials(p.publisher_name);
    const time = timeAgo(p.created_at);
    
    // Dynamic Fallback Images based on Post Type
    let mediaUrl = p.image_url;
    if (!mediaUrl) {
      const fallbacks = {
        'hackathon': 'https://placehold.co/800x400/ef4444/ffffff?text=Hackathon',
        'event': 'https://placehold.co/800x400/10b981/ffffff?text=Campus+Event',
        'workshop': 'https://placehold.co/800x400/f59e0b/ffffff?text=Workshop',
        'circular': 'https://placehold.co/800x400/1e293b/ffffff?text=Official+Notice',
        'meeting': 'https://placehold.co/800x400/3b82f6/ffffff?text=Meeting',
        'placement talk': 'https://placehold.co/800x400/8b5cf6/ffffff?text=Placement+Talk'
      };
      mediaUrl = fallbacks[p.post_type] || 'https://placehold.co/800x400/6366f1/ffffff?text=Announcement';
    }
    const media = `<img src="${mediaUrl}" class="post-image shadow-sm" style="object-fit: cover;" alt="Post attachment">`;
    
    // Type Badge Colors
    const typeColors = {
      'event': 'bg-success', 'hackathon': 'bg-danger', 'meeting': 'bg-primary', 
      'placement talk': 'bg-warning text-dark', 'circular': 'bg-dark'
    };
    const badgeClass = typeColors[p.post_type] || 'bg-secondary';

    return `
      <div class="col fade-in">
        <article class="post-card p-4 h-100 d-flex flex-column">
          <div class="post-header">
            <div class="post-publisher-avatar">${escapeHtml(avatar)}</div>
            <div>
              <h6 class="mb-0 fw-700">${escapeHtml(p.publisher_name)}</h6>
              <span class="text-muted small">${escapeHtml(p.publisher_department || 'Campus')} · ${time}</span>
            </div>
            <div class="ms-auto dropdown">
               <button class="btn btn-sm btn-light rounded-circle" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button>
               <ul class="dropdown-menu dropdown-menu-end">
                  <li><a class="dropdown-item bookmark-btn ${p.bookmarked_by_me ? 'text-primary' : ''}" data-id="${p.id}" href="#">
                    <i class="bi ${p.bookmarked_by_me ? 'bi-bookmark-fill' : 'bi-bookmark'}"></i> ${p.bookmarked_by_me ? 'Saved' : 'Save Post'}
                  </a></li>
                  <li><a class="dropdown-item text-danger" href="#" onclick="deletePost(${p.id})">Remove</a></li>
               </ul>
            </div>
          </div>

          <div class="d-flex align-items-center gap-2 mb-2">
            <span class="badge ${badgeClass} text-uppercase ls-1" style="font-size:0.6rem">${escapeHtml(p.post_type || 'POST')}</span>
            <span class="badge bg-light text-dark border py-1" style="font-size:0.6rem">TARGET: ${escapeHtml(p.target_type)}</span>
          </div>

          <h5 class="fw-800 mb-2">${escapeHtml(p.title)}</h5>
          <div class="small text-muted flex-grow-1 mb-3">
             ${escapeHtml(p.content.substring(0, 150))}${p.content.length > 150 ? '...' : ''}
             ${p.content.length > 150 ? `<a href="#" class="read-more fw-600 ms-1" data-id="${p.id}">Read more</a>` : ''}
          </div>

          ${media}

          <div class="post-actions mt-auto">
            <button class="post-action-btn like-btn ${p.liked_by_me ? 'liked' : ''}" data-id="${p.id}">
              <i class="bi ${p.liked_by_me ? 'bi-heart-fill' : 'bi-heart'}"></i>
              <span>${p.like_count} likes</span>
            </button>
            <button class="post-action-btn share-btn" onclick="sharePost(${p.id})">
              <i class="bi bi-share"></i> <span>Share</span>
            </button>
          </div>
        </article>
      </div>`;
  }

  // --- Compose Logic ---
  function prepareCompose() {
    composeForm.reset();
    targetPickerWrap.classList.add('d-none');
  }

  const audienceSelect = document.getElementById('audienceSelect');
  const targetPickerWrap = document.getElementById('targetPickerWrap');
  const targetLabel = document.getElementById('targetLabel');
  const targetPicker = document.getElementById('targetPicker');

  audienceSelect.onchange = () => {
    const val = audienceSelect.value;
    targetPickerWrap.classList.toggle('d-none', val === 'all');
    if (val === 'department') {
      targetLabel.textContent = 'Select Target Departments';
      targetPicker.innerHTML = departmentsCache.map(d => `
        <input type="checkbox" class="btn-check target-cb" id="tgt_d_${d.id}" value="${d.id}" name="depts">
        <label class="btn btn-sm btn-outline-primary rounded-pill" for="tgt_d_${d.id}">${escapeHtml(d.name)}</label>
      `).join('');
    } else if (val === 'club') {
      targetLabel.textContent = 'Select Target Clubs';
      targetPicker.innerHTML = clubsCache.map(c => `
        <input type="checkbox" class="btn-check target-cb" id="tgt_c_${c.id}" value="${c.id}" name="clubs">
        <label class="btn btn-sm btn-outline-primary rounded-pill" for="tgt_c_${c.id}">${escapeHtml(c.name)}</label>
      `).join('');
    }
  };

  composeForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('composeBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Publishing...';

    const formData = new FormData();
    formData.append('title', document.getElementById('postTitle').value);
    formData.append('content', document.getElementById('postContent').value);
    formData.append('target_type', audienceSelect.value);
    formData.append('post_type', document.getElementById('postType').value);
    formData.append('post_level', 'college-wide'); // Basic mapping for now
    
    const imgFile = document.getElementById('postImage').files[0];
    if (imgFile) formData.append('image', imgFile);

    const checkedTargets = [...targetPicker.querySelectorAll('.target-cb:checked')].map(c => Number(c.value));
    if (audienceSelect.value === 'department') formData.append('department_ids', JSON.stringify(checkedTargets));
    if (audienceSelect.value === 'club') formData.append('club_ids', JSON.stringify(checkedTargets));

    try {
      // Use raw fetch for multipart/form-data
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (!res.ok) throw new Error('Upload failed');
      
      alert('Announcement Published!');
      composeForm.reset();
      targetPickerWrap.classList.add('d-none');
      document.querySelector('[data-tab="feed"]').click();
    } catch (err) { alert(err.message); }
    finally {
      btn.disabled = false;
      btn.innerHTML = 'Publish Post <i class="bi bi-arrow-right ms-2"></i>';
    }
  };

  // --- Subscriptions / Communities ---
  async function loadPublishers() {
    try {
      const data = await API.get('/api/users');
      const pubs = data.users.filter(u => u.role === 'publisher' || u.role === 'admin');
      publisherList.innerHTML = pubs.map(p => `
        <div class="col">
          <div class="card shadow-sm border-0 h-100 rounded-4 p-3 d-flex flex-row align-items-center gap-3">
             <div class="publisher-avatar bg-primary text-white fs-5 d-flex align-items-center justify-content-center rounded-circle" style="width:48px; height:48px;">
               ${initials(p.full_name)}
             </div>
             <div>
               <h6 class="mb-0 fw-bold">${escapeHtml(p.full_name)}</h6>
               <small class="text-muted">${escapeHtml(p.department_name || 'Campus Admin')}</small>
             </div>
             <button class="btn btn-sm btn-outline-primary rounded-pill ms-auto">Follow</button>
          </div>
        </div>
      `).join('');
    } catch (e) { console.error(e); }
  }

  // --- Admin Dashboard ---
  async function loadAdminDashboard() {
    try {
      const stats = await API.get('/api/admin/stats');
      analyticsBoard.innerHTML = `
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value">${stats.totalUsers}</div><div class="stat-label">Users</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value">${stats.totalPosts}</div><div class="stat-label">Posts</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value">${stats.totalClubs}</div><div class="stat-label">Clubs</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value">${stats.activeUsers}</div><div class="stat-label">7D Active</div></div></div>
        <div class="col-12 col-md-8 col-lg-4"><div class="stat-card bg-primary text-white"><div class="stat-value text-white">${stats.mostActiveClub}</div><div class="stat-label text-white-50">Most Active Community</div></div></div>
      `;
      loadUsersDirectory();
    } catch (e) {}
  }

  async function loadUsersDirectory() {
    const { users } = await API.get('/api/users');
    usersTbody.innerHTML = users.map(u => `
      <tr class="${u.is_banned ? 'bg-danger-subtle' : ''}">
        <td>
          <div class="d-flex align-items-center gap-2">
            <div class="publisher-avatar bg-light text-dark fw-bold border" style="width:32px; height:32px; font-size: 0.8rem;">${initials(u.full_name)}</div>
            <div>
              <div class="fw-bold fw-700">${escapeHtml(u.full_name)}</div>
              <div class="small text-muted">@${escapeHtml(u.username)}</div>
            </div>
          </div>
        </td>
        <td><span class="badge ${u.role === 'admin' ? 'bg-indigo' : 'bg-light text-dark border'}">${u.role}</span></td>
        <td>${escapeHtml(u.department_name || 'Generic')}</td>
        <td>
          <div class="d-flex gap-2">
            <button class="btn btn-xs btn-outline-danger" onclick="toggleBan(${u.id}, ${!u.is_banned})">${u.is_banned ? 'Unban' : 'Ban'}</button>
            <button class="btn btn-xs btn-outline-primary" onclick="promoteUser(${u.id})">Promote</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // --- Modal & Helpers ---
  function showPostModal(p) {
    const modal = new bootstrap.Modal(document.getElementById('postModal'));
    const content = document.getElementById('modalPostContent');
    content.innerHTML = `
      <div class="modal-header border-0 pb-0">
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body p-4 pt-0">
        <div class="post-header mb-4">
            <div class="post-publisher-avatar">${escapeHtml(initials(p.publisher_name))}</div>
            <div>
              <h5 class="mb-0 fw-800">${escapeHtml(p.publisher_name)}</h5>
              <span class="text-muted small">${escapeHtml(p.publisher_department || 'Campus')}</span>
            </div>
        </div>
        <h3 class="fw-800 mb-3">${escapeHtml(p.title)}</h3>
        <p class="text-muted" style="white-space:pre-wrap">${escapeHtml(p.content)}</p>
        ${p.image_url ? `<img src="${p.image_url}" class="w-100 rounded-4 shadow-sm mb-4">` : ''}
        <div class="text-muted small">Posted on ${new Date(p.created_at).toLocaleString()}</div>
      </div>
    `;
    modal.show();
  }

  // Filter Event Listeners
  document.querySelectorAll('.feed-filter').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.feed-filter').forEach(b => {
        b.classList.remove('btn-dark', 'active');
        b.classList.add('btn-outline-secondary');
      });
      btn.classList.add('btn-dark', 'active');
      btn.classList.remove('btn-outline-secondary');
      currentFilters.type = btn.dataset.type;
      loadFeed();
    };
  });

  deptFilter.onchange = () => {
    currentFilters.dept = deptFilter.value;
    loadFeed();
  };

  globalSearch.oninput = debounce(() => {
    currentFilters.q = globalSearch.value;
    loadFeed();
  }, 400);

  // General Helpers
  function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function initials(name) { return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(); }
  function timeAgo(ts) { 
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff/60) + 'm';
    if (diff < 86400) return Math.floor(diff/3600) + 'h';
    return new Date(ts).toLocaleDateString();
  }
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // Exposed Global Functions
  window.toggleBan = async (id, banned) => {
    if(!confirm(`Sure you want to ${banned ? 'ban' : 'unban'}?`)) return;
    await API.post(`/api/admin/users/${id}/ban`, { banned });
    loadAdminDashboard();
  };
  window.promoteUser = async (id) => {
     const role = prompt("Enter role (viewer, publisher, admin):");
     if(!role) return;
     await API.post(`/api/admin/users/${id}/role`, { role });
     loadAdminDashboard();
  };
  window.deletePost = async (id) => {
    if(!confirm('Relish this post?')) return;
    await API.del(`/api/posts/${id}`);
    loadFeed();
  };
  window.toggleLike = async (btn) => {
    const r = await API.post(`/api/posts/${btn.dataset.id}/like`);
    btn.classList.toggle('liked', r.liked);
    btn.querySelector('span').textContent = `${r.like_count} likes`;
  };
  window.toggleBookmark = async (btn) => {
    const r = await API.post(`/api/posts/${btn.dataset.id}/bookmark`);
    btn.classList.toggle('text-primary', r.bookmarked);
    btn.querySelector('i').className = `bi bi-bookmark${r.bookmarked ? '-fill' : ''}`;
  };
  window.sharePost = (id) => {
    navigator.clipboard.writeText(`${window.location.origin}/app.html?post=${id}`);
    alert('Link copied to clipboard!');
  };

})();
