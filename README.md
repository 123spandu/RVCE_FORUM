# RVCE Connect (PWA)

The official unified notice board / campus forum for **RV College of Engineering** — a mobile-first Progressive Web App built with **HTML, CSS, Bootstrap 5, vanilla JavaScript, Node.js (Express) and MySQL** (no SPA framework).

> Full write-up: see **[PROJECT_REPORT.md](./PROJECT_REPORT.md)** for the complete college forum app report.

## Key features (all implemented)

### Access & roles
- **Three roles** — `admin`, `publisher` (HOD / faculty / club heads), `viewer` (student)
- **Role portals** — Admin / Publisher / Viewer login + create-account (role-locked JWT)
- JWT auth with live DB checks (ban / role / department)

### Student experience
- **Personalized Dashboard** — My Department, Today’s Updates, Upcoming Deadlines, Events, Subscribed Clubs, Assignments, Bookmarks; Attendance Alerts placeholder
- **Personalized Feed** — college-wide + subscriptions + own department board
- **Department board browse** — filter or tap a community to see that board’s notices
- **Like**, **Bookmark / Save**, **Share** (Web Share + clipboard)
- Auto-subscribe to own department board on login/register

### Publishing
- Compose with image, category, **Post From**, **Visible To** (everyone or selected depts/clubs)
- **Schedule** — current time publishes now; future time queues until due
- **Expires On (required)** — default +7 days; auto-archives (no manual delete needed)
- Offline drafts + auto-sync for publishers/admins

### Communities & push
- Subscribe / unsubscribe to departments & clubs
- **Bell** = Web Push opt-in (VAPID), separate from subscribe

### Automation & analytics
- **Scheduled publish job** + **expiry → archive** every 5 minutes
- **Publisher Analytics** — Views, Likes, Bookmarks, Subscribers, CTR, Department reach, Most active time, Heatmaps, Charts, Top posts
- Admin stats, member directory (ban/promote), community CRUD + logos, archived posts viewer

### PWA
- Installable (custom install banner)
- Service worker hybrid cache + offline page
- Offline Sync (post drafts) + offline likes/bookmarks
- Background Sync + Periodic Sync (feed cache refresh)
- Share Target (`/share`) + file handlers + protocol handler
- Light / dark theme (contrast-tuned)

## Project structure

```
campus-connect/
├── server.js                 # Express, migrations, jobs, /share target
├── db.js                     # MySQL pool
├── PROJECT_REPORT.md         # Complete project report
├── PRD.md                    # Product vision + roadmap
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

## Getting started

### Prerequisites
- Node.js 18+
- MySQL 8 (`docker compose up -d db` → host port **3307**, or local MySQL)

### Install & run
```bash
npm install
cp .env.example .env
# Set DB_*, JWT_SECRET, VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
npm start
```
Open http://localhost:3000

Generate VAPID keys if needed:
```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

### Demo logins

| Role | Portal | Username | Password |
|------|--------|----------|----------|
| Admin | Admin Sign In | `admin` | `admin123` |
| Publisher | Publisher Sign In | `hod_cse` | `rvce123` |
| Viewer | Viewer Sign In | `bharath_student` | `rvce123` |

Change the default admin password before real use.

## How to use (short)

- **Student** → Dashboard → Feed / Communities → like, save, subscribe, bell  
- **Publisher** → Post (schedule/expiry) → Analytics  
- **Admin** → Dashboard (members, communities, archive) + Post / Analytics  

Hard-refresh after updates so the service worker picks up the latest shell cache.

## PWA / Push notes

- Install works best on Chrome/Edge/Android; iOS 16.4+ via Add to Home Screen  
- Push needs **HTTPS** or **localhost**  
- Offline drafts & engagement sync when connectivity returns  

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
| Share | `GET|POST /share` |

## Future scope

Real-time chat, academic calendar, placement RSVPs, Kannada i18n — see `PRD.md`. Attendance alerts UI is a placeholder only.
