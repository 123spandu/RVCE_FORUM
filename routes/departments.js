// routes/departments.js
const express = require('express');
const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/departments - list all (any authenticated user)
router.get('/', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM departments ORDER BY name');
    res.json({ departments: rows });
  } catch (err) {
    console.error('List departments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/departments - create (admin only)
router.post('/', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    try {
      const [result] = await pool.query('INSERT INTO departments (name) VALUES (?)', [name.trim()]);
      res.status(201).json({ id: result.insertId, name: name.trim() });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Department already exists' });
      throw err;
    }
  } catch (err) {
    console.error('Create department error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
