// scripts/publish-scheduled.js
// Publishes posts whose scheduled_at has arrived (is_published = FALSE → TRUE)
// and fans out push notifications once they go live.
const pool = require('../db');
const { notifyChannelSubscribers } = require('../routes/push');

async function publishScheduledPosts() {
  const [due] = await pool.query(
    `SELECT p.id, p.publisher_id, p.channel_id, p.title, p.community_name,
            COALESCE(c.name, p.community_name) AS channel_name
       FROM posts p
       LEFT JOIN channels c ON c.id = p.channel_id
      WHERE p.is_published = FALSE
        AND p.scheduled_at IS NOT NULL
        AND p.scheduled_at <= NOW()
        AND (p.expires_at IS NULL OR p.expires_at > NOW())`
  );

  let count = 0;
  for (const p of due) {
    try {
      const [result] = await pool.query(
        'UPDATE posts SET is_published = TRUE WHERE id = ? AND is_published = FALSE',
        [p.id]
      );
      if (!result.affectedRows) continue;
      count++;

      if (p.channel_id) {
        // Fire-and-forget push now that the post is live
        notifyChannelSubscribers(p.channel_id, {
          title: p.channel_name ? `New post in ${p.channel_name}` : 'New campus announcement',
          body: p.title,
          postId: p.id
        }, p.publisher_id).catch(() => {});
      }
    } catch (err) {
      console.error(`Failed to publish scheduled post ${p.id}:`, err.message);
    }
  }

  if (count > 0) {
    console.log(`Published ${count} scheduled post(s) at ${new Date().toISOString()}`);
  }
  return count;
}

module.exports = { publishScheduledPosts };

if (require.main === module) {
  publishScheduledPosts()
    .catch(err => console.error('Publish-scheduled run error:', err))
    .finally(() => pool.end());
}
