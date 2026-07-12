// scripts/expire-posts.js
// Notice Expiry Automation: every post with expires_at <= NOW() is moved to
// expired_posts (archive) and removed from the live feed. No manual deletion needed.
const pool = require('../db');

async function archiveExpiredPosts() {
  // Expiry overrides pinning. Posts without expires_at are ignored here —
  // the create API always assigns a default expiry so new notices always expire.
  const [expired] = await pool.query(
    `SELECT id, publisher_id, channel_id, title, body, level, type,
            image_url, is_pinned, scheduled_at, expires_at, created_at
       FROM posts
      WHERE expires_at IS NOT NULL
        AND expires_at <= NOW()`
  );

  let count = 0;
  for (const p of expired) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Avoid duplicate archive rows if a previous run archived but failed to delete.
      const [already] = await conn.query(
        'SELECT id FROM expired_posts WHERE original_post_id = ? LIMIT 1',
        [p.id]
      );
      if (!already.length) {
        await conn.query(
          `INSERT INTO expired_posts
             (original_post_id, publisher_id, channel_id, title, body, level, type,
              image_url, is_pinned, scheduled_at, expires_at, original_created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.id, p.publisher_id, p.channel_id, p.title, p.body, p.level, p.type,
           p.image_url, p.is_pinned, p.scheduled_at, p.expires_at, p.created_at]
        );
      }

      // Targeting rows cascade-delete with the post.
      await conn.query('DELETE FROM posts WHERE id = ?', [p.id]);
      await conn.commit();
      count++;
    } catch (err) {
      await conn.rollback();
      console.error(`Failed to archive post ${p.id}:`, err.message);
    } finally {
      conn.release();
    }
  }

  if (count > 0) {
    console.log(`✔ Archived ${count} expired notice(s) at ${new Date().toISOString()}`);
  } else {
    console.log(`Archived 0 expired posts at ${new Date().toISOString()}`);
  }
  return count;
}

module.exports = { archiveExpiredPosts };

if (require.main === module) {
  archiveExpiredPosts()
    .catch(err => console.error('Expiry run error:', err))
    .finally(() => pool.end());
}
