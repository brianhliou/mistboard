// Direct-message persistence (#88, lichess msg model). The two load-bearing
// design decisions, copied deliberately:
//   1. Thread id = the two user ids sorted and joined with '/', so one thread
//      per unordered pair and new-vs-reply is an existence check.
//   2. Read state lives only on the thread's denormalized last message; there
//      is no per-message read cursor. Unread = last_read=false AND the last
//      sender isn't me, scanned over a bounded window of newest threads.
// Deletion is per side and only hides the thread from that side's inbox list;
// the pair's shared history stays intact and any new message un-deletes the
// thread for both. Policy (block gate, rate limits, link rules) lives in
// routes/inbox.ts — this module is mechanics.

import { getPool, withTransaction } from './persistence-db.js';

export const DM_BODY_MAX = 5000;
const DM_PREVIEW_MAX = 100;

export type DmThreadSummary = {
  threadId: string;
  other: { handle: string; displayName: string };
  lastText: string;
  lastFromMe: boolean;
  lastAt: Date;
  unread: boolean;
};

export type DmMessageRecord = {
  id: string;
  fromMe: boolean;
  senderHandle: string | null;
  bodyText: string;
  createdAt: Date;
};

export type DmConversation = {
  threadId: string;
  other: { handle: string; displayName: string };
  messages: DmMessageRecord[];
};

export type DmSendResult =
  | { ok: true; threadId: string; isNewThread: boolean; message: DmMessageRecord }
  | { ok: false; error: 'unknown_user' | 'self_message' };

export type DmReportRecord = {
  id: string;
  threadId: string;
  reporterHandle: string | null;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: Date;
};

export function dmThreadId(userA: string, userB: string): string {
  return userA < userB ? `${userA}/${userB}` : `${userB}/${userA}`;
}

export async function dmThreadExists(userA: string, userB: string): Promise<boolean> {
  const { rows } = await getPool().query(`SELECT 1 FROM dm_threads WHERE id = $1 LIMIT 1`, [
    dmThreadId(userA, userB),
  ]);
  return rows.length > 0;
}

