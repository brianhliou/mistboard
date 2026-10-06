#!/usr/bin/env node
// Records the triage decision on one /contact submission. The only writer of
// the triage columns (migration 162), run by a session after Brian has decided
// what the message is and what happens next; see
// docs-private/runbooks/feedback-triage.md. Prints the row it changed.
//
//   node scripts/feedback-mark.mjs <id> --status triaged|done|spam|new \
//     [--class bug|idea|partnership|praise|question|spam] [--note "decision, link"]
//
// --class and --note keep their stored value when left out; --status spam
// defaults the class to spam. The note is the decision and its link (a GitHub
// issue, a commit, a doc), never the person: a note shaped like an email
// address is refused.
//
// Against production this is a write: only with Brian's go, from the linked root:
//
//   command railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/feedback-mark.mjs <id> --status done --class bug --note "…"'

import pg from 'pg';
import { formatRow, markFeedback, parseMarkArgs, presentRow } from './lib/feedback-triage.mjs';

const USAGE =
  'Usage: node scripts/feedback-mark.mjs <id> --status new|triaged|done|spam ' +
  '[--class bug|idea|partnership|praise|question|spam] [--note "<decision and link>"] [--json]';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
let options;
try {
  options = parseMarkArgs(argv.filter((arg) => arg !== '--json'));
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
    'DATABASE_URL is not set. For production (a write: Brian says go first), from the linked root:\n' +
      '  command railway run -s Postgres -- sh -c \'DATABASE_URL="$DATABASE_PUBLIC_URL" ' +
      "node scripts/feedback-mark.mjs <id> --status …'",
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const row = await markFeedback(client, options);
  if (!row) {
    console.error(`No feedback submission with id ${options.id}.`);
    process.exitCode = 1;
  } else {
    const presented = presentRow(row);
    console.log(json ? JSON.stringify(presented, null, 2) : `updated\n${formatRow(presented)}`);
  }
} finally {
  await client.end();
}
