// routes/users.js
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users - list all users (admin only)
router.get('/', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.role, u.department_id,
              d.name AS department_name, u.created_at
       FROM users u LEFT JOIN departments d ON u.department_id = d.id
       ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users - create a viewer or publisher (admin only)
router.post('/', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, full_name, role, department_id } = req.body || {};

    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ error: 'username, password, full_name and role are required' });
    }
    if (!['viewer', 'publisher'].includes(role)) {
      return res.status(400).json({ error: 'role must be viewer or publisher' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Department must exist if supplied
    let deptId = department_id ? Number(department_id) : null;
    if (deptId) {
      const [d] = await pool.query('SELECT id FROM departments WHERE id = ?', [deptId]);
      if (d.length === 0) return res.status(400).json({ error: 'Invalid department_id' });
    }

    const hash = await bcrypt.hash(password, 10);
    try {
      const [result] = await pool.query(
        `INSERT INTO users (username, password_hash, full_name, role, department_id)
         VALUES (?, ?, ?, ?, ?)`,
        [username.trim(), hash, full_name.trim(), role, deptId]
      );
      res.status(201).json({ id: result.insertId });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Username already exists' });
      }
      throw err;
    }
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/users/:id - delete a user (admin only; cannot delete self)
router.delete('/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/publishers - list all publishers (any authenticated user)
// Used by viewers & publishers to browse who they can subscribe to
router.get('/publishers/list', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.department_id, d.name AS department_name
       FROM users u LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.role = 'publisher'
       ORDER BY u.full_name`
    );
    res.json({ publishers: rows });
  } catch (err) {
    console.error('List publishers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
