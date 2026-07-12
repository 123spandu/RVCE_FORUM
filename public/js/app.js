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
  const tabAnalytics = document.getElementById('tabAnalytics');
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
  let currentFilters = { type: '', dept: '', channel: '', q: '' };
  let flushingQueue = false; // guards maybeFlushQueue against overlapping runs

  // --- Initialization ---
  whoAmI.textContent = user.full_name + (user.department_name ? ` · ${user.department_name}` : '');
  if (user.role === 'publisher' || user.role === 'admin') tabCompose.classList.remove('d-none');
  // Moderation tab stays hidden (approval flow removed; panel hidden per product decision).
  if (user.role === 'publisher' || user.role === 'admin') {
    if (tabAnalytics) tabAnalytics.classList.remove('d-none');
  }
  if (user.role === 'admin') tabAdmin.classList.remove('d-none');

  // Show the right pane immediately so students see Dashboard (not a blank/stale Feed).
  function activateTab(target) {
    const tab = [...tabs].find(t => t.dataset.tab === target);
    if (!tab) return;
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    panes.forEach(p => p.classList.toggle('d-none', p.dataset.pane !== target));

    if (target === 'home') loadPersonalizedDashboard();
    if (target === 'feed') loadFeed();
    if (target === 'analytics') loadPublisherAnalytics();
    if (target === 'admin') loadAdminDashboard();
    if (target === 'moderation') loadModeration();
    if (target === 'subs') loadCommunities();
    if (target === 'compose') prepareCompose();
  }

  if (user.role === 'viewer') activateTab('home');
  else if (user.role !== 'publisher') activateTab('feed');

  // Init Data
  if (user.role !== 'viewer') loadFeed();
  loadStories();
  loadMetadata(); // Load depts and clubs
  // --- Network + Offline Sync ---
  const canOfflineSync = user.role === 'publisher' || user.role === 'admin';
  const composeOfflineHint = document.getElementById('composeOfflineHint');
  const offlineSyncBanner = document.getElementById('offlineSyncBanner');
  const offlineSyncBannerTitle = document.getElementById('offlineSyncBannerTitle');
  const offlineSyncBannerText = document.getElementById('offlineSyncBannerText');
  const offlineSyncBannerIcon = document.getElementById('offlineSyncBannerIcon');
  const offlineSyncNowBtn = document.getElementById('offlineSyncNowBtn');
  const offlineDraftsCard = document.getElementById('offlineDraftsCard');
  const offlineDraftsList = document.getElementById('offlineDraftsList');
  const syncDraftsBtn = document.getElementById('syncDraftsBtn');
  const saveOfflineDraftBtn = document.getElementById('saveOfflineDraftBtn');

  function updateOnlineUi() {
    const online = navigator.onLine;
    if (offlineBadge) offlineBadge.classList.toggle('d-none', online);
    if (composeOfflineHint) composeOfflineHint.classList.toggle('d-none', online || !canOfflineSync);
  }

  function showSyncBanner(kind, title, text, showSyncBtn) {
    if (!offlineSyncBanner) return;
    offlineSyncBanner.classList.remove('d-none', 'd-flex', 'alert-warning', 'alert-info', 'alert-success', 'alert-danger');
    offlineSyncBanner.classList.add('d-flex');
    const map = {
      offline: 'alert-warning',
      syncing: 'alert-info',
      success: 'alert-success',
      error: 'alert-danger'
    };
    offlineSyncBanner.classList.add(map[kind] || 'alert-info');
    if (offlineSyncBannerIcon) {
      offlineSyncBannerIcon.className = 'bi fs-5 ' + ({
        offline: 'bi-wifi-off',
        syncing: 'bi-arrow-repeat',
        success: 'bi-cloud-check-fill',
        error: 'bi-exclamation-triangle-fill'
      }[kind] || 'bi-cloud-arrow-up-fill');
    }
    if (offlineSyncBannerTitle) offlineSyncBannerTitle.textContent = title;
    if (offlineSyncBannerText) offlineSyncBannerText.textContent = text;
    if (offlineSyncNowBtn) offlineSyncNowBtn.classList.toggle('d-none', !showSyncBtn);
  }

  function hideSyncBannerSoon() {
    setTimeout(() => {
      if (offlineSyncBanner && navigator.onLine) {
        offlineSyncBanner.classList.add('d-none');
        offlineSyncBanner.classList.remove('d-flex');
      }
    }, 4500);
  }

  updateOnlineUi();
  if (!navigator.onLine && canOfflineSync) {
    showSyncBanner('offline', 'You are offline', 'Write your announcement — it will be saved as a draft and auto-sync when internet returns.', false);
  }

  window.addEventListener('online', async () => {
    updateOnlineUi();
    showSyncBanner('syncing', 'Back online', 'Syncing offline drafts…', false);
    await maybeFlushQueue();
  });
  window.addEventListener('offline', () => {
    updateOnlineUi();
    if (canOfflineSync) {
      showSyncBanner('offline', 'You are offline', 'New posts will be saved as drafts and sync automatically later.', false);
    }
  });

  // Service worker Background Sync → flush drafts
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'FLUSH_PENDING_POSTS') maybeFlushQueue();
      if (event.data && event.data.type === 'FLUSH_PENDING_ACTIONS' && window.CCEngage) {
        window.CCEngage.syncAll({ token }).then((r) => {
          if (r.synced > 0) showToast(`Synced ${r.synced} offline like/bookmark action${r.synced > 1 ? 's' : ''}.`);
        }).catch(() => {});
      }
    });
  }

  if (navigator.onLine) {
    maybeFlushQueue();
    if (window.CCEngage) window.CCEngage.syncAll({ token }).catch(() => {});
  }
  if (window.CCQueue) {
    window.CCQueue.onChange(() => {
      refreshPendingBadge();
      renderOfflineDrafts();
    });
  }

  // --- Tab Navigation ---
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      activateTab(tab.dataset.tab);
    });
  });

  document.querySelectorAll('[data-tab-jump]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      activateTab(el.getAttribute('data-tab-jump'));
    });
  });

  // --- Personalized Dashboard (Home) ---
  function dashEmpty(msg) {
    return `<div class="dash-empty text-muted small">${msg}</div>`;
  }

  function dashNoticeRow(item, meta) {
    const type = escapeHtml(item.post_type || 'notice');
    return `
      <button type="button" class="dash-item text-start w-100" data-dash-post="${item.id}">
        <div class="dash-item-title">${escapeHtml(item.title)}</div>
        <div class="dash-item-meta">
          ${item.community_name ? `<span>${escapeHtml(item.community_name)}</span> · ` : ''}
          <span class="text-uppercase" style="font-size:0.65rem">${type}</span>
          ${meta ? ` · ${meta}` : ''}
        </div>
      </button>`;
  }

  function openDepartmentBoard(deptId, channelId) {
    currentFilters.dept = deptId ? String(deptId) : '';
    currentFilters.channel = channelId ? String(channelId) : '';
    if (deptFilter) deptFilter.value = currentFilters.dept;
    activateTab('feed');
  }

  async function loadPersonalizedDashboard() {
    const greet = document.getElementById('dashGreeting');
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    if (greet) greet.textContent = `${hello}, ${user.full_name.split(' ')[0]}`;

    const els = {
      dept: document.getElementById('dashDepartment'),
      today: document.getElementById('dashToday'),
      deadlines: document.getElementById('dashDeadlines'),
      events: document.getElementById('dashEvents'),
      clubs: document.getElementById('dashClubs'),
      attendance: document.getElementById('dashAttendance'),
      assignments: document.getElementById('dashAssignments'),
      bookmarks: document.getElementById('dashBookmarks')
    };
    Object.values(els).forEach(el => { if (el) el.innerHTML = '<div class="text-muted small">Loading…</div>'; });

    try {
      const data = await API.get('/api/dashboard');
      const myDept = data.my_department;
      const deptTitle = document.getElementById('dashDeptTitle');
      const deptOpen = document.getElementById('dashDeptOpenFeed');
      const deptWrap = document.getElementById('dashDeptWrap');

      if (myDept) {
        if (deptWrap) deptWrap.classList.remove('d-none');
        if (deptTitle) deptTitle.textContent = myDept.name || 'My Department';
        if (deptOpen) {
          deptOpen.onclick = (e) => {
            e.preventDefault();
            openDepartmentBoard(myDept.id, myDept.channel_id);
          };
        }
        if (els.dept) {
          els.dept.innerHTML = myDept.posts?.length
            ? myDept.posts.map(p => dashNoticeRow(p, timeAgo(p.created_at))).join('')
            : dashEmpty('No notices on your department board yet.');
        }
      } else if (deptWrap) {
        deptWrap.classList.add('d-none');
      }

      if (els.today) {
        els.today.innerHTML = data.today_updates?.length
          ? data.today_updates.map(p => dashNoticeRow(p, timeAgo(p.created_at))).join('')
          : dashEmpty('No new updates today. Check the Feed for earlier notices.');
      }

      if (els.deadlines) {
        els.deadlines.innerHTML = data.upcoming_deadlines?.length
          ? data.upcoming_deadlines.map(p => dashNoticeRow(p, `due ${new Date(p.expires_at).toLocaleDateString()}`)).join('')
          : dashEmpty('No deadlines in the next two weeks.');
      }

      if (els.events) {
        els.events.innerHTML = data.events?.length
          ? data.events.map(p => dashNoticeRow(p, p.expires_at ? `until ${new Date(p.expires_at).toLocaleDateString()}` : '')).join('')
          : dashEmpty('No upcoming events in your communities.');
      }

      if (els.clubs) {
        els.clubs.innerHTML = data.subscribed_clubs?.length
          ? data.subscribed_clubs.map(c => `
              <div class="dash-club">
                <div class="dash-club-avatar">${escapeHtml((c.name || '?').slice(0, 1).toUpperCase())}</div>
                <div class="flex-grow-1 min-w-0">
                  <div class="fw-700 text-truncate">${escapeHtml(c.name)}</div>
                  <div class="small text-muted text-truncate">${escapeHtml(c.description || 'Club updates')}</div>
                </div>
                ${c.bell_enabled ? '<i class="bi bi-bell-fill text-success" title="Alerts on"></i>' : '<i class="bi bi-bell-slash text-muted" title="Alerts off"></i>'}
              </div>`).join('')
          : dashEmpty('Subscribe to clubs under Communities to see them here.');
      }

      if (els.attendance) {
        const att = data.attendance_alerts || {};
        els.attendance.innerHTML = `
          <div class="dash-coming-soon">
            <i class="bi bi-clock-history me-2"></i>
            ${escapeHtml(att.message || 'Attendance alerts are coming soon.')}
          </div>`;
      }

      if (els.assignments) {
        els.assignments.innerHTML = data.assignments?.length
          ? data.assignments.map(a => `
              <div class="dash-item">
                <div class="d-flex justify-content-between gap-2 align-items-start">
                  <div class="dash-item-title">${escapeHtml(a.title)}</div>
                  ${a.is_overdue ? '<span class="badge bg-danger">Overdue</span>' : ''}
                </div>
                <div class="dash-item-meta">
                  ${a.community_name ? escapeHtml(a.community_name) + ' · ' : ''}
                  Due ${new Date(a.due_at).toLocaleString()}
                </div>
                ${a.body ? `<div class="small text-muted mt-1">${escapeHtml(a.body)}</div>` : ''}
              </div>`).join('')
          : dashEmpty('No assignments due soon.');
      }

      if (els.bookmarks) {
        els.bookmarks.innerHTML = data.bookmarks?.length
          ? `<div class="row g-2">${data.bookmarks.map(p => `
              <div class="col-12 col-md-6 col-lg-4">
                <button type="button" class="dash-bookmark w-100 text-start" data-dash-post="${p.id}">
                  <div class="fw-700 text-truncate">${escapeHtml(p.title)}</div>
                  <div class="small text-muted text-truncate">${escapeHtml(p.community_name || p.publisher_name || '')}</div>
                </button>
              </div>`).join('')}</div>`
          : dashEmpty('Bookmark notices from the Feed to find them here.');
      }

      document.querySelectorAll('[data-dash-post]').forEach(btn => {
        btn.onclick = async () => {
          try {
            const qs = currentFilters.dept ? `?dept=${encodeURIComponent(currentFilters.dept)}` : '';
            const { posts } = await API.get('/api/posts' + qs);
            const post = (posts || []).find(x => String(x.id) === String(btn.dataset.dashPost));
            if (post) showPostModal(post);
            else activateTab('feed');
          } catch (_) {
            activateTab('feed');
          }
        };
      });
    } catch (err) {
      Object.values(els).forEach(el => {
        if (el) el.innerHTML = '<div class="text-danger small">Could not load this section.</div>';
      });
    }
  }

  logoutBtn.addEventListener('click', () => { API.clearToken(); location.replace('/'); });

  // --- Engagement tracking (views / CTR clicks) ---
  const viewedPostIds = new Set();
  function trackView(postId) {
    const id = Number(postId);
    if (!id || viewedPostIds.has(id)) return;
    viewedPostIds.add(id);
    API.post('/api/analytics/view', { post_id: id }).catch(() => {});
  }
  function trackClick(postId) {
    const id = Number(postId);
    if (!id) return;
    API.post('/api/analytics/click', { post_id: id }).catch(() => {});
  }

  // --- Publisher Analytics Dashboard ---
  const analyticsCharts = { engagement: null, hours: null, dept: null };

  function destroyAnalyticsCharts() {
    Object.keys(analyticsCharts).forEach(k => {
      if (analyticsCharts[k]) {
        analyticsCharts[k].destroy();
        analyticsCharts[k] = null;
      }
    });
  }

  function chartTextColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#14241c';
  }
  function chartMutedColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#64766d';
  }

  function renderHeatmap(cells) {
    const wrap = document.getElementById('analyticsHeatmap');
    if (!wrap) return;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    const map = new Map(cells.map(c => [`${c.dow}-${c.hour}`, c.count]));
    let max = 1;
    cells.forEach(c => { if (hours.includes(c.hour) && c.count > max) max = c.count; });

    let html = '<div class="hm-corner"></div>';
    hours.forEach(h => { html += `<div class="hm-hour">${h}</div>`; });
    days.forEach((day, dow) => {
      html += `<div class="hm-day">${day}</div>`;
      hours.forEach(h => {
        const n = map.get(`${dow}-${h}`) || 0;
        const intensity = n === 0 ? 0 : 0.15 + (n / max) * 0.85;
        html += `<div class="hm-cell" style="--hm:${intensity.toFixed(2)}" title="${day} ${h}:00 — ${n} engagements"></div>`;
      });
    });
    wrap.innerHTML = html;
  }

  async function loadPublisherAnalytics() {
    const kpi = document.getElementById('pubAnalyticsKpis');
    const scopeLabel = document.getElementById('analyticsScopeLabel');
    const peakLabel = document.getElementById('peakHourLabel');
    const tbody = document.querySelector('#analyticsTopPostsTable tbody');
    if (kpi) kpi.innerHTML = '<div class="col-12 text-muted small">Loading analytics…</div>';

    try {
      const data = await API.get('/api/analytics/publisher');
      const t = data.totals || {};
      if (scopeLabel) {
        scopeLabel.textContent = data.scope === 'campus'
          ? 'Campus-wide publisher metrics — views, engagement, reach, and peak activity.'
          : 'Your posts and communities — views, engagement, reach, and peak activity.';
      }

      if (kpi) {
        const cards = [
          { label: 'Views', value: t.views, sub: `${t.unique_views || 0} unique`, icon: 'bi-eye' },
          { label: 'Likes', value: t.likes, icon: 'bi-heart' },
          { label: 'Bookmarks', value: t.bookmarks, icon: 'bi-bookmark' },
          { label: 'Subscribers', value: t.subscribers, icon: 'bi-people' },
          { label: 'CTR', value: `${t.ctr || 0}%`, sub: `${t.clicks || 0} clicks`, icon: 'bi-cursor' },
          { label: 'Posts', value: t.posts, icon: 'bi-file-earmark-text' }
        ];
        kpi.innerHTML = cards.map(c => `
          <div class="col-6 col-md-4 col-xl-2">
            <div class="stat-card analytics-kpi h-100">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <span class="text-muted small fw-600">${c.label}</span>
                <i class="bi ${c.icon} text-success"></i>
              </div>
              <div class="fw-800 fs-4">${c.value}</div>
              ${c.sub ? `<div class="small text-muted">${c.sub}</div>` : ''}
            </div>
          </div>`).join('');
      }

      if (peakLabel && data.most_active_time) {
        peakLabel.innerHTML = `Peak hour: <strong>${escapeHtml(data.most_active_time.peak_label)}</strong>`;
      }

      destroyAnalyticsCharts();
      if (typeof Chart === 'undefined') {
        console.warn('Chart.js not loaded');
      } else {
        const text = chartTextColor();
        const muted = chartMutedColor();

        // Fill 14-day series
        const days = [];
        for (let i = 13; i >= 0; i--) {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() - i);
          days.push(d.toISOString().slice(0, 10));
        }
        const byDay = new Map((data.daily_engagement || []).map(r => {
          const key = typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10);
          return [key, r];
        }));

        const engCanvas = document.getElementById('chartEngagement');
        if (engCanvas) {
          analyticsCharts.engagement = new Chart(engCanvas, {
            type: 'line',
            data: {
              labels: days.map(d => d.slice(5)),
              datasets: [
                {
                  label: 'Views',
                  data: days.map(d => (byDay.get(d) || {}).views || 0),
                  borderColor: '#0f7a4d',
                  backgroundColor: 'rgba(15,122,77,0.12)',
                  fill: true,
                  tension: 0.35
                },
                {
                  label: 'Likes',
                  data: days.map(d => (byDay.get(d) || {}).likes || 0),
                  borderColor: '#f43f5e',
                  backgroundColor: 'transparent',
                  tension: 0.35
                },
                {
                  label: 'Clicks',
                  data: days.map(d => (byDay.get(d) || {}).clicks || 0),
                  borderColor: '#14b8a6',
                  backgroundColor: 'transparent',
                  tension: 0.35
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { labels: { color: muted } } },
              scales: {
                x: { ticks: { color: muted }, grid: { color: 'rgba(100,118,109,0.12)' } },
                y: { beginAtZero: true, ticks: { color: muted }, grid: { color: 'rgba(100,118,109,0.12)' } }
              }
            }
          });
        }

        const hourCanvas = document.getElementById('chartActiveHours');
        if (hourCanvas) {
          const hours = (data.most_active_time?.by_hour || []).filter(h => h.hour >= 7 && h.hour <= 22);
          analyticsCharts.hours = new Chart(hourCanvas, {
            type: 'bar',
            data: {
              labels: hours.map(h => `${h.hour}`),
              datasets: [{
                label: 'Engagement',
                data: hours.map(h => h.count),
                backgroundColor: hours.map(h =>
                  h.hour === data.most_active_time.peak_hour ? '#0f7a4d' : 'rgba(20,184,166,0.45)'
                ),
                borderRadius: 6
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: muted }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: muted }, grid: { color: 'rgba(100,118,109,0.12)' } }
              }
            }
          });
        }

        const deptCanvas = document.getElementById('chartDeptReach');
        if (deptCanvas) {
          const depts = data.department_reach || [];
          analyticsCharts.dept = new Chart(deptCanvas, {
            type: 'doughnut',
            data: {
              labels: depts.length ? depts.map(d => d.name) : ['No reach yet'],
              datasets: [{
                data: depts.length ? depts.map(d => d.reach) : [1],
                backgroundColor: depts.length
                  ? ['#0f7a4d', '#14b8a6', '#0ea5e9', '#f59e0b', '#f43f5e', '#8b5cf6', '#64748b']
                  : ['#e2e8f0']
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'bottom', labels: { color: muted, boxWidth: 12 } }
              }
            }
          });
        }
      }

      renderHeatmap(data.heatmap || []);

      if (tbody) {
        const rows = data.top_posts || [];
        tbody.innerHTML = rows.length
          ? rows.map(p => `
              <tr>
                <td>
                  <div class="fw-600">${escapeHtml(p.title)}</div>
                  <div class="small text-muted text-uppercase" style="font-size:0.65rem">${escapeHtml(p.post_type || '')}</div>
                </td>
                <td class="text-end">${p.views}</td>
                <td class="text-end">${p.likes}</td>
                <td class="text-end">${p.bookmarks}</td>
                <td class="text-end">${p.ctr}%</td>
              </tr>`).join('')
          : '<tr><td colspan="5" class="text-muted small">No posts yet — publish to see analytics.</td></tr>';
      }
    } catch (err) {
      if (kpi) kpi.innerHTML = `<div class="col-12 text-danger small">${escapeHtml(err.message || 'Failed to load analytics')}</div>`;
    }
  }

  const analyticsRefreshBtn = document.getElementById('analyticsRefreshBtn');
  if (analyticsRefreshBtn) {
    analyticsRefreshBtn.addEventListener('click', () => loadPublisherAnalytics());
  }
  window.addEventListener('cc-theme-change', () => {
    const analyticsPane = document.querySelector('[data-pane="analytics"]');
    if (analyticsPane && !analyticsPane.classList.contains('d-none')) {
      loadPublisherAnalytics();
    }
  });

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

      populateAudienceCommunities();

      // The compose tab may already be showing (publishers land on it) before
      // channels finished loading — (re)populate the "From" dropdown now.
      populateFromCommunity();
    } catch (err) { console.error('Meta load fail', err); }
  }

  // Communities available in "Post From" — show every department & club
  // (same as before; all communities are public).
  function myPostableCommunities() {
    return channelsCache.slice().sort((a, b) => {
      if (a.type !== b.type) return a.type === 'department' ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  // --- Feed & Stories ---
  function updateFeedChrome() {
    const title = document.getElementById('feedTitle');
    const subtitle = document.getElementById('feedSubtitle');
    const clearBtn = document.getElementById('clearDeptFilterBtn');
    const deptId = currentFilters.dept ? Number(currentFilters.dept) : null;
    const dept = departmentsCache.find(d => Number(d.id) === deptId);
    const channel = channelsCache.find(c => String(c.id) === String(currentFilters.channel));

    if (dept || channel) {
      const name = dept?.name || channel?.name || 'Department';
      if (title) title.textContent = `${name} board`;
      if (subtitle) subtitle.textContent = 'All notices posted from or targeted to this department';
      if (clearBtn) clearBtn.classList.remove('d-none');
    } else {
      if (title) title.textContent = 'Campus Feed';
      if (subtitle) subtitle.textContent = 'College-wide notices plus communities you follow';
      if (clearBtn) clearBtn.classList.add('d-none');
    }
  }

  async function loadFeed() {
    updateFeedChrome();
    const params = new URLSearchParams();
    if (currentFilters.type) params.set('type', currentFilters.type);
    if (currentFilters.dept) params.set('dept', currentFilters.dept);
    if (currentFilters.channel) params.set('channel', currentFilters.channel);
    if (currentFilters.q) params.set('q', currentFilters.q);
    const query = params.toString();
    feedList.innerHTML = `<div class="col-12 text-center py-5"><div class="spinner-border text-primary"></div></div>`;
    try {
      const data = await API.get(`/api/posts${query ? `?${query}` : ''}`);
      renderFeed(data.posts || []);
    } catch (err) {
      feedList.innerHTML = `<div class="alert alert-danger mx-3">Could not load feed</div>`;
    }
  }

  async function loadStories() {
    if (!storiesContainer) return;
    try {
      const data = await API.get('/api/posts/stories');
      const stories = data.stories || [];
      const addBtn = document.getElementById('addStoryBtn');

      storiesContainer.innerHTML = '';
      if (addBtn) storiesContainer.appendChild(addBtn);

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
    } catch (e) { }
  }

  function renderFeed(posts) {
    if (!posts.length) {
      const browsing = !!(currentFilters.dept || currentFilters.channel);
      feedList.innerHTML = `<div class="col-12 text-center py-5">
        <img src="https://cdni.iconscout.com/illustration/premium/thumb/empty-state-2130362-1800505.png" style="width:200px" class="mb-3 opacity-50" alt="">
        <br><span class="text-muted d-block mb-2">${browsing ? 'No notices for this department yet.' : 'No posts in your feed yet.'}</span>
        <span class="text-muted small">${browsing
          ? 'Try another department, or clear the filter to see your personalized feed.'
          : 'Subscribe to departments and clubs under <strong>Communities</strong> to follow their updates. College-wide announcements always appear here.'}</span>
      </div>`;
      return;
    }
    feedList.innerHTML = posts.map(p => postCardHtml(p)).join('');
    posts.forEach(p => trackView(p.id));
    // Wire up events
    feedList.querySelectorAll('.read-more').forEach(btn => {
      btn.onclick = () => {
        trackClick(btn.dataset.id);
        showPostModal(posts.find(x => x.id == btn.dataset.id));
      };
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
            ${p.audience_count > 0
              ? `<span class="badge bg-warning-subtle text-dark border border-warning py-1" style="font-size:0.6rem" title="${escapeHtml(p.audience_names || '')}"><i class="bi bi-building me-1"></i>To: ${escapeHtml(p.audience_names || 'Selected departments')}</span>`
              : `<span class="badge bg-info-subtle text-dark border border-info py-1" style="font-size:0.6rem"><i class="bi bi-globe me-1"></i>College-wide</span>`}
            ${p.is_subscribed ? `<span class="badge bg-success-subtle text-success border border-success py-1" style="font-size:0.6rem"><i class="bi bi-check-circle-fill me-1"></i>Subscribed</span>` : ''}
            ${p.is_scheduled ? `<span class="badge bg-primary-subtle text-primary border border-primary py-1" style="font-size:0.6rem"><i class="bi bi-clock me-1"></i>Scheduled</span>` : ''}
            ${p.expires_at && !p.is_expired ? `<span class="badge bg-light text-dark border py-1" style="font-size:0.6rem"><i class="bi bi-hourglass-split me-1"></i>Expires ${new Date(p.expires_at).toLocaleDateString()}</span>` : ''}
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
            <button class="post-action-btn bookmark-btn ${p.bookmarked_by_me ? 'bookmarked' : ''}" data-id="${p.id}" title="Bookmark">
              <i class="bi ${p.bookmarked_by_me ? 'bi-bookmark-fill' : 'bi-bookmark'}"></i>
              <span>${p.bookmarked_by_me ? 'Saved' : 'Save'}</span>
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
  const scheduledAtInput = document.getElementById('scheduledAt');
  const scheduledAtError = document.getElementById('scheduledAtError');

  // ---- Audience (department / group targeting) ----
  // "all" = college-wide. "communities" = only students in selected departments
  // (by department membership) and/or subscribers of selected clubs.
  function populateAudienceCommunities() {
    const list = document.getElementById('audienceDeptList');
    if (!list) return;
    const depts = channelsCache.filter(c => c.type === 'department');
    const clubs = channelsCache.filter(c => c.type === 'club');
    const row = c => `
      <div class="form-check audience-row" data-name="${escapeHtml(c.name).toLowerCase()}" data-type="${c.type}">
        <input class="form-check-input audience-dept" type="checkbox" value="${c.id}" id="audCh${c.id}"
          data-type="${c.type}" data-label="${escapeHtml(c.name)}">
        <label class="form-check-label small" for="audCh${c.id}">${escapeHtml(c.name)}</label>
      </div>`;
    const section = (title, items) => items.length
      ? `<div class="text-muted text-uppercase fw-700 mt-1 mb-1" style="font-size:0.65rem; letter-spacing:.05em">${title}</div>${items.map(row).join('')}`
      : '';
    list.innerHTML = section('Departments', depts) + section('Clubs / groups', clubs);
    syncAudienceUI();
  }

  // Returns { visibility, ids, mode } from the current dropdown state.
  function getAudienceSelection() {
    const modeEl = document.querySelector('input[name="audienceMode"]:checked');
    const mode = modeEl ? modeEl.value : 'all';
    const ids = Array.from(document.querySelectorAll('.audience-dept:checked')).map(c => Number(c.value));
    if (mode === 'communities') {
      return { visibility: 'communities', ids, mode };
    }
    return { visibility: 'all', ids: [], mode: 'all' };
  }

  function syncAudienceUI() {
    const modeEl = document.querySelector('input[name="audienceMode"]:checked');
    const mode = modeEl ? modeEl.value : 'all';
    const wrap = document.getElementById('audienceDeptListWrap');
    const label = document.getElementById('audienceLabel');
    const commMode = mode === 'communities';
    if (wrap) wrap.classList.toggle('opacity-50', !commMode);
    document.querySelectorAll('.audience-dept').forEach(c => { c.disabled = !commMode; });
    const search = document.getElementById('audienceSearch');
    if (search) search.disabled = !commMode;
    if (!label) return;
    if (commMode) {
      const checked = Array.from(document.querySelectorAll('.audience-dept:checked'));
      if (checked.length === 0) {
        label.innerHTML = '<i class="bi bi-building me-2"></i>Select departments…';
      } else if (checked.length === 1) {
        const name = checked[0].dataset.label || '1 department';
        label.innerHTML = `<i class="bi bi-building me-2"></i>${escapeHtml(name)}`;
      } else {
        label.innerHTML = `<i class="bi bi-building me-2"></i>${checked.length} departments / groups`;
      }
    } else {
      label.innerHTML = '<i class="bi bi-globe me-2"></i>Everyone in the institution';
    }
  }

  function resetAudienceSelection() {
    const all = document.getElementById('audienceAll');
    if (all) all.checked = true;
    document.querySelectorAll('.audience-dept').forEach(c => { c.checked = false; });
    const search = document.getElementById('audienceSearch');
    if (search) search.value = '';
    document.querySelectorAll('.audience-row').forEach(r => r.classList.remove('d-none'));
    const audienceError = document.getElementById('audienceError');
    if (audienceError) audienceError.classList.add('d-none');
    syncAudienceUI();
  }

  // When "Post From" is a department/club, default Visible To to that same audience
  // so department notices are not accidentally published college-wide.
  function applyAudienceFromCommunity() {
    const channelId = fromCommunity.value;
    const selectedOpt = fromCommunity.options[fromCommunity.selectedIndex];
    const chanType = selectedOpt ? selectedOpt.dataset.type : null;
    if (!channelId || (chanType !== 'department' && chanType !== 'club')) {
      return;
    }
    const deptsRadio = document.getElementById('audienceDepts');
    if (deptsRadio) deptsRadio.checked = true;
    document.querySelectorAll('.audience-dept').forEach(c => {
      c.checked = String(c.value) === String(channelId);
    });
    syncAudienceUI();
  }

  const audienceMenu = document.getElementById('audienceMenu');
  if (audienceMenu) {
    audienceMenu.addEventListener('change', (e) => {
      if (e.target.classList.contains('audience-dept') && e.target.checked) {
        const deptsRadio = document.getElementById('audienceDepts');
        if (deptsRadio) deptsRadio.checked = true;
      }
      syncAudienceUI();
    });
    const search = document.getElementById('audienceSearch');
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        document.querySelectorAll('.audience-row').forEach(r => {
          r.classList.toggle('d-none', q && !r.dataset.name.includes(q));
        });
      });
    }
  }

  if (fromCommunity) {
    fromCommunity.addEventListener('change', applyAudienceFromCommunity);
  }

  function populateFromCommunity() {
    const mine = myPostableCommunities();
    const depts = mine.filter(c => c.type === 'department');
    const clubs = mine.filter(c => c.type === 'club');
    let html = '<option value="" disabled selected>Select community</option>';
    if (user.role === 'admin') {
      html = '<option value="" selected>College-wide (no specific community)</option>';
    }
    if (depts.length) {
      html += '<optgroup label="Departments">';
      html += depts.map(c =>
        `<option value="${c.id}" data-type="${c.type}">${escapeHtml(c.name)}</option>`
      ).join('');
      html += '</optgroup>';
    }
    if (clubs.length) {
      html += '<optgroup label="Clubs / groups">';
      html += clubs.map(c =>
        `<option value="${c.id}" data-type="${c.type}">${escapeHtml(c.name)}</option>`
      ).join('');
      html += '</optgroup>';
    }
    fromCommunity.innerHTML = html;
  }

  function defaultExpiryLocalValue() {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    // datetime-local needs local YYYY-MM-DDTHH:mm
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function prepareCompose() {
    composeForm.reset();
    if (fromCommunityError) fromCommunityError.classList.add('d-none');
    if (endDateError) endDateError.classList.add('d-none');
    if (scheduledAtError) scheduledAtError.classList.add('d-none');
    const audienceError = document.getElementById('audienceError');
    if (audienceError) audienceError.classList.add('d-none');
    populateFromCommunity();
    populateAudienceCommunities();
    resetAudienceSelection();
    if (endDate) endDate.value = defaultExpiryLocalValue();
    refreshPendingBadge();
    renderOfflineDrafts();
    updateOnlineUi();
  }

  composeForm.onsubmit = async (e) => {
    e.preventDefault();
    fromCommunityError.classList.add('d-none');
    endDateError.classList.add('d-none');
    if (scheduledAtError) scheduledAtError.classList.add('d-none');
    const audienceError = document.getElementById('audienceError');
    if (audienceError) audienceError.classList.add('d-none');

    const channelId = fromCommunity.value;
    const selectedOpt = fromCommunity.options[fromCommunity.selectedIndex];

    // Publishers must pick a community.
    if (user.role !== 'admin' && !channelId) {
      fromCommunityError.textContent = 'Please select a community to post from.';
      fromCommunityError.classList.remove('d-none');
      return;
    }

    const audience = getAudienceSelection();
    if (audience.mode === 'communities' && audience.ids.length === 0) {
      if (audienceError) {
        audienceError.textContent = 'Select at least one department or group, or choose Everyone.';
        audienceError.classList.remove('d-none');
      }
      return;
    }

    // Optional schedule — empty or current/past time publishes immediately; future time queues it.
    let scheduledAt = '';
    if (scheduledAtInput && scheduledAtInput.value) {
      const d = new Date(scheduledAtInput.value);
      if (isNaN(d.getTime())) {
        if (scheduledAtError) {
          scheduledAtError.textContent = 'Enter a valid date and time.';
          scheduledAtError.classList.remove('d-none');
        }
        return;
      }
      // Allow "now" / current minute — only future times are treated as delayed publish.
      scheduledAt = d.toISOString();
    }

    // Notice Expiry Automation — required; every notice auto-archives.
    let expiresAt = '';
    if (!endDate.value) {
      endDateError.textContent = 'Expiry date is required. Every notice expires automatically into the archive.';
      endDateError.classList.remove('d-none');
      return;
    }
    {
      const d = new Date(endDate.value);
      if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        endDateError.textContent = 'Expiry date must be in the future.';
        endDateError.classList.remove('d-none');
        return;
      }
      if (scheduledAt && d.getTime() <= new Date(scheduledAt).getTime()) {
        endDateError.textContent = 'Expiry must be after the scheduled publish time.';
        endDateError.classList.remove('d-none');
        return;
      }
      expiresAt = d.toISOString();
    }

    // Derive the post level from the selected community type.
    const chanType = selectedOpt ? selectedOpt.dataset.type : null;
    const level = audience.visibility === 'all' ? 'college_wide'
      : chanType === 'department' ? 'department'
        : chanType === 'club' ? 'club'
          : 'college_wide';

    const btn = document.getElementById('composeBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Publishing...';

    // Offline-first: if already offline, save draft and register auto-sync (no failed fetch).
    if (!navigator.onLine && canOfflineSync && window.CCQueue) {
      try {
        await saveComposeAsOfflineDraft('offline-publish');
      } catch (err) {
        alert(err.message || 'Could not save offline draft');
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Publish Post <i class="bi bi-arrow-right ms-2"></i>';
      }
      return;
    }

    const buildFormData = () => {
      const fd = new FormData();
      fd.append('title', document.getElementById('postTitle').value);
      fd.append('content', document.getElementById('postContent').value);
      fd.append('post_type', document.getElementById('postType').value);
      fd.append('post_level', level);
      if (channelId) fd.append('channel_id', channelId);
      if (scheduledAt) fd.append('scheduled_at', scheduledAt);
      if (expiresAt) fd.append('expires_at', expiresAt);
      fd.append('visibility', audience.visibility);
      if (audience.visibility === 'communities') {
        fd.append('target_channel_ids', JSON.stringify(audience.ids));
      }
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
      const data = await res.json().catch(() => ({}));
      alert(data.scheduled
        ? 'Announcement scheduled! It will appear in feeds at the selected time.'
        : 'Announcement Published!');
      composeForm.reset();
      resetAudienceSelection();
      activateTab('feed');
    } catch (err) {
      // Network drop mid-request → queue for Offline Sync
      if ((err.name === 'TypeError' || !navigator.onLine) && canOfflineSync && window.CCQueue) {
        try {
          await saveComposeAsOfflineDraft('network-error');
        } catch (qErr) {
          alert('Could not save post offline: ' + qErr.message);
        }
      } else if (err.name === 'TypeError' || !navigator.onLine) {
        alert("You're offline. Offline sync isn't available for this account.");
      } else {
        alert(err.message || 'Failed to publish');
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Publish Post <i class="bi bi-arrow-right ms-2"></i>';
    }
  };

  // ---- Offline Sync: replay drafts when connectivity returns ----
  async function maybeFlushQueue() {
    if (!canOfflineSync || !window.CCQueue || flushingQueue) return;
    if (!navigator.onLine) return;
    flushingQueue = true;
    try {
      const before = await window.CCQueue.count();
      if (before === 0) {
        await renderOfflineDrafts();
        return;
      }
      showSyncBanner('syncing', 'Offline Sync', `Publishing ${before} draft${before > 1 ? 's' : ''}…`, false);
      const result = await window.CCQueue.syncAll({
        token,
        onProgress: ({ current, total, title, status }) => {
          showSyncBanner(
            status === 'synced' ? 'syncing' : 'syncing',
            'Offline Sync',
            `${status === 'synced' ? 'Synced' : 'Syncing'} ${current}/${total}: ${title}`,
            false
          );
        }
      });
      await refreshPendingBadge();
      await renderOfflineDrafts();
      if (result.published > 0) {
        showSyncBanner(
          'success',
          'Sync complete',
          `Published ${result.published} offline draft${result.published > 1 ? 's' : ''}.`,
          false
        );
        showToast(`Synced ${result.published} offline draft${result.published > 1 ? 's' : ''} to the campus feed.`);
        loadFeed();
        hideSyncBannerSoon();
      } else if (result.failed > 0 && result.remaining > 0) {
        showSyncBanner('error', 'Sync incomplete', 'Some drafts could not be published. Tap Sync now to retry.', true);
      } else if (result.remaining === 0) {
        hideSyncBannerSoon();
      }
    } finally {
      flushingQueue = false;
    }
  }

  async function refreshPendingBadge() {
    if (!canOfflineSync || !window.CCQueue) return;
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

  async function renderOfflineDrafts() {
    if (!offlineDraftsCard || !offlineDraftsList || !window.CCQueue || !canOfflineSync) return;
    const drafts = await window.CCQueue.getPendingPosts();
    if (!drafts.length) {
      offlineDraftsCard.classList.add('d-none');
      offlineDraftsList.innerHTML = '';
      return;
    }
    offlineDraftsCard.classList.remove('d-none');
    offlineDraftsList.innerHTML = drafts.map(d => {
      const when = d.savedAt ? new Date(d.savedAt).toLocaleString() : '';
      const statusBadge = d.status === 'failed'
        ? `<span class="badge bg-danger">Failed</span>`
        : d.status === 'syncing'
          ? `<span class="badge bg-info text-dark">Syncing…</span>`
          : `<span class="badge bg-warning text-dark">Pending sync</span>`;
      const err = d.lastError ? `<div class="text-danger small mt-1">${escapeHtml(d.lastError)}</div>` : '';
      return `
        <div class="border rounded-3 p-3 bg-light d-flex justify-content-between align-items-start gap-2">
          <div class="min-w-0">
            <div class="fw-700 text-truncate">${escapeHtml(d.title || 'Untitled')}</div>
            <div class="small text-muted">Saved ${escapeHtml(when)}</div>
            ${statusBadge}${err}
          </div>
          <button type="button" class="btn btn-sm btn-outline-danger rounded-pill flex-shrink-0"
            onclick="window.deleteOfflineDraft(${d.id})" title="Remove draft">
            <i class="bi bi-trash"></i>
          </button>
        </div>`;
    }).join('');
  }

  window.deleteOfflineDraft = async function (id) {
    if (!window.CCQueue) return;
    if (!confirm('Remove this offline draft?')) return;
    await window.CCQueue.deletePendingPost(id);
    await refreshPendingBadge();
    await renderOfflineDrafts();
  };

  function collectComposePayload() {
    const channelId = fromCommunity.value;
    const selectedOpt = fromCommunity.options[fromCommunity.selectedIndex];
    const audience = getAudienceSelection();
    const chanType = selectedOpt ? selectedOpt.dataset.type : null;
    const level = audience.visibility === 'all' ? 'college_wide'
      : chanType === 'department' ? 'department'
        : chanType === 'club' ? 'club'
          : 'college_wide';

    let scheduledAt = null;
    if (scheduledAtInput && scheduledAtInput.value) {
      const d = new Date(scheduledAtInput.value);
      if (!isNaN(d.getTime())) scheduledAt = d.toISOString();
    }
    let expiresAt = null;
    if (endDate.value) {
      const d = new Date(endDate.value);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now()) expiresAt = d.toISOString();
    }
    if (!expiresAt) {
      expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    return {
      title: document.getElementById('postTitle').value.trim(),
      content: document.getElementById('postContent').value.trim(),
      post_type: document.getElementById('postType').value,
      post_level: level,
      channel_id: channelId || null,
      scheduled_at: scheduledAt,
      expires_at: expiresAt,
      visibility: audience.visibility,
      target_channel_ids: audience.visibility === 'communities' ? audience.ids : undefined
    };
  }

  async function saveComposeAsOfflineDraft(reason) {
    if (!canOfflineSync || !window.CCQueue) throw new Error('Offline sync not available');
    const payload = collectComposePayload();
    if (!payload.title || !payload.content || !payload.post_type) {
      throw new Error('Title, content, and category are required to save a draft.');
    }
    if (user.role !== 'admin' && !payload.channel_id) {
      throw new Error('Select a community before saving a draft.');
    }
    if (payload.visibility === 'communities' && (!payload.target_channel_ids || !payload.target_channel_ids.length)) {
      throw new Error('Select at least one department/group, or choose Everyone.');
    }
    const hadImage = !!document.getElementById('postImage').files[0];
    await window.CCQueue.savePendingPost(payload, { reason: reason || 'manual' });
    await window.CCQueue.registerSync();
    await refreshPendingBadge();
    await renderOfflineDrafts();
    composeForm.reset();
    resetAudienceSelection();
    showSyncBanner(
      'offline',
      'Draft saved offline',
      'It will publish automatically when your connection returns.' + (hadImage ? ' (Images are not stored in offline drafts.)' : ''),
      navigator.onLine
    );
    showToast('Offline draft saved — will auto-sync when you are back online.');
  }

  if (saveOfflineDraftBtn) {
    saveOfflineDraftBtn.addEventListener('click', async () => {
      try {
        await saveComposeAsOfflineDraft('manual');
      } catch (err) {
        alert(err.message || 'Could not save offline draft');
      }
    });
  }
  if (syncDraftsBtn) syncDraftsBtn.addEventListener('click', () => maybeFlushQueue());
  if (offlineSyncNowBtn) offlineSyncNowBtn.addEventListener('click', () => maybeFlushQueue());

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
          const bellIcon = c.bell_enabled ? 'bi-bell-fill' : 'bi-bell';
          const bellTitle = c.bell_enabled ? 'Disable notifications' : 'Enable notifications';
          const bellClass = c.bell_enabled ? 'btn-warning' : 'btn-outline-secondary';
          controls = `
            <div class="community-card-actions">
              <span class="badge bg-light text-dark border text-truncate"><i class="bi bi-person-badge me-1"></i>Yours</span>
              <button class="btn btn-sm ${bellClass} rounded-circle bell-btn" title="${bellTitle}"
                      onclick="window.toggleBellOwned(${c.id}, ${!c.bell_enabled})">
                <i class="bi ${bellIcon}"></i>
              </button>
            </div>`;
        } else if (subscribed) {
          const bellIcon = c.bell_enabled ? 'bi-bell-fill' : 'bi-bell';
          const bellTitle = c.bell_enabled ? 'Disable notifications' : 'Enable notifications';
          const bellClass = c.bell_enabled ? 'btn-warning' : 'btn-outline-secondary';
          controls = `
            <div class="community-card-actions">
              <button class="btn btn-sm btn-success rounded-pill subscribed-btn" title="Click to unsubscribe"
                      onclick="window.unsubscribeCommunity(${c.id}, '${escapeHtml(c.name).replace(/'/g, "\\'")}')">
                <i class="bi bi-check-circle me-1"></i><span class="subscribed-label">Joined</span>
              </button>
              <button class="btn btn-sm ${bellClass} rounded-circle bell-btn" title="${bellTitle}"
                      onclick="window.toggleBell(${c.id}, ${!c.bell_enabled})">
                <i class="bi ${bellIcon}"></i>
              </button>
            </div>`;
        } else {
          controls = `<div class="community-card-actions"><button class="btn btn-sm btn-outline-primary rounded-pill" onclick="window.subscribeCommunity(${c.id})">Subscribe</button></div>`;
        }

        const subtitle = c.type === 'department' ? 'Department' : 'Club';
        const icon = c.logo_url ? `<img src="${c.logo_url}" alt="logo" class="w-100 h-100 rounded-circle object-fit-cover">` : `<i class="bi bi-people-fill"></i>`;

        return `
        <div class="col">
          <div class="card shadow-sm border-0 h-100 rounded-4 p-3 community-card"
               role="button" tabindex="0"
               data-channel-id="${c.id}" data-dept-id="${c.department_id || ''}" data-channel-type="${c.type}"
               title="View notices from ${escapeHtml(c.name)}">
             <div class="community-card-main">
               <div class="community-card-avatar bg-primary text-white fs-5 d-flex align-items-center justify-content-center rounded-circle overflow-hidden">
                 ${icon}
               </div>
               <div class="community-card-text min-w-0">
                 <h6 class="mb-0 fw-bold text-truncate">${escapeHtml(c.name)}</h6>
                 <small class="text-muted text-truncate d-block">${subtitle} · tap to view</small>
               </div>
             </div>
             ${controls}
          </div>
        </div>
      `}).join('');

      communitiesList.querySelectorAll('.community-card').forEach(card => {
        const openBoard = () => {
          const type = card.dataset.channelType;
          const channelId = card.dataset.channelId;
          const deptId = card.dataset.deptId;
          if (type === 'department' && deptId) {
            openDepartmentBoard(deptId, channelId);
          } else {
            currentFilters.dept = '';
            currentFilters.channel = channelId || '';
            if (deptFilter) deptFilter.value = '';
            activateTab('feed');
          }
        };
        card.addEventListener('click', (e) => {
          if (e.target.closest('button')) return; // subscribe / bell
          openBoard();
        });
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openBoard();
          }
        });
      });
    } catch (e) { console.error(e); }
  }

  window.subscribeCommunity = async function (channelId) {
    try {
      await API.post(`/api/channels/${channelId}/subscribe`);
      loadCommunities();
      // Refresh feed so newly followed publisher posts appear immediately.
      loadFeed();
      showToast('Subscribed — their updates will appear in your feed.');
    } catch (err) {
      alert(err.message || 'Error subscribing');
    }
  };

  window.unsubscribeCommunity = async function (channelId, name) {
    if (!confirm(`Unsubscribe from "${name}"? You'll stop seeing its posts in your feed (college-wide announcements still appear).`)) return;
    try {
      await API.del(`/api/channels/${channelId}/subscribe`);
      loadCommunities();
      loadFeed();
      showToast('Unsubscribed.');
    } catch (err) {
      alert(err.message || 'Error unsubscribing');
    }
  };

  // Bell toggles per-community push opt-in. Turning it ON registers a real Web Push
  // subscription (VAPID) with this browser, then flags the channel for notifications.
  window.toggleBell = async function (channelId, enable) {
    try {
      if (enable) {
        try {
          await ensurePushSubscription();
        } catch (e) {
          showPushHelp(e.message);
          return; // leave bell off
        }
      }
      await API.patch(`/api/channels/${channelId}/bell`, { enabled: enable });
      loadCommunities();
    } catch (err) {
      alert(err.message || 'Could not update notifications');
    }
  };

  // Owned communities may not have a subscription row yet — create one, then toggle bell.
  window.toggleBellOwned = async function (channelId, enable) {
    try {
      try {
        await API.post(`/api/channels/${channelId}/subscribe`);
      } catch (e) {
        if (!(e && e.status === 409)) throw e;
      }
      await window.toggleBell(channelId, enable);
    } catch (err) {
      alert(err.message || 'Could not update notifications');
    }
  };

  // Ensure this browser has an active push subscription registered on the server.
  async function ensurePushSubscription() {
    // Push requires a secure context. On phones over plain HTTP (LAN IP) this is the
    // usual reason the bell "doesn't work" even though OS notifications are enabled.
    if (!window.isSecureContext) throw new Error('insecure');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('unsupported');
    }

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('denied');

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await API.get('/api/push/vapid-public-key');
      if (!key) throw new Error('server-disabled');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      });
    }
    await API.post('/api/push/subscribe', { subscription: sub.toJSON() });
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function showPushHelp(reason) {
    const messages = {
      insecure: 'Push notifications need a secure (HTTPS) connection. On a phone, open the app over HTTPS or install it to your home screen — plain http:// over your network won’t work.',
      unsupported: 'This browser doesn’t support push notifications. On iPhone, install the app to your Home Screen first (iOS 16.4+).',
      denied: 'Notifications are blocked for this site. Allow them in your browser/site settings, then try the bell again.',
      'server-disabled': 'Push is not configured on the server (missing VAPID keys).'
    };
    const text = messages[reason] || ('Could not enable notifications: ' + reason);
    if (document.getElementById('notifBlockedBanner')) document.getElementById('notifBlockedBanner').remove();
    const el = document.createElement('div');
    el.id = 'notifBlockedBanner';
    el.className = 'alert alert-warning alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3 shadow';
    el.style.zIndex = '2000';
    el.style.maxWidth = '92%';
    el.innerHTML = escapeHtml(text) + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 9000);
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

  window.removeCommunity = async function (id, name) {
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
    const countBadge = document.getElementById('archivedPostsCount');
    if (!wrap) return;
    try {
      const data = await API.get('/api/admin/expired-posts?limit=30');
      const rows = data.expired_posts || [];
      if (countBadge) countBadge.textContent = String(data.total != null ? data.total : rows.length);
      if (!rows.length) {
        wrap.innerHTML = '<div class="text-muted">No archived posts yet. Expired notices appear here automatically.</div>';
        return;
      }
      wrap.innerHTML = rows.map(p => `
        <div class="border-bottom py-2">
          <div class="fw-600">${escapeHtml(p.title)}</div>
          <div class="text-muted">
            ${escapeHtml(p.publisher_name || 'Unknown')}
            ${p.channel_name ? ' · ' + escapeHtml(p.channel_name) : ''}
            · expired ${new Date(p.expires_at).toLocaleString()}
            · archived ${new Date(p.archived_at).toLocaleString()}
          </div>
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

  window.approveRequest = async function (channelId, subscriberId) {
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
    if (p && p.id) trackClick(p.id);
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
    currentFilters.channel = '';
    if (currentFilters.dept) {
      const ch = channelsCache.find(c =>
        c.type === 'department' && String(c.department_id) === String(currentFilters.dept)
      );
      if (ch) currentFilters.channel = String(ch.id);
    }
    loadFeed();
  };

  const clearDeptFilterBtn = document.getElementById('clearDeptFilterBtn');
  if (clearDeptFilterBtn) {
    clearDeptFilterBtn.onclick = () => {
      currentFilters.dept = '';
      currentFilters.channel = '';
      if (deptFilter) deptFilter.value = '';
      loadFeed();
    };
  }

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
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return new Date(ts).toLocaleDateString();
  }
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // Exposed Global Functions
  window.toggleBan = async (id, banned) => {
    if (!confirm(`Sure you want to ${banned ? 'ban' : 'unban'}?`)) return;
    await API.post(`/api/admin/users/${id}/ban`, { banned });
    loadAdminDashboard();
  };
  window.promoteUser = async (id) => {
    const role = prompt("Enter role (viewer, publisher, admin):");
    if (!role) return;
    await API.post(`/api/admin/users/${id}/role`, { role });
    loadAdminDashboard();
  };
  window.deletePost = async (id) => {
    if (!confirm('Delete this post?')) return;
    await API.del(`/api/posts/${id}`);
    loadFeed();
  };
  window.toggleLike = async (btn) => {
    const id = btn.dataset.id;
    const wasLiked = btn.classList.contains('liked');
    const countEl = btn.querySelector('span');
    const prevCount = parseInt((countEl.textContent || '0'), 10) || 0;

    // Optimistic UI
    btn.classList.toggle('liked', !wasLiked);
    btn.querySelector('i').className = `bi ${!wasLiked ? 'bi-heart-fill' : 'bi-heart'}`;
    countEl.textContent = `${Math.max(0, prevCount + (wasLiked ? -1 : 1))} likes`;

    if (!navigator.onLine && window.CCEngage) {
      try {
        await window.CCEngage.enqueue('like', id);
        showToast('Like saved offline — will sync when you are back online.');
      } catch (_) {
        // revert
        btn.classList.toggle('liked', wasLiked);
        btn.querySelector('i').className = `bi ${wasLiked ? 'bi-heart-fill' : 'bi-heart'}`;
        countEl.textContent = `${prevCount} likes`;
      }
      return;
    }

    try {
      const r = await API.post(`/api/posts/${id}/like`);
      btn.classList.toggle('liked', r.liked);
      btn.querySelector('i').className = `bi ${r.liked ? 'bi-heart-fill' : 'bi-heart'}`;
      btn.querySelector('span').textContent = `${r.like_count} likes`;
    } catch (err) {
      if (err.network && window.CCEngage) {
        await window.CCEngage.enqueue('like', id);
        showToast('Like queued offline.');
        return;
      }
      btn.classList.toggle('liked', wasLiked);
      btn.querySelector('i').className = `bi ${wasLiked ? 'bi-heart-fill' : 'bi-heart'}`;
      countEl.textContent = `${prevCount} likes`;
      alert(err.message || 'Could not update like');
    }
  };
  window.toggleBookmark = async (btn) => {
    const id = btn.dataset.id;
    const wasSaved = btn.classList.contains('bookmarked');
    btn.classList.toggle('bookmarked', !wasSaved);
    btn.querySelector('i').className = `bi ${!wasSaved ? 'bi-bookmark-fill' : 'bi-bookmark'}`;
    btn.querySelector('span').textContent = !wasSaved ? 'Saved' : 'Save';

    if (!navigator.onLine && window.CCEngage) {
      try {
        await window.CCEngage.enqueue('bookmark', id);
        showToast('Bookmark saved offline — will sync when online.');
      } catch (_) {
        btn.classList.toggle('bookmarked', wasSaved);
        btn.querySelector('i').className = `bi ${wasSaved ? 'bi-bookmark-fill' : 'bi-bookmark'}`;
        btn.querySelector('span').textContent = wasSaved ? 'Saved' : 'Save';
      }
      return;
    }

    try {
      const r = await API.post(`/api/posts/${id}/bookmark`);
      btn.classList.toggle('bookmarked', r.bookmarked);
      btn.querySelector('i').className = `bi ${r.bookmarked ? 'bi-bookmark-fill' : 'bi-bookmark'}`;
      btn.querySelector('span').textContent = r.bookmarked ? 'Saved' : 'Save';
    } catch (err) {
      if (err.network && window.CCEngage) {
        await window.CCEngage.enqueue('bookmark', id);
        showToast('Bookmark queued offline.');
        return;
      }
      btn.classList.toggle('bookmarked', wasSaved);
      btn.querySelector('i').className = `bi ${wasSaved ? 'bi-bookmark-fill' : 'bi-bookmark'}`;
      btn.querySelector('span').textContent = wasSaved ? 'Saved' : 'Save';
      alert(err.message || 'Could not update bookmark');
    }
  };
  window.sharePost = async (id) => {
    trackClick(id);
    const url = `${window.location.origin}/app.html?post=${id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'RVCE Connect',
          text: 'Check this campus notice on RVCE Connect',
          url
        });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied to clipboard!');
    } catch (_) {
      alert('Link: ' + url);
    }
  };

  // Boot: publishers → Compose; students already on Dashboard; others → Feed.
  const bootParams = new URLSearchParams(location.search);
  const bootTab = bootParams.get('tab');
  const sharedTitle = bootParams.get('title');
  const sharedText = bootParams.get('text') || bootParams.get('body');
  const sharedUrl = bootParams.get('url');
  const sharedImage = bootParams.get('image');
  const isShareLaunch = bootParams.get('share') === '1' || !!(sharedTitle || sharedText || sharedUrl || sharedImage);

  if (isShareLaunch && (user.role === 'publisher' || user.role === 'admin')) {
    activateTab('compose');
    // Prefill compose from OS share / share_target
    const titleEl = document.getElementById('postTitle');
    const bodyEl = document.getElementById('postContent');
    if (titleEl && sharedTitle) titleEl.value = sharedTitle;
    if (bodyEl) {
      const parts = [];
      if (sharedText) parts.push(sharedText);
      if (sharedUrl) parts.push(sharedUrl);
      if (parts.length) bodyEl.value = parts.join('\n\n');
    }
    if (sharedImage) {
      showToast('Shared image received — attach it from uploads if needed, or paste the notice text and publish.');
      // Image from share is on server; show hint in content
      if (bodyEl && sharedImage && !bodyEl.value.includes(sharedImage)) {
        bodyEl.value = (bodyEl.value ? bodyEl.value + '\n\n' : '') + `(Shared media: ${sharedImage})`;
      }
    }
  } else if (bootTab === 'compose' || user.role === 'publisher') {
    if (user.role === 'publisher') sessionStorage.setItem('publisher_default_tab', 'compose');
    activateTab('compose');
  } else if (bootTab === 'feed' || bootTab === 'subs' || bootTab === 'admin' || bootTab === 'analytics' || bootTab === 'home') {
    activateTab(bootTab);
  } else if (user.role === 'viewer') {
    activateTab('home');
  }
  if (bootParams.get('sync') === '1') {
    maybeFlushQueue();
  }
  if (bootParams.get('sync') === 'actions' && window.CCEngage) {
    window.CCEngage.syncAll({ token }).catch(() => {});
  }
  // Initial drafts panel + badge
  refreshPendingBadge();
  renderOfflineDrafts();

})();
