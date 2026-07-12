// routes/analytics.js — Publisher Analytics Dashboard
const express = require('express');
const pool = require('../db');
const { authRequired, requirePublisher } = require('../middleware/auth');

const router = express.Router();

function publisherScope(me) {
  // Admins see campus-wide; publishers see only their own posts/channels.
  if (me.role === 'admin') {
    return { postWhere: '1=1', postParams: [], channelWhere: '1=1', channelParams: [] };
  }
  return {
    postWhere: 'p.publisher_id = ?',
    postParams: [me.id],
    channelWhere: 'c.id IN (SELECT channel_id FROM posts WHERE publisher_id = ? AND channel_id IS NOT NULL)',
    channelParams: [me.id]
  };
}

// POST /api/analytics/view — record an impression/view
router.post('/view', authRequired, async (req, res) => {
  try {
    const postId = Number(req.body?.post_id);
    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ error: 'post_id required' });
    }
    const [exists] = await pool.query('SELECT id FROM posts WHERE id = ?', [postId]);
    if (!exists.length) return res.status(404).json({ error: 'Post not found' });

    await pool.query(
      'INSERT INTO post_views (post_id, user_id) VALUES (?, ?)',
      [postId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Record view error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/analytics/click — record a click (read more / open / share) for CTR
router.post('/click', authRequired, async (req, res) => {
  try {
    const postId = Number(req.body?.post_id);
    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ error: 'post_id required' });
    }
    const [exists] = await pool.query('SELECT id FROM posts WHERE id = ?', [postId]);
    if (!exists.length) return res.status(404).json({ error: 'Post not found' });

    await pool.query(
      'INSERT INTO post_clicks (post_id, user_id) VALUES (?, ?)',
      [postId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Record click error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/analytics/publisher — full analytics payload for the signed-in publisher
router.get('/publisher', authRequired, requirePublisher, async (req, res) => {
  try {
    const me = req.user;
    const scope = publisherScope(me);

    const [[viewsRow]] = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT v.user_id) AS unique_views
         FROM post_views v
         JOIN posts p ON p.id = v.post_id
        WHERE ${scope.postWhere}`,
      scope.postParams
    );

    const [[likesRow]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM likes l
         JOIN posts p ON p.id = l.post_id
        WHERE ${scope.postWhere}`,
      scope.postParams
    );

    const [[bookmarksRow]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM bookmarks b
         JOIN posts p ON p.id = b.post_id
        WHERE ${scope.postWhere}`,
      scope.postParams
    );

    const [[clicksRow]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM post_clicks c
         JOIN posts p ON p.id = c.post_id
        WHERE ${scope.postWhere}`,
      scope.postParams
    );

    const [[subsRow]] = await pool.query(
      `SELECT COUNT(DISTINCT s.subscriber_id) AS total
         FROM subscriptions s
         JOIN channels c ON c.id = s.channel_id
        WHERE s.status = 'approved'
          AND ${scope.channelWhere}`,
      scope.channelParams
    );

    const views = Number(viewsRow.total) || 0;
    const clicks = Number(clicksRow.total) || 0;
    const ctr = views > 0 ? Math.round((clicks / views) * 1000) / 10 : 0;

    // Department reach — unique engagers by department
    const [deptReach] = await pool.query(
      `SELECT d.id, d.name, COUNT(DISTINCT u.id) AS reach
         FROM (
           SELECT l.user_id AS uid FROM likes l JOIN posts p ON p.id = l.post_id WHERE ${scope.postWhere}
           UNION
           SELECT b.user_id FROM bookmarks b JOIN posts p ON p.id = b.post_id WHERE ${scope.postWhere}
           UNION
           SELECT v.user_id FROM post_views v JOIN posts p ON p.id = v.post_id WHERE ${scope.postWhere} AND v.user_id IS NOT NULL
         ) eng
         JOIN users u ON u.id = eng.uid
         JOIN departments d ON d.id = u.department_id
        GROUP BY d.id, d.name
        ORDER BY reach DESC
        LIMIT 12`,
      [...scope.postParams, ...scope.postParams, ...scope.postParams]
    );

    // Most active hour (0–23) from combined engagement
    const [hourRows] = await pool.query(
      `SELECT hr AS hour, SUM(cnt) AS count FROM (
          SELECT HOUR(l.created_at) AS hr, COUNT(*) AS cnt
            FROM likes l JOIN posts p ON p.id = l.post_id
           WHERE ${scope.postWhere}
           GROUP BY HOUR(l.created_at)
          UNION ALL
          SELECT HOUR(v.created_at), COUNT(*)
            FROM post_views v JOIN posts p ON p.id = v.post_id
           WHERE ${scope.postWhere}
           GROUP BY HOUR(v.created_at)
          UNION ALL
          SELECT HOUR(b.created_at), COUNT(*)
            FROM bookmarks b JOIN posts p ON p.id = b.post_id
           WHERE ${scope.postWhere}
           GROUP BY HOUR(b.created_at)
          UNION ALL
          SELECT HOUR(c.created_at), COUNT(*)
            FROM post_clicks c JOIN posts p ON p.id = c.post_id
           WHERE ${scope.postWhere}
           GROUP BY HOUR(c.created_at)
        ) t
        GROUP BY hr
        ORDER BY hr`,
      [...scope.postParams, ...scope.postParams, ...scope.postParams, ...scope.postParams]
    );

    const activeByHour = Array.from({ length: 24 }, (_, h) => {
      const row = hourRows.find(r => Number(r.hour) === h);
      return { hour: h, count: row ? Number(row.count) : 0 };
    });
    const peak = activeByHour.reduce((a, b) => (b.count > a.count ? b : a), { hour: 0, count: 0 });

    // Heatmap: day-of-week (1=Sun..7=Sat in MySQL DAYOFWEEK) × hour
    const [heatRows] = await pool.query(
      `SELECT dow, hr, SUM(cnt) AS count FROM (
          SELECT DAYOFWEEK(l.created_at) AS dow, HOUR(l.created_at) AS hr, COUNT(*) AS cnt
            FROM likes l JOIN posts p ON p.id = l.post_id
           WHERE ${scope.postWhere} AND l.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           GROUP BY DAYOFWEEK(l.created_at), HOUR(l.created_at)
          UNION ALL
          SELECT DAYOFWEEK(v.created_at), HOUR(v.created_at), COUNT(*)
            FROM post_views v JOIN posts p ON p.id = v.post_id
           WHERE ${scope.postWhere} AND v.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           GROUP BY DAYOFWEEK(v.created_at), HOUR(v.created_at)
          UNION ALL
          SELECT DAYOFWEEK(c.created_at), HOUR(c.created_at), COUNT(*)
            FROM post_clicks c JOIN posts p ON p.id = c.post_id
           WHERE ${scope.postWhere} AND c.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           GROUP BY DAYOFWEEK(c.created_at), HOUR(c.created_at)
        ) t
        GROUP BY dow, hr`,
      [...scope.postParams, ...scope.postParams, ...scope.postParams]
    );

    // Engagement over last 14 days (for line/bar chart)
    const [daily] = await pool.query(
      `SELECT d AS day, SUM(views) AS views, SUM(likes) AS likes, SUM(clicks) AS clicks FROM (
          SELECT DATE(v.created_at) AS d, COUNT(*) AS views, 0 AS likes, 0 AS clicks
            FROM post_views v JOIN posts p ON p.id = v.post_id
           WHERE ${scope.postWhere} AND v.created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
           GROUP BY DATE(v.created_at)
          UNION ALL
          SELECT DATE(l.created_at), 0, COUNT(*), 0
            FROM likes l JOIN posts p ON p.id = l.post_id
           WHERE ${scope.postWhere} AND l.created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
           GROUP BY DATE(l.created_at)
          UNION ALL
          SELECT DATE(c.created_at), 0, 0, COUNT(*)
            FROM post_clicks c JOIN posts p ON p.id = c.post_id
           WHERE ${scope.postWhere} AND c.created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
           GROUP BY DATE(c.created_at)
        ) x
        GROUP BY d
        ORDER BY d`,
      [...scope.postParams, ...scope.postParams, ...scope.postParams]
    );

    // Top posts by engagement
    const [topPosts] = await pool.query(
      `SELECT p.id, p.title, p.type AS post_type,
              (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id) AS views,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
              (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id) AS bookmarks,
              (SELECT COUNT(*) FROM post_clicks c WHERE c.post_id = p.id) AS clicks
         FROM posts p
        WHERE ${scope.postWhere}
        ORDER BY (
          (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id)
          + (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) * 2
          + (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id) * 2
          + (SELECT COUNT(*) FROM post_clicks c WHERE c.post_id = p.id)
        ) DESC
        LIMIT 8`,
      scope.postParams
    );

    const [[postCount]] = await pool.query(
      `SELECT COUNT(*) AS total FROM posts p WHERE ${scope.postWhere}`,
      scope.postParams
    );

    res.json({
      scope: me.role === 'admin' ? 'campus' : 'mine',
      totals: {
        views,
        unique_views: Number(viewsRow.unique_views) || 0,
        likes: Number(likesRow.total) || 0,
        bookmarks: Number(bookmarksRow.total) || 0,
        subscribers: Number(subsRow.total) || 0,
        clicks,
        ctr,
        posts: Number(postCount.total) || 0
      },
      department_reach: deptReach.map(r => ({
        id: r.id,
        name: r.name,
        reach: Number(r.reach)
      })),
      most_active_time: {
        peak_hour: peak.hour,
        peak_label: `${String(peak.hour).padStart(2, '0')}:00`,
        by_hour: activeByHour
      },
      heatmap: heatRows.map(r => ({
        // Convert MySQL DAYOFWEEK (1=Sun) → 0=Sun … 6=Sat
        dow: Number(r.dow) - 1,
        hour: Number(r.hr),
        count: Number(r.count)
      })),
      daily_engagement: daily.map(r => ({
        day: r.day,
        views: Number(r.views),
        likes: Number(r.likes),
        clicks: Number(r.clicks)
      })),
      top_posts: topPosts.map(p => ({
        id: p.id,
        title: p.title,
        post_type: p.post_type,
        views: Number(p.views),
        likes: Number(p.likes),
        bookmarks: Number(p.bookmarks),
        clicks: Number(p.clicks),
        ctr: Number(p.views) > 0
          ? Math.round((Number(p.clicks) / Number(p.views)) * 1000) / 10
          : 0
      }))
    });
  } catch (err) {
    console.error('Publisher analytics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
