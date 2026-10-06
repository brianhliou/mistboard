#!/usr/bin/env node
// Lists /contact feedback, newest first. Read only (a READ ONLY transaction).
// Untriaged rows by default; the triage loop is docs-private/runbooks/feedback-triage.md.
//
//   node scripts/feedback-inbox.mjs                      # status 'new', newest 50
//   node scripts/feedback-inbox.mjs --all                # every status
//   node scripts/feedback-inbox.mjs --since 2026-10-01 --limit 20
//   node scripts/feedback-inbox.mjs --json               # machine-readable
//   node scripts/feedback-inbox.mjs --show-email         # unmask reply addresses
//
// Reply addresses are masked (j***@example.com) unless --show-email: the
// output lands in agent transcripts, and the address is only needed when
// Brian replies from the Workspace inbox.
//
// Against production, hand the connection to Railway from the linked root, so
// the connection string never enters this process's arguments or the terminal:
//
//   command railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/feedback-inbox.mjs'

import pg from 'pg';
import { formatInbox, listFeedback, parseInboxArgs } from './lib/feedback-triage.mjs';

const USAGE =
  'Usage: node scripts/feedback-inbox.mjs [--all] [--since YYYY-MM-DD] [--limit N] [--json] [--show-email]';

let options;
try {
  options = parseInboxArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(1);
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. For production, run this through Railway from the linked root:\n' +
      '  command railway run -s Postgres -- sh -c \'DATABASE_URL="$DATABASE_PUBLIC_URL" ' +
      "node scripts/feedback-inbox.mjs'",
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const rows = await listFeedback(client, options);
  console.log(formatInbox(rows, options));
} finally {
  await client.end();
}
