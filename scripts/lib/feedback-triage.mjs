// Shared by the two feedback triage commands (docs-private/runbooks/feedback-triage.md):
//
//   feedback-inbox.mjs  lists /contact submissions, untriaged first (read only)
//   feedback-mark.mjs   records Brian's decision on one submission (the only write)
//
// Both print the reply address masked unless asked: the output lands in an
// agent transcript, which is kept for years, and the address is only needed
// at the moment Brian replies from the Workspace inbox.

export const TRIAGE_STATUSES = ['new', 'triaged', 'done', 'spam'];
export const TRIAGE_CLASSES = ['bug', 'idea', 'partnership', 'praise', 'question', 'spam'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Anything shaped like an address. A note is read by every later session, so
// it holds the decision, never the person.
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export function maskEmail(email) {
  if (typeof email !== 'string' || email.length === 0) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function parseInboxArgs(argv) {
  const options = { since: null, limit: 50, json: false, showEmail: false, all: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--show-email') options.showEmail = true;
    else if (arg === '--all') options.all = true;
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

export function parseMarkArgs(argv) {
  const options = { id: null, status: null, triageClass: null, note: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--status') options.status = argv[++index] ?? '';
    else if (arg === '--class') options.triageClass = argv[++index] ?? '';
    else if (arg === '--note') options.note = argv[++index] ?? '';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
    else if (options.id === null) options.id = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.id || !UUID_PATTERN.test(options.id)) {
    throw new Error('the first argument is the full submission id (a UUID from feedback:inbox)');
  }
  if (!TRIAGE_STATUSES.includes(options.status)) {
    throw new Error(`--status is required: ${TRIAGE_STATUSES.join(' | ')}`);
  }
  if (options.triageClass !== null && !TRIAGE_CLASSES.includes(options.triageClass)) {
    throw new Error(`--class must be one of ${TRIAGE_CLASSES.join(' | ')}`);
  }
  if (options.status === 'spam' && options.triageClass === null) options.triageClass = 'spam';
  if (options.note !== null) {
    options.note = options.note.trim();
    if (options.note.length === 0) throw new Error('--note is empty');
    if (options.note.length > 2000) throw new Error('--note is over 2000 characters');
    if (EMAIL_LIKE.test(options.note)) {
      throw new Error('--note looks like it holds an email address; keep personal details out');
    }
  }
  return options;
}

const ROW_COLUMNS = `f.id, f.created_at, f.path, f.message, f.email, f.user_id,
       u.handle AS account_handle, f.triage_status, f.triage_class,
       f.triage_note, f.triaged_at`;

// One READ ONLY transaction: the inbox is a reader by construction, so a bug
// here cannot become a write against production.
export async function listFeedback(client, options) {
  await client.query('BEGIN READ ONLY');
  try {
    const result = await client.query(
      `SELECT ${ROW_COLUMNS}
         FROM feedback_submissions f
         LEFT JOIN users u ON u.id = f.user_id::text
        WHERE ($1::boolean OR f.triage_status = 'new')
          AND ($2::date IS NULL OR f.created_at >= ($2::date)::timestamp AT TIME ZONE 'UTC')
        ORDER BY f.created_at DESC, f.id
        LIMIT $3`,
      [options.all, options.since, options.limit],
    );
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function markFeedback(client, options) {
  const result = await client.query(
    `WITH updated AS (
       UPDATE feedback_submissions
          SET triage_status = $2,
              triage_class = COALESCE($3, triage_class),
              triage_note = COALESCE($4, triage_note),
              triaged_at = now()
        WHERE id = $1
        RETURNING *
     )
     SELECT ${ROW_COLUMNS}
       FROM updated f
       LEFT JOIN users u ON u.id = f.user_id::text`,
    [options.id, options.status, options.triageClass, options.note],
  );
  return result.rows[0] ?? null;
}

export function presentRow(row, { showEmail = false } = {}) {
  const presented = {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    path: row.path ?? null,
    from: row.account_handle ? `@${row.account_handle}` : row.user_id ? 'account' : 'guest',
    emailLeft: Boolean(row.email),
    email: showEmail ? (row.email ?? null) : maskEmail(row.email),
    status: row.triage_status,
    class: row.triage_class ?? null,
    note: row.triage_note ?? null,
    triagedAt: row.triaged_at ? new Date(row.triaged_at).toISOString() : null,
    message: row.message,
  };
  return presented;
}

export function formatRow(presented) {
  const reply = presented.emailLeft
    ? `email left: ${presented.email}`
    : presented.from === 'guest'
      ? 'no email left'
      : 'reply via account email';
  const lines = [
    `── ${presented.id}`,
    `   ${presented.createdAt}  ${presented.path ?? '(no path)'}  from ${presented.from}  ${reply}`,
    `   status ${presented.status}${presented.class ? `, class ${presented.class}` : ''}${
      presented.triagedAt ? `, triaged ${presented.triagedAt.slice(0, 10)}` : ''
    }`,
  ];
  if (presented.note) lines.push(`   note: ${presented.note}`);
  lines.push('', ...presented.message.split('\n').map((line) => `   | ${line}`), '');
  return lines.join('\n');
}

export function formatInbox(rows, options) {
  const presented = rows.map((row) => presentRow(row, options));
  if (options.json) return JSON.stringify(presented, null, 2);
  const scope = options.all ? 'all statuses' : 'untriaged';
  if (presented.length === 0) return `No feedback (${scope}).`;
  const header = `${presented.length} feedback submission${presented.length === 1 ? '' : 's'} (${scope}, newest first${
    presented.length === options.limit ? `, capped at --limit ${options.limit}` : ''
  })`;
  return [header, '', ...presented.map(formatRow)].join('\n');
}
