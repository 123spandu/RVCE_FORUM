// routes/dashboard.js — Personalized student dashboard
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { personalizedVisibility, livePostClause } = require('../lib/feedVisibility');

const router = express.Router();

const EVENT_TYPES = ['event', 'hackathon', 'conference', 'seminar', 'workshop', 'meeting'];

function mapPost(r) {
  return {
    id: r.id,
    title: r.title,
    content: r.content || r.body,
    post_type: r.post_type || r.type,
    community_name: r.community_name,
    publisher_name: r.publisher_name,
    created_at: r.created_at,
    expires_at: r.expires_at,
    scheduled_at: r.scheduled_at,
    image_url: r.image_url
  };
}

// GET /api/dashboard — sections for the signed-in student (or any role)
router.get('/', authRequired, async (req, res) => {
  try {
    const me = req.user;
    const vis = personalizedVisibility(me);
    const live = livePostClause();

    const postSelect = `
      SELECT p.id, p.title, p.body AS content, p.type AS post_type, p.image_url,
             p.created_at, p.expires_at, p.scheduled_at,
             u.full_name AS publisher_name,
             COALESCE(c.name, p.community_name) AS community_name
        FROM posts p
        JOIN users u ON p.publisher_id = u.id
        LEFT JOIN channels c ON p.channel_id = c.id
    `;

    // Today's Updates — published today, personalized
    const [todayRows] = await pool.query(
      `${postSelect}
       WHERE ${live}
         AND DATE(COALESCE(p.scheduled_at, p.created_at)) = CURDATE()
         AND ${vis.clause}
       ORDER BY p.created_at DESC
       LIMIT 12`,
      vis.params
    );

    // Upcoming Deadlines — notices/circulars (and anything) with expiry in next 14 days
    const [deadlineRows] = await pool.query(
      `${postSelect}
       WHERE ${live}
         AND p.expires_at IS NOT NULL
         AND p.expires_at > NOW()
         AND p.expires_at <= DATE_ADD(NOW(), INTERVAL 14 DAY)
         AND ${vis.clause}
       ORDER BY p.expires_at ASC
       LIMIT 12`,
      vis.params
    );

    // Events — event-like types, soonest first
    const [eventRows] = await pool.query(
      `${postSelect}
       WHERE ${live}
         AND p.type IN (?)
         AND ${vis.clause}
       ORDER BY COALESCE(p.scheduled_at, p.expires_at, p.created_at) ASC
       LIMIT 12`,
      [EVENT_TYPES, ...vis.params]
    );

    // My Department board — always available for students with a department
    let myDepartment = null;
    if (me.department_id) {
      const [[deptMeta]] = await pool.query(
        `SELECT d.id, d.name, c.id AS channel_id, c.name AS channel_name
           FROM departments d
           LEFT JOIN channels c ON c.department_id = d.id AND c.type = 'department'
          WHERE d.id = ?
          LIMIT 1`,
        [me.department_id]
      );
      const [deptPosts] = await pool.query(
        `${postSelect}
         WHERE ${live}
           AND (
             (c.type = 'department' AND c.department_id = ?)
             OR EXISTS (
               SELECT 1 FROM post_target_channels ptc
               JOIN channels ch ON ch.id = ptc.channel_id
               WHERE ptc.post_id = p.id AND ch.type = 'department' AND ch.department_id = ?
             )
           )
         ORDER BY p.created_at DESC
         LIMIT 10`,
        [me.department_id, me.department_id]
      );
      myDepartment = {
        id: deptMeta?.id || me.department_id,
        name: deptMeta?.name || 'My Department',
        channel_id: deptMeta?.channel_id || null,
        channel_name: deptMeta?.channel_name || null,
        posts: deptPosts.map(mapPost)
      };
    }

    // Subscribed Clubs
    const [clubs] = await pool.query(
      `SELECT c.id, c.name, c.description, c.logo_url, c.type,
              s.push_notifications_enabled AS bell_enabled, s.created_at AS subscribed_at
         FROM subscriptions s
         JOIN channels c ON c.id = s.channel_id
        WHERE s.subscriber_id = ?
          AND s.status = 'approved'
          AND c.type = 'club'
        ORDER BY c.name ASC`,
      [me.id]
    );

    // Bookmarks
    const [bookmarks] = await pool.query(
      `SELECT p.id, p.title, p.body AS content, p.type AS post_type, p.image_url,
              p.created_at, p.expires_at,
              u.full_name AS publisher_name,
              COALESCE(c.name, p.community_name) AS community_name,
              b.created_at AS bookmarked_at
         FROM bookmarks b
         JOIN posts p ON p.id = b.post_id
         JOIN users u ON p.publisher_id = u.id
         LEFT JOIN channels c ON p.channel_id = c.id
        WHERE b.user_id = ?
          AND ${live}
        ORDER BY b.created_at DESC
        LIMIT 20`,
      [me.id]
    );

    res.json({
      today_updates: todayRows.map(mapPost),
      upcoming_deadlines: deadlineRows.map(mapPost),
      events: eventRows.map(mapPost),
      my_department: myDepartment,
      subscribed_clubs: clubs.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        logo_url: c.logo_url,
        bell_enabled: !!c.bell_enabled,
        subscribed_at: c.subscribed_at
      })),
      bookmarks: bookmarks.map(r => ({
        ...mapPost(r),
        bookmarked_at: r.bookmarked_at
      }))
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
