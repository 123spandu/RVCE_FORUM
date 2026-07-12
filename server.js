// server.js - Campus Connect entry point
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

const pool = require('./db');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const channelRoutes = require('./routes/channels');
const postRoutes = require('./routes/posts');
const subscriptionRoutes = require('./routes/subscriptions');
const adminRoutes = require('./routes/admin');
const clubRoutes = require('./routes/clubs');
const departmentRoutes = require('./routes/departments');
const pushRoutes = require('./routes/push');
const dashboardRoutes = require('./routes/dashboard');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' })); // Increased limit for images
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files (PWA frontend)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health-check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);

// ---- PWA Share Target: receive shared text/images into Compose ----
const multer = require('multer');
const shareStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname || '.jpg'))
});
const shareUpload = multer({
  storage: shareStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only images can be shared into RVCE Connect'));
    }
    cb(null, true);
  }
});

function buildShareRedirect(query) {
  const q = new URLSearchParams();
  q.set('tab', 'compose');
  q.set('share', '1');
  if (query.title) q.set('title', String(query.title).slice(0, 200));
  if (query.text) q.set('text', String(query.text).slice(0, 4000));
  if (query.url) q.set('url', String(query.url).slice(0, 500));
  if (query.image) q.set('image', String(query.image));
  return '/app.html?' + q.toString();
}

app.get('/share', (req, res) => {
  res.redirect(buildShareRedirect(req.query));
});

app.post('/share', (req, res) => {
  shareUpload.single('media')(req, res, (err) => {
    if (err) {
      console.error('Share upload error:', err.message);
      return res.redirect('/app.html?tab=compose&share=1');
    }
    const image = req.file ? `/uploads/${req.file.filename}` : '';
    res.redirect(buildShareRedirect({
      title: req.body.title,
      text: req.body.text,
      url: req.body.url,
      image
    }));
  });
});

// SPA fallback - send the main page for any non-API path
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --------- Bootstrap: ensure tables + default admin ----------
async function bootstrap() {
  // Load schema.sql and run each statement (skips on errors for existing objects)
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const statements = schema
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length && !s.startsWith('--'));

  // We need a connection that is NOT bound to the (possibly missing) database
  const mysql = require('mysql2/promise');
  const adminConn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });
  try {
    await adminConn.query(schema);
    console.log('✔ Database schema is ready');
  } finally {
    await adminConn.end();
  }

  // Idempotent column migrations.
  // NOTE: MySQL 8 does NOT support "ALTER TABLE ... ADD COLUMN IF NOT EXISTS"
  // (that is MariaDB syntax), and the bootstrap runs schema.sql via a single
  // multipleStatements query which cannot host a stored procedure (no DELIMITER
  // at the protocol level). So we do the conditional ALTERs here in JS instead.
  await runMigrations();

  // Create default admin if no admin exists yet
  const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (admins.length === 0) {
    const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const password = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const fullName = process.env.DEFAULT_ADMIN_NAME || 'Administrator';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, role) VALUES (?, ?, ?, ?, 'admin')`,
      [username, hash, fullName, 'admin@rvce.edu.in']
    );
    console.log(`✔ Default admin created -> username: ${username} / password: ${password}`);
    console.log('  (change this immediately after first login!)');
  }

  // Ensure seeded demo publisher/viewer accounts use the documented demo password.
  // (INSERT IGNORE in schema.sql will not update hashes that were already present.)
  const demoUsernames = [
    'hod_cse', 'hod_me', 'kavya_debsoc', 'pranav_envisage',
    'bharath_student', 'shruti_student', 'amith_student'
  ];
  const demoHash = await bcrypt.hash('rvce123', 10);
  await pool.query(
    `UPDATE users SET password_hash = ? WHERE username IN (?)`,
    [demoHash, demoUsernames]
  );
}

// Add a column only if it does not already exist (idempotent, MySQL 8 safe)
async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows.length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${definition}`);
    console.log(`✔ Migration: added ${table}.${column}`);
  }
}

