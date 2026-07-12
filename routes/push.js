// routes/push.js — Web Push (VAPID) subscription endpoints + fan-out helpers
const express = require('express');
const webpush = require('web-push');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@rvce.edu.in';
const pushEnabled = Boolean(PUBLIC && PRIVATE);

if (pushEnabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  console.log('✔ Web Push enabled (VAPID configured)');
} else {
  console.warn('⚠ Web Push disabled: set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env');
}

// GET /api/push/vapid-public-key — client needs this to subscribe
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: pushEnabled ? PUBLIC : null });
});

// POST /api/push/subscribe — store this browser's push endpoint for the user
router.post('/subscribe', authRequired, async (req, res) => {
  try {
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
      [req.user.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/push/subscribe — remove a browser endpoint (e.g. on logout)
router.delete('/subscribe', authRequired, async (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (endpoint) {
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [endpoint, req.user.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

async function sendToEndpoints(rows, payload) {
  if (!rows.length) return { sent: 0, failed: 0 };
  const data = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  await Promise.all(rows.map(async (row) => {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth }
    };
    try {
      await webpush.sendNotification(subscription, data);
      sent++;
    } catch (err) {
      failed++;
      // Endpoint gone — drop it so we don't keep retrying.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [row.id]).catch(() => {});
      } else {
        console.error('Push send error:', err.statusCode || err.message);
      }
    }
  }));
  return { sent, failed };
}

/**
 * Notify every active user who has registered this browser for Web Push
 * (excluding the author). This is the primary fan-out for new posts.
 */
async function notifyAllPushUsers(payload, excludeUserId) {
  if (!pushEnabled) return { sent: 0, failed: 0, skipped: 'disabled' };
  try {
    const [subs] = await pool.query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
         FROM push_subscriptions ps
         JOIN users u ON u.id = ps.user_id
        WHERE u.is_active = TRUE
          AND ps.user_id <> ?`,
      [excludeUserId || 0]
    );
    const result = await sendToEndpoints(subs, payload);
    console.log(
      `Push fan-out (all users): sent=${result.sent} failed=${result.failed} endpoints=${subs.length} title="${payload?.title || ''}"`
    );
    return result;
  } catch (err) {
    console.error('notifyAllPushUsers failed:', err.message);
    return { sent: 0, failed: 0, error: err.message };
  }
}

/**
 * Legacy: fan out to bell-enabled subscribers of one channel.
 * Kept for compatibility; new posts use notifyAllPushUsers.
 */
async function notifyChannelSubscribers(channelId, payload, excludeUserId) {
  if (!pushEnabled || !channelId) return { sent: 0, failed: 0 };
  try {
    const [subs] = await pool.query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
         FROM subscriptions s
         JOIN push_subscriptions ps ON ps.user_id = s.subscriber_id
         JOIN users u ON u.id = s.subscriber_id
        WHERE s.channel_id = ?
          AND s.push_notifications_enabled = TRUE
          AND u.is_active = TRUE
          AND s.subscriber_id <> ?`,
      [channelId, excludeUserId || 0]
    );
    return sendToEndpoints(subs, payload);
  } catch (err) {
    console.error('notifyChannelSubscribers failed:', err.message);
    return { sent: 0, failed: 0, error: err.message };
  }
}

/**
 * Notify users when a post goes live.
 * Sends to all registered push endpoints (all users who enabled notifications).
 */
async function notifyNewPost({
  title,
  body,
  postId,
  communityName,
  excludeUserId
}) {
  return notifyAllPushUsers({
    title: communityName ? `New post in ${communityName}` : 'New campus announcement',
    body: title || body || 'A new notice was posted on RVCE Connect',
    postId
  }, excludeUserId);
}

module.exports = router;
module.exports.notifyChannelSubscribers = notifyChannelSubscribers;
module.exports.notifyAllPushUsers = notifyAllPushUsers;
module.exports.notifyNewPost = notifyNewPost;
