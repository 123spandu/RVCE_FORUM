// routes/posts.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { authRequired, requirePublisher } = require('../middleware/auth');

const router = express.Router();

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// GET /api/posts
router.get('/', authRequired, async (req, res) => {
  try {
    const me = req.user;
    const { type, q, date } = req.query; // UI team's query params
    
    let whereClause = "p.is_published = TRUE";
    let params = [];

    // Base Visibility Rules
    if (me.role !== 'admin') {
      whereClause += ` AND (
        p.level = 'college_wide' OR
        p.channel_id IN (SELECT channel_id FROM subscriptions WHERE subscriber_id = ? AND status = 'approved')
      )`;
      params.push(me.id);
    }

    // UI Team's advanced filters
    if (type) { whereClause += " AND p.type = ?"; params.push(type); }
    if (q) { whereClause += " AND (p.title LIKE ? OR p.body LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
    if (date) { whereClause += " AND DATE(p.created_at) = ?"; params.push(date); }

    const sql = `
      SELECT p.id, p.title, p.body AS content, p.level AS target_type, p.type AS post_type, p.image_url, p.is_pinned, p.created_at,
             u.full_name AS publisher_name,
             c.name AS publisher_department, c.type AS channel_type,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me,
             (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) AS bookmarked_by_me
      FROM posts p
      JOIN users u ON p.publisher_id = u.id
      LEFT JOIN channels c ON p.channel_id = c.id
      WHERE ${whereClause}
      ORDER BY p.is_pinned DESC, p.created_at DESC
      LIMIT 100
    `;
    
    // Inject user_id twice for liked_by_me and bookmarked_by_me calculations
    const finalParams = [me.id, me.id, ...params];
    const [rows] = await pool.query(sql, finalParams);
    
    // Cast booleans for UI compatibility
    rows.forEach(r => {
      r.liked_by_me = Number(r.liked_by_me) > 0;
      r.bookmarked_by_me = Number(r.bookmarked_by_me) > 0;
    });

    res.json({ posts: rows });
  } catch (err) {
    console.error('List posts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts
router.post('/', authRequired, requirePublisher, upload.single('image'), async (req, res) => {
  try {
    const { title, content, target_type, post_type, post_level, department_ids, club_ids } = req.body || {};
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    
    // Map UI variables to backend schema variables
    const body = content;
    const type = post_type;
    const level = post_level || 'college_wide';
    
    if (!title || !body || !level || !type) {
      return res.status(400).json({ error: 'Title, body, level, and type are required' });
    }

    // Bridge the UI's multi-select arrays to our unified single channel_id
    let channel_id = null;
    if (target_type === 'department' && department_ids) {
      const ids = JSON.parse(department_ids);
      if (ids.length > 0) {
        const [chanRows] = await pool.query('SELECT id FROM channels WHERE department_id = ?', [ids[0]]);
        if (chanRows.length) channel_id = chanRows[0].id;
      }
    } else if (target_type === 'club' && club_ids) {
      const ids = JSON.parse(club_ids);
      if (ids.length > 0) {
        const [chanRows] = await pool.query('SELECT id FROM channels WHERE club_id = ?', [ids[0]]);
        if (chanRows.length) channel_id = chanRows[0].id;
      }
    }

    if (req.user.role === 'publisher') {
      if (level === 'college_wide' || target_type === 'all') {
        return res.status(403).json({ error: 'Publishers cannot create college_wide broadcasts' });
      }
      
      const [chanRows] = await pool.query('SELECT department_id, club_id FROM channels WHERE id = ?', [channel_id]);
      if (chanRows.length === 0) return res.status(404).json({ error: 'Channel not found' });
      
      const chan = chanRows[0];
      const isDeptMatch = chan.department_id !== null && chan.department_id === req.user.department_id;
      const isClubMatch = chan.club_id !== null && req.user.managed_club_ids.includes(chan.club_id);
      
      if (!isDeptMatch && !isClubMatch) {
        return res.status(403).json({ error: 'You are not authorized to post to this channel' });
      }
    }

    const [result] = await pool.query(
      `INSERT INTO posts (publisher_id, channel_id, title, body, level, type, image_url, is_pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, channel_id, title, body, level, type, imageUrl, false]
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Server error' });
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

// POST /api/posts/:id/like
router.post('/:id/like', authRequired, async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id FROM likes WHERE user_id = ? AND post_id = ?', [req.user.id, req.params.id]);
    let liked = false;
    if (existing.length) {
      await pool.query('DELETE FROM likes WHERE id = ?', [existing[0].id]);
    } else {
      await pool.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [req.user.id, req.params.id]);
      liked = true;
    }
    const [countResult] = await pool.query('SELECT COUNT(*) AS count FROM likes WHERE post_id = ?', [req.params.id]);
    res.json({ liked, like_count: countResult[0].count });
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

// DELETE /api/posts/:id
router.delete('/:id', authRequired, requirePublisher, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query('SELECT publisher_id FROM posts WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    
    if (req.user.role !== 'admin' && rows[0].publisher_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    await pool.query('DELETE FROM posts WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
