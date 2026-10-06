// Logic behind `npm run feedback:inbox` (scripts/feedback-inbox.mjs), which
// lists /contact submissions so a session can read them. Read only.
//
// The reply address prints masked unless asked: the output lands in an agent
// transcript, which is kept for years, and the address is only needed at the
// moment Brian replies from the Workspace inbox.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function maskEmail(email) {
  if (typeof email !== 'string' || email.length === 0) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function parseInboxArgs(argv) {
  const options = { since: null, limit: 50, json: false, showEmail: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--show-email') options.showEmail = true;
    else if (arg === '--since') {
      const value = argv[++index];
      if (!value || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        throw new Error('--since takes a date, YYYY-MM-DD');
      }
      options.since = value;
    } else if (arg === '--limit') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 1000) {
        throw new Error('--limit takes a whole number from 1 to 1000');
      }
      options.limit = value;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

// One READ ONLY transaction: the inbox is a reader by construction, so a bug
// here cannot become a write against production.
export async function listFeedback(client, options) {
  await client.query('BEGIN READ ONLY');
  try {
    const result = await client.query(
      `SELECT f.id, f.created_at, f.path, f.message, f.email, f.user_id,
              u.handle AS account_handle
         FROM feedback_submissions f
         LEFT JOIN users u ON u.id = f.user_id::text
        WHERE ($1::date IS NULL OR f.created_at >= ($1::date)::timestamp AT TIME ZONE 'UTC')
        ORDER BY f.created_at DESC, f.id
        LIMIT $2`,
      [options.since, options.limit],
    );
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export function presentRow(row, { showEmail = false } = {}) {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    path: row.path ?? null,
    from: row.account_handle ? `@${row.account_handle}` : row.user_id ? 'account' : 'guest',
    emailLeft: Boolean(row.email),
    email: showEmail ? (row.email ?? null) : maskEmail(row.email),
    message: row.message,
  };
}

export function formatRow(presented) {
  const reply = presented.emailLeft
    ? `email left: ${presented.email}`
    : presented.from === 'guest'
      ? 'no email left'
      : 'reply via account email';
  return [
    `── ${presented.id}`,
    `   ${presented.createdAt}  ${presented.path ?? '(no path)'}  from ${presented.from}  ${reply}`,
    '',
    ...presented.message.split('\n').map((line) => `   | ${line}`),
    '',
  ].join('\n');
}

export function formatInbox(rows, options) {
  const presented = rows.map((row) => presentRow(row, options));
  if (options.json) return JSON.stringify(presented, null, 2);
  if (presented.length === 0) return 'No feedback.';
  const header = `${presented.length} feedback submission${presented.length === 1 ? '' : 's'} (newest first${
    presented.length === options.limit ? `, capped at --limit ${options.limit}` : ''
  })`;
  return [header, '', ...presented.map(formatRow)].join('\n');
}
