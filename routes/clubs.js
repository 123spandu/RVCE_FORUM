const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/clubs
router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clubs ORDER BY name');
    res.json({ clubs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
