// middleware/auth.js — JWT verification + role-based authorization
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';

// Verify a JWT and attach the user payload to req.user.
// Also re-checks that the account still exists and is active (not banned).
async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const [rows] = await pool.query(
      'SELECT id, username, role, department_id, is_active FROM users WHERE id = ? LIMIT 1',
      [payload.id]
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (!rows[0].is_active) {
      return res.status(403).json({ error: 'You are banned.' });
    }
    // Prefer live role/department from DB so promotions/bans take effect without waiting for token expiry
    req.user = {
      ...payload,
      id: rows[0].id,
      username: rows[0].username,
      role: rows[0].role,
      department_id: rows[0].department_id
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Require one of the given roles dynamically
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden: insufficient role (' + roles.join(' or ') + ' required)'
      });
    }
    next();
  };
}

// Pre-bound guards for the 3-Tier architecture
const requireAdmin = requireRole('admin');
const requirePublisher = requireRole('admin', 'publisher'); // Admins inherit publisher abilities
const requireViewer = requireRole('admin', 'publisher', 'viewer');

module.exports = {
  authRequired,
  requireRole,
  requireAdmin,
  requirePublisher,
  requireViewer,
  JWT_SECRET
};
