const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// Upload storage for community logos (served from /uploads).
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Middleware to strictly enforce Super Admin role
async function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Super Admin access required' });
  }
  next();
}

// GET /api/admin/pending-publishers
router.get('/pending-publishers', authRequired, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, d.name AS department_name 
       FROM users u LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.role = 'publisher' AND u.is_active = false`
    );
    res.json({ pending_publishers: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/approve-publisher/:id
router.post('/approve-publisher/:id', authRequired, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE users SET is_active = true WHERE id = ? AND role = 'publisher'`, 
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pending publisher not found' });
    res.json({ success: true, message: 'Publisher approved successfully and can now login.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/stats
router.get('/stats', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const [userCount] = await pool.query('SELECT COUNT(*) as count FROM users');
    const [deptCount] = await pool.query('SELECT COUNT(*) as count FROM departments');
    const [clubCount] = await pool.query('SELECT COUNT(*) as count FROM clubs');
    const [postCount] = await pool.query('SELECT COUNT(*) as count FROM posts');
    const [activeUsers] = await pool.query("SELECT COUNT(DISTINCT user_id) as count FROM likes WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)");
    
    // Adapted from post_clubs to our unified channel_id structure
    const [mostActiveClub] = await pool.query(`
      SELECT cl.name, COUNT(p.id) as post_count 
      FROM clubs cl
      JOIN channels c ON cl.id = c.club_id
      JOIN posts p ON p.channel_id = c.id
      GROUP BY cl.id 
      ORDER BY post_count DESC LIMIT 1
    `);

    res.json({
      totalUsers: userCount[0].count,
      totalDepartments: deptCount[0].count,
      totalClubs: clubCount[0].count,
      totalPosts: postCount[0].count,
      activeUsers: activeUsers[0].count,
      mostActiveClub: mostActiveClub.length ? mostActiveClub[0].name : 'N/A'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { banned } = req.body;
    // Safely map the UI's 'banned' concept to our 'is_active' column
    const isActive = banned ? 0 : 1;
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [isActive, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/:id/role
router.post('/users/:id/role', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================================
// Community (Channel) Management — Admin only
// ============================================================================

// POST /api/admin/communities — create a brand-new department/club AND its community (channel)
router.post('/communities', authRequired, requireAdmin, upload.single('logo'), async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  const code = (req.body && req.body.code || '').trim().toUpperCase();
  const type = req.body && req.body.type;
  const description = (req.body && req.body.description || '').trim() || null;
  const logoUrl = req.file ? `/uploads/${req.file.filename}` : null;

  if (!name) return res.status(400).json({ error: 'Community name is required.' });
  if (!['department', 'club'].includes(type)) {
    return res.status(400).json({ error: "Type must be 'department' or 'club'." });
  }
  if (!code) return res.status(400).json({ error: `A unique ${type} code is required (e.g. CSE, DEBSOC).` });

  // Prevent duplicate community names up front.
  const [dupChan] = await pool.query('SELECT id FROM channels WHERE name = ?', [name]);
  if (dupChan.length) return res.status(409).json({ error: 'A community with this name already exists.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let deptId = null, clubId = null;

    if (type === 'department') {
      const [r] = await conn.query(
        'INSERT INTO departments (name, code) VALUES (?, ?)',
        [name, code]
      );
      deptId = r.insertId;
    } else {
      // A club requires a club_head; default the creating admin as the head.
      const [r] = await conn.query(
        'INSERT INTO clubs (name, code, description, logo_url, club_head_id) VALUES (?, ?, ?, ?, ?)',
        [name, code, description, logoUrl, req.user.id]
      );
      clubId = r.insertId;
    }

    const [chan] = await conn.query(
      'INSERT INTO channels (type, department_id, club_id, name, description, logo_url) VALUES (?, ?, ?, ?, ?, ?)',
      [type, deptId, clubId, name, description, logoUrl]
    );

    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM channels WHERE id = ?', [chan.insertId]);
    res.status(201).json({ channel: rows[0] });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `A ${type} with this name or code already exists.` });
    }
    console.error('Create community error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// DELETE /api/admin/communities/:id — delete a community, preserving its posts
router.delete('/communities/:id', authRequired, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [chan] = await pool.query('SELECT id FROM channels WHERE id = ?', [id]);
    if (chan.length === 0) return res.status(404).json({ error: 'Community not found' });

    // Preserve post history: detach posts (treat as college-wide) BEFORE deleting
    // the channel, otherwise the posts FK (ON DELETE CASCADE) would remove them.
    await pool.query('UPDATE posts SET channel_id = NULL WHERE channel_id = ?', [id]);
    await pool.query('DELETE FROM channels WHERE id = ?', [id]);

    try {
      await pool.query(
        'INSERT INTO audit_logs (actor_id, action, details) VALUES (?, ?, ?)',
        [req.user.id, 'COMMUNITY_DELETE', JSON.stringify({ channel_id: id })]
      );
    } catch (logErr) {
      console.error('Audit log failed:', logErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete community error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/communities/:id/active-post-count — helper for the delete warning modal
router.get('/communities/:id/active-post-count', authRequired, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS count FROM posts
       WHERE channel_id = ? AND is_published = TRUE
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [id]
    );
    res.json({ count: rows[0].count });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/expired-posts — read-only paginated archive
router.get('/expired-posts', authRequired, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM expired_posts');
    const [rows] = await pool.query(
      `SELECT e.*, u.full_name AS publisher_name, c.name AS channel_name
       FROM expired_posts e
       LEFT JOIN users u ON e.publisher_id = u.id
       LEFT JOIN channels c ON e.channel_id = c.id
       ORDER BY e.archived_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json({ expired_posts: rows, page, limit, total });
  } catch (err) {
    console.error('List expired posts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
