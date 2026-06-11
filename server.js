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
}

// Auto-archive expired posts on boot and every 15 minutes (simple in-process scheduler)
const { archiveExpiredPosts } = require('./scripts/expire-posts');
function startExpiryJob() {
  const safeRun = async () => {
    try {
      await archiveExpiredPosts();
    } catch (err) {
      // Must never crash the server — just log.
      console.error('Expiry job failed:', err.message);
    }
  };
  safeRun(); // run once on boot
  setInterval(safeRun, 15 * 60 * 1000); // every 15 minutes
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
