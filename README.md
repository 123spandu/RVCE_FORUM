# RVCE Connect

**Official campus notice board / forum** for **RV College of Engineering** — a mobile-first Progressive Web App.

**Stack:** HTML · CSS · Bootstrap 5 · vanilla JavaScript · Node.js (Express) · MySQL  
*(no React / Vue / Angular)*

---

## Live demo

| | |
|---|---|
| **Open the app** | **[https://teens-prominent-watch-valve.trycloudflare.com](https://teens-prominent-watch-valve.trycloudflare.com)** |
| Health check | [https://teens-prominent-watch-valve.trycloudflare.com/api/health](https://teens-prominent-watch-valve.trycloudflare.com/api/health) |
| Local | http://localhost:3000 |

> The public URL is a **Cloudflare tunnel** to the running server. It works while the host PC and tunnel are online. For a permanent cloud host, see [DEPLOY.md](./DEPLOY.md).

### Demo accounts

| Role | Portal | Username | Password |
|------|--------|----------|----------|
| **Admin** | Admin Sign In | `admin` | `admin123` |
| **Publisher** | Publisher Sign In | `hod_cse` | `rvce123` |
| **Viewer (student)** | Viewer Sign In | `bharath_student` | `rvce123` |

Change default passwords before any real / production use.

---

## What this app does

One place for college notices instead of scattered WhatsApp groups and paper boards:

- **Publishers** (HODs, faculty, club heads) post notices, events, and circulars  
- **Students** get a personalized dashboard + feed, department boards, subscriptions, likes, bookmarks, and optional push alerts  
- **Admins** manage members, communities, and archived posts  

Full write-up: **[PROJECT_REPORT.md](./PROJECT_REPORT.md)** · Product roadmap: **[PRD.md](./PRD.md)** · Deploy guide: **[DEPLOY.md](./DEPLOY.md)**

---

## Features

### Access & roles
- Three roles: `admin`, `publisher`, `viewer`
- Separate login portals + create-account (role-locked JWT)
- Live DB checks for ban / role / department

### Student experience
- **Personalized Dashboard** — My Department, Today’s Updates, Deadlines, Events, Clubs, Assignments, Bookmarks (Attendance placeholder)
- **Personalized Feed** — college-wide + subscriptions + own department board
- **Department browse** — filter or open a community board
- Like · Bookmark / Save · Share (Web Share + clipboard)
- Auto-subscribe to own department board on login/register

### Publishing
- Compose with image, category, **Post From**, **Visible To** (everyone or selected depts/clubs)
- **Schedule** — now publishes immediately; future times queue until due
- **Expires On (required)** — default +7 days; auto-archives (no manual delete needed)
- Offline drafts + auto-sync for publishers/admins

### Communities & push
- Subscribe / unsubscribe to departments & clubs
- **Bell** = Web Push opt-in (VAPID), separate from subscribe

### Automation & analytics
- Scheduled publish job + expiry → archive every **5 minutes**
- **Publisher Analytics** — Views, Likes, Bookmarks, Subscribers, CTR, department reach, active time, heatmaps, charts, top posts
- Admin stats, member directory (ban/promote), community CRUD + logos, archived posts

### PWA
- Installable (custom install banner)
- Service worker hybrid cache + offline page
- Offline Sync (drafts) + offline likes/bookmarks
- Background Sync + Periodic Sync
- Share Target (`/share`) + file handlers + protocol handler
- Light / dark theme

---

## Project structure

```
campus-connect/
├── server.js                 # Express, migrations, jobs, /share
├── db.js                     # MySQL pool
├── PROJECT_REPORT.md         # Full project report
├── PRD.md                    # Product vision + roadmap
├── DEPLOY.md                 # Tunnel / Docker / Render / Railway
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

## Getting started (local)

### Prerequisites
- **Node.js 18+**
- **MySQL 8** — either local MySQL, or `docker compose up -d db` (host port **3307**)

### Install & run
```bash
npm install
cp .env.example .env
# Edit .env: DB_*, JWT_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
npm start
```
Open **http://localhost:3000**

Generate VAPID keys if needed:
```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Optional DB init:
```bash
npm run init-db
```

### Docker (app + MySQL)
```bash
docker compose up -d --build
```
See [DEPLOY.md](./DEPLOY.md) for tunnels and cloud (Render / Railway).

---

## How to use

| Role | Typical flow |
|------|----------------|
| **Student** | Dashboard → Feed / Communities → like, save, subscribe, bell |
| **Publisher** | Post (schedule + expiry) → Analytics |
| **Admin** | Members / communities / archive + Post / Analytics |

Hard-refresh after updates so the service worker picks up the latest shell cache.

---

## API (high level)

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

## PWA / Push notes

- Install works best on Chrome / Edge / Android; iOS 16.4+ via Add to Home Screen  
- Push needs **HTTPS** or **localhost** (the live demo URL is HTTPS)  
- Offline drafts & engagement sync when connectivity returns  

---

## Repository

- GitHub: [123spandu/RVCE_FORUM](https://github.com/123spandu/RVCE_FORUM)

---

## Future scope

Real-time chat, academic calendar, placement RSVPs, Kannada i18n — see `PRD.md`. Attendance alerts UI is a placeholder only.
