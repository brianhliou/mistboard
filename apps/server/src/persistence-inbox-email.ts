// Persistence only: reads never reserve or mark a delivery. The serial email
// pass must mark after provider acceptance, just like the correspondence digest.
// Neither query reads a message body or thread preview.
import { getPool } from './persistence-db.js';

export type InboxEmailCandidate = {
  userId: string;
  email: string;
  locale: string | null;
  threadId: string;
  messageId: string;
  messageAt: Date;
  senderHandle: string;
  senderName: string;
};

export type InboxEmailQuery = { now: Date };

// At most one reminder per account in any rolling 24 hours. Pick the newest
// eligible message, with identity breaking equal-timestamp ties. Its persisted
// tuple covers all older messages across the inbox, not just this thread.
export async function listInboxEmailCandidates(
  query: InboxEmailQuery,
): Promise<InboxEmailCandidate[]> {
  const { rows } = await getPool().query<{
    user_id: string;
    email: string;
    locale: string | null;
    thread_id: string;
    message_id: string;
    message_at: Date;
    sender_handle: string;
    sender_name: string;
  }>(
    `SELECT DISTINCT ON (u.id)
       u.id AS user_id, u.email, u.locale, t.id AS thread_id,
       m.id AS message_id, m.created_at AS message_at,
       sender.handle AS sender_handle, sender.display_name AS sender_name
     FROM dm_threads t
     JOIN users u ON
       (u.id = t.user_lo AND t.last_sender_id = t.user_hi AND t.deleted_by_lo_at IS NULL)
       OR (u.id = t.user_hi AND t.last_sender_id = t.user_lo AND t.deleted_by_hi_at IS NULL)
     JOIN users sender ON sender.id = t.last_sender_id
     JOIN LATERAL (
       SELECT id, created_at FROM dm_messages
       WHERE thread_id = t.id AND sender_id = t.last_sender_id AND created_at = t.last_at
       ORDER BY id DESC LIMIT 1
     ) m ON true
     WHERE t.last_read = false
       AND t.last_at <= $1::timestamptz - interval '12 hours'
       AND u.email_verified_at IS NOT NULL AND NULLIF(btrim(u.email), '') IS NOT NULL
       AND u.play_disabled_at IS NULL AND u.closed_at IS NULL
       AND COALESCE((u.account_preferences->>'inboxEmail')::boolean, true)
       AND (u.inbox_email_sent_at IS NULL
         OR u.inbox_email_sent_at <= $1::timestamptz - interval '24 hours')
       AND (u.inbox_email_last_message_id IS NULL
         OR (m.created_at, m.id) > (u.inbox_email_last_message_at, u.inbox_email_last_message_id))
       AND NOT EXISTS (
         SELECT 1 FROM user_relations r WHERE r.relation = 'block'
           AND ((r.actor_id = u.id AND r.target_id = sender.id)
             OR (r.actor_id = sender.id AND r.target_id = u.id))
       )
     ORDER BY u.id, m.created_at DESC, m.id DESC`,
    [query.now],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    locale: row.locale,
    threadId: row.thread_id,
    messageId: row.message_id,
    messageAt: row.message_at,
    senderHandle: row.sender_handle,
    senderName: row.sender_name,
  }));
}

// Record only an accepted email. Resolve the message timestamp in the database
// rather than trusting a caller's watermark, and retain the tuple on users so
// removing a thread or message cannot make older messages eligible again.
// The conditional UPDATE makes duplicate/stale acknowledgements harmless and
// keeps both the rolling cap and the watermark monotonic.
export async function markInboxEmailSent(
  userId: string,
  messageId: string,
  at: Date,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE users u SET inbox_email_sent_at = $3,
       inbox_email_last_message_id = m.id, inbox_email_last_message_at = m.created_at
     FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id
     WHERE u.id = $1 AND m.id = $2
       AND (u.id = t.user_lo OR u.id = t.user_hi) AND m.sender_id <> u.id
       AND m.created_at <= $3::timestamptz
       AND (u.inbox_email_sent_at IS NULL
         OR u.inbox_email_sent_at <= $3::timestamptz - interval '24 hours')
       AND (u.inbox_email_last_message_id IS NULL
         OR (m.created_at, m.id) > (u.inbox_email_last_message_at, u.inbox_email_last_message_id))`,
    [userId, messageId, at],
  );
  return (rowCount ?? 0) > 0;
}
