// scripts/expire-posts.js
// Archives posts whose expires_at has passed into the expired_posts table,
// then removes them from the live posts table.
//
// Exported as a function (NOT run on require) so server.js can schedule it.
// Can also be run standalone:  node scripts/expire-posts.js
const pool = require('../db');

async function archiveExpiredPosts() {
  // Expiry overrides pinning. NULL expires_at is never archived.
  // expires_at exactly == NOW() counts as expired (<=).
  const [expired] = await pool.query(
    `SELECT id, publisher_id, channel_id, title, body, level, type,
            image_url, is_pinned, scheduled_at, expires_at, created_at
       FROM posts
      WHERE expires_at IS NOT NULL
        AND expires_at <= NOW()
        AND is_published = TRUE`
  );

  let count = 0;
  for (const p of expired) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO expired_posts
           (original_post_id, publisher_id, channel_id, title, body, level, type,
            image_url, is_pinned, scheduled_at, expires_at, original_created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.publisher_id, p.channel_id, p.title, p.body, p.level, p.type,
         p.image_url, p.is_pinned, p.scheduled_at, p.expires_at, p.created_at]
      );
      // Delete after archiving — so re-runs cannot re-insert the same post.
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

  console.log(`Archived ${count} expired posts at ${new Date().toISOString()}`);
  return count;
}

module.exports = { archiveExpiredPosts };

// Allow standalone execution: `node scripts/expire-posts.js`
if (require.main === module) {
  archiveExpiredPosts()
    .catch(err => console.error('Expiry run error:', err))
    .finally(() => pool.end());
}
