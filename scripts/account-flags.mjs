#!/usr/bin/env node
// Read and set the three account switches that have no UI: the admin role, the
// play lock, and the statistics exclusion. All are manual-grant only by design,
// so this script is the whole mechanism outside `db:seed:qa`, which promotes
// the local QA email. The account is addressed by email, or by @handle.
//
//   node scripts/account-flags.mjs <email|@handle>                       # show the row, change nothing
//   node scripts/account-flags.mjs <email|@handle> --grant-admin         # promote to admin
//   node scripts/account-flags.mjs <email|@handle> --revoke-admin        # demote to player
//   node scripts/account-flags.mjs <email|@handle> --disable-play        # no games, no puzzles
//   node scripts/account-flags.mjs <email|@handle> --enable-play         # let it play again
//   node scripts/account-flags.mjs <email|@handle> --exclude-from-stats  # its games leave every count
//   node scripts/account-flags.mjs <email|@handle> --include-in-stats    # count them again
//
// The statistics exclusion (users.stats_excluded_at, migration 136) is for the
// operator's own accounts: their games stay on their profiles and in replays,
// but drop out of /stats, the homepage games-played number, /metrics, and the
// readout, matching the PostHog test-account filter. On 2026-09-11 those
// accounts had played 512 of 988 completed human games.
//
// The play lock is for accounts that are an identity rather than a player (the
// official @mistboard account). Locked, it cannot take a game seat, post or
// accept a correspondence challenge, or book a puzzle attempt. It can still
// sign in, watch, post, and cancel challenges aimed at it. Migration 120 was
// the cost of not having this: a game and a puzzle attempt landed on the
// official account because a browser was signed in as the wrong identity.
//
// Against production, hand the connection to Railway rather than putting it in
// your shell. The connection string is referenced by name inside the child and
// never enters this process or the terminal:
//
//   railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/account-flags.mjs <email> --disable-play'
//
// The account must already exist. Signing in creates it, and this script will
// not invent a row for an address nobody has proved they can receive mail at.

import { parseArgs } from 'node:util';
import pg from 'pg';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'grant-admin': { type: 'boolean', default: false },
    'revoke-admin': { type: 'boolean', default: false },
    'disable-play': { type: 'boolean', default: false },
    'enable-play': { type: 'boolean', default: false },
    'exclude-from-stats': { type: 'boolean', default: false },
    'include-in-stats': { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

const email = positionals[0];
if (!email) {
  fail(
    'Usage: node scripts/account-flags.mjs <email|@handle> ' +
      '[--grant-admin|--revoke-admin] [--disable-play|--enable-play] ' +
      '[--exclude-from-stats|--include-in-stats]',
  );
}
if (values['exclude-from-stats'] && values['include-in-stats']) {
  fail('Pass one of --exclude-from-stats or --include-in-stats, not both.');
}
if (values['grant-admin'] && values['revoke-admin']) {
  fail('Pass one of --grant-admin or --revoke-admin, not both.');
}
if (values['disable-play'] && values['enable-play']) {
  fail('Pass one of --disable-play or --enable-play, not both.');
}
if (!process.env.DATABASE_URL) {
  fail(
    'DATABASE_URL is not set. For production, run this through Railway:\n' +
      '  railway run -s Postgres -- sh -c \'DATABASE_URL="$DATABASE_PUBLIC_URL" ' +
      `node scripts/account-flags.mjs ${email}'`,
  );
}

const targetRole = values['grant-admin'] ? 'admin' : values['revoke-admin'] ? 'player' : null;
const targetLock = values['disable-play'] ? true : values['enable-play'] ? false : null;
const targetExcluded = values['exclude-from-stats']
  ? true
  : values['include-in-stats']
    ? false
    : null;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // lower(email) matches findUserByEmail, so the row this resolves to is the
  // same one a sign-in resolves to. A leading @ addresses the handle instead,
  // for accounts whose mailbox nobody remembers (the official @mistboard).
  const byHandle = email.startsWith('@');
  const found = await client.query(
    `SELECT id, email, handle, display_name, account_role, email_verified_at, play_disabled_at,
            stats_excluded_at
       FROM users WHERE ${byHandle ? 'lower(handle) = lower($1)' : 'lower(email) = lower($1)'}
       LIMIT 1`,
    [byHandle ? email.slice(1) : email],
  );
  const row = found.rows[0];
  if (!row) {
    fail(`No account for ${email}. Sign in once at mistboard.com to create it, then re-run.`);
  }

  console.log(
    `${row.email} -> @${row.handle} (${row.display_name}), role=${row.account_role}, ` +
      `play=${row.play_disabled_at ? `disabled since ${row.play_disabled_at.toISOString()}` : 'enabled'}, ` +
      `stats=${row.stats_excluded_at ? `excluded since ${row.stats_excluded_at.toISOString()}` : 'counted'}, ` +
      `verified=${row.email_verified_at ? 'yes' : 'no'}, id=${row.id}`,
  );

  if (targetRole === null && targetLock === null && targetExcluded === null) {
    console.log('Read-only run. Pass a flag to change something.');
  }

  if (targetRole !== null) {
    if (row.account_role === targetRole) {
      console.log(`Role already ${targetRole}. Nothing to do.`);
    } else {
      await client.query(`UPDATE users SET account_role = $2, updated_at = now() WHERE id = $1`, [
        row.id,
        targetRole,
      ]);
      console.log(`Role ${row.account_role} -> ${targetRole}.`);
    }
  }

  if (targetLock !== null) {
    const locked = row.play_disabled_at !== null;
    if (locked === targetLock) {
      console.log(`Play already ${targetLock ? 'disabled' : 'enabled'}. Nothing to do.`);
    } else {
      await client.query(
        `UPDATE users
            SET play_disabled_at = CASE WHEN $2 THEN now() ELSE NULL END,
                updated_at = now()
          WHERE id = $1`,
        [row.id, targetLock],
      );
      console.log(
        `Play ${locked ? 'disabled' : 'enabled'} -> ${targetLock ? 'disabled' : 'enabled'}.`,
      );
    }
  }

  if (targetExcluded !== null) {
    const excluded = row.stats_excluded_at !== null;
    if (excluded === targetExcluded) {
      console.log(`Stats already ${targetExcluded ? 'excluded' : 'counted'}. Nothing to do.`);
    } else {
      await client.query(
        `UPDATE users
            SET stats_excluded_at = CASE WHEN $2 THEN now() ELSE NULL END,
                updated_at = now()
          WHERE id = $1`,
        [row.id, targetExcluded],
      );
      console.log(
        `Stats ${excluded ? 'excluded' : 'counted'} -> ${targetExcluded ? 'excluded' : 'counted'}.`,
      );
    }
  }

  const admins = await client.query(
    `SELECT handle FROM users WHERE account_role = 'admin' ORDER BY handle`,
  );
  const locked = await client.query(
    `SELECT handle FROM users WHERE play_disabled_at IS NOT NULL ORDER BY handle`,
  );
  console.log(`Admins now: ${admins.rows.map((r) => `@${r.handle}`).join(', ') || '(none)'}`);
  console.log(
    `Play-disabled now: ${locked.rows.map((r) => `@${r.handle}`).join(', ') || '(none)'}`,
  );
  const excluded = await client.query(
    `SELECT handle FROM users WHERE stats_excluded_at IS NOT NULL ORDER BY handle`,
  );
  console.log(
    `Excluded from stats now: ${excluded.rows.map((r) => `@${r.handle}`).join(', ') || '(none)'}`,
  );
} finally {
  await client.end();
}
