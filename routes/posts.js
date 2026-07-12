// routes/posts.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { authRequired, requirePublisher } = require('../middleware/auth');
const { notifyChannelSubscribers } = require('./push');

const router = express.Router();

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// GET /api/posts
// Normal feed: hides expired posts.
// Publisher history view (?mine=1): returns the publisher's own posts INCLUDING
// expired ones, each flagged with is_expired so the UI can show an [Expired] badge.
router.get('/', authRequired, async (req, res) => {
  try {
    const me = req.user;
    const { type, q, date, mine } = req.query; // UI team's query params
    const mineView = mine === '1' || mine === 'true';

    let whereClause = "p.is_published = TRUE";
    let params = [];

    // Base Visibility Rules removed per user architecture update.
    // All posts are now globally visible. Subscriptions govern push notifications instead.

    if (mineView) {
      // Publishers see their full posting history, including expired posts.
      whereClause += " AND p.publisher_id = ?";
      params.push(me.id);
    } else {
      // Public feed: filter out posts whose expiry date has passed.
      whereClause += " AND (p.expires_at IS NULL OR p.expires_at > NOW())";

      // Audience targeting: a post is visible when it targets NO community
      // (broadcast to all), OR the viewer is an approved SUBSCRIBER of one of the
      // targeted communities, OR the viewer authored it. Admins bypass targeting.
      if (me.role !== 'admin') {
        whereClause += ` AND (
          NOT EXISTS (SELECT 1 FROM post_target_channels ptc WHERE ptc.post_id = p.id)
          OR EXISTS (
            SELECT 1 FROM post_target_channels ptc
            JOIN subscriptions s ON s.channel_id = ptc.channel_id
            WHERE ptc.post_id = p.id AND s.subscriber_id = ? AND s.status = 'approved'
          )
          OR p.publisher_id = ?
        )`;
        params.push(me.id, me.id);
      }
    }

    // UI Team's advanced filters
    if (type) { whereClause += " AND p.type = ?"; params.push(type); }
    if (q) { whereClause += " AND (p.title LIKE ? OR p.body LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
    if (date) { whereClause += " AND DATE(p.created_at) = ?"; params.push(date); }

    const sql = `
      SELECT p.id, p.title, p.body AS content, p.level AS target_type, p.type AS post_type, p.image_url, p.is_pinned, p.created_at,
             p.expires_at,
             (p.expires_at IS NOT NULL AND p.expires_at <= NOW()) AS is_expired,
             u.full_name AS publisher_name,
             COALESCE(c.name, p.community_name) AS community_name,
             c.name AS publisher_department, c.type AS channel_type,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me,
             (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) AS bookmarked_by_me,
             (SELECT COUNT(*) FROM subscriptions s
                WHERE s.channel_id = p.channel_id AND s.subscriber_id = ? AND s.status = 'approved') AS is_subscribed
      FROM posts p
      JOIN users u ON p.publisher_id = u.id
      LEFT JOIN channels c ON p.channel_id = c.id
      WHERE ${whereClause}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 100
    `;

    // Inject user_id for liked_by_me, bookmarked_by_me, and is_subscribed calculations
    const finalParams = [me.id, me.id, me.id, ...params];
    const [rows] = await pool.query(sql, finalParams);

    // Cast booleans for UI compatibility
    rows.forEach(r => {
      r.liked_by_me = Number(r.liked_by_me) > 0;
      r.bookmarked_by_me = Number(r.bookmarked_by_me) > 0;
      r.is_expired = Number(r.is_expired) > 0;
      r.is_subscribed = Number(r.is_subscribed) > 0;
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
    const { title, content, target_type, post_type, post_level, department_ids, club_ids, expires_at, visibility, target_channel_ids } = req.body || {};
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // Map UI variables to backend schema variables
    const body = content;
    const type = post_type;
    const level = post_level || 'college_wide';

    if (!title || !body || !level || !type) {
      return res.status(400).json({ error: 'Title, body, level, and type are required' });
    }

    // Resolve the channel. The new composer sends channel_id directly (the "From" field).
    // Fall back to the legacy multi-select arrays for backward compatibility.
    let channel_id = null;
    if (req.body.channel_id) {
      channel_id = Number(req.body.channel_id) || null;
    } else if (target_type === 'department' && department_ids) {
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

    // Publishers must always post to a community they are assigned to.
    let communityName = null;
    if (req.user.role === 'publisher') {
      if (!channel_id) {
        return res.status(400).json({ error: 'Please select a community to post from.' });
      }
      const [chanRows] = await pool.query('SELECT name, department_id, club_id FROM channels WHERE id = ?', [channel_id]);
      if (chanRows.length === 0) return res.status(404).json({ error: 'Channel not found' });

      const chan = chanRows[0];
      const managedClubIds = req.user.managed_club_ids || [];
      const isDeptMatch = chan.department_id !== null && chan.department_id === req.user.department_id;
      const isClubMatch = chan.club_id !== null && managedClubIds.includes(chan.club_id);

      // Owns it OR has joined (subscribed to) it.
      let allowed = isDeptMatch || isClubMatch;
      if (!allowed) {
        const [sub] = await pool.query(
          'SELECT id FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?',
          [req.user.id, channel_id]
        );
        allowed = sub.length > 0;
      }
      if (!allowed) {
        return res.status(403).json({ error: 'You can only post to communities you own or have joined.' });
      }
      communityName = chan.name;
    } else if (channel_id) {
      // Admin posting into a specific community — capture its name for denormalization.
      const [chanRows] = await pool.query('SELECT name FROM channels WHERE id = ?', [channel_id]);
      if (chanRows.length) communityName = chanRows[0].name;
    }

    // Validate optional expiry date — must be a valid timestamp in the future.
    let expiresAt = null;
    if (expires_at) {
      const d = new Date(expires_at);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid expiry date.' });
      }
      if (d.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'Expiry date must be in the future.' });
      }
      expiresAt = d;
    }

    // Resolve audience targeting. `visibility === 'communities'` restricts the post
    // to the chosen community (channel) IDs — subscribers of those channels only;
    // anything else (default) makes it visible to all. target_channel_ids may arrive
    // as a JSON string (multipart form) or an array (offline JSON replay). Invalid/
    // empty selections fall back to "visible to all".
    let targetChannelIds = [];
    if (visibility === 'communities' && target_channel_ids != null) {
      try {
        const raw = Array.isArray(target_channel_ids) ? target_channel_ids : JSON.parse(target_channel_ids);
        targetChannelIds = [...new Set((raw || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
      } catch (_) {
        targetChannelIds = [];
      }
    }

    const [result] = await pool.query(
      `INSERT INTO posts (publisher_id, channel_id, title, body, level, type, image_url, community_name, is_pinned, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, channel_id, title, body, level, type, imageUrl, communityName, false, expiresAt]
    );

    // Persist community targeting (if any). No rows = visible to everyone.
    if (targetChannelIds.length > 0) {
      await pool.query(
        'INSERT INTO post_target_channels (post_id, channel_id) VALUES ?',
        [targetChannelIds.map(id => [result.insertId, id])]
      );
    }

    // Fire push notifications to bell-enabled subscribers (non-blocking).
    if (channel_id) {
      notifyChannelSubscribers(channel_id, {
        title: communityName ? `New post in ${communityName}` : 'New campus announcement',
        body: title,
        postId: result.insertId
      }, req.user.id);
    }

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

// DELETE /api/posts/:id — admin only. Publishers can no longer delete posts.
router.delete('/:id', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete posts.' });
    }

    const id = Number(req.params.id);
    const [rows] = await pool.query('SELECT id, title, publisher_id FROM posts WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });

    await pool.query('DELETE FROM posts WHERE id = ?', [id]);

    // Audit the admin deletion (best-effort — never fail the request over logging).
    try {
      await pool.query(
        'INSERT INTO audit_logs (actor_id, action, details) VALUES (?, ?, ?)',
        [req.user.id, 'POST_DELETE', JSON.stringify({ post_id: id, title: rows[0].title, publisher_id: rows[0].publisher_id })]
      );
    } catch (logErr) {
      console.error('Audit log failed:', logErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
