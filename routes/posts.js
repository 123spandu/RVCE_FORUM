// routes/posts.js
const express = require('express');
const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/posts
 * Returns posts visible to the current user:
 * - Admin sees everything
 * - Publishers see everything (so they can monitor their own feed and others)
 * - Viewers see posts that are either target_type='all'
 *   OR target a department that includes the viewer's department
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const me = req.user;
    let sql;
    let params = [];

    if (me.role === 'viewer') {
      // Visible if "all" or specifically targeted to the viewer's department
      sql = `
        SELECT p.id, p.title, p.content, p.target_type, p.created_at,
               u.id AS publisher_id, u.full_name AS publisher_name, u.username AS publisher_username,
               d.name AS publisher_department,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me
        FROM posts p
        JOIN users u ON p.publisher_id = u.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE p.target_type = 'all'
           OR p.id IN (SELECT post_id FROM post_departments WHERE department_id = ?)
        ORDER BY p.created_at DESC
        LIMIT 200`;
      params = [me.id, me.department_id || 0];
    } else {
      // admin & publisher see all
      sql = `
        SELECT p.id, p.title, p.content, p.target_type, p.created_at,
               u.id AS publisher_id, u.full_name AS publisher_name, u.username AS publisher_username,
               d.name AS publisher_department,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me
        FROM posts p
        JOIN users u ON p.publisher_id = u.id
        LEFT JOIN departments d ON u.department_id = d.id
        ORDER BY p.created_at DESC
        LIMIT 200`;
      params = [me.id];
    }

    const [rows] = await pool.query(sql, params);

    // Attach the list of target departments for each "department" post
    const deptPostIds = rows.filter(r => r.target_type === 'department').map(r => r.id);
    let deptMap = {};
    if (deptPostIds.length) {
      const [drows] = await pool.query(
        `SELECT pd.post_id, d.id AS dept_id, d.name AS dept_name
           FROM post_departments pd JOIN departments d ON pd.department_id = d.id
          WHERE pd.post_id IN (?)`,
        [deptPostIds]
      );
      drows.forEach(r => {
        if (!deptMap[r.post_id]) deptMap[r.post_id] = [];
        deptMap[r.post_id].push({ id: r.dept_id, name: r.dept_name });
      });
    }
    rows.forEach(r => {
      r.target_departments = r.target_type === 'department' ? (deptMap[r.id] || []) : [];
      r.liked_by_me = Number(r.liked_by_me) > 0;
      r.like_count = Number(r.like_count);
    });

    res.json({ posts: rows });
  } catch (err) {
    console.error('List posts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/posts - publishers and admins only
 * Body: { title, content, target_type: 'all'|'department', department_ids?: [int] }
 */
router.post('/', authRequired, requireRole('publisher', 'admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { title, content } = req.body || {};
    let { target_type, department_ids } = req.body || {};
    target_type = target_type === 'department' ? 'department' : 'all'; // default 'all'

    if (!title || !title.trim() || !content || !content.trim()) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    if (target_type === 'department') {
      if (!Array.isArray(department_ids) || department_ids.length === 0) {
        return res.status(400).json({ error: 'department_ids is required when target_type is department' });
      }
    }

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO posts (publisher_id, title, content, target_type)
       VALUES (?, ?, ?, ?)`,
      [req.user.id, title.trim(), content.trim(), target_type]
    );
    const postId = result.insertId;

    if (target_type === 'department') {
      // Validate department ids
      const ids = [...new Set(department_ids.map(Number).filter(Boolean))];
      const [dRows] = await conn.query(
        'SELECT id FROM departments WHERE id IN (?)', [ids]
      );
      const validIds = dRows.map(r => r.id);
      if (validIds.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'No valid departments supplied' });
      }
      const values = validIds.map(id => [postId, id]);
      await conn.query('INSERT INTO post_departments (post_id, department_id) VALUES ?', [values]);
    }

    await conn.commit();
    res.status(201).json({ id: postId });
  } catch (err) {
    await conn.rollback();
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/posts/:id/like - toggle like
 */
router.post('/:id/like', authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const userId = req.user.id;

    const [existing] = await pool.query(
      'SELECT id FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]
    );
    if (existing.length) {
      await pool.query('DELETE FROM likes WHERE id = ?', [existing[0].id]);
    } else {
      // Make sure post exists
      const [p] = await pool.query('SELECT id FROM posts WHERE id = ?', [postId]);
      if (!p.length) return res.status(404).json({ error: 'Post not found' });
      await pool.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [userId, postId]);
    }
    const [c] = await pool.query('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?', [postId]);
    res.json({ liked: !existing.length, like_count: c[0].c });
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/posts/:id - publisher (own posts) or admin (any)
 */
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query('SELECT publisher_id FROM posts WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const isOwner = rows[0].publisher_id === req.user.id;
    if (!(isOwner || req.user.role === 'admin')) {
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
