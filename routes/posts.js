// routes/posts.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

/**
 * GET /api/posts
 * Returns posts visible to the current user with filters
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const me = req.user;
    const { type, dept, club, q, date } = req.query;
    
    let whereClause = "(p.target_type = 'all' OR p.id IN (SELECT post_id FROM post_departments WHERE department_id = ?) OR p.id IN (SELECT post_id FROM post_clubs WHERE club_id IN (SELECT target_id FROM publisher_assignments WHERE user_id = ? AND target_type = 'club')))";
    let params = [me.department_id || 0, me.id];

    if (me.role === 'admin' || me.role === 'publisher') {
      whereClause = "1=1"; // Admin/Publisher see everything for management
      params = [];
    }

    if (type) { whereClause += " AND p.post_type = ?"; params.push(type); }
    if (q) { whereClause += " AND (p.title LIKE ? OR p.content LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
    if (date) { whereClause += " AND DATE(p.created_at) = ?"; params.push(date); }

    const sql = `
      SELECT p.id, p.title, p.content, p.image_url, p.target_type, p.post_type, p.post_level, p.created_at,
             u.id AS publisher_id, u.full_name AS publisher_name, u.username AS publisher_username,
             d.name AS publisher_department,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me,
             (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) AS bookmarked_by_me
      FROM posts p
      JOIN users u ON p.publisher_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT 200`;
    
    const finalParams = [me.id, me.id, ...params];
    const [rows] = await pool.query(sql, finalParams);

    // Attach targets
    for (let r of rows) {
      if (r.target_type === 'department') {
        const [depts] = await pool.query("SELECT d.name FROM post_departments pd JOIN departments d ON pd.department_id = d.id WHERE pd.post_id = ?", [r.id]);
        r.target_departments = depts;
      } else if (r.target_type === 'club') {
        const [clubs] = await pool.query("SELECT c.name FROM post_clubs pc JOIN clubs c ON pc.club_id = c.id WHERE pc.post_id = ?", [r.id]);
        r.target_clubs = clubs;
      }
    }

    res.json({ posts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/posts
 */
router.post('/', authRequired, requireRole('publisher', 'admin'), upload.single('image'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { title, content, target_type, post_type, post_level, department_ids, club_ids, scheduled_at, event_date } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO posts (publisher_id, title, content, image_url, target_type, post_type, post_level, scheduled_at, event_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, title, content, imageUrl, target_type || 'all', post_type, post_level, scheduled_at || null, event_date || null]
    );
    const postId = result.insertId;

    if (target_type === 'department' && department_ids) {
      const ids = JSON.parse(department_ids);
      const values = ids.map(id => [postId, id]);
      await conn.query('INSERT INTO post_departments (post_id, department_id) VALUES ?', [values]);
    } else if (target_type === 'club' && club_ids) {
      const ids = JSON.parse(club_ids);
      const values = ids.map(id => [postId, id]);
      await conn.query('INSERT INTO post_clubs (post_id, club_id) VALUES ?', [values]);
    }

    await conn.commit();
    res.status(201).json({ id: postId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// GET /api/posts/stories
router.get('/stories', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, u.full_name as publisher_name 
      FROM stories s 
      JOIN users u ON s.publisher_id = u.id 
      WHERE s.expires_at > NOW() 
      ORDER BY s.created_at DESC
    `);
    res.json({ stories: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/:id/bookmark
router.post('/:id/bookmark', authRequired, async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?', [req.user.id, req.params.id]);
    if (existing.length) {
      await pool.query('DELETE FROM bookmarks WHERE id = ?', [existing[0].id]);
      res.json({ bookmarked: false });
    } else {
      await pool.query('INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)', [req.user.id, req.params.id]);
      res.json({ bookmarked: true });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
