// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authRequired, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.password_hash, u.full_name, u.role, u.department_id, d.name AS department_name
       FROM users u LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.username = ? LIMIT 1`,
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // If publisher or admin, check if they manage any clubs
    let managed_club_ids = [];
    if (user.role === 'publisher' || user.role === 'admin') {
      const [clubRows] = await pool.query('SELECT id FROM clubs WHERE club_head_id = ?', [user.id]);
      managed_club_ids = clubRows.map(r => r.id);
    }

    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      department_id: user.department_id,
      managed_club_ids
    };
    
    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        department_id: user.department_id,
        department_name: user.department_name,
        managed_club_ids
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me  - get current user info from the token
router.get('/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.role, u.department_id, d.name AS department_name
       FROM users u LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = ? LIMIT 1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const user = rows[0];
    let managed_club_ids = [];
    if (user.role === 'publisher' || user.role === 'admin') {
      const [clubRows] = await pool.query('SELECT id FROM clubs WHERE club_head_id = ?', [user.id]);
      managed_club_ids = clubRows.map(r => r.id);
    }
    
    user.managed_club_ids = managed_club_ids;
    res.json({ user });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
