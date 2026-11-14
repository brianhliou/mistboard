#!/usr/bin/env node
// Admin-only token management. DATABASE_URL is supplied locally or by prod:db.
// Never print database errors: constraint details can contain credential hashes.
import { createHash, randomBytes } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';

class CommandError extends Error {}
const usage =
  'Usage: broadcast:push-token create-test-event --slug <slug> --name <name> | issue --tour <slug> --label <label> --out <path> | revoke --id <id> | list [--tour <slug>] | set-listed --tour <slug> --listed true|false';
const flags = {
  'create-test-event': ['slug', 'name'],
  issue: ['tour', 'label', 'out'],
  revoke: ['id'],
  list: ['tour'],
  'set-listed': ['tour', 'listed'],
};
function argumentsFor(argv) {
  const [command, ...args] = argv;
  if (!Object.hasOwn(flags, command)) throw new CommandError(usage);
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: Object.fromEntries(flags[command].map((key) => [key, { type: 'string' }])),
    }));
  } catch {
    throw new CommandError(usage);
  }
  if (command !== 'list' && flags[command].some((key) => !values[key]?.trim()))
    throw new CommandError(usage);
  if ((values.tour || values.slug) && !/^[a-z0-9][a-z0-9-]*$/.test(values.tour ?? values.slug))
    throw new CommandError('invalid tour slug');
  if (values.id && !/^bpt_[a-f0-9]{8}$/.test(values.id)) throw new CommandError('invalid token id');
  if (command === 'set-listed' && !['true', 'false'].includes(values.listed))
    throw new CommandError('listed must be true or false');
  return { command, values };
}

export async function runBroadcastPushToken(argv, client, log = console.log) {
  const { command, values: v } = argumentsFor(argv);
  let file;
  let createdFile = false;
  let committed = false;
  try {
    if (command === 'list') {
      const { rows } = await client.query(
        `SELECT id, tour_slug, label, created_at, revoked_at, last_used_at
           FROM xiangqi_broadcast_push_tokens WHERE ($1::text IS NULL OR tour_slug = $1)
          ORDER BY created_at, id`,
        [v.tour ?? null],
      );
      log(
        JSON.stringify(
          rows.map(({ id, tour_slug, label, created_at, revoked_at, last_used_at }) => ({
            id,
            tour_slug,
            label,
            created_at,
            revoked_at,
            last_used_at,
          })),
        ),
      );
      return;
    }
    await client.query('BEGIN');
    if (command === 'issue') {
      const { rows } = await client.query(
        `SELECT source_url, poll_mode FROM xiangqi_broadcast_tours WHERE slug = $1 FOR UPDATE`,
        [v.tour],
      );
      if (!rows[0]) throw new CommandError('unknown tour');
      if (rows[0].source_url !== null && rows[0].poll_mode !== 'off')
        throw new CommandError('event_not_pushable');
      try {
        file = await open(v.out, 'wx', 0o600);
        createdFile = true;
      } catch (error) {
        if (error.code === 'EEXIST') throw new CommandError('refuses to overwrite token output');
        throw new CommandError('cannot create token output');
      }
      const id = `bpt_${randomBytes(4).toString('hex')}`;
      const token = `mbpush_${randomBytes(32).toString('base64url')}`;
      const hash = createHash('sha256').update(token).digest('hex');
      await file.chmod(0o600);
      await file.writeFile(`${token}\n`);
      await file.sync();
      await file.close();
      file = undefined;
      await client.query(
        `INSERT INTO xiangqi_broadcast_push_tokens (id, tour_slug, label, token_hash) VALUES ($1, $2, $3, $4)`,
        [id, v.tour, v.label, hash],
      );
      await client.query('COMMIT');
      committed = true;
      log(JSON.stringify({ id, path: v.out }));
      return;
    }
    let result;
    if (command === 'create-test-event') {
      const payload = { schema: 'mistboard.xiangqi.broadcast.v1', slug: v.slug, name: v.name };
      result = await client.query(
        `INSERT INTO xiangqi_broadcast_tours (slug, name, source_url, listed, poll_mode, payload)
         VALUES ($1, $2, NULL, false, 'off', $3::jsonb)`,
        [v.slug, v.name, JSON.stringify(payload)],
      );
    } else if (command === 'revoke') {
      result = await client.query(
        `UPDATE xiangqi_broadcast_push_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1`,
        [v.id],
      );
    } else {
      result = await client.query(
        `UPDATE xiangqi_broadcast_tours SET listed = $2, updated_at = now() WHERE slug = $1`,
        [v.tour, v.listed === 'true'],
      );
    }
    if (!result.rowCount) throw new CommandError('no matching event or token');
    await client.query('COMMIT');
    committed = true;
    log(JSON.stringify({ ok: true }));
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    if (file) await file.close().catch(() => {});
    if (createdFile && !committed) await unlink(v.out).catch(() => {});
    throw error instanceof CommandError
      ? error
      : new CommandError('broadcast push token operation failed');
  }
}

async function main() {
  // Validate before connecting so typos cannot open a database session.
  argumentsFor(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new CommandError('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  client.on('error', () => {});
  try {
    await client.connect();
    await runBroadcastPushToken(process.argv.slice(2), client);
  } finally {
    await client.end().catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(
      error instanceof CommandError ? error.message : 'broadcast push token operation failed',
    );
    process.exitCode = 1;
  });
}
