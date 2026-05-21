// routes/channels.js
const express = require('express');
const pool = require('../db');
const { authRequired, requirePublisher } = require('../middleware/auth');

const router = express.Router();

// GET /api/channels
// Returns all channels (both departments and clubs), their type, and name
router.get('/', authRequired, async (req, res) => {
  try {
    const sql = `
      SELECT c.id, c.type, c.name, c.description,
             d.code AS department_code, cl.code AS club_code,
             cl.is_restricted, cl.logo_url,
             s.status AS my_status
      FROM channels c
      LEFT JOIN departments d ON c.department_id = d.id
      LEFT JOIN clubs cl ON c.club_id = cl.id
      LEFT JOIN subscriptions s ON c.id = s.channel_id AND s.subscriber_id = ?
      ORDER BY c.type, c.name
    `;
    const [rows] = await pool.query(sql, [req.user.id]);
    res.json({ channels: rows });
  } catch (err) {
    console.error('List channels error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/channels/:id/subscribe
// Viewers and Publishers can subscribe to channels
router.post('/:id/subscribe', authRequired, async (req, res) => {
  try {
    const channelId = Number(req.params.id);
    const userId = req.user.id;
    
    // Ensure the channel exists, check if it maps to a restricted club
    const [c] = await pool.query(`
      SELECT c.id, cl.is_restricted 
      FROM channels c 
      LEFT JOIN clubs cl ON c.club_id = cl.id 
      WHERE c.id = ?`, [channelId]
    );
    
    if (c.length === 0) return res.status(404).json({ error: 'Channel not found' });
    
    // Auto-approve unless it's a restricted club
    const status = c[0].is_restricted ? 'pending' : 'approved';
    
    try {
      await pool.query(
        'INSERT INTO subscriptions (subscriber_id, channel_id, status) VALUES (?, ?, ?)',
        [userId, channelId, status]
      );
      res.status(201).json({ success: true, status });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Already subscribed' });
      throw err;
    }
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

// GET /api/channels/pending
// Fetch pending subscriptions for a Publisher's channels
router.get('/pending', authRequired, requirePublisher, async (req, res) => {
  try {
    const sql = `
      SELECT s.id AS subscription_id, s.subscriber_id, s.channel_id, s.created_at,
             u.full_name AS student_name, u.username AS student_username,
             d.name AS student_department,
             c.name AS channel_name
      FROM subscriptions s
      JOIN users u ON s.subscriber_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      JOIN channels c ON s.channel_id = c.id
      JOIN clubs cl ON c.club_id = cl.id
      WHERE s.status = 'pending' AND cl.club_head_id = ?
      ORDER BY s.created_at DESC
    `;
    const [rows] = await pool.query(sql, [req.user.id]);
    res.json({ pending: rows });
  } catch (err) {
    console.error('List pending subscriptions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/channels/:channelId/approve/:subscriberId
router.post('/:channelId/approve/:subscriberId', authRequired, requirePublisher, async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);
    const subscriberId = Number(req.params.subscriberId);

    // Verify this publisher actually manages this club
    const [c] = await pool.query(`
      SELECT c.id FROM channels c
      JOIN clubs cl ON c.club_id = cl.id
      WHERE c.id = ? AND cl.club_head_id = ?
    `, [channelId, req.user.id]);
    
    if (c.length === 0) return res.status(403).json({ error: 'Not authorized to manage this channel' });

    const [result] = await pool.query(
      'UPDATE subscriptions SET status = "approved" WHERE channel_id = ? AND subscriber_id = ?',
      [channelId, subscriberId]
    );
    
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Subscription request not found' });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Approve subscription error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
