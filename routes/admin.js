const express = require('express');
const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/stats
router.get('/stats', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const [userCount] = await pool.query('SELECT COUNT(*) as count FROM users');
    const [deptCount] = await pool.query('SELECT COUNT(*) as count FROM departments');
    const [clubCount] = await pool.query('SELECT COUNT(*) as count FROM clubs');
    const [postCount] = await pool.query('SELECT COUNT(*) as count FROM posts');
    const [activeUsers] = await pool.query("SELECT COUNT(DISTINCT user_id) as count FROM likes WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)");
    
    const [mostActiveClub] = await pool.query(`
      SELECT c.name, COUNT(pc.post_id) as post_count 
      FROM clubs c 
      JOIN post_clubs pc ON c.id = pc.club_id 
      GROUP BY c.id 
      ORDER BY post_count DESC LIMIT 1
    `);

    res.json({
      totalUsers: userCount[0].count,
      totalDepartments: deptCount[0].count,
      totalClubs: clubCount[0].count,
      totalPosts: postCount[0].count,
      activeUsers: activeUsers[0].count,
      mostActiveClub: mostActiveClub[0] ? mostActiveClub[0].name : 'N/A'
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
    await pool.query('UPDATE users SET is_banned = ? WHERE id = ?', [banned, req.params.id]);
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