// Append a message: upsert the thread (denormalized last message, unread for
// the recipient, both deletion flags cleared) then insert the message row, in
// one transaction so the preview can never point at a missing message.
export async function sendDmMessage(input: {
  messageId: string;
  senderId: string;
  targetHandle: string;
  bodyText: string;
  now?: Date;
}): Promise<DmSendResult> {
  const target = await findUserByHandle(input.targetHandle);
  if (!target) return { ok: false, error: 'unknown_user' };
  if (target.id === input.senderId) return { ok: false, error: 'self_message' };

  const now = input.now ?? new Date();
  const threadId = dmThreadId(input.senderId, target.id);
  const [userLo, userHi] =
    input.senderId < target.id ? [input.senderId, target.id] : [target.id, input.senderId];
  const body = input.bodyText.trim();
  const preview = body.length > DM_PREVIEW_MAX ? `${body.slice(0, DM_PREVIEW_MAX - 1)}…` : body;

  const isNewThread = await withTransaction(async (client) => {
    const { rows } = await client.query<{ inserted: boolean }>(
      `INSERT INTO dm_threads
         (id, user_lo, user_hi, created_by, last_text, last_sender_id, last_at, last_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $7)
       ON CONFLICT (id) DO UPDATE SET
         last_text = EXCLUDED.last_text,
         last_sender_id = EXCLUDED.last_sender_id,
         last_at = EXCLUDED.last_at,
         last_read = false,
         deleted_by_lo_at = NULL,
         deleted_by_hi_at = NULL
       RETURNING (xmax = 0) AS inserted`,
      [threadId, userLo, userHi, input.senderId, preview, input.senderId, now],
    );
    await client.query(
      `INSERT INTO dm_messages (id, thread_id, sender_id, body_text, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.messageId, threadId, input.senderId, body, now],
    );
    return rows[0]?.inserted === true;
  });

  return {
    ok: true,
    threadId,
    isNewThread,
    message: {
      id: input.messageId,
      fromMe: true,
      senderHandle: null,
      bodyText: body,
      createdAt: now,
    },
  };
}

// The viewer's inbox: newest-first threads they participate in and haven't
// deleted, timestamp-cursor paginated on last_at (lichess-style, not offset).
export async function listDmThreads(
  userId: string,
  opts: { before?: Date; limit: number },
): Promise<DmThreadSummary[]> {
  const params: unknown[] = [userId, opts.limit];
  let beforeClause = '';
  if (opts.before) {
    params.push(opts.before);
    beforeClause = 'AND dm_threads.last_at < $3';
  }
  const { rows } = await getPool().query<{
    id: string;
    handle: string;
    display_name: string;
    last_text: string;
    last_sender_id: string;
    last_at: Date;
    last_read: boolean;
  }>(
    `SELECT dm_threads.id, users.handle, users.display_name,
            dm_threads.last_text, dm_threads.last_sender_id,
            dm_threads.last_at, dm_threads.last_read
     FROM dm_threads
     JOIN users ON users.id =
       (CASE WHEN dm_threads.user_lo = $1 THEN dm_threads.user_hi ELSE dm_threads.user_lo END)
     WHERE (dm_threads.user_lo = $1 OR dm_threads.user_hi = $1)
       AND ((dm_threads.user_lo = $1 AND dm_threads.deleted_by_lo_at IS NULL)
         OR (dm_threads.user_hi = $1 AND dm_threads.deleted_by_hi_at IS NULL))
       ${beforeClause}
     ORDER BY dm_threads.last_at DESC
     LIMIT $2`,
    params,
  );
  return rows.map((row) => ({
    threadId: row.id,
    other: { handle: row.handle, displayName: row.display_name },
    lastText: row.last_text,
    lastFromMe: row.last_sender_id === userId,
    lastAt: row.last_at,
    unread: !row.last_read && row.last_sender_id !== userId,
  }));
}

// Load a conversation and mark it read as a side effect (only when the viewer
// isn't the last sender — reading your own sent message is not a read receipt).
// The shared history renders even if the viewer had deleted the thread; delete
// only hides the inbox list entry.
export async function getDmConversation(
  viewerId: string,
  otherHandle: string,
  opts: { before?: Date; limit: number },
): Promise<DmConversation | null> {
  const other = await findUserByHandle(otherHandle);
  if (!other || other.id === viewerId) return null;
  const threadId = dmThreadId(viewerId, other.id);

  const params: unknown[] = [threadId, opts.limit];
  let beforeClause = '';
  if (opts.before) {
    params.push(opts.before);
    beforeClause = 'AND dm_messages.created_at < $3';
  }
  const { rows } = await getPool().query<{
    id: string;
    sender_id: string | null;
    body_text: string;
    created_at: Date;
  }>(
    `SELECT id, sender_id, body_text, created_at
     FROM dm_messages
     WHERE thread_id = $1 ${beforeClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    params,
  );

  await getPool().query(
    `UPDATE dm_threads SET last_read = true
     WHERE id = $1 AND last_sender_id <> $2 AND last_read = false`,
    [threadId, viewerId],
  );

  return {
    threadId,
    other: { handle: other.handle, displayName: other.displayName },
    messages: rows
      .map((row) => ({
        id: row.id,
        fromMe: row.sender_id === viewerId,
        senderHandle: row.sender_id === viewerId ? null : other.handle,
        bodyText: row.body_text,
        createdAt: row.created_at,
      }))
      .reverse(),
  };
}

export async function deleteDmThreadForUser(
  viewerId: string,
  otherHandle: string,
  now?: Date,
): Promise<boolean> {
  const other = await findUserByHandle(otherHandle);
  if (!other || other.id === viewerId) return false;
  const threadId = dmThreadId(viewerId, other.id);
  const { rowCount } = await getPool().query(
    `UPDATE dm_threads SET
       deleted_by_lo_at = CASE WHEN user_lo = $2 THEN $3 ELSE deleted_by_lo_at END,
       deleted_by_hi_at = CASE WHEN user_hi = $2 THEN $3 ELSE deleted_by_hi_at END
     WHERE id = $1`,
    [threadId, viewerId, now ?? new Date()],
  );
  return (rowCount ?? 0) > 0;
}

// Badge count. Bounded to the 20 newest threads (the lichess trick) so the
// count stays index-cheap no matter how deep an inbox gets.
export async function countUnreadDmThreads(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM (
       SELECT last_read, last_sender_id FROM dm_threads
       WHERE (user_lo = $1 OR user_hi = $1)
         AND ((user_lo = $1 AND deleted_by_lo_at IS NULL)
           OR (user_hi = $1 AND deleted_by_hi_at IS NULL))
       ORDER BY last_at DESC
       LIMIT 20
     ) newest
     WHERE newest.last_read = false AND newest.last_sender_id <> $1`,
    [userId],
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

// Rate-limit counters (DB-counted, forum pattern).
export async function countRecentDmThreadsStartedByUser(
  userId: string,
  since: Date,
): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM dm_threads
     WHERE created_by = $1 AND created_at > $2`,
    [userId, since],
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

export async function countRecentDmMessagesByUser(userId: string, since: Date): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM dm_messages
     WHERE sender_id = $1 AND created_at > $2`,
    [userId, since],
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

export async function createDmReport(input: {
  id: string;
  reporterId: string;
  otherHandle: string;
  reason: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: 'unknown_thread' | 'already_reported' }> {
  const other = await findUserByHandle(input.otherHandle);
  if (!other || other.id === input.reporterId) return { ok: false, error: 'unknown_thread' };
  const threadId = dmThreadId(input.reporterId, other.id);
  if (!(await threadExistsById(threadId))) return { ok: false, error: 'unknown_thread' };
  try {
    await getPool().query(
      `INSERT INTO dm_reports (id, reporter_account_id, thread_id, reason, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [input.id, input.reporterId, threadId, input.reason.trim(), input.now ?? new Date()],
    );
  } catch (err) {
    // The partial unique index (one OPEN report per reporter+thread) is the
    // dedupe; surface it as a domain result rather than a 500.
    if ((err as { code?: string }).code === '23505') {
      return { ok: false, error: 'already_reported' };
    }
    throw err;
  }
  return { ok: true };
}

// Admin queue reads. Admins see reported threads only — there is deliberately
// no browse-all-DMs query in this module.
export async function listDmReports(opts: {
  status?: 'open' | 'resolved' | 'dismissed';
  limit: number;
}): Promise<DmReportRecord[]> {
  const status = opts.status ?? 'open';
  const { rows } = await getPool().query<{
    id: string;
    thread_id: string;
    handle: string | null;
    reason: string;
    status: DmReportRecord['status'];
    created_at: Date;
  }>(
    `SELECT dm_reports.id, dm_reports.thread_id, users.handle,
            dm_reports.reason, dm_reports.status, dm_reports.created_at
     FROM dm_reports
     LEFT JOIN users ON users.id = dm_reports.reporter_account_id
     WHERE dm_reports.status = $1
     ORDER BY dm_reports.created_at DESC
     LIMIT $2`,
    [status, opts.limit],
  );
  return rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    reporterHandle: row.handle,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function resolveDmReport(input: {
  reportId: string;
  status: 'resolved' | 'dismissed';
  resolvedById: string;
  note?: string;
  now?: Date;
}): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE dm_reports SET
       status = $2, resolution_note = $3, resolved_by_account_id = $4,
       resolved_at = $5, updated_at = $5
     WHERE id = $1 AND status = 'open'`,
    [input.reportId, input.status, input.note ?? null, input.resolvedById, input.now ?? new Date()],
  );
  return (rowCount ?? 0) > 0;
}

// Reported-thread reader for the admin queue: full message history with both
// participants named. Route-gated to admins; not part of any user surface.
// A thread nobody has reported reads as missing: the admin role alone is not
// access to private messages. Any report, open or closed, opens the thread, so
// a resolved case can be re-read.
export async function getDmThreadForAdmin(threadId: string): Promise<{
  threadId: string;
  participants: { handle: string; displayName: string }[];
  messages: { senderHandle: string | null; bodyText: string; createdAt: Date }[];
} | null> {
  const { rows: threadRows } = await getPool().query<{
    lo_handle: string;
    lo_name: string;
    hi_handle: string;
    hi_name: string;
  }>(
    `SELECT lo.handle AS lo_handle, lo.display_name AS lo_name,
            hi.handle AS hi_handle, hi.display_name AS hi_name
     FROM dm_threads
     JOIN users lo ON lo.id = dm_threads.user_lo
     JOIN users hi ON hi.id = dm_threads.user_hi
     WHERE dm_threads.id = $1
       AND EXISTS (SELECT 1 FROM dm_reports WHERE dm_reports.thread_id = dm_threads.id)`,
    [threadId],
  );
  const thread = threadRows[0];
  if (!thread) return null;

  const { rows } = await getPool().query<{
    sender_id: string | null;
    handle: string | null;
    body_text: string;
    created_at: Date;
  }>(
    `SELECT dm_messages.sender_id, users.handle, dm_messages.body_text, dm_messages.created_at
     FROM dm_messages
     LEFT JOIN users ON users.id = dm_messages.sender_id
     WHERE dm_messages.thread_id = $1
     ORDER BY dm_messages.created_at ASC, dm_messages.id ASC
     LIMIT 500`,
    [threadId],
  );
  return {
    threadId,
    participants: [
      { handle: thread.lo_handle, displayName: thread.lo_name },
      { handle: thread.hi_handle, displayName: thread.hi_name },
    ],
    messages: rows.map((row) => ({
      senderHandle: row.handle,
      bodyText: row.body_text,
      createdAt: row.created_at,
    })),
  };
}

async function threadExistsById(threadId: string): Promise<boolean> {
  const { rows } = await getPool().query(`SELECT 1 FROM dm_threads WHERE id = $1 LIMIT 1`, [
    threadId,
  ]);
  return rows.length > 0;
}

// Exported for the inbox route's pre-send guards (block gate, self check),
// which need the target's id before deciding whether to write anything.
export async function findUserIdByHandle(handle: string): Promise<string | null> {
  return (await findUserByHandle(handle))?.id ?? null;
}

async function findUserByHandle(
  handle: string,
): Promise<{ id: string; handle: string; displayName: string } | null> {
  const { rows } = await getPool().query<{ id: string; handle: string; display_name: string }>(
    `SELECT id, handle, display_name FROM users WHERE lower(handle) = lower($1) LIMIT 1`,
    [handle],
  );
  return rows[0]
    ? { id: rows[0].id, handle: rows[0].handle, displayName: rows[0].display_name }
    : null;
}
