// routes/posts.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { authRequired, requirePublisher } = require('../middleware/auth');
const { notifyNewPost } = require('./push');
const { personalizedVisibility, departmentBoardFilter } = require('../lib/feedVisibility');

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
    const { type, q, date, mine, dept, channel } = req.query; // UI team's query params
    const mineView = mine === '1' || mine === 'true';
    const deptId = dept ? Number(dept) : NaN;
    const channelId = channel ? Number(channel) : NaN;
    const browsingDept = Number.isInteger(deptId) && deptId > 0;
    const browsingChannel = Number.isInteger(channelId) && channelId > 0;

    let whereClause = "1=1";
    let params = [];

    if (mineView) {
      // Publishers see their full posting history, including scheduled drafts and expired posts.
      whereClause += " AND p.publisher_id = ?";
      params.push(me.id);
    } else {
      // Live feed: published, not future-scheduled, not expired.
      whereClause += " AND p.is_published = TRUE AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())";
      whereClause += " AND (p.expires_at IS NULL OR p.expires_at > NOW())";

      // Department / community browse: show that board's posts without requiring a prior subscription.
      // Personalized feed (subscriptions + audience) applies only to the default "All" feed.
      if (browsingDept || browsingChannel) {
        if (browsingChannel) {
          whereClause += ' AND p.channel_id = ?';
          params.push(channelId);
        }
        if (browsingDept) {
          const board = departmentBoardFilter(deptId);
          whereClause += ` AND ${board.clause}`;
          params.push(...board.params);
        }
      } else {
        const vis = personalizedVisibility(me);
        whereClause += ` AND ${vis.clause}`;
        params.push(...vis.params);
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
             (p.is_published = FALSE OR (p.scheduled_at IS NOT NULL AND p.scheduled_at > NOW())) AS is_scheduled,
             p.scheduled_at,
             p.is_published,
             u.full_name AS publisher_name,
             COALESCE(c.name, p.community_name) AS community_name,
             c.name AS publisher_department, c.type AS channel_type,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me,
             (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id) AS bookmark_count,
             (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) AS bookmarked_by_me,
             (SELECT COUNT(*) FROM subscriptions s
                WHERE s.channel_id = p.channel_id AND s.subscriber_id = ? AND s.status = 'approved') AS is_subscribed,
             (SELECT GROUP_CONCAT(ch.name ORDER BY ch.name SEPARATOR ', ')
                FROM post_target_channels ptc
                JOIN channels ch ON ch.id = ptc.channel_id
                WHERE ptc.post_id = p.id) AS audience_names,
             (SELECT COUNT(*) FROM post_target_channels ptc WHERE ptc.post_id = p.id) AS audience_count
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
      r.is_scheduled = Number(r.is_scheduled) > 0;
      r.is_published = r.is_published === undefined ? true : Number(r.is_published) > 0;
      r.is_subscribed = Number(r.is_subscribed) > 0;
      r.audience_count = Number(r.audience_count) || 0;
      r.audience_names = r.audience_names || null;
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
    const { title, content, target_type, post_type, post_level, department_ids, club_ids, expires_at, scheduled_at, visibility, target_channel_ids } = req.body || {};
    // Prefer uploaded file; allow share-target / reused upload path via image_url
    let imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    if (!imageUrl && req.body && req.body.image_url) {
      const raw = String(req.body.image_url).trim();
      if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(raw)) imageUrl = raw;
    }

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

    // Publishers may post from any public community (all communities are open).
    let communityName = null;
    if (req.user.role === 'publisher') {
      if (!channel_id) {
        return res.status(400).json({ error: 'Please select a community to post from.' });
      }
      const [chanRows] = await pool.query('SELECT name FROM channels WHERE id = ?', [channel_id]);
      if (chanRows.length === 0) return res.status(404).json({ error: 'Channel not found' });
      communityName = chanRows[0].name;
    } else if (channel_id) {
      // Admin posting into a specific community — capture its name for denormalization.
      const [chanRows] = await pool.query('SELECT name FROM channels WHERE id = ?', [channel_id]);
      if (chanRows.length) communityName = chanRows[0].name;
    }

    // Optional scheduled publish time.
    // Current / past / within ~1 minute → publish now.
    // Future → keep as draft until the publish job runs.
    let scheduledAt = null;
    let isPublished = true;
    if (scheduled_at) {
      const d = new Date(scheduled_at);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid scheduled publish time.' });
      }
      scheduledAt = d;
      if (d.getTime() > Date.now() + 60 * 1000) {
        isPublished = false;
      } else {
        // Snap "now" selections to the actual publish moment
        scheduledAt = new Date();
      }
    }

    // Notice Expiry Automation: every notice MUST expire and move to archive.
    // If the publisher omits expires_at, default to 7 days from publish/schedule time.
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
    } else {
      const base = scheduledAt && scheduledAt.getTime() > Date.now() ? scheduledAt.getTime() : Date.now();
      expiresAt = new Date(base + 7 * 24 * 60 * 60 * 1000);
    }

    if (scheduledAt && expiresAt.getTime() <= scheduledAt.getTime()) {
      return res.status(400).json({ error: 'Expiry must be after the scheduled publish time.' });
    }

    // Resolve audience targeting (2.2 Department-Specific Notice Distribution):
    // - visibility 'all' (or omitted) → college-wide (no target rows)
    // - visibility 'communities' → must include ≥1 channel IDs (departments and/or clubs)
    // target_channel_ids may arrive as JSON string (multipart) or array (offline replay).
    let targetChannelIds = [];
    if (visibility === 'communities') {
      try {
        const raw = Array.isArray(target_channel_ids) ? target_channel_ids : JSON.parse(target_channel_ids || '[]');
        targetChannelIds = [...new Set((raw || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
      } catch (_) {
        targetChannelIds = [];
      }
      if (targetChannelIds.length === 0) {
        return res.status(400).json({
          error: 'Select at least one department (or community), or choose Everyone.'
        });
      }
      // Ensure every target channel exists
      const [valid] = await pool.query(
        `SELECT id FROM channels WHERE id IN (?)`,
        [targetChannelIds]
      );
      if (valid.length !== targetChannelIds.length) {
        return res.status(400).json({ error: 'One or more selected departments/communities are invalid.' });
      }
    }

    const [result] = await pool.query(
      `INSERT INTO posts (publisher_id, channel_id, title, body, level, type, image_url, community_name, is_pinned, scheduled_at, is_published, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, channel_id, title, body, level, type, imageUrl, communityName, false, scheduledAt, isPublished, expiresAt]
    );

    // Persist targeting. No rows = visible to everyone in the institution.
    if (targetChannelIds.length > 0) {
      await pool.query(
        'INSERT INTO post_target_channels (post_id, channel_id) VALUES ?',
        [targetChannelIds.map(id => [result.insertId, id])]
      );
    }

    // Push to every user who enabled browser notifications (not only bell-on subscribers).
    if (isPublished) {
      notifyNewPost({
        title,
        body,
        postId: result.insertId,
        communityName,
        excludeUserId: req.user.id
      }).catch((err) => console.error('Post push notify failed:', err.message));
    }

    res.status(201).json({ id: result.insertId, scheduled: !isPublished, is_published: isPublished });
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

// GET /api/posts/bookmarks — saved notices for the signed-in user
router.get('/bookmarks', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.title, p.body AS content, p.level AS target_type, p.type AS post_type,
              p.image_url, p.created_at, p.expires_at,
              u.full_name AS publisher_name,
              COALESCE(c.name, p.community_name) AS community_name,
              b.created_at AS bookmarked_at
         FROM bookmarks b
         JOIN posts p ON p.id = b.post_id
         JOIN users u ON p.publisher_id = u.id
         LEFT JOIN channels c ON p.channel_id = c.id
        WHERE b.user_id = ?
          AND p.is_published = TRUE
          AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())
          AND (p.expires_at IS NULL OR p.expires_at > NOW())
        ORDER BY b.created_at DESC
        LIMIT 50`,
      [req.user.id]
    );
    res.json({ bookmarks: rows });
  } catch (err) {
    console.error('List bookmarks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/posts/:id — deep links (push click, share URL, web+rvce protocol)
// MUST stay below /stories and /bookmarks so those paths are not captured as ids.
router.get('/:id', authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ error: 'Invalid post id' });
    }
    const me = req.user;
    const sql = `
      SELECT p.id, p.title, p.body AS content, p.level AS target_type, p.type AS post_type, p.image_url, p.is_pinned, p.created_at,
             p.expires_at,
             (p.expires_at IS NOT NULL AND p.expires_at <= NOW()) AS is_expired,
             (p.is_published = FALSE OR (p.scheduled_at IS NOT NULL AND p.scheduled_at > NOW())) AS is_scheduled,
             p.scheduled_at,
             p.is_published,
             u.full_name AS publisher_name,
             COALESCE(c.name, p.community_name) AS community_name,
             c.name AS publisher_department, c.type AS channel_type,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me,
             (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id) AS bookmark_count,
             (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) AS bookmarked_by_me,
             (SELECT COUNT(*) FROM subscriptions s
                WHERE s.channel_id = p.channel_id AND s.subscriber_id = ? AND s.status = 'approved') AS is_subscribed,
             (SELECT GROUP_CONCAT(ch.name ORDER BY ch.name SEPARATOR ', ')
                FROM post_target_channels ptc
                JOIN channels ch ON ch.id = ptc.channel_id
                WHERE ptc.post_id = p.id) AS audience_names,
             (SELECT COUNT(*) FROM post_target_channels ptc WHERE ptc.post_id = p.id) AS audience_count
      FROM posts p
      JOIN users u ON p.publisher_id = u.id
      LEFT JOIN channels c ON c.id = p.channel_id
      WHERE p.id = ?
      LIMIT 1
    `;
    const [rows] = await pool.query(sql, [me.id, me.id, me.id, postId]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const r = rows[0];
    r.liked_by_me = Number(r.liked_by_me) > 0;
    r.bookmarked_by_me = Number(r.bookmarked_by_me) > 0;
    r.is_expired = Number(r.is_expired) > 0;
    r.is_scheduled = Number(r.is_scheduled) > 0;
    r.is_published = r.is_published === undefined ? true : Number(r.is_published) > 0;
    r.is_subscribed = Number(r.is_subscribed) > 0;
    r.audience_count = Number(r.audience_count) || 0;
    r.audience_names = r.audience_names || null;
    res.json({ post: r });
  } catch (err) {
    console.error('Get post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/:id/like
// Body { liked: true|false } sets desired state (idempotent). Omit to toggle (legacy).
router.post('/:id/like', authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const [posts] = await pool.query('SELECT id FROM posts WHERE id = ?', [postId]);
    if (!posts.length) return res.status(404).json({ error: 'Post not found' });

    const [existing] = await pool.query(
      'SELECT id FROM likes WHERE user_id = ? AND post_id = ?',
      [req.user.id, postId]
    );

    let liked;
    if (typeof req.body?.liked === 'boolean') {
      liked = req.body.liked;
      if (liked && !existing.length) {
        await pool.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [req.user.id, postId]);
      } else if (!liked && existing.length) {
        await pool.query('DELETE FROM likes WHERE id = ?', [existing[0].id]);
      }
    } else if (existing.length) {
      await pool.query('DELETE FROM likes WHERE id = ?', [existing[0].id]);
      liked = false;
    } else {
      await pool.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [req.user.id, postId]);
      liked = true;
    }

    const [countResult] = await pool.query('SELECT COUNT(*) AS count FROM likes WHERE post_id = ?', [postId]);
    res.json({ liked, like_count: Number(countResult[0].count) || 0 });
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/posts/:id/bookmark
// Body { bookmarked: true|false } sets desired state (idempotent). Omit to toggle (legacy).
router.post('/:id/bookmark', authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const [posts] = await pool.query('SELECT id FROM posts WHERE id = ?', [postId]);
    if (!posts.length) return res.status(404).json({ error: 'Post not found' });

    const [existing] = await pool.query(
      'SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?',
      [req.user.id, postId]
    );

    let bookmarked;
    if (typeof req.body?.bookmarked === 'boolean') {
      bookmarked = req.body.bookmarked;
      if (bookmarked && !existing.length) {
        await pool.query(
          'INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)',
          [req.user.id, postId]
        );
      } else if (!bookmarked && existing.length) {
        await pool.query('DELETE FROM bookmarks WHERE id = ?', [existing[0].id]);
      }
    } else if (existing.length) {
      await pool.query('DELETE FROM bookmarks WHERE id = ?', [existing[0].id]);
      bookmarked = false;
    } else {
      await pool.query(
        'INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)',
        [req.user.id, postId]
      );
      bookmarked = true;
    }

    const [countResult] = await pool.query(
      'SELECT COUNT(*) AS count FROM bookmarks WHERE post_id = ?',
      [postId]
    );
    res.json({
      bookmarked,
      bookmark_count: Number(countResult[0].count) || 0
    });
  } catch (err) {
    console.error('Bookmark error:', err);
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
