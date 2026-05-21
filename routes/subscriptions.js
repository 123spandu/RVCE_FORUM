// routes/subscriptions.js
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/subscriptions - publishers I am subscribed to
router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.publisher_id, u.username, u.full_name, d.name AS department_name
       FROM subscriptions s
       JOIN users u ON s.publisher_id = u.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE s.subscriber_id = ?
       ORDER BY u.full_name`,
      [req.user.id]
    );
    res.json({ subscriptions: rows });
  } catch (err) {
    console.error('List subscriptions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/subscriptions  { publisher_id }  - subscribe
router.post('/', authRequired, async (req, res) => {
  try {
    const { publisher_id } = req.body || {};
    const pid = Number(publisher_id);
    if (!pid) return res.status(400).json({ error: 'publisher_id required' });
    if (pid === req.user.id) return res.status(400).json({ error: 'Cannot subscribe to yourself' });

    const [u] = await pool.query("SELECT id FROM users WHERE id = ? AND role = 'publisher'", [pid]);
    if (!u.length) return res.status(404).json({ error: 'Publisher not found' });

    try {
      await pool.query(
        'INSERT INTO subscriptions (subscriber_id, publisher_id) VALUES (?, ?)',
        [req.user.id, pid]
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/subscriptions/:publisherId - unsubscribe
router.delete('/:publisherId', authRequired, async (req, res) => {
  try {
    const pid = Number(req.params.publisherId);
    await pool.query(
      'DELETE FROM subscriptions WHERE subscriber_id = ? AND publisher_id = ?',
      [req.user.id, pid]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