async function runMigrations() {
  // Bell / per-community push opt-in
  await addColumnIfMissing('subscriptions', 'push_notifications_enabled', 'BOOLEAN DEFAULT FALSE');
  // Denormalized community name for offline/cached display
  await addColumnIfMissing('posts', 'community_name', "VARCHAR(150) NULL COMMENT 'Denormalized community name for offline/cached display'");
  // Custom per-community logo
  await addColumnIfMissing('channels', 'logo_url', 'VARCHAR(255) NULL');
  // All communities are public now — lock is_restricted to FALSE
  await pool.query('UPDATE clubs SET is_restricted = FALSE WHERE is_restricted <> FALSE');
  // Per-post audience targeting by community (channel — department OR club).
  // A post with NO rows here is visible to everyone; department rows restrict
  // by the viewer's department membership; club rows by subscription.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_target_channels (
      post_id INT NOT NULL,
      channel_id INT NOT NULL,
      PRIMARY KEY (post_id, channel_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  // Drop the earlier department-only targeting table it replaces (no production data).
  await pool.query('DROP TABLE IF EXISTS post_target_departments');

  // Backfill targeting for older department/club posts that had none (they were
  // incorrectly visible college-wide). College-wide posts (NULL channel or
  // level=college_wide) stay untargeted.
  const [backfill] = await pool.query(`
    INSERT IGNORE INTO post_target_channels (post_id, channel_id)
    SELECT p.id, p.channel_id
    FROM posts p
    WHERE p.channel_id IS NOT NULL
      AND p.level IN ('department', 'club')
      AND NOT EXISTS (
        SELECT 1 FROM post_target_channels ptc WHERE ptc.post_id = p.id
      )
  `);
  if (backfill.affectedRows > 0) {
    console.log(`✔ Migration: backfilled audience targeting for ${backfill.affectedRows} post(s)`);
  }

  // Notice Expiry Automation: ensure every live post has an expiry date.
  // Older rows with NULL expires_at get created_at + 7 days (or NOW()+1 day if already past).
  const [expiryBackfill] = await pool.query(`
    UPDATE posts
       SET expires_at = GREATEST(
             DATE_ADD(COALESCE(created_at, NOW()), INTERVAL 7 DAY),
             DATE_ADD(NOW(), INTERVAL 1 DAY)
           )
     WHERE expires_at IS NULL
  `);
  if (expiryBackfill.affectedRows > 0) {
    console.log(`✔ Migration: set default expiry on ${expiryBackfill.affectedRows} notice(s)`);
  }

  // Personalized Dashboard: assignments (due dates for students)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      publisher_id INT NOT NULL,
      channel_id INT NULL,
      title VARCHAR(200) NOT NULL,
      body TEXT NULL,
      due_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (publisher_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
      INDEX idx_due (due_at)
    ) ENGINE=InnoDB
  `);
  const [asnCount] = await pool.query('SELECT COUNT(*) AS n FROM assignments');
  if (Number(asnCount[0].n) === 0) {
    await pool.query(
      `INSERT INTO assignments (publisher_id, channel_id, title, body, due_at) VALUES
       (1, 1, 'DBMS Lab Report Submission', 'Submit the printed schema and ER diagram before the lab evaluation.', DATE_ADD(NOW(), INTERVAL 3 DAY)),
       (1, 1, 'Unit Test 2 — DSA', 'Syllabus: trees, graphs, and dynamic programming. Venue will be announced on the CSE board.', DATE_ADD(NOW(), INTERVAL 8 DAY)),
       (2, 2, 'Workshop Reflection Write-up', 'One-page summary of the CNC workshop for internal marks.', DATE_ADD(NOW(), INTERVAL 5 DAY))`
    );
    console.log('✔ Seeded sample assignments for Personalized Dashboard');
  }

  // Publisher Analytics: view + click event tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_views (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_view_post_time (post_id, created_at),
      INDEX idx_view_time (created_at)
    ) ENGINE=InnoDB
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_clicks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_click_post_time (post_id, created_at),
      INDEX idx_click_time (created_at)
    ) ENGINE=InnoDB
  `);

  const [viewCount] = await pool.query('SELECT COUNT(*) AS n FROM post_views');
  if (Number(viewCount[0].n) === 0) {
    // Seed realistic demo engagement across hours/days for charts + heatmaps
    await pool.query(`
      INSERT INTO post_views (post_id, user_id, created_at)
      SELECT p.id,
             CASE WHEN RAND() < 0.85 THEN ELT(1 + FLOOR(RAND() * 3), 5, 6, 7) ELSE NULL END,
             DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 14) DAY)
               + INTERVAL FLOOR(RAND() * 24) HOUR
               + INTERVAL FLOOR(RAND() * 60) MINUTE
        FROM posts p
        CROSS JOIN (SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) x
        CROSS JOIN (SELECT 0 m UNION SELECT 1 UNION SELECT 2) y
       WHERE p.is_published = TRUE
    `);
    await pool.query(`
      INSERT INTO post_clicks (post_id, user_id, created_at)
      SELECT p.id,
             ELT(1 + FLOOR(RAND() * 3), 5, 6, 7),
             DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 14) DAY)
               + INTERVAL (8 + FLOOR(RAND() * 12)) HOUR
               + INTERVAL FLOOR(RAND() * 60) MINUTE
        FROM posts p
        CROSS JOIN (SELECT 0 n UNION SELECT 1 UNION SELECT 2) x
       WHERE p.is_published = TRUE
         AND RAND() < 0.55
    `);
    console.log('✔ Seeded sample post views/clicks for Analytics Dashboard');
  }

  // Students should always follow their department notice board
  const [deptSubs] = await pool.query(`
    INSERT IGNORE INTO subscriptions (subscriber_id, channel_id, status)
    SELECT u.id, c.id, 'approved'
      FROM users u
      JOIN channels c ON c.type = 'department' AND c.department_id = u.department_id
     WHERE u.role = 'viewer'
       AND u.department_id IS NOT NULL
  `);
  if (deptSubs.affectedRows > 0) {
    console.log(`✔ Auto-subscribed ${deptSubs.affectedRows} student(s) to their department board`);
  }
}

// Auto-archive expired notices + publish due scheduled posts (every 5 minutes)
const { archiveExpiredPosts } = require('./scripts/expire-posts');
const { publishScheduledPosts } = require('./scripts/publish-scheduled');
function startExpiryJob() {
  const safeRun = async () => {
    try {
      await publishScheduledPosts();
    } catch (err) {
      console.error('Publish-scheduled job failed:', err.message);
    }
    try {
      await archiveExpiredPosts();
    } catch (err) {
      // Must never crash the server — just log.
      console.error('Expiry job failed:', err.message);
    }
  };
  safeRun(); // run once on boot
  setInterval(safeRun, 5 * 60 * 1000); // every 5 minutes — keep feeds fresh
}

bootstrap()
  .then(() => {
    startExpiryJob();
    app.listen(PORT, () => {
      console.log(`\n🚀 Campus Connect running on http://localhost:${PORT}\n`);
    });
  })
  .catch(err => {
    console.error('\n❌ Bootstrap failed:', err.message);
    console.error('   Check your MySQL connection details in .env');
    process.exit(1);
  });
