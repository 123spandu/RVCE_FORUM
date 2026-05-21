// routes/channels.js
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/channels
// Returns all channels (both departments and clubs), their type, and name
router.get('/', authRequired, async (req, res) => {
  try {
    const sql = `
      SELECT c.id, c.type, c.name, c.description,
             d.code AS department_code, cl.code AS club_code,
             cl.is_restricted
      FROM channels c
      LEFT JOIN departments d ON c.department_id = d.id
      LEFT JOIN clubs cl ON c.club_id = cl.id
      ORDER BY c.type, c.name
    `;
    const [rows] = await pool.query(sql);
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
