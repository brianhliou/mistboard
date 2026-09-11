#!/usr/bin/env node
// Read and set the account switches that have no UI: the admin role, the play
// lock, and per-variant access. All are manual-grant only by design, so this
// script is the whole mechanism outside `db:seed:qa`, which promotes the local
// QA email.
//
//   node scripts/account-flags.mjs <email>                  # show the row, change nothing
//   node scripts/account-flags.mjs <email> --grant-admin    # promote to admin
//   node scripts/account-flags.mjs <email> --revoke-admin   # demote to player
//   node scripts/account-flags.mjs <email> --disable-play   # no games, no puzzles
//   node scripts/account-flags.mjs <email> --enable-play    # let it play again
//   node scripts/account-flags.mjs <email> --grant-variant mahjong --note 'hk tester'
//   node scripts/account-flags.mjs <email> --revoke-variant mahjong
//
// Variant access (136) is for a variant that runs but whose rules nobody
// trusted yet: playable by the handful of people who know they are checking it,
// and by nobody else. Revoking never removes somebody from a game already in
// progress; it only stops them taking a new seat.
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
    'grant-variant': { type: 'string' },
    'revoke-variant': { type: 'string' },
    note: { type: 'string' },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

const email = positionals[0];
if (!email) {
  fail(
    'Usage: node scripts/account-flags.mjs <email> ' +
      '[--grant-admin|--revoke-admin] [--disable-play|--enable-play] ' +
      '[--grant-variant <spec>|--revoke-variant <spec>] [--note <text>]',
  );
}
if (values['grant-admin'] && values['revoke-admin']) {
  fail('Pass one of --grant-admin or --revoke-admin, not both.');
}
if (values['disable-play'] && values['enable-play']) {
  fail('Pass one of --disable-play or --enable-play, not both.');
}
if (values['grant-variant'] && values['revoke-variant']) {
  fail('Pass one of --grant-variant or --revoke-variant, not both.');
}
if (values.note && !values['grant-variant']) {
  fail('--note only means something with --grant-variant.');
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
const grantVariant = values['grant-variant'] ?? null;
const revokeVariant = values['revoke-variant'] ?? null;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // lower(email) matches findUserByEmail, so the row this resolves to is the
  // same one a sign-in resolves to.
  const found = await client.query(
    `SELECT id, email, handle, display_name, account_role, email_verified_at, play_disabled_at
       FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  const row = found.rows[0];
  if (!row) {
    fail(`No account for ${email}. Sign in once at mistboard.com to create it, then re-run.`);
  }

  console.log(
    `${row.email} -> @${row.handle} (${row.display_name}), role=${row.account_role}, ` +
      `play=${row.play_disabled_at ? `disabled since ${row.play_disabled_at.toISOString()}` : 'enabled'}, ` +
      `verified=${row.email_verified_at ? 'yes' : 'no'}, id=${row.id}`,
  );

  if (targetRole === null && targetLock === null && !grantVariant && !revokeVariant) {
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

  if (grantVariant) {
    // Idempotent, and re-granting refreshes the note without moving the date,
    // so re-running a batch of testers is safe.
    await client.query(
      `INSERT INTO variant_access_grants (user_id, game_spec_id, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, game_spec_id) DO UPDATE SET note = EXCLUDED.note`,
      [row.id, grantVariant, values.note ?? null],
    );
    console.log(`Granted ${grantVariant}.`);
  }

  if (revokeVariant) {
    const gone = await client.query(
      `DELETE FROM variant_access_grants WHERE user_id = $1 AND game_spec_id = $2`,
      [row.id, revokeVariant],
    );
    console.log(gone.rowCount ? `Revoked ${revokeVariant}.` : `No ${revokeVariant} grant to revoke.`);
  }

  const grants = await client.query(
    `SELECT game_spec_id FROM variant_access_grants WHERE user_id = $1 ORDER BY game_spec_id`,
    [row.id],
  );
  console.log(
    `Variant grants for @${row.handle}: ` +
      `${grants.rows.map((r) => r.game_spec_id).join(', ') || '(none)'}`,
  );

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
} finally {
  await client.end();
}
