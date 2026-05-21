const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/departments
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM departments ORDER BY name');
    res.json({ departments: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
