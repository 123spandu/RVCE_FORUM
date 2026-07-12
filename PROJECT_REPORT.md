# RVCE Connect — College Forum App
## Complete Project Report

**Product name:** RVCE Connect – A Campus Forum App  
**Institution context:** RV College of Engineering (RVCE)  
**Stack:** HTML, CSS, Bootstrap 5, vanilla JavaScript, Node.js (Express), MySQL 8  
**Type:** Mobile-first Progressive Web App (PWA)  
**Status:** Core product **implemented and running** (July 2026)

---

## 1. Executive Summary

RVCE Connect is a unified campus notice-board and forum PWA. Instead of scattered WhatsApp groups and paper boards, authorized publishers (HODs, faculty, club heads) broadcast notices, events, and circulars. Students get a personalized feed, a student dashboard, department boards, subscriptions, likes, bookmarks, and optional push alerts.

The system enforces **role-based access** (Admin / Publisher / Viewer), supports **scheduled publishing**, **automatic notice expiry & archive**, **department-specific targeting**, **publisher analytics**, and a full **PWA layer** (install, offline shell, offline sync, push, share target).

---

## 2. Problem & Solution

| Problem | Solution in RVCE Connect |
|--------|---------------------------|
| Notices scattered across chats & boards | One official feed + communities |
| Students miss department / club updates | Subscribe + department board browse + push bell |
| Anyone can spam chats | Only publishers/admins can post |
| Expired notices clutter feeds | Required expiry → auto-archive (no manual delete needed) |
| Poor reach visibility for HODs | Publisher Analytics (views, likes, CTR, reach, heatmaps) |
| Offline campus network / travel | Offline drafts, cached feed, offline likes/bookmarks |

---

## 3. Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML5, CSS3 (design tokens), Bootstrap 5.3, Bootstrap Icons, Chart.js |
| Client logic | Vanilla JavaScript (no React/Vue) |
| Backend | Node.js, Express |
| Auth | JWT (Bearer), bcrypt password hashes |
| Database | MySQL 8 (InnoDB) |
| Push | Web Push + VAPID (`web-push`) |
| PWA | `manifest.json`, Service Worker, Cache Storage, IndexedDB, Background Sync |
| Uploads | Multer → `/uploads` |
| Optional DB | Docker Compose MySQL on host port **3307** |

---

## 4. System Architecture (high level)

```
[ Browser / Installed PWA ]
        │  HTTPS or localhost
        ▼
[ Express (server.js) ]
  ├── /api/auth, users, channels, posts, push
  ├── /api/dashboard, analytics, admin, clubs, departments
  ├── /share  (PWA share target)
  ├── static public/ + uploads/
  └── background jobs: publish-scheduled + expire-posts (every 5 min)
        ▼
[ MySQL ]
```

**Frontend pages**
- `index.html` — role portal (Admin / Publisher / Viewer)
- `login-admin.html` / `login-publisher.html` / `login-viewer.html`
- `app.html` — main app (tabs adapt by role)
- `offline.html` — offline fallback

---

## 5. Roles & Access Control

| Role | Who | Primary capabilities |
|------|-----|----------------------|
| **Admin** | System administrators | All publisher abilities + member directory, ban/promote, community CRUD, archived posts, campus-wide analytics |
| **Publisher** | HODs, faculty, club heads | Compose/schedule notices, analytics for own posts, communities, feed |
| **Viewer** | Students | Dashboard, feed, subscribe, like, bookmark, department boards, push bell |

- Login is **role-locked** to the matching portal.
- Registration is available on all portals with **role-aware** create-account (portal expected role).
- JWT is verified on each API call; banned / inactive users are rejected.
- Live role & department are reloaded from the DB (promotions/bans apply without waiting for token expiry).

### Demo credentials (seed)

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Publisher | `hod_cse` | `rvce123` |
| Viewer | `bharath_student` | `rvce123` |

---

## 6. Key Features (complete — implemented)

### 6.1 Role-based portals & authentication
- Separate Admin / Publisher / Viewer entry points
- Sign in + Create Account on each portal
- JWT session stored in the browser; API wrapper attaches `Authorization: Bearer`
- Department selection on student registration; students are auto-subscribed to their department board on login/register

