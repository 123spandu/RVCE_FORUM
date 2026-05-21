const express = require('express');
const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
