// routes/analytics.js — Publisher / Campus Analytics Dashboard
const express = require('express');
const pool = require('../db');
const { authRequired, requirePublisher } = require('../middleware/auth');

const router = express.Router();

// MySQL TIMESTAMP is stored UTC; campus charts display Asia/Kolkata (IST, UTC+5:30).
function istHour(col) {
  return `HOUR(CONVERT_TZ(${col}, '+00:00', '+05:30'))`;
}
function istDow(col) {
  return `DAYOFWEEK(CONVERT_TZ(${col}, '+00:00', '+05:30'))`;
}
function istDate(col) {
  return `DATE(CONVERT_TZ(${col}, '+00:00', '+05:30'))`;
}
function istDayStr(col) {
  return `DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', '+05:30'), '%Y-%m-%d')`;
}

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

function localDayKeys(daysBack) {
  // Build YYYY-MM-DD keys in IST (±5:30) without depending on server locale.
  const keys = [];
  const now = Date.now() + (5.5 * 60 * 60 * 1000);
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    keys.push(`${y}-${m}-${day}`);
  }
  return keys;
}

// POST /api/analytics/view — record one impression per user/post/day (excludes author's own views)
router.post('/view', authRequired, async (req, res) => {
  try {
    const postId = Number(req.body?.post_id);
    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ error: 'post_id required' });
    }
    const [posts] = await pool.query(
      'SELECT id, publisher_id FROM posts WHERE id = ? LIMIT 1',
      [postId]
    );
    if (!posts.length) return res.status(404).json({ error: 'Post not found' });

    if (Number(posts[0].publisher_id) === Number(req.user.id)) {
      return res.json({ ok: true, counted: false, reason: 'own_post' });
    }

    const [existing] = await pool.query(
      `SELECT id FROM post_views
        WHERE post_id = ? AND user_id = ? AND DATE(created_at) = CURDATE()
        LIMIT 1`,
      [postId, req.user.id]
    );
    if (existing.length) {
      return res.json({ ok: true, counted: false, reason: 'already_counted_today' });
    }

    await pool.query(
      'INSERT INTO post_views (post_id, user_id) VALUES (?, ?)',
      [postId, req.user.id]
    );
    res.json({ ok: true, counted: true });
  } catch (err) {
    console.error('Record view error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/analytics/click — one intentional open/share per user/post/day (excludes author)
router.post('/click', authRequired, async (req, res) => {
  try {
    const postId = Number(req.body?.post_id);
    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ error: 'post_id required' });
    }
    const [posts] = await pool.query(
      'SELECT id, publisher_id FROM posts WHERE id = ? LIMIT 1',
      [postId]
    );
    if (!posts.length) return res.status(404).json({ error: 'Post not found' });

    if (Number(posts[0].publisher_id) === Number(req.user.id)) {
      return res.json({ ok: true, counted: false, reason: 'own_post' });
    }

    const [existing] = await pool.query(
      `SELECT id FROM post_clicks
        WHERE post_id = ? AND user_id = ? AND DATE(created_at) = CURDATE()
        LIMIT 1`,
      [postId, req.user.id]
    );
    if (existing.length) {
      return res.json({ ok: true, counted: false, reason: 'already_counted_today' });
    }

    await pool.query(
      'INSERT INTO post_clicks (post_id, user_id) VALUES (?, ?)',
      [postId, req.user.id]
    );
    res.json({ ok: true, counted: true });
  } catch (err) {
    console.error('Record click error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/analytics/publisher — full analytics payload for publisher or campus admin
router.get('/publisher', authRequired, requirePublisher, async (req, res) => {
  try {
    const me = req.user;
    const scope = publisherScope(me);
    const isAdmin = me.role === 'admin';

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
    const likes = Number(likesRow.total) || 0;
    const bookmarks = Number(bookmarksRow.total) || 0;
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

    // Most active hour in IST (0–23)
    const [hourRows] = await pool.query(
      `SELECT hr AS hour, SUM(cnt) AS count FROM (
          SELECT ${istHour('l.created_at')} AS hr, COUNT(*) AS cnt
            FROM likes l JOIN posts p ON p.id = l.post_id
           WHERE ${scope.postWhere}
           GROUP BY ${istHour('l.created_at')}
          UNION ALL
          SELECT ${istHour('v.created_at')}, COUNT(*)
            FROM post_views v JOIN posts p ON p.id = v.post_id
           WHERE ${scope.postWhere}
           GROUP BY ${istHour('v.created_at')}
          UNION ALL
          SELECT ${istHour('b.created_at')}, COUNT(*)
            FROM bookmarks b JOIN posts p ON p.id = b.post_id
           WHERE ${scope.postWhere}
           GROUP BY ${istHour('b.created_at')}
          UNION ALL
          SELECT ${istHour('c.created_at')}, COUNT(*)
            FROM post_clicks c JOIN posts p ON p.id = c.post_id
           WHERE ${scope.postWhere}
           GROUP BY ${istHour('c.created_at')}
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

    // Heatmap: IST day-of-week × hour (last 30 days)
    const [heatRows] = await pool.query(
      `SELECT dow, hr, SUM(cnt) AS count FROM (
          SELECT ${istDow('l.created_at')} AS dow, ${istHour('l.created_at')} AS hr, COUNT(*) AS cnt
            FROM likes l JOIN posts p ON p.id = l.post_id
           WHERE ${scope.postWhere} AND l.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           GROUP BY ${istDow('l.created_at')}, ${istHour('l.created_at')}
          UNION ALL
          SELECT ${istDow('v.created_at')}, ${istHour('v.created_at')}, COUNT(*)
            FROM post_views v JOIN posts p ON p.id = v.post_id
           WHERE ${scope.postWhere} AND v.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           GROUP BY ${istDow('v.created_at')}, ${istHour('v.created_at')}
          UNION ALL
          SELECT ${istDow('b.created_at')}, ${istHour('b.created_at')}, COUNT(*)
            FROM bookmarks b JOIN posts p ON p.id = b.post_id
           WHERE ${scope.postWhere} AND b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           GROUP BY ${istDow('b.created_at')}, ${istHour('b.created_at')}
          UNION ALL
          SELECT ${istDow('c.created_at')}, ${istHour('c.created_at')}, COUNT(*)
            FROM post_clicks c JOIN posts p ON p.id = c.post_id
           WHERE ${scope.postWhere} AND c.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           GROUP BY ${istDow('c.created_at')}, ${istHour('c.created_at')}
        ) t
        GROUP BY dow, hr`,
      [...scope.postParams, ...scope.postParams, ...scope.postParams, ...scope.postParams]
    );

    // Engagement over last 14 IST days
    const [daily] = await pool.query(
      `SELECT d AS day, SUM(views) AS views, SUM(likes) AS likes, SUM(bookmarks) AS bookmarks, SUM(clicks) AS clicks FROM (
          SELECT ${istDayStr('v.created_at')} AS d, COUNT(*) AS views, 0 AS likes, 0 AS bookmarks, 0 AS clicks
            FROM post_views v JOIN posts p ON p.id = v.post_id
           WHERE ${scope.postWhere} AND v.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
           GROUP BY ${istDayStr('v.created_at')}
          UNION ALL
          SELECT ${istDayStr('l.created_at')}, 0, COUNT(*), 0, 0
            FROM likes l JOIN posts p ON p.id = l.post_id
           WHERE ${scope.postWhere} AND l.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
           GROUP BY ${istDayStr('l.created_at')}
          UNION ALL
          SELECT ${istDayStr('b.created_at')}, 0, 0, COUNT(*), 0
            FROM bookmarks b JOIN posts p ON p.id = b.post_id
           WHERE ${scope.postWhere} AND b.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
           GROUP BY ${istDayStr('b.created_at')}
          UNION ALL
          SELECT ${istDayStr('c.created_at')}, 0, 0, 0, COUNT(*)
            FROM post_clicks c JOIN posts p ON p.id = c.post_id
           WHERE ${scope.postWhere} AND c.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
           GROUP BY ${istDayStr('c.created_at')}
        ) x
        GROUP BY d
        ORDER BY d`,
      [...scope.postParams, ...scope.postParams, ...scope.postParams, ...scope.postParams]
    );

    // Notices published per day (always meaningful even with little engagement)
    const [publishedDaily] = await pool.query(
      `SELECT ${istDayStr('p.created_at')} AS day, COUNT(*) AS posts
         FROM posts p
        WHERE ${scope.postWhere}
          AND p.is_published = TRUE
          AND p.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
        GROUP BY ${istDayStr('p.created_at')}
        ORDER BY day`,
      scope.postParams
    );

    // Notices by category / type
    const [postsByType] = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(p.type), ''), 'other') AS post_type, COUNT(*) AS count
         FROM posts p
        WHERE ${scope.postWhere}
          AND p.is_published = TRUE
        GROUP BY COALESCE(NULLIF(TRIM(p.type), ''), 'other')
        ORDER BY count DESC`,
      scope.postParams
    );

    // Top communities by post volume (campus chart)
    const [postsByCommunity] = await pool.query(
      `SELECT COALESCE(c.name, p.community_name, 'Unassigned') AS name, COUNT(*) AS count
         FROM posts p
         LEFT JOIN channels c ON c.id = p.channel_id
        WHERE ${scope.postWhere}
          AND p.is_published = TRUE
        GROUP BY COALESCE(c.name, p.community_name, 'Unassigned')
        ORDER BY count DESC
        LIMIT 8`,
      scope.postParams
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

    const dayKeys = localDayKeys(14);
    const engMap = new Map(
      daily.map(r => [String(r.day).slice(0, 10), r])
    );
    const pubMap = new Map(
      publishedDaily.map(r => [String(r.day).slice(0, 10), Number(r.posts) || 0])
    );

    const dailyEngagement = dayKeys.map(day => {
      const r = engMap.get(day) || {};
      return {
        day,
        views: Number(r.views) || 0,
        likes: Number(r.likes) || 0,
        bookmarks: Number(r.bookmarks) || 0,
        clicks: Number(r.clicks) || 0,
        posts: pubMap.get(day) || 0
      };
    });

    const engagementTotal = views + likes + bookmarks + clicks;
    const insights = [];
    if (peak.count > 0) {
      insights.push(`Students engage most around ${String(peak.hour).padStart(2, '0')}:00 IST.`);
    } else {
      insights.push('Not enough engagement yet to find a peak hour — open the Feed as students to record views.');
    }
    if (views > 0) {
      insights.push(`Click-through rate is ${ctr}% (${clicks} opens out of ${views} views).`);
    }
    if (deptReach.length) {
      insights.push(`Strongest reach: ${deptReach[0].name} (${deptReach[0].reach} unique engagers).`);
    }
    if (postsByType.length) {
      insights.push(`Most common notice type: ${postsByType[0].post_type} (${postsByType[0].count}).`);
    }

    res.json({
      scope: isAdmin ? 'campus' : 'mine',
      timezone: 'Asia/Kolkata',
      totals: {
        views,
        unique_views: Number(viewsRow.unique_views) || 0,
        likes,
        bookmarks,
        subscribers: Number(subsRow.total) || 0,
        clicks,
        ctr,
        posts: Number(postCount.total) || 0,
        engagement_events: engagementTotal
      },
      insights,
      department_reach: deptReach.map(r => ({
        id: r.id,
        name: r.name,
        reach: Number(r.reach)
      })),
      posts_by_type: postsByType.map(r => ({
        post_type: r.post_type,
        count: Number(r.count)
      })),
      posts_by_community: postsByCommunity.map(r => ({
        name: r.name,
        count: Number(r.count)
      })),
      most_active_time: {
        peak_hour: peak.count > 0 ? peak.hour : null,
        peak_label: peak.count > 0 ? `${String(peak.hour).padStart(2, '0')}:00 IST` : 'Not enough data',
        peak_count: peak.count,
        by_hour: activeByHour
      },
      heatmap: heatRows.map(r => ({
        dow: Number(r.dow) - 1,
        hour: Number(r.hr),
        count: Number(r.count)
      })),
      daily_engagement: dailyEngagement,
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