### 6.2 Personalized student Dashboard (Home)
Students land on **Dashboard** with:
- **My Department** board (notices for their department)
- **Today’s Updates**
- **Upcoming Deadlines** (notices expiring within 14 days)
- **Events** (event / hackathon / workshop / seminar / conference / meeting)
- **Subscribed Clubs**
- **Attendance Alerts** — placeholder (“coming soon”)
- **Assignments** (due dates from `assignments` table)
- **Bookmarks** (saved notices)

### 6.3 Campus Feed
- Personalized feed: college-wide + subscribed communities (+ own department board without extra subscribe)
- Filters: All / Events / Hackathons / Placements / Notices
- **Department board browse** — selecting a department shows that board’s posts (not unrelated college-wide noise)
- Tap a community card → open that board’s notices
- Global search
- Like, **Save (bookmark)**, Share (Web Share API + clipboard fallback)
- Engagement tracking: views & clicks for analytics / CTR

### 6.4 Department-specific notice distribution
- Composer **Visible To**: Everyone **or** selected departments / clubs
- Targeting stored in `post_target_channels`
- Audience badges on cards (“College-wide” / “To: …”)
- Feed respects department membership and club subscriptions

### 6.5 Communities & subscriptions
- List of department + club channels
- **Subscribe / Joined (unsubscribe)**
- **Bell** = push opt-in only (separate from subscribe)
- Layout wraps safely on small screens (no overflow)
- Optional community logos

### 6.6 Compose / Publish (Publisher & Admin)
- Title, body, image upload
- Post category (event, hackathon, meeting, seminar, workshop, conference, circular)
- **Post From** community (required for publishers)
- **Visible To** audience
- **Schedule Posting (optional)**  
  - Empty or **current time** → publish **now**  
  - Future time → held until due (`is_published = false`) then released by job
- **Expires On (required)** — defaults to +7 days; every notice must expire
- Offline: auto-save draft / “Save Offline Draft”; sync when online

### 6.7 Notice Expiry Automation
- Every live post has `expires_at`
- Job runs **on boot and every 5 minutes**
- Expired notices move to `expired_posts` and are removed from the live feed
- Admin **Archived Posts** panel (read-only)
- No need for manual deletion of expired notices

### 6.8 Scheduled publishing
- `scripts/publish-scheduled.js` + same 5-minute job loop
- Due scheduled posts become visible and can trigger push

### 6.9 Publisher Analytics Dashboard ⭐
Publishers/admins see **Analytics** tab with:
- **Views** & unique views  
- **Likes**  
- **Bookmarks**  
- **Subscribers** (on their channels)  
- **CTR** (clicks ÷ views)  
- **Department reach** (doughnut)  
- **Most active time** (peak hour + bar chart)  
- **Activity heatmap** (day × hour, 30 days)  
- **14-day engagement charts** (Chart.js)  
- **Top posts** table  

Data from `post_views`, `post_clicks`, likes, bookmarks, subscriptions.

### 6.10 Admin Dashboard
- Stats cards (users, posts, clubs, active users)
- Member directory: search, ban/unban, promote role
- Create / delete communities (+ optional logo)
- Archived (expired) posts list

### 6.11 Engagement
- Likes (toggle)
- Bookmarks (toggle + dashboard list + API list)
- Offline likes/bookmarks queued in IndexedDB and synced on reconnect
- View / click analytics recording

### 6.12 Assignments
- `assignments` table with due dates
- Shown on student dashboard for relevant department/club channels
- Sample assignments seeded at boot when empty

### 6.13 Light / Dark theme
- Persistent theme (`localStorage`)
- High-contrast dark mode for badges, forms, alerts, tables, charts
- Theme color meta updates for PWA chrome
- Analytics charts refresh on theme change

---

## 7. PWA Features (complete)

| Feature | Status | Notes |
|--------|--------|--------|
| Web App Manifest | ✅ | Icons, screenshots, shortcuts, standalone, theme colors |
| Installable app | ✅ | Custom **Install** banner (`beforeinstallprompt`) |
| Service Worker | ✅ | Hybrid caching |
| App-shell precache | ✅ | HTML/CSS/JS/icons/login pages |
| Cache-first static | ✅ | Shell + CDN assets |
| Network-first feed APIs | ✅ | `/api/posts`, `/api/channels` + offline fallback |
| Offline fallback page | ✅ | `/offline.html` |
| Offline Sync (drafts) | ✅ | IndexedDB `CCQueue` + Background Sync |
| Offline likes/bookmarks | ✅ | IndexedDB `CCEngage` + Background Sync |
| Auto-sync on reconnect | ✅ | `online` event + SW messages |
| Web Push (VAPID) | ✅ | Per-community bell |
| Periodic Background Sync | ✅ | Refresh feed caches (~12h, Chromium/installed) |
| Share Target | ✅ | OS Share → `/share` → Compose prefilled |
| File handlers | ✅ | Open images into compose (manifest) |
| Protocol handler | ✅ | `web+rvce:` |
| Web Share API | ✅ | Share button on posts |
| Shortcuts | ✅ | Feed / Post / Communities |

