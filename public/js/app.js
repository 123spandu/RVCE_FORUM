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
  const tabModeration = document.getElementById('tabModeration');
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
  let channelsCache = [];
  let currentFilters = { type: '', dept: '', q: '' };

  // --- Initialization ---
  whoAmI.textContent = user.full_name;
  if (user.role === 'publisher' || user.role === 'admin') tabCompose.classList.remove('d-none');
  // Moderation tab stays hidden (approval flow removed; panel hidden per product decision).
  if (user.role === 'admin') tabAdmin.classList.remove('d-none');

  // Init Data
  loadFeed();
  loadStories();
  loadMetadata(); // Load depts and clubs

  // Publishers always land on the Post/Compose tab (set up at the end of this
  // module, once all compose-section bindings have been initialized).

  // --- Network ---
  window.addEventListener('online', () => { if (offlineBadge) offlineBadge.classList.add('d-none'); loadFeed(); });
  window.addEventListener('offline', () => { if (offlineBadge) offlineBadge.classList.remove('d-none'); });

  // --- Tab Navigation ---
  function activateTab(target) {
    const tab = [...tabs].find(t => t.dataset.tab === target);
    if (!tab) return;
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    panes.forEach(p => p.classList.toggle('d-none', p.dataset.pane !== target));

    if (target === 'feed') loadFeed();
    if (target === 'admin') loadAdminDashboard();
    if (target === 'moderation') loadModeration();
    if (target === 'subs') loadCommunities();
    if (target === 'compose') prepareCompose();
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      activateTab(tab.dataset.tab);
    });
  });

  logoutBtn.addEventListener('click', () => { API.clearToken(); location.replace('/'); });

  // --- Metadata (Depts/Clubs) ---
  async function loadMetadata() {
    try {
      const [{ departments }, { clubs }, { channels }] = await Promise.all([
        API.get('/api/departments'),
        API.get('/api/clubs'),
        API.get('/api/channels')
      ]);
      departmentsCache = departments;
      clubsCache = clubs;
      channelsCache = channels || [];

      deptFilter.innerHTML = '<option value="">All Departments</option>' +
        departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');

      // The compose tab may already be showing (publishers land on it) before
      // channels finished loading — (re)populate the "From" dropdown now.
      populateFromCommunity();
    } catch (err) { console.error('Meta load fail', err); }
  }

  // Communities the current user is allowed to post from.
  function myPostableCommunities() {
    if (user.role === 'admin') return channelsCache;
    const managed = user.managed_club_ids || [];
    return channelsCache.filter(c =>
      (c.department_id != null && c.department_id === user.department_id) ||
      (c.club_id != null && managed.includes(c.club_id))
    );
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
            ${user.role === 'admin' ? `
            <div class="ms-auto dropdown">
               <button class="btn btn-sm btn-light rounded-circle" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button>
               <ul class="dropdown-menu dropdown-menu-end">
                  <li><a class="dropdown-item text-danger" href="#" onclick="deletePost(${p.id})"><i class="bi bi-trash me-1"></i>Delete</a></li>
               </ul>
            </div>` : ''}
          </div>

          <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
            <span class="badge ${badgeClass} text-uppercase ls-1" style="font-size:0.6rem">${escapeHtml(p.post_type || 'POST')}</span>
            ${p.community_name ? `<span class="badge bg-light text-dark border py-1" style="font-size:0.6rem"><i class="bi bi-broadcast me-1"></i>From: ${escapeHtml(p.community_name)}</span>` : ''}
            ${p.is_expired ? `<span class="badge bg-secondary py-1" style="font-size:0.6rem">EXPIRED</span>` : ''}
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
  const fromCommunity = document.getElementById('fromCommunity');
  const fromCommunityError = document.getElementById('fromCommunityError');
  const endDate = document.getElementById('endDate');
  const endDateError = document.getElementById('endDateError');

  function prepareCompose() {
    composeForm.reset();
    if (fromCommunityError) fromCommunityError.classList.add('d-none');
    if (endDateError) endDateError.classList.add('d-none');
    populateFromCommunity();
    refreshPendingBadge();
  }

  function populateFromCommunity() {
    const mine = myPostableCommunities();
    let html = '<option value="" disabled selected>Select community</option>';
    // Admins may also broadcast college-wide (no specific community).
    if (user.role === 'admin') {
      html = '<option value="" selected>Everyone (College Wide)</option>';
    }
    html += mine.map(c =>
      `<option value="${c.id}" data-type="${c.type}">${escapeHtml(c.name)}</option>`
    ).join('');
    fromCommunity.innerHTML = html;
  }

  composeForm.onsubmit = async (e) => {
    e.preventDefault();
    fromCommunityError.classList.add('d-none');
    endDateError.classList.add('d-none');

    const channelId = fromCommunity.value;
    const selectedOpt = fromCommunity.options[fromCommunity.selectedIndex];

    // Publishers must pick a community.
    if (user.role !== 'admin' && !channelId) {
      fromCommunityError.textContent = 'Please select a community to post from.';
      fromCommunityError.classList.remove('d-none');
      return;
    }

    // Validate optional expiry — must be in the future.
    let expiresAt = '';
    if (endDate.value) {
      const d = new Date(endDate.value);
      if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        endDateError.textContent = 'Expiry date must be in the future.';
        endDateError.classList.remove('d-none');
        return;
      }
      expiresAt = d.toISOString();
    }

    // Derive the post level from the selected community type.
    const chanType = selectedOpt ? selectedOpt.dataset.type : null;
    const level = chanType === 'department' ? 'department'
                : chanType === 'club' ? 'club'
                : 'college_wide';

    const btn = document.getElementById('composeBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Publishing...';

    const buildFormData = () => {
      const fd = new FormData();
      fd.append('title', document.getElementById('postTitle').value);
      fd.append('content', document.getElementById('postContent').value);
      fd.append('post_type', document.getElementById('postType').value);
      fd.append('post_level', level);
      if (channelId) fd.append('channel_id', channelId);
      if (expiresAt) fd.append('expires_at', expiresAt);
      const imgFile = document.getElementById('postImage').files[0];
      if (imgFile) fd.append('image', imgFile);
      return fd;
    };

    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: buildFormData()
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }

      alert('Announcement Published!');
      composeForm.reset();
      activateTab('feed');
    } catch (err) {
      // Offline publisher queue: save the post and sync on reconnect.
      if ((err.name === 'TypeError' || !navigator.onLine) && user.role === 'publisher' && window.CCQueue) {
        try {
          await window.CCQueue.savePendingPost({
            title: document.getElementById('postTitle').value,
            content: document.getElementById('postContent').value,
            post_type: document.getElementById('postType').value,
            post_level: level,
            channel_id: channelId || null,
            expires_at: expiresAt || null
          });
          await window.CCQueue.registerSync();
          showToast("You're offline. Your post has been saved and will be published when you reconnect.");
          composeForm.reset();
          refreshPendingBadge();
        } catch (qErr) {
          alert('Could not save post offline: ' + qErr.message);
        }
      } else {
        alert(err.message);
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Publish Post <i class="bi bi-arrow-right ms-2"></i>';
    }
  };

  // Pending offline posts badge on the compose tab.
  async function refreshPendingBadge() {
    if (user.role !== 'publisher' || !window.CCQueue) return;
    try {
      const pending = await window.CCQueue.getPendingPosts();
      let badge = document.getElementById('pendingPostsBadge');
      const tabLink = tabCompose ? tabCompose.querySelector('a') : null;
      if (!tabLink) return;
      if (pending.length > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.id = 'pendingPostsBadge';
          badge.className = 'badge bg-warning text-dark ms-1';
          tabLink.appendChild(badge);
        }
        badge.textContent = pending.length;
      } else if (badge) {
        badge.remove();
      }
    } catch (e) { /* ignore */ }
  }

  function showToast(message) {
    const el = document.createElement('div');
    el.className = 'toast-popup position-fixed bottom-0 start-50 translate-middle-x mb-4 px-4 py-3 bg-dark text-white rounded-pill shadow-lg';
    el.style.zIndex = '2000';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // --- Communities ---
  const communitiesList = document.getElementById('communitiesList');

  // Communities the publisher owns/manages — they are implicitly associated, so no Subscribe/Bell shown.
  function isOwnedCommunity(c) {
    if (user.role !== 'publisher') return false;
    const managed = user.managed_club_ids || [];
    return (c.department_id != null && c.department_id === user.department_id) ||
           (c.club_id != null && managed.includes(c.club_id));
  }

  async function loadCommunities() {
    try {
      const data = await API.get('/api/channels');
      channelsCache = data.channels || [];
      communitiesList.innerHTML = channelsCache.map(c => {
        const subscribed = c.my_status === 'approved';
        let controls = '';

        if (isOwnedCommunity(c)) {
          controls = `<span class="badge bg-light text-dark border ms-auto"><i class="bi bi-person-badge me-1"></i>Your community</span>`;
        } else if (subscribed) {
          const bellIcon = c.bell_enabled ? 'bi-bell-fill' : 'bi-bell';
          const bellTitle = c.bell_enabled ? 'Disable notifications' : 'Enable notifications';
          const bellClass = c.bell_enabled ? 'btn-warning' : 'btn-outline-secondary';
          controls = `
            <div class="ms-auto d-flex gap-2">
              <button class="btn btn-sm btn-success rounded-pill subscribed-btn" title="Click to unsubscribe"
                      onclick="window.unsubscribeCommunity(${c.id}, '${escapeHtml(c.name).replace(/'/g, "\\'")}')">
                <i class="bi bi-check-circle me-1"></i>Subscribed
              </button>
              <button class="btn btn-sm ${bellClass} rounded-circle bell-btn" title="${bellTitle}"
                      onclick="window.toggleBell(${c.id}, ${!c.bell_enabled})">
                <i class="bi ${bellIcon}"></i>
              </button>
            </div>`;
        } else {
          controls = `<button class="btn btn-sm btn-outline-primary rounded-pill ms-auto" onclick="window.subscribeCommunity(${c.id})">Subscribe</button>`;
        }

        const subtitle = c.type === 'department' ? 'Department' : 'Club';
        const icon = c.logo_url ? `<img src="${c.logo_url}" alt="logo" class="w-100 h-100 rounded-circle object-fit-cover">` : `<i class="bi bi-people-fill"></i>`;

        return `
        <div class="col">
          <div class="card shadow-sm border-0 h-100 rounded-4 p-3 d-flex flex-row align-items-center gap-3">
             <div class="bg-primary text-white fs-5 d-flex align-items-center justify-content-center rounded-circle overflow-hidden" style="width:48px; height:48px; flex-shrink: 0;">
               ${icon}
             </div>
             <div>
               <h6 class="mb-0 fw-bold">${escapeHtml(c.name)}</h6>
               <small class="text-muted">${subtitle}</small>
             </div>
             ${controls}
          </div>
        </div>
      `}).join('');
    } catch (e) { console.error(e); }
  }

  window.subscribeCommunity = async function(channelId) {
    try {
      await API.post(`/api/channels/${channelId}/subscribe`);
      loadCommunities();
    } catch (err) {
      alert(err.message || 'Error subscribing');
    }
  };

  window.unsubscribeCommunity = async function(channelId, name) {
    if (!confirm(`Unsubscribe from "${name}"? You'll stop seeing its posts and notifications.`)) return;
    try {
      await API.del(`/api/channels/${channelId}/subscribe`);
      loadCommunities();
    } catch (err) {
      alert(err.message || 'Error unsubscribing');
    }
  };

  // Bell toggles per-community push opt-in. Turning it ON also requests browser
  // notification permission; if the user blocks it, we show a banner and keep the bell off.
  window.toggleBell = async function(channelId, enable) {
    try {
      if (enable) {
        if ('Notification' in window && Notification.permission !== 'granted') {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') {
            showNotificationBlockedBanner();
            return; // do not mark bell active
          }
        }
      }
      await API.patch(`/api/channels/${channelId}/bell`, { enabled: enable });
      loadCommunities();
    } catch (err) {
      alert(err.message || 'Could not update notifications');
    }
  };

  function showNotificationBlockedBanner() {
    if (document.getElementById('notifBlockedBanner')) return;
    const el = document.createElement('div');
    el.id = 'notifBlockedBanner';
    el.className = 'alert alert-warning alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3 shadow';
    el.style.zIndex = '2000';
    el.innerHTML = 'Notifications blocked. Enable them in your browser settings to receive alerts.' +
      '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 7000);
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
      `;
      loadUsersDirectory();
      loadAdminCommunities();
      loadArchivedPosts();
    } catch (e) {
      console.error('Failed to load Admin Dashboard:', e);
    }
  }

  // --- Admin: Communities Management ---
  const adminCommunitiesList = document.getElementById('adminCommunitiesList');
  const commModalEl = document.getElementById('communityModal');
  const commForm = document.getElementById('communityForm');
  const commType = document.getElementById('commType');
  const commCode = document.getElementById('commCode');
  const commCodeLabel = document.getElementById('commCodeLabel');
  const commCodeHelp = document.getElementById('commCodeHelp');
  const commName = document.getElementById('commName');
  const commFormError = document.getElementById('communityFormError');

  async function loadAdminCommunities() {
    if (!adminCommunitiesList) return;
    try {
      const data = await API.get('/api/channels');
      channelsCache = data.channels || [];
      if (!channelsCache.length) {
        adminCommunitiesList.innerHTML = '<li class="list-group-item text-muted small">No communities yet.</li>';
        return;
      }
      adminCommunitiesList.innerHTML = channelsCache.map(c => `
        <li class="list-group-item d-flex justify-content-between align-items-center px-0">
          <span class="d-flex align-items-center gap-2">
            ${c.logo_url ? `<img src="${c.logo_url}" alt="logo" class="rounded-circle object-fit-cover" style="width:28px;height:28px;">` : ''}
            <span class="badge ${c.type === 'department' ? 'bg-info' : 'bg-primary'}">${c.type}</span>
            ${escapeHtml(c.name)}
          </span>
          <button class="btn btn-sm btn-outline-danger rounded-circle" title="Remove community"
                  onclick="window.removeCommunity(${c.id}, '${escapeHtml(c.name).replace(/'/g, "\\'")}')">
            <i class="bi bi-trash"></i>
          </button>
        </li>
      `).join('');
    } catch (e) {
      adminCommunitiesList.innerHTML = '<li class="list-group-item text-danger small">Failed to load.</li>';
    }
  }

  // Each community creates a NEW department/club — relabel the code field by type.
  function refreshCommTypeUi() {
    const isDept = commType.value === 'department';
    commCodeLabel.textContent = isDept ? 'Department Code' : 'Club Code';
    commCode.placeholder = isDept ? 'e.g. CSE' : 'e.g. DEBSOC';
    commCodeHelp.textContent = `A short unique code for this new ${isDept ? 'department' : 'club'}.`;
  }

  // Suggest a code from the name until the admin types their own.
  let commCodeEdited = false;
  if (commCode) commCode.addEventListener('input', () => { commCodeEdited = true; });
  if (commName) commName.addEventListener('input', () => {
    if (commCodeEdited) return;
    commCode.value = commName.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  });

  if (document.getElementById('addCommunityBtn')) {
    document.getElementById('addCommunityBtn').onclick = () => {
      commForm.reset();
      commCodeEdited = false;
      commFormError.classList.add('d-none');
      refreshCommTypeUi();
      new bootstrap.Modal(commModalEl).show();
    };
  }
  if (commType) commType.onchange = refreshCommTypeUi;

  if (commForm) {
    commForm.onsubmit = async (e) => {
      e.preventDefault();
      commFormError.classList.add('d-none');

      const fd = new FormData();
      fd.append('name', document.getElementById('commName').value.trim());
      fd.append('description', document.getElementById('commDesc').value.trim());
      fd.append('type', commType.value);
      fd.append('code', commCode.value.trim());
      const logoFile = document.getElementById('commLogo').files[0];
      if (logoFile) fd.append('logo', logoFile);

      const btn = document.getElementById('commSubmitBtn');
      btn.disabled = true;
      try {
        const res = await fetch('/api/admin/communities', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Could not create community');
        }
        bootstrap.Modal.getInstance(commModalEl).hide();
        loadAdminCommunities();
        loadMetadata();
      } catch (err) {
        commFormError.textContent = err.message || 'Could not create community';
        commFormError.classList.remove('d-none');
      } finally {
        btn.disabled = false;
      }
    };
  }

  window.removeCommunity = async function(id, name) {
    try {
      const { count } = await API.get(`/api/admin/communities/${id}/active-post-count`);
      let msg = `Remove community "${name}"?`;
      if (count > 0) {
        msg = `This community has ${count} active post(s). They will be moved to college-wide. Continue?`;
      }
      if (!confirm(msg)) return;
      await API.del(`/api/admin/communities/${id}`);
      loadAdminCommunities();
      loadMetadata();
    } catch (err) {
      alert(err.message || 'Could not remove community');
    }
  };

  // --- Admin: Archived (expired) posts ---
  async function loadArchivedPosts() {
    const wrap = document.getElementById('archivedPostsList');
    if (!wrap) return;
    try {
      const data = await API.get('/api/admin/expired-posts?limit=20');
      const rows = data.expired_posts || [];
      if (!rows.length) {
        wrap.innerHTML = '<div class="text-muted">No archived posts.</div>';
        return;
      }
      wrap.innerHTML = rows.map(p => `
        <div class="border-bottom py-2">
          <div class="fw-600">${escapeHtml(p.title)}</div>
          <div class="text-muted">${escapeHtml(p.publisher_name || 'Unknown')} · expired ${new Date(p.expires_at).toLocaleDateString()}</div>
        </div>
      `).join('');
    } catch (e) {
      wrap.innerHTML = '<div class="text-danger">Failed to load archive.</div>';
    }
  }

  // --- Moderation Dashboard (Publishers) ---
  async function loadModeration() {
    const pendingTbody = document.getElementById('pendingRequestsTbody');
    try {
      const { pending } = await API.get('/api/channels/pending');
      if (pending && pending.length > 0) {
        pendingTbody.innerHTML = pending.map(r => `
          <tr>
            <td>
              <div class="fw-bold">${escapeHtml(r.student_name)}</div>
              <div class="small text-muted">@${escapeHtml(r.student_username)}</div>
            </td>
            <td>${escapeHtml(r.student_department || 'Generic')}</td>
            <td><span class="badge bg-indigo text-white">${escapeHtml(r.channel_name)}</span></td>
            <td class="text-muted small">${new Date(r.created_at).toLocaleDateString()}</td>
            <td>
              <button class="btn btn-sm btn-success rounded-pill px-3" onclick="window.approveRequest(${r.channel_id}, ${r.subscriber_id})">Approve</button>
            </td>
          </tr>
        `).join('');
      } else {
        pendingTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No pending requests right now!</td></tr>';
      }
    } catch (err) {
      console.error('Failed to load moderation requests:', err);
    }
  }

  window.approveRequest = async function(channelId, subscriberId) {
    try {
      await API.post(`/api/channels/${channelId}/approve/${subscriberId}`);
      loadModeration();
    } catch (err) {
      alert(err.message || 'Error approving request');
    }
  };

  let usersCache = [];

  async function loadUsersDirectory() {
    const { users } = await API.get('/api/users');
    usersCache = users || [];
    renderUsers(usersCache);
  }

  function renderUsers(list) {
    if (!list.length) {
      usersTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">No members found.</td></tr>';
      return;
    }
    usersTbody.innerHTML = list.map(u => `
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

  function filterUsers(term) {
    const q = (term || '').trim().toLowerCase();
    if (!q) return renderUsers(usersCache);
    renderUsers(usersCache.filter(u =>
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q) ||
      (u.department_name || '').toLowerCase().includes(q)
    ));
  }

  const memberSearch = document.getElementById('memberSearch');
  if (memberSearch) memberSearch.oninput = debounce(() => filterUsers(memberSearch.value), 200);

  const refreshUsersBtn = document.getElementById('refreshUsersBtn');
  if (refreshUsersBtn) refreshUsersBtn.onclick = async () => {
    await loadUsersDirectory();
    if (memberSearch) filterUsers(memberSearch.value);
  };

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
  window.sharePost = (id) => {
    navigator.clipboard.writeText(`${window.location.origin}/app.html?post=${id}`);
    alert('Link copied to clipboard!');
  };

  // Publishers always land on the Post/Compose tab — on login AND on every (re)open.
  // Runs last so all compose-section bindings are initialized before activateTab().
  if (user.role === 'publisher') {
    sessionStorage.setItem('publisher_default_tab', 'compose');
    activateTab('compose');
  }

})();
