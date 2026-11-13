import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function setup(t) {
  const mod = await import('./broadcast-push-token.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'mbpush-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = [];
  const calls = [];
  let tour = { source_url: null, poll_mode: 'off' };
  let failInsert = false;
  const client = {
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (sql.includes('SELECT source_url'))
        return { rows: tour ? [tour] : [], rowCount: tour ? 1 : 0 };
      if (sql.includes('INSERT INTO xiangqi_broadcast_push_tokens') && failInsert)
        throw new Error('unsafe database details');
      if (sql.includes('SELECT id, tour_slug'))
        return {
          rows: [
            {
              id: 'bpt_12345678',
              tour_slug: 'test',
              label: 'clock',
              created_at: 'now',
              revoked_at: null,
              last_used_at: null,
              token_hash: 'must-not-escape',
            },
          ],
        };
      return { rows: [], rowCount: 1 };
    },
  };
  return {
    ...mod,
    client,
    calls,
    output,
    out: join(dir, 'token'),
    log: (line) => output.push(line),
    setTour: (v) => {
      tour = v;
    },
    failInsert: () => {
      failInsert = true;
    },
  };
}

test('issue writes an exclusive 0600 token file; database and output contain only safe metadata', async (t) => {
  const s = await setup(t);
  await s.runBroadcastPushToken(
    ['issue', '--tour', 'test', '--label', 'clock', '--out', s.out],
    s.client,
    s.log,
  );
  const token = (await readFile(s.out, 'utf8')).trim();
  assert.equal(/^mbpush_[A-Za-z0-9_-]{43}$/.test(token), true);
  assert.equal((await stat(s.out)).mode & 0o777, 0o600);
  const insert = s.calls.find((c) => c.sql.includes('INSERT INTO xiangqi_broadcast_push_tokens'));
  const hash = createHash('sha256').update(token).digest('hex');
  assert.equal(insert.args.includes(hash), true);
  assert.equal(JSON.stringify(s.calls).includes(token), false);
  const output = s.output.join('\n');
  assert.equal(output.includes(token) || output.includes(hash), false);
  assert.deepEqual(Object.keys(JSON.parse(output)).sort(), ['id', 'path']);
  assert.equal(/^bpt_[0-9a-f]{8}$/.test(JSON.parse(output).id), true);
  await assert.rejects(
    s.runBroadcastPushToken(
      ['issue', '--tour', 'test', '--label', 'clock', '--out', s.out],
      s.client,
      s.log,
    ),
    /refuses to overwrite/,
  );
  assert.equal((await readFile(s.out, 'utf8')).trim() === token, true);
  assert.equal(
    s.calls.filter((c) => c.sql.includes('INSERT INTO xiangqi_broadcast_push_tokens')).length,
    1,
  );
});

test('issue rejects symlinks, polled/missing tours and cleans its file after a failed insert', async (t) => {
  const s = await setup(t);
  s.setTour({ source_url: 'https://source.invalid', poll_mode: 'auto' });
  const args = ['issue', '--tour', 'test', '--label', 'clock', '--out', s.out];
  await assert.rejects(s.runBroadcastPushToken(args, s.client, s.log), /event_not_pushable/);
  await assert.rejects(stat(s.out), { code: 'ENOENT' });
  s.setTour(null);
  await assert.rejects(s.runBroadcastPushToken(args, s.client, s.log), /unknown tour/);
  s.setTour({ source_url: 'https://source.invalid', poll_mode: 'off' });
  const target = `${s.out}-target`;
  await writeFile(target, 'existing');
  await symlink(target, s.out);
  await assert.rejects(s.runBroadcastPushToken(args, s.client, s.log), /refuses to overwrite/);
  assert.equal(await readFile(target, 'utf8'), 'existing');
  await rm(s.out);
  s.failInsert();
  await assert.rejects(s.runBroadcastPushToken(args, s.client, s.log), /operation failed/);
  await assert.rejects(stat(s.out), { code: 'ENOENT' });
  assert.equal(s.output.length, 0);
});

test('admin commands create an unlisted nonpolling tour, revoke, list safely and set listing', async (t) => {
  const s = await setup(t);
  await s.runBroadcastPushToken(
    ['create-test-event', '--slug', 'test', '--name', 'Test event'],
    s.client,
    s.log,
  );
  const insert = s.calls.find((c) => c.sql.includes('INSERT INTO xiangqi_broadcast_tours'));
  assert.match(insert.sql, /false, 'off'/);
  assert.match(insert.sql, /NULL/);
  await s.runBroadcastPushToken(['revoke', '--id', 'bpt_12345678'], s.client, s.log);
  assert.ok(s.calls.some((c) => /revoked_at = COALESCE/.test(c.sql)));
  await s.runBroadcastPushToken(['list', '--tour', 'test'], s.client, s.log);
  assert.equal(
    s.output.join('\n').includes('token_hash') || s.output.join('\n').includes('must-not-escape'),
    false,
  );
  assert.equal(
    s.calls.some((c) => c.sql.includes('SELECT *')),
    false,
  );
  await s.runBroadcastPushToken(
    ['set-listed', '--tour', 'test', '--listed', 'true'],
    s.client,
    s.log,
  );
  assert.ok(s.calls.some((c) => c.sql.includes('SET listed = $2') && c.args[1] === true));
});

test('invalid flags and values fail before touching the database', async (t) => {
  const s = await setup(t);
  for (const args of [
    [],
    ['issue'],
    ['list', '--label', 'wrong'],
    ['list', '--wat', 'value'],
    ['set-listed', '--tour', 'test', '--listed', 'yes'],
    ['revoke', '--id', 'bad'],
    ['create-test-event', '--slug', '../bad', '--name', 'test'],
  ]) {
    await assert.rejects(s.runBroadcastPushToken(args, s.client, s.log));
  }
  assert.equal(s.calls.length, 0);
  await writeFile(s.out, 'existing');
});

test('CLI entrypoint sanitizes invalid arguments and fails safely without DATABASE_URL', () => {
  const token = `mbpush_${randomBytes(32).toString('base64url')}`;
  const cli = new URL('./broadcast-push-token.mjs', import.meta.url);
  for (const args of [
    [token],
    ['issue', '--tour', 'test', '--label', 'clock', '--out', '/unused/token'],
  ]) {
    const result = spawnSync(process.execPath, [cli.pathname, ...args], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes(token), false);
    assert.match(result.stderr, /Usage:|DATABASE_URL is required/);
  }
});