**Push note:** requires **HTTPS** or **localhost**. On LAN `http://IP`, use a tunnel or install as PWA where supported. iOS needs Home Screen install (16.4+).

---

## 8. Database (implemented)

Core tables (see `db/schema.sql` + boot migrations):

| Table | Purpose |
|-------|---------|
| `departments` | Academic departments |
| `users` | Accounts + role + department |
| `clubs` | Clubs / groups |
| `channels` | Department & club notice boards (+ `logo_url`) |
| `subscriptions` | Subscribe + `push_notifications_enabled` (bell) |
| `posts` | Notices (`expires_at`, `scheduled_at`, `is_published`, `community_name`) |
| `post_target_channels` | Audience targeting |
| `likes` | Post likes |
| `bookmarks` | Saved posts |
| `stories` | Short-lived stories |
| `expired_posts` | Auto-archive of expired notices |
| `audit_logs` | Admin actions (e.g. delete) |
| `push_subscriptions` | Browser push endpoints |
| `assignments` | Student assignment due dates |
| `post_views` | Impression tracking |
| `post_clicks` | CTR click tracking |

---

## 9. Background Jobs

Every **5 minutes** (and once on server start):

1. **Publish scheduled posts** — `scripts/publish-scheduled.js`
2. **Archive expired posts** — `scripts/expire-posts.js`

---

## 10. API summary (implemented)

| Area | Endpoints (representative) |
|------|----------------------------|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Posts | `GET /api/posts`, `POST /api/posts`, `GET /api/posts/bookmarks`, `POST /api/posts/:id/like`, `POST /api/posts/:id/bookmark`, `DELETE /api/posts/:id` (admin) |
| Channels | `GET /api/channels`, subscribe / unsubscribe / bell |
| Dashboard | `GET /api/dashboard` |
| Analytics | `GET /api/analytics/publisher`, `POST /api/analytics/view`, `POST /api/analytics/click` |
| Admin | stats, users ban/role, communities CRUD, expired-posts |
| Push | VAPID public key, subscribe |
| Share | `GET|POST /share` → redirects into Compose |

Feed query helpers: `?type=`, `?dept=`, `?channel=`, `?q=`, `?mine=1`.

---

## 11. How to run

```bash
npm install
cp .env.example .env   # set DB_*, JWT_SECRET, VAPID_* 
npm start              # http://localhost:3000
```

First boot: applies schema, migrations, seeds demos, creates default admin if missing.

---

## 12. Role walkthrough

### Student (Viewer)
1. Viewer portal → login / register  
2. **Dashboard** — department board, deadlines, events, assignments, bookmarks  
3. **Feed** — filter by type or department; like / save / share  
4. **Communities** — subscribe; bell for push  

### Publisher
1. Publisher portal → lands on **Post**  
2. Compose with From, Visible To, schedule (now allowed), expiry  
3. **Analytics** — views, CTR, reach, heatmaps, charts  
4. Offline drafts sync when back online  

### Admin
1. Admin portal → **Dashboard** (admin)  
2. Members, communities, archive  
3. Also has Compose + Analytics (campus-wide scope)  

---

## 13. Future scope (not required for current release)

Documented in `PRD.md` as longer-term vision:

- Real-time coordinator chat  
- Academic calendar + post–calendar links  
- Placement RSVPs  
- Kannada i18n  
- Attendance alerts (UI placeholder only today)  

---

## 14. Conclusion

RVCE Connect delivers a complete, working college forum PWA: role-based publishing, personalized student experience, department distribution, expiry automation, publisher analytics, and a modern PWA stack (install, offline sync, push, share). It is suitable for campus deployment over HTTPS with MySQL and configured VAPID keys.

---

*Report aligned with the implemented codebase (server, routes, schema, and public PWA client).*
