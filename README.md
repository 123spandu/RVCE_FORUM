# Campus Connect (PWA)

A campus notice-board / Progressive Web App built with **HTML, CSS, Bootstrap 5, vanilla JavaScript, Node.js (Express) and MySQL** — no frameworks.

## Features

- 🎓 **Three roles** — `admin`, `publisher` (faculty / dept / club), `viewer` (student)
- 🔐 **JWT login** for every user, including admin
- 📝 Publishers & admins can publish posts
  - Audience defaults to **Everyone**; can be restricted to **specific departments** (multi-select)
- 👀 Viewers see posts targeted to **Everyone** or to **their department**
- ❤️ Viewers can **like** posts (toggle, one like per user per post)
- 🔔 Viewers and publishers can **subscribe** to publishers
- 🏛️ Users are grouped by **department**
- 👮 Only `admin` can add / delete users and create departments
- 📱 **PWA** — installable, with `manifest.json`, service worker, offline cache
  - Recent posts feed is cached so viewers can read offline
- 🎨 Mobile-first Bootstrap UI

## Project structure

```
campus-connect/
├── server.js                 # Express entry point + bootstrap
├── db.js                     # MySQL connection pool
├── package.json
├── .env.example              # Copy to .env and fill in
├── db/
│   └── schema.sql            # Database schema + sample departments
├── middleware/
│   └── auth.js               # JWT verification & role guards
├── routes/
│   ├── auth.js               # /api/auth/login, /api/auth/me
│   ├── users.js              # /api/users (admin) + /publishers/list
│   ├── departments.js
│   ├── posts.js              # feed, create, like, delete
│   └── subscriptions.js
└── public/                   # PWA frontend
    ├── index.html            # Login page
    ├── app.html              # Main app (adapts to role)
    ├── offline.html          # Offline fallback
    ├── manifest.json         # PWA manifest
    ├── service-worker.js     # Offline cache strategy
    ├── css/styles.css
    ├── icons/                # PNG icons (192, 512)
    └── js/
        ├── api.js            # fetch wrapper with JWT
        ├── login.js
        ├── app.js            # main client controller
        └── sw-register.js
```

## Getting started

### 1. Prerequisites

- **Node.js 18+**
- **MySQL 8** (or MariaDB 10.3+) running locally

### 2. Install

```bash
cd campus-connect
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Then open `.env` and set your MySQL credentials and a long random `JWT_SECRET`.

### 4. Run

```bash
npm start
```

On first launch the server will:
1. Create the database / tables from `db/schema.sql` if they don't exist
2. Insert sample departments
3. Create a default admin (`admin / admin123` unless you changed `.env`)

Open <http://localhost:3000> and log in.

> ⚠️ **Change the default admin password immediately** in production. (You can add yourself a new admin account directly in the DB or extend the API as an exercise.)

## How to use it

### As **admin**

1. Log in with `admin / admin123`
2. Go to the **Admin** tab
3. Add departments (if you want more than the seeded ones)
4. Add **viewers** (students) and **publishers** (faculty/clubs/depts), assigning each to a department

### As **publisher**

1. Log in with your publisher credentials
2. **Post** tab → write a post → pick *Everyone* (default) or specific *Department(s)* → Publish
3. **Subscriptions** tab → follow other publishers

### As **viewer** (student)

1. Log in
2. **Feed** tab shows posts targeted to *Everyone* OR your department
3. Tap the ❤️ to like
4. **Subscriptions** tab → follow faculty/clubs/depts

## PWA / Offline

- The web app declares a `manifest.json` and registers a service worker on every page
- On mobile or desktop browsers (Chrome / Edge), the **Install** prompt will appear
- The service worker pre-caches the app shell (HTML/CSS/JS, Bootstrap CDN files, icons)
- The `/api/posts` feed uses a **network-first** strategy with a fallback to the cached copy, so viewers can re-open the app and read the most recent feed even when offline
- An offline fallback page (`/offline.html`) is shown if navigation fails without a cached copy

## API summary

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | anyone | Get JWT |
| GET | `/api/auth/me` | authed | Current user |
| GET | `/api/posts` | authed | Feed (filtered by role/dept) |
| POST | `/api/posts` | publisher/admin | New post |
| POST | `/api/posts/:id/like` | authed | Toggle like |
| DELETE | `/api/posts/:id` | owner / admin | Delete |
| GET | `/api/users` | admin | List users |
| POST | `/api/users` | admin | Create viewer/publisher |
| DELETE | `/api/users/:id` | admin | Delete user |
| GET | `/api/users/publishers/list` | authed | Browse publishers |
| GET | `/api/departments` | authed | List departments |
| POST | `/api/departments` | admin | Create department |
| GET | `/api/subscriptions` | authed | My subscriptions |
| POST | `/api/subscriptions` | authed | Subscribe |
| DELETE | `/api/subscriptions/:publisherId` | authed | Unsubscribe |

## Notes / things you can extend

- **Push notifications**: subscription is stored in the DB, but in-browser **Web Push** isn't wired up. To turn this into real notifications you'd add `web-push`, generate VAPID keys, store push subscriptions in a new table, and emit a notification on `POST /api/posts` to all `subscriptions.subscriber_id` rows matching the publisher.
- **Password change / profile edit** isn't included — straightforward to add.
- **Pagination**: the feed query is capped at 200 most-recent posts.
- For production, serve over HTTPS (PWAs require it) and put MySQL on a private network.
