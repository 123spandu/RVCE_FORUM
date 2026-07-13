# RVCE Connect

**Official campus notice board / forum** for **RV College of Engineering (RVCE)** — a mobile-first Progressive Web App (PWA).

| | |
|---|---|
| **Product** | RVCE Connect – Campus Forum App |
| **Type** | Web-based campus communication / notice-board system (PWA) |
| **Stack** | HTML · CSS · Bootstrap 5 · vanilla JavaScript · Node.js (Express) · MySQL 8 |
| **Status** | Implemented and running (July 2026) |

> No SPA framework (no React / Vue / Angular).  
> **Full report:** [PROJECT_REPORT.md](./PROJECT_REPORT.md) · [View on GitHub](https://github.com/123spandu/RVCE_FORUM/blob/main/PROJECT_REPORT.md) · Roadmap: [PRD.md](./PRD.md) · Deploy: [DEPLOY.md](./DEPLOY.md)

---

## Live demo (use these links)

> **Why GitHub showed “network unreachable”:** the old Cloudflare demo URL expired. Demo links only work while this PC runs `npm start` **and** the Cloudflare tunnel. Open the links below (current working tunnel).

| Purpose | Link |
|--------|------|
| **1. Visit the PWA (website)** | **[https://inch-courier-increases-stayed.trycloudflare.com/](https://inch-courier-increases-stayed.trycloudflare.com/)** |
| **2. Install the app** | **[https://inch-courier-increases-stayed.trycloudflare.com/?install=1](https://inch-courier-increases-stayed.trycloudflare.com/?install=1)** |
| Health check | [https://inch-courier-increases-stayed.trycloudflare.com/api/health](https://inch-courier-increases-stayed.trycloudflare.com/api/health) |
| Local (this PC only) | http://localhost:3000 |
| **GitHub repo** | [123spandu/RVCE_FORUM](https://github.com/123spandu/RVCE_FORUM) |
| **College Forum App Report (Markdown)** | [View on GitHub](https://github.com/123spandu/RVCE_FORUM/blob/main/PROJECT_REPORT.md) |
| **College Forum App Report (Word)** | [Download / view on GitHub](https://github.com/123spandu/RVCE_FORUM/blob/main/College_Forum_App_Report.docx) |

### How to use on phone

1. **Visit:** open link **1** → choose Admin / Publisher / Viewer → sign in.  
2. **Install:** after login (or from the home page), tap the **Install RVCE Connect** banner, or browser menu → **Install app** / **Add to Home Screen**.  
3. Later open the app from your **home-screen icon** (not from an old bookmarked trycloudflare URL).

### Online vs offline (important)

| Situation | What works |
|-----------|------------|
| **First time / login / new posts** | Needs **network** (phone online + PC server + tunnel running) |
| **After install, no network** | Cached PWA **shell** still opens from the home-screen icon (offline page / last cached feed). You cannot load a brand-new URL with zero internet. Login and live API need network again when you reconnect. |

Demo accounts: `admin` / `admin123` · `hod_cse` / `rvce123` · `bharath_student` / `rvce123`

For a **permanent** always-on host (Render/Railway), see [DEPLOY.md](./DEPLOY.md).

---

## Project report

Complete college forum documentation (problem, objectives, features, architecture, workflows):

- **In this repo:** [PROJECT_REPORT.md](./PROJECT_REPORT.md) · [College_Forum_App_Report.docx](./College_Forum_App_Report.docx)
- **On GitHub:** [PROJECT_REPORT.md](https://github.com/123spandu/RVCE_FORUM/blob/main/PROJECT_REPORT.md) · [College_Forum_App_Report.docx](https://github.com/123spandu/RVCE_FORUM/blob/main/College_Forum_App_Report.docx)

Also: [PRD.md](./PRD.md) · [DEPLOY.md](./DEPLOY.md)

---

## 1. Project definition

**RVCE Connect** is a unified digital campus forum that lets authorized publishers (HODs, faculty, club heads) broadcast notices, events, circulars, and deadlines, while students receive a **personalized dashboard and feed**, subscribe to communities, save important posts, and optionally receive **push notifications**.

The system replaces fragmented communication (WhatsApp groups, paper boards, email chains) with one **role-based, department-aware, installable PWA** backed by **MySQL** and automated **schedule / expiry** jobs.

**In scope**
- Role portals (Admin / Publisher / Viewer)
- Personalized student dashboard & feed
- Department / club communities and targeting
- Compose, schedule, expire & archive notices
- Likes, bookmarks, share, Web Push
- Publisher analytics and admin management
- Offline-capable PWA shell and sync

**Out of scope (future)**
- Real-time chat, full academic calendar, placement RSVPs, Kannada i18n, live attendance alerts (UI placeholder only)

---

## 2. Project domain

| Aspect | Description |
|--------|-------------|
| **Domain** | Higher-education campus communication & information dissemination |
| **Sub-domain** | Official notice board / college forum / community engagement |
| **Institution** | RV College of Engineering (RVCE) and similar multi-department campuses |
| **Users** | Students (viewers), faculty / HODs / club heads (publishers), system admins |
| **Primary data** | Notices, events, channels (departments & clubs), users, subscriptions, engagement metrics |
| **Delivery** | Browser + installable Progressive Web App (mobile-first, HTTPS or localhost) |

This sits at the intersection of **campus ERP/notice systems**, **social feed UX**, and **PWA offline/push** capabilities—without becoming a full LMS or social network.

---

## 3. Problem statement

In a large engineering college, academic and co-curricular information is spread across **WhatsApp groups, email, paper notice boards, and unofficial channels**. That causes:

1. **Missed updates** — students do not see department- or club-specific notices in time  
2. **No single source of truth** — conflicting or outdated messages persist  
3. **Weak access control** — anyone can post in chats; spam and rumor are common  
4. **Clutter** — expired circulars stay visible; feeds become noisy  
5. **Poor publisher insight** — HODs/faculty cannot measure reach (views, likes, CTR)  
6. **Connectivity gaps** — offline or weak campus Wi‑Fi blocks reading or drafting notices  

**Problem statement (formal):**  
*There is no unified, role-secured, mobile-first platform for RVCE that delivers department-aware notices with scheduling, automatic expiry, personalization, push alerts, and engagement analytics—while remaining usable offline as a Progressive Web App.*

---

## 4. Objectives

### Primary objectives
1. Provide a **single official campus forum** for notices, events, and circulars  
2. Enforce **role-based access** (Admin / Publisher / Viewer) with secure JWT auth  
3. Deliver a **personalized student experience** (dashboard + feed + department boards)  
4. Enable **targeted publishing** (college-wide or selected departments/clubs)  
5. Support **scheduled publish** and **mandatory expiry → automatic archive**  
6. Offer **Web Push**, installability, and **offline** drafts / engagement sync (PWA)  
7. Give publishers **analytics** (views, likes, bookmarks, CTR, reach, heatmaps)

### Secondary objectives
- Admin tools for members, communities, and archived posts  
- Clear UX for subscribe vs push “bell”  
- Documented local + cloud deploy path  

### Success criteria (achieved in current build)
- Students land on a useful Dashboard; publishers can compose with schedule/expiry  
- Expired posts leave the live feed and appear in admin archive  
- App installs and works over HTTPS; health endpoint reports OK  

---

## 5. Key features (with workflow)

### 5.1 Role-based portals & authentication

| Feature | What it does |
|---------|----------------|
| Separate portals | Admin / Publisher / Viewer entry pages |
| Sign in & create account | Role-locked to the chosen portal |
| JWT + live DB checks | Ban / role / department re-checked on API calls |
| Department on register | Students pick department; auto-subscribe to that board |

**Workflow — sign in**
```
Open index → choose Admin / Publisher / Viewer portal
  → Sign in (or Create Account)
  → JWT stored in browser
  → Redirect to app.html (tabs depend on role)
```

---

### 5.2 Personalized student Dashboard

| Section | Content |
|---------|---------|
| My Department | Notices for the student’s department board |
| Today’s Updates | Fresh posts relevant to the student |
| Upcoming Deadlines | Notices expiring within ~14 days |
| Events | Event / hackathon / workshop / seminar / etc. |
| Subscribed Clubs | Club-channel highlights |
| Attendance Alerts | Placeholder (“coming soon”) |
| Assignments | Due dates from `assignments` table |
| Bookmarks | Saved notices |

**Workflow — student home**
```
Viewer login → Dashboard tab (default)
  → API GET /api/dashboard
  → Read sections → tap item → open post / board
  → Optional: Save (bookmark), Share
```

---

### 5.3 Campus Feed & department browse

| Feature | What it does |
|---------|----------------|
| Personalized feed | College-wide + subscriptions + own department |
| Category filters | All / Events / Hackathons / Placements / Notices |
| Department / community browse | `?dept=` / community tap → that board only |
| Engage | Like, Save (bookmark), Share (Web Share + clipboard) |
| Analytics hooks | View + click tracking for CTR |

**Workflow — browse feed**
```
Feed tab → load personalized posts
  → Filter by category OR open a community / department
  → Like / Save / Share
  → Read more → click tracked for analytics
```

---

### 5.4 Communities & subscriptions

| Feature | What it does |
|---------|----------------|
| Channels | Departments + clubs with optional logos |
| Subscribe | Join/leave community for feed inclusion |
| Bell | Web Push opt-in for that channel (separate from subscribe) |

**Workflow — follow a community**
```
Communities tab → find department/club
  → Subscribe (Joined) for feed
  → Bell → allow notifications (HTTPS)
  → Tap card → open that board’s notices
```

---

### 5.5 Compose, schedule & expiry (Publisher / Admin)

| Feature | What it does |
|---------|----------------|
| Compose | Title, body, image, category, Post From, Visible To |
| Visible To | Everyone **or** selected depts/clubs |
| Schedule | Empty / now → publish immediately; future → queue |
| Expires On | **Required** (default +7 days) |
| Offline drafts | Save locally; sync when online |

**Workflow — publish a notice**
```
Post tab → fill form (Post From, Visible To, Expires On)
  → Optional schedule time
  → Publish
       ├─ time ≤ now  → live in feed
       └─ time > now  → held until job publishes
  → After expires_at → expire job archives post (every 5 min)
```

**Workflow — automation (server)**
```
server.js boot + every 5 minutes
  → publish-scheduled.js  (release due posts)
  → expire-posts.js       (move expired → archived_posts / expired_posts)
```

---

### 5.6 Publisher Analytics

| Metrics | Views, Likes, Bookmarks, Subscribers, CTR |
| Reach | Department / audience breakdown |
| Insights | Most active time, heatmaps, charts, top posts |

**Workflow — measure reach**
```
Publisher/Admin → Analytics tab
  → GET /api/analytics/publisher
  → Charts (Chart.js) + KPI cards + top posts
```

---

### 5.7 Admin management

| Feature | What it does |
|---------|----------------|
| Members | Directory, ban / promote |
| Communities | CRUD + logos |
| Archive | View expired / archived posts |
| Stats | Campus-wide overview |

**Workflow — moderate**
```
Admin login → Admin dashboard
  → Manage users / communities
  → Review archived posts
  → Optionally compose + view analytics
```

---

### 5.8 PWA layer

| Feature | What it does |
|---------|----------------|
| Install | Custom banner + manifest |
| Offline | Cached shell + `offline.html` |
| Sync | Offline drafts; offline likes/bookmarks → Background Sync |
| Share Target | `POST /share` → Compose prefill |
| Theme | Light / dark |

**Workflow — install & offline**
```
Visit over HTTPS → Install banner / browser install
  → Use offline → shell + drafts/actions queue
  → Back online → Background Sync flushes queue
```

---

## 6. End-to-end system workflow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Browser /  │────▶│  Express API     │────▶│   MySQL 8   │
│  Installed  │◀────│  (server.js)     │◀────│  users,     │
│  PWA        │     │  + SW / Push     │     │  posts, …   │
└─────────────┘     └────────┬─────────┘     └─────────────┘
                             │
                    every 5 min jobs
                    (schedule + expiry)
```

1. User opens portal → authenticates → JWT  
2. Student uses Dashboard/Feed; publisher composes with audience + expiry  
3. Jobs publish scheduled posts and archive expired ones  
4. Engagement feeds Publisher Analytics  
5. Optional push notifies subscribed users with bell enabled  

---

## 7. Technology stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML5, CSS3, Bootstrap 5.3, Bootstrap Icons, Chart.js |
| Client logic | Vanilla JavaScript |
| Backend | Node.js, Express |
| Auth | JWT (Bearer), bcrypt |
| Database | MySQL 8 (InnoDB) |
| Push | Web Push + VAPID |
| PWA | `manifest.json`, Service Worker, Cache, IndexedDB, Background Sync |
| Uploads | Multer → `/uploads` |

---

## 8. Project structure

```
campus-connect/
├── server.js                 # Express, migrations, jobs, /share
├── db.js                     # MySQL pool
├── PROJECT_REPORT.md
├── PRD.md
├── DEPLOY.md
├── Dockerfile / docker-compose.yml / render.yaml
├── db/schema.sql
├── middleware/auth.js
├── scripts/
│   ├── expire-posts.js
│   ├── publish-scheduled.js
│   └── init-db.js
├── routes/                   # auth, posts, channels, dashboard, analytics, admin, push, …
└── public/                   # PWA frontend
    ├── index.html, login-*.html, app.html, offline.html
    ├── manifest.json, service-worker.js
    └── js/  api.js, app.js, login.js, theme.js, sw-register.js, pwa-extras.js
```

---

## 9. Getting started (local)

### Prerequisites
- **Node.js 18+**
- **MySQL 8** — local MySQL, or `docker compose up -d db` (host port **3307**)

### Install & run
```bash
npm install
cp .env.example .env
# Edit .env: DB_*, JWT_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
npm start
```
Open **http://localhost:3000**

Generate VAPID keys:
```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Optional DB init:
```bash
npm run init-db
```

### Docker
```bash
docker compose up -d --build
```

Hard-refresh after updates so the service worker picks up the latest cache.

---

## 10. API (high level)

| Area | Paths |
|------|--------|
| Auth | `/api/auth/register`, `/login`, `/me` |
| Posts | `/api/posts`, `/bookmarks`, `/:id/like`, `/:id/bookmark` |
| Channels | `/api/channels` + subscribe / bell |
| Dashboard | `/api/dashboard` |
| Analytics | `/api/analytics/publisher`, `/view`, `/click` |
| Admin | `/api/admin/stats`, users, communities, expired-posts |
| Push | `/api/push/vapid-public-key`, `/subscribe` |
| Health | `/api/health` |
| Share | `GET` / `POST` `/share` |

---

## 11. Future scope

Real-time chat, academic calendar, placement RSVPs, Kannada i18n, live attendance alerts — see `PRD.md`.
