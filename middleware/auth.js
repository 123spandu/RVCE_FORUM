// middleware/auth.js
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';

// Verify a JWT and attach the user payload to req.user
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // JWT Payload usually includes: { id, username, role, department_id, club_id, channel_ids }
    req.user = payload; 
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
      return res.status(403).json({ error: 'Forbidden: insufficient role (' + roles.join(' or ') + ' required)' });
    }
    next();
  };
}

// Pre-bound guards for the 3-Tier architecture
const requireAdmin = requireRole('admin');
const requirePublisher = requireRole('admin', 'publisher'); // Admins inherit publisher abilities
const requireViewer = requireRole('admin', 'publisher', 'viewer'); // Everyone inherits viewer abilities

module.exports = { 
  authRequired, 
  requireRole, 
  requireAdmin, 
  requirePublisher, 
  requireViewer, 
  JWT_SECRET 
};
