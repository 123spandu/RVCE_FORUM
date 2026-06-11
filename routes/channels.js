// routes/channels.js
const express = require('express');
const pool = require('../db');
const { authRequired, requirePublisher } = require('../middleware/auth');

const router = express.Router();

// GET /api/channels
// Returns all channels (both departments and clubs), their type, name,
// the caller's subscription status, and the caller's bell (push opt-in) state.
router.get('/', authRequired, async (req, res) => {
  try {
    const sql = `
      SELECT c.id, c.type, c.name, c.description,
             c.department_id, c.club_id,
             d.code AS department_code, cl.code AS club_code,
             COALESCE(c.logo_url, cl.logo_url) AS logo_url,
             s.status AS my_status,
             COALESCE(s.push_notifications_enabled, FALSE) AS bell_enabled
      FROM channels c
      LEFT JOIN departments d ON c.department_id = d.id
      LEFT JOIN clubs cl ON c.club_id = cl.id
      LEFT JOIN subscriptions s ON c.id = s.channel_id AND s.subscriber_id = ?
      ORDER BY c.type, c.name
    `;
    const [rows] = await pool.query(sql, [req.user.id]);
    rows.forEach(r => { r.bell_enabled = Number(r.bell_enabled) > 0; });
    res.json({ channels: rows });
  } catch (err) {
    console.error('List channels error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/channels/:id/subscribe
// All communities are public now: subscriptions are always auto-approved.
router.post('/:id/subscribe', authRequired, async (req, res) => {
  try {
    const channelId = Number(req.params.id);
    const userId = req.user.id;

    const [c] = await pool.query('SELECT id FROM channels WHERE id = ?', [channelId]);
    if (c.length === 0) return res.status(404).json({ error: 'Channel not found' });

    try {
      await pool.query(
        "INSERT INTO subscriptions (subscriber_id, channel_id, status) VALUES (?, ?, 'approved')",
        [userId, channelId]
      );
      res.status(201).json({ success: true, status: 'approved' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Already subscribed' });
      throw err;
    }
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/channels/:id/bell
// Toggle per-community push notification opt-in (the "bell").
// The viewer must already be subscribed. Subscribing alone only adds posts to
// the feed; the bell controls whether new posts also trigger push notifications.
router.patch('/:id/bell', authRequired, async (req, res) => {
  try {
    const channelId = Number(req.params.id);
    const enabled = req.body && (req.body.enabled === true || req.body.enabled === 'true');

    const [result] = await pool.query(
      'UPDATE subscriptions SET push_notifications_enabled = ? WHERE channel_id = ? AND subscriber_id = ?',
      [enabled ? 1 : 0, channelId, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Subscribe to this community before enabling notifications.' });
    }

    // The browser-side Notification permission / push subscription is handled by
    // the client. The backend only records the per-community preference here.
    res.json({ success: true, enabled });
  } catch (err) {
    console.error('Bell toggle error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/channels/:id/subscribe — unsubscribe from a community
router.delete('/:id/subscribe', authRequired, async (req, res) => {
  try {
    const channelId = Number(req.params.id);
    await pool.query(
      'DELETE FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?',
      [channelId, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/channels/pending — deprecated. Approval flow removed; nothing is pending.
router.get('/pending', authRequired, requirePublisher, async (req, res) => {
  res.json({ pending: [] });
});

// POST /api/channels/:channelId/approve/:subscriberId — deprecated.
// Approval flow removed: all communities are public.
router.post('/:channelId/approve/:subscriberId', authRequired, requirePublisher, async (req, res) => {
  res.status(410).json({ error: 'Approval flow removed. All communities are public.' });
});

// PUT /api/channels/requests/:id — deprecated alias for the old approval flow.
router.put('/requests/:id', authRequired, (req, res) => {
  res.status(410).json({ error: 'Approval flow removed. All communities are public.' });
});

module.exports = router;
