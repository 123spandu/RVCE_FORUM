# RVCE Connect — The RVCE Broadcast PWA
## Central Product Requirement Document (PRD)

> **STATUS UPDATE (12 July 2026):** The app is **functionally complete** for its core campus-forum scope. Implemented and running: JWT role portals, personalized **student Dashboard**, department targeting + board browse, subscriptions + push **bell**, scheduled publish + **notice expiry automation** (5‑min job), **publisher Analytics** (views/likes/bookmarks/CTR/reach/heatmaps/charts), assignments, bookmarks UI, admin community CRUD + archive, unified light/dark theme, and a full **PWA** layer (install banner, hybrid SW cache, offline drafts, offline likes/bookmarks, Background Sync, Periodic Sync, Share Target, file handlers, Web Share).  
> Future scope remains: real-time chat, academic calendar, placement RSVPs, Kannada i18n, live attendance alerts.  
> Authoritative feature inventory: **`PROJECT_REPORT.md`**. Authoritative schema: **`db/schema.sql`** (+ boot migrations).
>
> The app was renamed from *CampusConnect* to **RVCE Connect**.

---

## 0. Implemented Product Decisions (changelog vs. original vision)

These decisions were taken during build and supersede conflicting statements elsewhere in this document:

- **All communities are public.** The `clubs.is_restricted` approval flow is removed; every subscription is auto-approved. The column is retained but locked to `FALSE`, and the old approval endpoint returns `410 Gone`.
- **Subscribe + Bell model.** "Join" is replaced by **Subscribe** (adds a channel's posts to the feed). A separate **bell** toggle per community is the **push-notification opt-in** — subscribing alone never sends push. Bell-on registers a real Web Push subscription and sets `subscriptions.push_notifications_enabled = TRUE`.
- **Admin-only post deletion.** Publishers can no longer delete posts (API returns `403`); admin deletions are written to `audit_logs`.
- **Bookmarks are live.** Table + toggle API + feed Save button + student Dashboard bookmarks section.
- **Publisher default tab.** Publishers land on the **Compose** tab on every (re)open; the Post tab is always visible to them. Students land on **Dashboard**.
- **Moderation panel hidden** (frontend `display:none`) per product decision; backend stubs may remain.
- **Composer From + Visible To + Expires On + Schedule.** Required community + audience targeting; required `expires_at` (default +7 days); schedule accepts **now** (publish immediately) or future (queue). Expiry job archives to `expired_posts` every **5 minutes**.
- **Publishers post from owned or joined communities.** "From" lists communities they own and any they subscribed to.
- **Admin community CRUD.** Create department/club + channel (+ logo); delete detaches posts to college-wide.
- **Role-aware registration** on each portal; students auto-subscribe to their department board.
- **Unified theme + dark mode** with contrast pass for badges/forms/alerts.
- **Analytics & dashboard.** Publisher Analytics API/UI; student personalized Dashboard API/UI; view/click tracking tables.
- **PWA extras.** Custom install prompt, Periodic Sync, Share Target (`/share`), file handlers, offline engagement queue.

---

## 1. Executive Summary & Project Vision

### The Core Problem
At RV College of Engineering (RVCE), communication is fragmented. Critical updates, hackathon announcements, department circulars, placement drives, and club events are scattered across dozens of unofficial WhatsApp groups, email chains, and physical notice boards. A student in Computer Science (CSE) has no central channel to discover a seminar hosted by Electronics (ECE), a hackathon opened by the IEEE club, or a placement talk scheduled by the career cell, unless someone manually forwards a screenshot or text. This leads to information fatigue, missed opportunities, and administrative chaos.

### The Solution: RVCE Connect
**RVCE Connect** is a mobile-first Progressive Web App (PWA) that acts as the unified, official notice board for RVCE. 
Unlike WhatsApp or Telegram:
- **Role-Controlled Broadcast System:** Only authorized personnel (Super Admins, HODs, Faculty, Club Heads) can broadcast. Students have a read-only experience to eliminate clutter and maintain a high signal-to-noise ratio.
- **Granular Feeds & Discovery:** Students subscribe to specific "channels" (departments and clubs) and can filter their feeds by categories (hackathons, placement talks, seminars, exams, etc.) rather than drowning in unsorted chat lists.
- **PWA Capabilities:** The application installs directly onto a user's phone or desktop, operates offline utilizing Service Worker caching, and delivers native push notifications (even when the browser is closed).
- **Utility Integrations:** Combines broadcasts with an **academic calendar**, **placement section with RSVPs**, **moderation reporting**, and **private internal coordination groups** for club/department coordinators.

---

## 2. System Architecture & Flowcharts

The following diagrams illustrate the key operational flows of RVCE Connect:

### A. Core Broadcast & Native Push Notification Flow
```mermaid
sequenceDiagram
    autonumber
    actor Admin as "Publisher (HOD/Club Head)"
    participant Server as "Node.js (Express) Server"
    participant DB as "MySQL Database"
    participant WP as "WebPush Service (VAPID)"
    actor Student as "Student (Subscriber)"

    Student->>Server: Subscribe to Channel (CSE / IEEE Club)
    Server->>DB: Store subscription association
    Student->>Server: Grant Push Notification permission & send PushSubscription object
    Server->>DB: Save PushSubscription (Endpoint, Keys)
    
    Admin->>Server: POST /api/posts (Title, Level, Type, Body, ScheduledTime)
    Server->>DB: Insert Post (status = 'published')
    Server->>DB: Fetch all subscribers with valid PushSubscriptions
    loop For each subscriber
        Server->>WP: Send Payload via WebPush Protocol (Title, Snippet, URL)
        WP->>Student: Deliver native OS Push Notification
    end
    Student->>Student: Click Notification -> Opens app at post URL
    Student->>Server: GET /api/posts/:id (Trigger analytics view count increment)
```

### B. Offline & Service Worker Sync Strategy
```mermaid
graph TD
    A[Student navigates to RVCE Connect] --> B{Service Worker registered?}
    B -->|No| C[Register Service Worker & Cache App Shell static HTML/CSS/JS]
    B -->|Yes| D[Load App Shell from Cache]
    D --> E{Device Online?}
    E -->|Yes| F[Fetch fresh posts via API]
    F --> G[Update offline cache with top 50 posts]
    F --> H[Render dynamic feed]
    E -->|No| I[Load top 50 cached posts from CacheStorage]
    I --> J[Display offline status banner + cached feed]
    J --> K[Offline interactions: Bookmark / Toggle RSVP]
    K --> L[Queue action in IndexedDB / Background Sync]
    L --> M{Connectivity restored?}
    M -->|Yes| N[Background Sync fires -> pushes queued operations to Server]
    N --> O[Sync complete]
```

---

## 3. Implementation Status

### ✅ Completed & Running

> For the full feature inventory used as the college forum **project report**, see **`PROJECT_REPORT.md`**.

#### Backend & Database
- **Database schema (actual, in `db/schema.sql` + boot migrations)** — core tables:
  `departments`, `users`, `clubs`, `channels`, `subscriptions` (with `push_notifications_enabled`),
  `posts` (with `expires_at`, `scheduled_at`, `is_published`, `community_name`), `post_target_channels`,
  `likes`, `bookmarks`, `stories`, `expired_posts`, `audit_logs`, `push_subscriptions`,
  plus **`assignments`**, **`post_views`**, **`post_clicks`**.
  - Seed data uses `INSERT IGNORE` (idempotent).
  - JS boot migrations add missing columns/tables and backfill expiry / dept subscriptions.
- **Authentication** — JWT login/register on role portals; live role/ban checks in middleware.
- **API route modules** — `/api/auth`, `/api/users`, `/api/channels`, `/api/posts`, `/api/subscriptions`,
  `/api/admin`, `/api/clubs`, `/api/departments`, `/api/push`, **`/api/dashboard`**, **`/api/analytics`**.
- **Web Push (VAPID)** — fan-out to bell-enabled subscribers; dead endpoints pruned.
- **Jobs (every 5 min)** — publish due scheduled posts; archive expired posts to `expired_posts`.
- **File uploads** — Multer for post images, community logos, and PWA share-target media (`/share`).
- **Docker** — `docker-compose.yml` runs MySQL 8 (host port 3307).

#### Frontend
- **PWA** — install banner, hybrid SW cache, Background Sync (drafts + likes/bookmarks), Periodic Sync,
  Share Target, file handlers, offline.html, Web Share API.
- **UI** — Bootstrap 5 + Chart.js + token-driven light/dark CSS (dark-mode contrast pass).
- **Pages** — role portal, three login pages, `app.html`, offline page.
- **Student Dashboard** — department board, today’s updates, deadlines, events, clubs, assignments, bookmarks.
- **Feed** — personalized + department browse, filters, search, like, bookmark, share, view/click tracking.
- **Composer** — From, Visible To, schedule (now OK), required expiry, offline drafts.
- **Communities** — subscribe + bell; overflow-safe cards.
- **Publisher Analytics** — KPIs, charts, heatmap, top posts.
- **Admin dashboard** — stats, members, communities, archived posts.
- **JS modules** — `api.js`, `login.js`, `app.js`, `sw-register.js` (+ IndexedDB `CCQueue`), `theme.js`.

#### Security & Administration
- **RBAC** — 3 roles: admin, publisher, viewer (admins inherit publisher/viewer abilities).
- **Admin tools** — stats, user management, community CRUD, archived posts.
- **Audit logging** — admin post deletions and community deletions recorded in `audit_logs`.
- **Ban** — admin deactivates a user; login is blocked with a **"You are banned."** message.

### 🔄 Partial

- **Stories** — table + `GET /api/posts/stories` exist; the stories strip is commented out in the UI.
- **Likes** — fully wired; **bookmarks** table/route remain but the UI control was intentionally removed.
- **Moderation/reports** — backend infrastructure intact; the panel is hidden in the UI.

### 📋 Future Scope (vision retained in later sections)

- Real-time coordination **chat** (Socket.io) — not built (chat tables were removed from the schema; would be re-added with the feature).
- **Academic calendar**, **placement RSVPs**, **post analytics**, **notification mute preferences**, **daily digest** — not built (no tables in the current schema).
- **Full-text search** (FULLTEXT index exists on `posts`), **rich-text editor**, **multi-image** posts.
- **Kannada i18n** and a formal **WCAG AA** accessibility pass.

---

## 4. Database Schema Design (MySQL)

This schema is optimized for **MySQL 8** (InnoDB engine). It expands the existing schema to accommodate all requested features while keeping the system manageable for a student.

> **⚠️ Note:** The block below is the **target/extended design**, not the exact current database. The **authoritative, implemented schema is `db/schema.sql`** (see Section 3 for the actual table list). Notable differences: the live schema uses `posts.image_url`/`community_name` (not `attachment_url`), the post `type` enum currently has no `placement_talk` value, `subscriptions` carries `push_notifications_enabled`, `channels` carries `logo_url`, and an `expired_posts` archive table exists. The `chat_groups`, `chat_group_members`, `chat_messages`, `notification_preferences`, `notifications`, `placement_rsvps`, `post_analytics`, `academic_calendar`, `post_calendar_links`, and `reports` tables below are **future scope** and are not yet created (the chat tables were removed from the live schema until the chat feature is built).

### ER Schema Diagram

```mermaid
erDiagram
    USERS {
        int id PK
        string username
        enum role "admin, publisher, viewer"
        int department_id FK
    }
    DEPARTMENTS {
        int id PK
        string name
        string code
    }
    CLUBS {
        int id PK
        string name
        int club_head_id FK
        boolean is_restricted
    }
    CHANNELS {
        int id PK
        enum type "department, club"
        int department_id FK
        int club_id FK
    }
    POSTS {
        int id PK
        int publisher_id FK
        int channel_id FK
        enum level
        enum type
        string title
        timestamp scheduled_at
    }
    SUBSCRIPTIONS {
        int id PK
        int subscriber_id FK
        int channel_id FK
        enum status
        boolean push_notifications_enabled
    }
    PUSH_SUBSCRIPTIONS {
        int id PK
        int user_id FK
        string endpoint
    }
    EXPIRED_POSTS {
        int id PK
        int original_post_id
        int channel_id
    }

    DEPARTMENTS ||--o{ USERS : "groups by"
    DEPARTMENTS ||--o| CHANNELS : "maps to"
    CLUBS ||--o| CHANNELS : "maps to"
    USERS ||--o{ CLUBS : "heads (Publisher)"
    
    CHANNELS ||--o{ SUBSCRIPTIONS : "has subscribers"
    USERS ||--o{ SUBSCRIPTIONS : "subscribes"
    
    CHANNELS ||--o{ POSTS : "receives broadcast"
    USERS ||--o{ POSTS : "authors (Publisher)"
    
    USERS ||--o{ PUSH_SUBSCRIPTIONS : "registers device"
    POSTS ||--o| EXPIRED_POSTS : "archived to"
```

### Table Definitions

```sql
-- Create database if not exists
CREATE DATABASE IF NOT EXISTS campus_connect
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE campus_connect;

-- 1. Departments Table
CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  code VARCHAR(10) UNIQUE NOT NULL, -- e.g., 'CSE', 'ECE', 'ME'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Users Table
-- Supports 3 Roles: 'admin' (global), 'publisher' (faculty/club leads), 'viewer' (student)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL, -- e.g., student USN or admin email
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('admin', 'publisher', 'viewer') NOT NULL,
  department_id INT NULL,
  phone_number VARCHAR(15) NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 3. Clubs Table
CREATE TABLE IF NOT EXISTS clubs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  code VARCHAR(15) UNIQUE NOT NULL, -- e.g., 'IEEE', 'CODS', 'CHIRAAG'
  description TEXT NULL,
  logo_url VARCHAR(255) NULL,
  club_head_id INT NOT NULL,
  department_id INT NULL, -- optional departmental affiliation
  is_restricted BOOLEAN DEFAULT FALSE, -- restricted clubs require approval to subscribe
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (club_head_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 4. Channels Table (Unified subscription target)
-- Students subscribe to CHANNELS, which represent either a Department or a Club.
CREATE TABLE IF NOT EXISTS channels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('department', 'club') NOT NULL,
  department_id INT NULL UNIQUE,
  club_id INT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  CONSTRAINT chk_channel_type CHECK (
    (type = 'department' AND department_id IS NOT NULL AND club_id IS NULL) OR
    (type = 'club' AND club_id IS NOT NULL AND department_id IS NULL)
  )
) ENGINE=InnoDB;

-- 5. Subscriptions Table
CREATE TABLE IF NOT EXISTS subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subscriber_id INT NOT NULL,
  channel_id INT NOT NULL,
  status ENUM('pending', 'approved') NOT NULL DEFAULT 'approved', -- 'pending' is used for restricted clubs
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_sub (subscriber_id, channel_id),
  FOREIGN KEY (subscriber_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Posts Table
-- Every post belongs to a channel (department/club) or is globally broadcasted by super_admin
CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  publisher_id INT NOT NULL,
  channel_id INT NULL, -- NULL means a college-wide broadcast by super_admin
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL, -- Rich text body / HTML support
  level ENUM('college_wide', 'department', 'club', 'student_body') NOT NULL,
  type ENUM('meeting', 'event', 'hackathon', 'conference', 'seminar', 'workshop', 'placement_talk', 'circular') NOT NULL,
  attachment_url VARCHAR(255) NULL, -- PDF flyer / image attachments
  is_pinned BOOLEAN DEFAULT FALSE, -- Pin to top of feed (super_admin only)
  scheduled_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, -- Future drafting support
  expires_at TIMESTAMP NULL, -- Automatic archiving
  is_published BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (publisher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  -- Optimized indexes for fast feeds & searches
  INDEX idx_publish_time (is_published, scheduled_at, expires_at),
  FULLTEXT INDEX idx_search (title, body) -- MySQL InnoDB Full-text search
) ENGINE=InnoDB;

-- 7. WebPush Subscriptions Table
-- Holds active push endpoints for service worker delivery
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_endpoint (user_id, endpoint(255)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 8. User Preferences (Notification filtering)
CREATE TABLE IF NOT EXISTS notification_preferences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNIQUE NOT NULL,
  mute_meetings BOOLEAN DEFAULT FALSE,
  mute_circulars BOOLEAN DEFAULT FALSE,
  mute_placements BOOLEAN DEFAULT FALSE,
  mute_hackathons BOOLEAN DEFAULT FALSE,
  daily_digest BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 9. In-App Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  post_id INT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 10. Bookmarks Table
CREATE TABLE IF NOT EXISTS bookmarks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  post_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_bookmark (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 11. Placement RSVPs Table
CREATE TABLE IF NOT EXISTS placement_rsvps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  student_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_rsvp (post_id, student_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 12. Post Analytics Table
CREATE TABLE IF NOT EXISTS post_analytics (
  post_id INT PRIMARY KEY,
  notifications_sent INT DEFAULT 0,
  notifications_opened INT DEFAULT 0,
  unique_views INT DEFAULT 0,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 13. Academic Calendar Events Table
CREATE TABLE IF NOT EXISTS academic_calendar (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT NULL,
  event_date DATE NOT NULL,
  event_type ENUM('exam', 'holiday', 'semester_start', 'semester_end', 'college_event') NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 14. Posts Linked to Calendar Table
CREATE TABLE IF NOT EXISTS post_calendar_links (
  post_id INT NOT NULL,
  calendar_event_id INT NOT NULL,
  PRIMARY KEY (post_id, calendar_event_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (calendar_event_id) REFERENCES academic_calendar(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 15. Private Chat Groups Table
CREATE TABLE IF NOT EXISTS chat_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  channel_id INT NULL, -- association with a club or department
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 16. Chat Group Members Table
CREATE TABLE IF NOT EXISTS chat_group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_member (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 17. Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  sender_id INT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 18. Audit Logs Table (For moderation & tracking)
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NOT NULL,
  action VARCHAR(100) NOT NULL, -- e.g., 'ROLE_CHANGE', 'POST_DELETE', 'USER_BAN', 'IMPERSONATION'
  details TEXT NOT NULL, -- JSON formatted details of changes
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 19. Reports Table
CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NOT NULL,
  post_id INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  status ENUM('pending', 'reviewed', 'ignored') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

---

## 4. Roles & Permissions Matrix

RVCE Connect uses a streamlined 3-tier architecture. "Publisher" encompasses Faculty, HODs, and Student Club Leads. Publishers derive their specific permissions based on which department or club they are assigned to in the database. (Rows marked *future* are not yet built.)

| Feature Area / Capability | Admin | Publisher (Faculty / Club Leads) | Viewer (Student) |
|:---|:---:|:---:|:---:|
| **Create Posts** | ✅ Yes (any community / college-wide) | ✅ Yes (communities they own or have joined) | ❌ Read Only |
| **Delete Posts** | ✅ Yes (logged to audit) | ❌ No (admin-only) | ❌ No |
| **Subscribe + Bell (push opt-in)** | — (implicitly associated) | — (own communities) | ✅ Yes |
| **Community Management (create/delete + logo)** | ✅ Yes | ❌ No | ❌ No |
| **User Management (Promote / Ban)** | ✅ Yes | ❌ No | ❌ No |
| **Audit Logs / Archived Posts** | ✅ Yes | ❌ No | ❌ No |
| **Moderation / Reports** | (backend only, UI hidden) | ❌ No | ❌ No |
| **Academic Calendar (Modify)** *(future)* | ✅ | ❌ | ❌ |
| **Internal Coord. Groups (Socket.io)** *(future)* | ✅ | ✅ | ❌ |

> All communities are **public** — there is no subscription-approval step. Subscribing adds a community's posts to the feed; the **bell** is the separate push opt-in.

---

## 5. Detailed Feature Specifications

### 1. Broadcast Feed & Composer
- **Post Composer (Rich Text):** Allows formatting such as headings, bold, lists, embedded hyperlinks (Google Meet, RSVPs), and attachment file paths (compressed flyers or PDFs).
- **Post Metadata:** Authors must define **Level** (college-wide, department, club, student body) and **Type** (meeting, event, hackathon, conference, seminar, workshop, placement talk, circular).
- **Scheduling Drawer:** Incorporates a draft status with a `scheduled_at` timestamp. A worker or query condition on the server hides posts where `scheduled_at > NOW()`.
- **Auto-Archive (Expiry):** Posts include an `expires_at` date. Archived posts do not appear on standard student feeds but remain searchable for historical records.
- **Pinned Posts:** A designated `is_pinned` BOOLEAN allows the Super Admin to snap highly critical circulars to the top of everyone's feed, regardless of channel subscriptions.

### 2. Native PWA Push Notification System (WebPush)
- **VAPID Keys Configuration:** Integrates Node.js `web-push` library. Public key exposed to the client to initialize browser push subscription.
- **Service Worker Integration:** Client-side registers `push` and `notificationclick` listeners inside `/public/service-worker.js` to process incoming JSON payloads and launch the app shell on active posts.
- **In-App Notification Center:** A notifications list with an unread badge inside the app header. Includes granular options to "Dismiss" or "Mark All as Read".
- **Student Mute Preferences:** Students can specify their notification preferences in a dedicated settings menu. This excludes muted types (e.g. "Mute routine meetings from ECE") during the push-dispatch fanout.
- **Daily Digest Cron:** A scheduler batches notifications marked as "Low Priority" into a single, comprehensive text summary dispatched at 8 PM daily, reducing notification spam.

### 3. PWA Offline Core & Local Sync
- **Service Worker Offline Cache:** The app shell (Bootstrap files, JS, styles.css, custom SVGs/icons) caches immediately upon installation.
- **Feed Cache Strategy (Network-First with Cache Fallback):** The API request `/api/posts` dynamically caches the response. If network requests fail (e.g. college Wi-Fi deadzones), the service worker returns the stored 50 posts from cache storage instantly, notifying the student with an offline alert banner.
- **Background Synchronization:** Actions like "Save Bookmark" or "Subscribe" taken while offline are stored inside a local IndexedDB buffer. The Service Worker uses `sync` API events to execute background queues as soon as internet connection is restored.
- **Custom Native Install Prompt:** Captures the `beforeinstallprompt` event and presents a beautiful, stylized in-app modal urging installation on the second page view, custom-styled in the RVCE visual theme (Royal Gold and Emerald Green).

### 4. Interactive Student Feed & Discovery (Explore)
- **Chronological Primary Feed:** Displays posts from channels (departments/clubs) the student follows.
- **Explore Feed:** Exhibits posts from channels the student has **not** subscribed to, allowing discovery of events outside their primary field.
- **Filters & Search:** Includes filters for department, date ranges, and categories. Includes full-text keyword search across post contents.
  > [!TIP]
  > Since the database is built on **MySQL**, search queries utilize MySQL's native `FULLTEXT` search syntax:
  > `SELECT * FROM posts WHERE MATCH(title, body) AGAINST(? IN NATURAL LANGUAGE MODE)`
  > This is highly performant at college-scale, requires zero infrastructure changes, and remains fully manageable for a student.

### 5. Private Groups & Real-Time Chat (Socket.io)
- **Internal Coordination Rooms:** Real-time messaging tailored specifically for internal department or club coordinator panels.
- **WebSocket Gateway:** Integrates `Socket.io` into `server.js` using authentication cookies to identify senders.
- **Chat Management:** Allows group admins to manage members, rename chat groups, and wipe specific messages to maintain organization and moderation standards.

### 6. Special Modules: Placements & Academic Calendar
- **Placement & Career Section:** Automatically displays items of type `placement_talk` or `conference`. Students can read placement drive briefs and submit an RSVP. RSVPs are securely collected and exposed exclusively to Placement HODs/Admins in an exportable table.
- **Academic Calendar:** A calendar feed containing semester bounds, exams, and national holidays. Super Admin posts can optionally link to calendar dates, enabling users to click calendar events to reveal associated broadcast posts directly.

### 7. Moderation, Reporting & Security
- **Report System:** Students can flag inappropriate posts. This alerts the Super Admin's dashboard with review/ignore/delete actions.
- **Audit Trails:** Logs every administrative action (role transitions, post deletions, account locks, and admin impersonation sessions) in `audit_logs` for tracking.
- **Security Features:** 
  - **Rate Limiting:** Enforces `express-rate-limit` on `/api/posts` creation and login interfaces.
  - **JWT Refresh Tokens:** Rotates session keys safely to sustain a 7-day login lifespan without risk.
  - **Email Fallback:** Uses `nodemailer` to dispatch high-priority college notices to student emails if push subscription objects fail or expire.

### 8. Accessibility (WCAG AA) & Internationalization (i18n)
- **Kannada Support:** Uses a translation framework (e.g. dynamic JSON locales loaded by client-side JavaScript) to translate core UI text (e.g., buttons, tabs, menu items).
- **Contrast & Font Control:** Accessible color systems using customized accessible dark and light schemes, passing a Lighthouse accessibility standard of >90.

---

## 5. Technical Stack & Architecture

### Backend
- **Runtime:** Node.js 18+ with Express.js 4.x
- **Database:** MySQL 8 (InnoDB) with connection pooling (mysql2)
- **Authentication:** JWT (jsonwebtoken) via `Authorization: Bearer` / cookie
- **Push:** `web-push` (VAPID) for native browser notifications
- **File Handling:** Multer for image/logo uploads
- **Utilities:** bcryptjs for password hashing, cookie-parser, dotenv
- **Development:** Nodemon for hot-reload development

### Frontend
- **Base Framework:** HTML5, vanilla JavaScript (no SPA framework)
- **CSS:** Bootstrap 5.3 + custom CSS, responsive mobile-first design
- **Icons:** Bootstrap Icons 1.11
- **PWA:** Service Worker (Cache-First shell / Network-First API / Background Sync), Web App Manifest, CacheStorage
- **State Management:** IndexedDB for the offline publisher post queue
- **Theming:** CSS custom properties with a persistent light/dark toggle (`theme.js`)
- **Font:** Google Fonts (Inter typeface)

### Infrastructure
- **Containerization:** Docker & Docker Compose for local development
- **API Response:** JSON over HTTPS (production)
- **CORS:** Configured for development environment

---

## 6. API Endpoint Specifications

All endpoints are guarded by JWT middleware (`middleware/auth.js`) that attaches `req.user` (id, role, department_id, managed_club_ids) to the incoming request. The list below reflects the **actually implemented** routes.

### Auth & User Management
```
POST   /api/auth/register          - Public: Creates an active VIEWER (@rvce.edu.in only); auto-logs in.
POST   /api/auth/login             - Public: Authenticates credentials, returns JWT; banned users get 403 "You are banned."
GET    /api/auth/me                - Authed: Current user profile, role, managed_club_ids.
GET    /api/users                  - Admin: Lists all users (with is_banned flag).
POST   /api/users                  - Admin: Creates a viewer/publisher.
DELETE /api/users/:id              - Admin: Deletes a user (cannot delete self).
POST   /api/admin/users/:id/ban    - Admin: Bans/unbans (toggles is_active).
POST   /api/admin/users/:id/role   - Admin: Promotes/changes a user's role.
```

### Broadcast Feed
```
GET    /api/posts                  - Authed: Feed, newest-first, expired posts hidden (filters: q, type, date).
                                     ?mine=1 → publisher's own history incl. expired (is_expired flag).
GET    /api/posts/stories          - Authed: Active (non-expired) stories.
POST   /api/posts                  - Publisher/Admin (multipart): Creates a post; fires Web Push to bell-on subs.
                                     Fields: title, content, post_type, post_level, channel_id, expires_at, image
DELETE /api/posts/:id              - Admin ONLY: Deletes a post (403 for others); logged to audit_logs.
POST   /api/posts/:id/like         - Authed: Toggle like.
POST   /api/posts/:id/bookmark     - Authed: Toggle bookmark (UI control removed; route retained).
```

### Channels, Subscriptions & Bell
```
GET    /api/channels               - Authed: All communities + my_status + bell_enabled + logo_url.
POST   /api/channels/:id/subscribe - Authed: Subscribe (always auto-approved).
DELETE /api/channels/:id/subscribe - Authed: Unsubscribe.
PATCH  /api/channels/:id/bell      - Authed: Toggle per-community push opt-in { enabled }.
PUT    /api/channels/requests/:id  - Deprecated → 410 Gone (approval flow removed).
POST   /api/channels/:cid/approve/:sid - Deprecated → 410 Gone.
```

### Web Push (VAPID)
```
GET    /api/push/vapid-public-key  - Authed: Public VAPID key for the client.
POST   /api/push/subscribe         - Authed: Store this browser's PushSubscription.
DELETE /api/push/subscribe         - Authed: Remove an endpoint (e.g. on logout).
```

### Admin: Communities & Archive
```
POST   /api/admin/communities      - Admin (multipart): Creates a new dept/club + channel (optional logo).
DELETE /api/admin/communities/:id  - Admin: Deletes a community; detaches its posts to college-wide.
GET    /api/admin/communities/:id/active-post-count - Admin: Count for the delete-warning modal.
GET    /api/admin/expired-posts    - Admin: Paginated read-only archive of expired posts.
GET    /api/admin/stats            - Admin: Dashboard counters.
GET    /api/clubs, /api/departments - Authed: Lookup lists.
```

> **Future scope (not implemented):** placement RSVPs, academic calendar, Socket.io coordination chat, post analytics, in-app notification center, and explore/pinned feeds.

---

## 7. Web Design & Premium Aesthetics (RVCE Custom Theme)

To create a premium user experience, RVCE Connect moves away from plain browser components, with glassmorphic panels and fluid CSS animations.

> **Implemented theme:** the shipped design uses an **RVCE emerald → teal** gradient accent (`#0f7a4d → #14b8a6`) on a token-driven system, with a **unified light/dark mode** toggled via `theme.js` and persisted in `localStorage`. The HSL/gold palette below is the original concept; the live tokens live in `public/css/styles.css` (`:root` for light, `html[data-theme="dark"]` for dark).

### Color Palette (CSS HSL variables)
```css
:root {
  --primary-emerald: hsl(152, 60%, 25%);    /* Deep Emerald Green */
  --primary-gold: hsl(43, 85%, 52%);        /* Royal Gold Accent */
  --bg-light: hsl(210, 20%, 98%);           /* Subtle Grey Background */
  --bg-dark: hsl(220, 25%, 10%);            /* Premium Deep Slate Blue */
  --glass-bg: rgba(255, 255, 255, 0.75);
  --glass-border: rgba(255, 255, 255, 0.18);
  --text-primary: hsl(220, 15%, 15%);
  --shadow-premium: 0 8px 32px 0 rgba(31, 38, 135, 0.08);
}
```

### UI Visual Accents
- **Glassmorphism:** Navigation menus, headers, and composer containers feature a `backdrop-filter: blur(12px)` with subtle gold borders.
- **Post Cards:** Highlight cards with a thin, vibrant badge denoting the post **Type** (e.g. Purple for "Hackathon", Crimson for "Placement Talk"). Cards lift on hover using smooth translations (`transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)`).
- **Micro-Animations:** Bookmarking toggles scale up slightly (`transform: scale(1.2)`) and spring back to rest. Notification bells ring with a CSS keyframe wiggle animation upon receiving fresh broadcasts.

---

## 8. Student-Friendly Step-by-Step Implementation Roadmap

This 9-stage guide makes the ambitious feature set manageable for a student, allowing sequential deployment and early verification.

```
[M1: Core Auth & DB] ➔ [M2: Post Composer & Feeds] ➔ [M3: Channel Subscriptions]
                                                               ⬇
[M6: WebSockets Coordinator Chat] ⬽ [M5: WebPush System] ⬽ [M4: PWA Offline Core]
      ⬇
[M7: Placements & Academic Calendar] ➔ [M8: Audit & Moderation] ➔ [M9: Polish & Deploy]
```

### 🟩 Milestone 1: Core Authentication & Expanded DB Setup
- **Goal:** Set up tables and enable multi-role logins.
- **Action items:**
  1. Update `db/schema.sql` with the schema detailed in Section 3 of this document.
  2. Implement `bcryptjs` hashing in user creation scripts.
  3. Expand JWT authentication in `middleware/auth.js` to parse and secure the 5 distinct roles.
- **Verification:** Spin up server, populate seeded data, and test logging in with Super Admin, HOD, and Student users using Postman or index.html.

### 🟩 Milestone 2: Rich-Text Post Composer & Multi-Level Feeds
- **Goal:** Enable post creations, drafts, and display options.
- **Action items:**
  1. Build a rich text textarea on `app.html` (supporting markdown/HTML markup).
  2. Implement the `POST /api/posts` endpoint with checks for publication schedules (`scheduled_at`).
  3. Formulate the primary timeline query, fetching pins (`is_pinned`) and sorting by creation timestamp.
- **Verification:** Author an announcement as HOD scheduled for a future time and verify it is hidden from students. Author a pinned post as Super Admin and verify it snaps to the top of all views.

### 🟩 Milestone 3: Subscriptions Model & Explores
- **Goal:** Enable channel followers and exploration feeds.
- **Action items:**
  1. Construct UI cards for available clubs and departments in the **Explore** panel.
  2. Map out subscription endpoints (`POST /api/channels/subscribe`).
  3. Restrict feed outputs: students see posts exclusively from channels they follow.
  4. Build restricted club joins: Club Heads approve subscriptions via requests lists.
- **Verification:** Unsubscribe from ECE as a CSE student, verify ECE-level announcements disappear from home feed, and verify they appear in the Explore tab.

### 🟩 Milestone 4: PWA Offline Core & Static Service Worker
- **Goal:** Create an installable mobile PWA operating entirely offline.
- **Action items:**
  1. Revamp `/public/manifest.json` to feature the custom Emerald and Gold theme, splash-screens, and custom app icons.
  2. Configure `/public/service-worker.js` with Cache-First routines for resources (HTML, styles, Bootstrap scripts).
  3. Formulate Network-First caching logic for `/api/posts`, saving a 50-entry cache list for offline fallbacks.
  4. Design a clean, high-end "offline banner" to notify students of connection drops.
- **Verification:** Toggle the browser to "Offline Mode" in Chrome DevTools. Reload the app. Verify the interface and the last 50 loaded posts remain completely visible.

### 🟩 Milestone 5: WebPush Native Notifications System
- **Goal:** Native push alerts when new posts hit.
- **Action items:**
  1. Initialize `web-push` on Express. Expose the public VAPID key to the front-end.
  2. In `/public/js/app.js`, request browser notification clearances and register endpoints to `POST /api/auth/push/subscribe`.
  3. On `POST /api/posts` creation, trigger a background fan-out fetching endpoint keys and running `webpush.sendNotification()`.
  4. Write push parsing triggers into `/public/service-worker.js` to draw OS system notifications.
- **Verification:** Grant notification permissions on a local phone/computer. Publish a post from a HOD portal. Verify a system notification pops up instantly even when the app is minimized.

### 🟩 Milestone 6: WebSockets Coordination Chats
- **Goal:** Real-time chat channels for admins and coordinators.
- **Action items:**
  1. Install `socket.io` and configure a socket server onto `server.js`.
  2. Establish channels based on `chat_groups` ids.
  3. Wire client-side sockets inside `app.html` to emit `chat message` payloads and update view components instantaneously.
- **Verification:** Log in with HOD on Chrome and Club Head on Edge. Join a coordination chat, exchange messages, and verify real-time layout updates without full page reloads.

### 🟩 Milestone 7: Academic Calendar & Club Pages
- **Goal:** Implement the academic calendar UI and dedicated club feeds.
- **Action items:**
  1. Create the monthly Academic Calendar view (using CSS grids or libraries like FullCalendar).
  2. Provide linkage fields to let admins anchor calendar points to broadcast notices.
  3. Build dedicated Club Pages showing club bio, logo, and a feed of their announcements.
- **Verification:** Register a calendar event as Admin and verify it appears on the calendar grid.
- **Note:** *Placement Drive Boards and RSVP functionalities have been deferred to a Future Feature to prioritize core Club engagement.*

### 🟩 Milestone 8: Reporting, Moderation, & Auditing
- **Goal:** Protect platform integrity with reporting channels and audit tracking.
- **Action items:**
  1. Build a "Report" button on student post cards.
  2. Map administrative actions (role changes, bans, deletions) to populate details in the `audit_logs` table.
  3. Construct a global Moderation interface within the Super Admin's dashboard displaying active reports.
- **Verification:** Report a mock post as a student. Log in as Super Admin, verify the report is listed in the center panel, click "Unpublish", and verify it immediately vanishes from student feeds.

### 🟩 Milestone 9: Kannada Translation, Security Limits, & Polish
- **Goal:** Set up Kannada support, secure system endpoints, and run Lighthouse.
- **Action items:**
  1. Formulate dynamic English/Kannada dynamic JSON packs on the client-side.
  2. Apply rate-limiting protections across sensitive endpoints.
  3. Refactor CSS styles to pass WCAG AA standards.
  4. Verify service workers pass PWA installation specifications inside Google Lighthouse audits.
- **Verification:** Switch language toggle to Kannada. Verify all headers, buttons, and system notices translate. Run a Lighthouse audit and verify PWA badge lights up green.

---

## 9. Parallel Workstreams for a 4-Member Team

To allow a team of 4 to build RVCE Connect concurrently without merge conflicts or code blocks, the project is divided into **four independent modules**. One member is focused on external ingestion, and the other three build isolated, parallel features.

```mermaid
graph TD
    subgraph SG1 ["Member 1: Data Ingestion"]
        M1[RVCE Web Scraper & JSON Seeds]
    end
    subgraph SG2 ["Member 2: Notifications"]
        M2[WebPush Engine & Notification Bell]
    end
    subgraph SG3 ["Member 3: Internal Coordination"]
        M3[Socket.io Chat Groups & WebSockets]
    end
    subgraph SG4 ["Member 4: Core Utility Panels"]
        M4[Club Pages & Calendar UI]
    end
    M1 -.->|Provides scraped circulars & calendar| M4
    M4 -.->|Triggers WebPush notices| M2
```

### 1. Member 1: Scraper & Official Data Ingestion (External Ingestion)
- **Role:** Extracts data from the official RVCE website (academic calendar events, placement drives, circular PDFs).
- **Core Action Items:**
  1. Write a Python or Node.js web-scraping script (using `cheerio`, `puppeteer`, or `BeautifulSoup`) targeting the RVCE official notices and placements page.
  2. Format scraped circulars, events, and calendar dates into standardized JSON objects.
  3. Create a DB seeding script (`scripts/seed-scraped.js`) that imports these circulars and calendar events directly into the `posts` and `academic_calendar` tables.
- **Conflict Profile:** Completely isolated. Develops in a standalone scraper folder or script file, feeding structured data into existing tables without touching server routes.

### 2. Member 2: Native WebPush Notifications & Preferences (Feature A)
- **Role:** Implements the VAPID WebPush protocol, subscriber endpoint stores, in-app notification bells, and student mute options.
- **Core Action Items:**
  1. Add a separate endpoints router (`routes/notifications.js`) to register/save push endpoints.
  2. Implement background notification dispatch fanouts using the `web-push` library.
  3. Write the background `push` listener in the `service-worker.js` script.
  4. Build the user notifications bell drawer UI with dynamic badges and "mark-all-read" features.
- **Conflict Profile:** Isolated backend router and standalone service worker listener. Leverages standard post event hooks (`POST /api/posts` calls an async notifier function) without altering the post composer logic.

### 3. Member 3: Internal Coordination Groups & Real-Time Chat (Feature B)
- **Role:** Configures real-time chat spaces for department heads, faculty, and club coordinators using Socket.io.
- **Core Action Items:**
  1. Initialize `socket.io` inside `server.js` using authentication cookie parsers.
  2. Build endpoints (`routes/chats.js`) for creating groups, joining rooms, and retrieving chat logs.
  3. Design the coordinator chat UI pane (`public/coordination.html` or a separate tab in `app.html`).
- **Conflict Profile:** High isolation. Touches exclusive tables (`chat_groups`, `chat_messages`) and establishes isolated Socket.io events. Does not intersect with standard student post timelines.

### 4. Member 4: Club Pages & Academic Calendar (Feature C)
- **Role:** Builds the dedicated Club Pages UI and interactive Academic Calendar grid. *(Note: Placements and RSVPs have been deferred to a Future Feature).*
- **Core Action Items:**
  1. Create a dedicated routing pattern for viewing specific clubs (`/clubs/:id`) and fetching their filtered feeds.
  2. Design the club profile UI (showing logo, member count, description, and post history).
  3. Connect the official calendar grid component with links referencing scraped calendar updates.
- **Conflict Profile:** Standalone UI components and dedicated frontend/backend views. Highly compatible with the scraped inputs from Member 1, and operates independently from the push notifications or Socket.io chat interfaces.

---

## 10. Conclusion & Maintenance Advice

For a college project, this architecture represents a robust, highly capable, and modern production-level application. 
By focusing on a **Milestone-Driven Workflow**, students can establish working builds within days, layering on advanced notification features, messaging services, and administrative modules incrementally. 

---

## 8. Development & Deployment Guide

### Local Development Setup

#### Prerequisites
- Node.js 18+ 
- MySQL 8 (or MariaDB 10.3+)
- Docker & Docker Compose (optional, for containerized setup)
- Git

#### Installation

1. **Clone & Install Dependencies**
```bash
cd campus-connect
npm install
```

2. **Environment Configuration**
```bash
cp .env.example .env
# Edit .env with your MySQL credentials and JWT_SECRET
```

3. **Initialize Database**
The server automatically creates tables on first run. Alternatively, manually:
```bash
mysql -u root -p campus_connect < db/schema.sql
node scripts/init-db.js
```

4. **Start Development Server**
```bash
npm run dev        # With hot-reload (Nodemon)
# OR
npm start          # Standard start
```

Server runs on `http://localhost:3000`

#### Default Admin Credentials
- **Username:** admin
- **Password:** admin123
- ⚠️ Change immediately in production

### Docker Setup

```bash
docker compose up -d db
```

`docker-compose.yml` runs **MySQL 8** only, mapped to host port **3307** (set `DB_PORT=3307` in `.env`). The Node app is run on the host with `npm start` (or `npm run dev`) and connects to that container. The server auto-creates/migrates the schema and a default admin on first boot.

### Project Directory Structure

```
campus-connect/
├── server.js                    # Express entry point
├── db.js                        # MySQL connection pool
├── package.json                 # Dependencies & scripts
├── .env.example                 # Environment template
├── docker-compose.yml           # Docker configuration
│
├── db/
│   └── schema.sql              # Implemented schema + idempotent seeds
│
├── middleware/
│   └── auth.js                 # JWT & role-based access control
│
├── routes/                      # API route handlers
│   ├── auth.js                 # Register (viewer), login, profile
│   ├── users.js                # User management
│   ├── channels.js             # Channels, subscribe/unsubscribe, bell
│   ├── posts.js                # Feed, create, admin-delete, like
│   ├── subscriptions.js        # Legacy subscription helpers
│   ├── admin.js                # Stats, users, community CRUD, archive
│   ├── push.js                 # Web Push (VAPID) + fan-out helper
│   ├── clubs.js                # Club listing
│   └── departments.js          # Department listing
│
├── scripts/
│   ├── init-db.js             # Database initialization script
│   └── expire-posts.js        # Archive expired posts (run every 15 min)
│
├── uploads/                     # Uploaded post images & community logos
│
└── public/                      # PWA Frontend
    ├── index.html              # Login page (+ theme toggle)
    ├── app.html                # Main app shell
    ├── offline.html            # Offline fallback
    ├── manifest.json           # PWA manifest (26 fields)
    ├── service-worker.js       # SW: hybrid cache, background sync, push
    │
    ├── css/
    │   └── styles.css          # Token-driven theme (light + dark)
    │
    ├── icons/                  # icon-72/96/128/192/256/512 + screenshots
    │
    └── js/
        ├── api.js              # JWT-aware API wrapper (get/post/patch/del)
        ├── login.js            # Login/register controller
        ├── app.js              # Main app logic
        ├── theme.js            # Light/dark theme controller (all pages)
        └── sw-register.js      # SW registration + IndexedDB CCQueue
```

---

## 9. Current Roadmap & Next Milestones

### Milestone 1: **Core Feature Completion** (In Progress)
- ✅ Backend API fully functional
- ✅ Database schema implemented
- ⏳ Frontend UI completion (feed, compose, subscriptions)
- ⏳ Role-based UI adaptation (admin, publisher, viewer)

### Milestone 2: **Push Notifications & Offline Sync** (Planned)
- Integration of WebPush with Service Worker
- Background Sync API implementation
- Notification delivery system
- Offline action queuing

### Milestone 3: **Advanced Features** (Planned)
- Chat system UI & real-time messaging
- Placement RSVPs UI
- Academic calendar integration
- Full-text search implementation

### Milestone 4: **Production Hardening** (Planned)
- Rate limiting on API endpoints
- Comprehensive error handling
- Security audit & penetration testing
- Performance optimization

---

## 10. Known Limitations & Considerations

### Current Scope
- **Push needs a secure context:** Web Push (VAPID) is fully implemented, but browsers only allow it over **HTTPS** (or `localhost`). On a phone over plain `http://<LAN-IP>` the bell correctly reports the insecure context — use HTTPS (tunnel) or an installed PWA to receive push. iOS requires the PWA installed to the Home Screen (iOS 16.4+).
- **No Real-time Chat Yet:** `chat_*` tables exist in DB; Socket.io gateway/UI pending.
- **No Calendar / RSVP / Analytics:** these tables are not in the current schema (future scope).
- **VAPID keys are local:** generated into `.env` for development; regenerate for any deployment.
- **Single-Region Deployment:** designed for single-site RVCE deployment.

### Browser Compatibility
- Modern browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+).
- PWA installation supported on Android and iOS 16.4+.
- Service Worker & Web Push require HTTPS in production (HTTP OK for `localhost` only).

### Performance Considerations
- Max file upload: 5MB (configurable).
- Feed returns up to 100 posts; SW caches the posts/channels responses for offline reads.
- Expired posts are archived every 15 minutes by an in-process job.
- MySQL indexes optimized for common queries (published/timestamp; FULLTEXT on title+body for future search).

---

## 11. Recommended Next Steps

1. **Complete Frontend UI Development**
   - Finish compose/post creation form with rich text editor
   - Implement moderation tab for admins
   - Add user settings/preferences UI

2. **Integrate Push Notifications**
   - Generate VAPID keys
   - Implement notification subscribe/unsubscribe
   - Test with production service

3. **Deploy & Test at Scale**
   - Set up staging environment
   - Load test with simulated campus user base
   - Security audit before production rollout

4. **Gather User Feedback**
   - Pilot with selected departments
   - Iterate on UX based on feedback
   - Document best practices for publishers
