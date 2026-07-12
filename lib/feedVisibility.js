// lib/feedVisibility.js
// Shared personalized visibility gate (2.2 audience + 2.3 subscriptions).
// Returns { clause, params } to AND into a posts query (alias `p`).

function personalizedVisibility(me) {
  if (!me || me.role === 'admin') {
    return { clause: '1=1', params: [] };
  }

  const myDeptId = me.department_id != null ? Number(me.department_id) : null;
  const clause = `(
    p.publisher_id = ?
    OR (
      (
        NOT EXISTS (SELECT 1 FROM post_target_channels ptc WHERE ptc.post_id = p.id)
        OR EXISTS (
          SELECT 1 FROM post_target_channels ptc
          JOIN channels ch ON ch.id = ptc.channel_id
          WHERE ptc.post_id = p.id AND (
            (ch.type = 'department' AND ch.department_id IS NOT NULL AND ch.department_id = ?)
            OR (
              ch.type = 'club' AND EXISTS (
                SELECT 1 FROM subscriptions s
                WHERE s.channel_id = ch.id AND s.subscriber_id = ? AND s.status = 'approved'
              )
            )
          )
        )
      )
      AND (
        NOT EXISTS (SELECT 1 FROM post_target_channels ptc WHERE ptc.post_id = p.id)
        OR p.channel_id IS NULL
        OR EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.channel_id = p.channel_id
            AND s.subscriber_id = ?
            AND s.status = 'approved'
        )
        -- Students always see their own department board without an extra subscribe step
        OR EXISTS (
          SELECT 1 FROM channels own
          WHERE own.id = p.channel_id
            AND own.type = 'department'
            AND own.department_id IS NOT NULL
            AND own.department_id = ?
        )
      )
    )
  )`;
  return { clause, params: [me.id, myDeptId, me.id, me.id, myDeptId] };
}

/** When browsing a specific department board (?dept=), show that board's posts without requiring a subscription. */
function departmentBoardFilter(deptId) {
  return {
    clause: `(
      (c.type = 'department' AND c.department_id = ?)
      OR EXISTS (
        SELECT 1 FROM post_target_channels ptc
        JOIN channels ch ON ch.id = ptc.channel_id
        WHERE ptc.post_id = p.id
          AND ch.type = 'department'
          AND ch.department_id = ?
      )
    )`,
    params: [deptId, deptId]
  };
}

function livePostClause() {
  return `p.is_published = TRUE
    AND (p.scheduled_at IS NULL OR p.scheduled_at <= NOW())
    AND (p.expires_at IS NULL OR p.expires_at > NOW())`;
}

module.exports = { personalizedVisibility, departmentBoardFilter, livePostClause };
