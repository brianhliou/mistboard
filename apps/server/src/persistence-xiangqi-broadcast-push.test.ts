import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { XiangqiBroadcastBoard } from '@mistboard/game';
import { getPool, withTransaction } from './persistence-db.js';
import {
  assert,
  definePersistenceTests,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import {
  createAccountBroadcastPushToken,
  createAccountBroadcastPushTokenOn,
  findXiangqiBroadcastPushToken,
  listAccountBroadcastPushGrants,
  revokeAccountBroadcastPushToken,
  revokeXiangqiBroadcastPushTokenOn,
  touchXiangqiBroadcastPushToken,
} from './persistence-xiangqi-broadcast-push.js';
import {
  applyXiangqiBroadcastBoardUpdate,
  applyXiangqiBroadcastBoardUpdateOn,
  getXiangqiBroadcastBoard,
  getXiangqiBroadcastTour,
  importXiangqiBroadcastPack,
} from './persistence-xiangqi-broadcasts.js';

const tour = { schema: 'mistboard.xiangqi.broadcast.v1', slug: 'push-test', name: 'Push test' };
const round = { schema: tour.schema, id: 'push-test-r1', tourSlug: tour.slug, name: 'Round 1' };
const board: XiangqiBroadcastBoard = {
  schema: 'mistboard.xiangqi.broadcast.v1',
  id: 'push-test-r1-b01',
  tourSlug: tour.slug,
  roundId: round.id,
  sourceBoardId: 'r1-b01',
  boardNumber: 1,
  red: { name: 'Red' },
  black: { name: 'Black' },
  status: 'live',
  result: '*',
  moves: [
    { from: 'h3', to: 'e3' },
    { from: 'h10', to: 'g8' },
  ],
};
const options = (seq?: number) => ({ allowCorrection: true, allowTakeback: true, push: { seq } });
async function seed() {
  await importXiangqiBroadcastPack({ tour, rounds: [round], boards: [] });
}
async function seq() {
  return (
    (
      await getPool().query(
        `SELECT last_accepted_seq FROM xiangqi_broadcast_boards WHERE id = $1`,
        [board.id],
      )
    ).rows[0]?.last_accepted_seq ?? null
  );
}
const cliPath = fileURLToPath(
  new URL('../../../scripts/broadcast-push-token.mjs', import.meta.url),
);
async function cli(...args: string[]) {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [cliPath, ...args], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    timeout: 10_000,
  });
  assert.equal(stderr, '');
  return JSON.parse(stdout) as Record<string, unknown>;
}

definePersistenceTests('xiangqi broadcast push', () => {
  test('account tokens persist hashes only, enforce ownership and serialize the five-token limit', async () => {
    await seed();
    await getPool().query(`INSERT INTO users (id, email, handle, display_name)
      VALUES ('owner', 'owner@example.test', 'clockmaker', 'Clock maker'),
             ('other', 'other@example.test', 'other', 'Other')`);
    await cli('grant', '--account', '@clockmaker', '--tour', tour.slug);
    await cli('grant', '--account', 'OWNER@example.test', '--tour', tour.slug);
    assert.equal(
      (
        await getPool().query(
          'SELECT id FROM xiangqi_broadcast_push_grants WHERE revoked_at IS NULL',
        )
      ).rowCount,
      1,
    );
    assert.equal(
      await createAccountBroadcastPushToken('other', tour.slug, 'No access'),
      'not_found',
    );
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createAccountBroadcastPushToken('owner', tour.slug, `Clock ${i}`),
      ),
    );
    const created = outcomes.filter((r) => typeof r !== 'string');
    assert.equal(created.length, 5);
    assert.equal(outcomes.filter((r) => r === 'token_limit').length, 3);
    const first = created[0]!;
    const hash = createHash('sha256').update(first.token).digest('hex');
    const stored = (
      await getPool().query('SELECT * FROM xiangqi_broadcast_push_tokens WHERE id = $1', [
        first.metadata.id,
      ])
    ).rows[0];
    assert.equal(stored.token_hash === hash, true);
    assert.equal(JSON.stringify(stored).includes(first.token), false);
    const listed = JSON.stringify(await listAccountBroadcastPushGrants('owner'));
    assert.equal(
      listed.includes(hash) || listed.includes(first.token) || listed.includes('token_hash'),
      false,
    );
    assert.deepEqual(await listAccountBroadcastPushGrants('other'), []);
    assert.equal(
      await revokeAccountBroadcastPushToken('other', tour.slug, first.metadata.id),
      false,
    );
    assert.equal(
      await revokeAccountBroadcastPushToken('owner', 'ungranted', first.metadata.id),
      false,
    );
    assert.equal(
      await revokeAccountBroadcastPushToken('owner', tour.slug, first.metadata.id),
      true,
    );
    await cli('revoke-grant', '--account', '@clockmaker', '--tour', tour.slug);
    assert.deepEqual(await listAccountBroadcastPushGrants('owner'), []);
    assert.equal(
      (
        await getPool().query(
          'SELECT id FROM xiangqi_broadcast_push_tokens WHERE revoked_at IS NULL',
        )
      ).rowCount,
      0,
    );
    await cli('grant', '--account', '@clockmaker', '--tour', tour.slug);
    // Regranting must never revive previously revoked credentials.
    assert.ok((await findXiangqiBroadcastPushToken(first.token))?.revokedAt);
  });

  test('migration 199 installs exact token columns, FK cascade, unique hash and durable nullable sequence', async () => {
    const { rows } = await getPool().query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'xiangqi_broadcast_push_tokens' ORDER BY ordinal_position`,
    );
    assert.deepEqual(
      rows.map((r) => r.column_name),
      [
        'id',
        'tour_slug',
        'label',
        'token_hash',
        'created_at',
        'revoked_at',
        'last_used_at',
        'account_id',
      ],
    );
    await seed();
    assert.equal((await getXiangqiBroadcastTour(tour.slug))?.listed, true);
    await applyXiangqiBroadcastBoardUpdate(board);
    assert.equal(await seq(), null);
    const hash = createHash('sha256').update('synthetic test credential').digest('hex');
    await getPool().query(
      `INSERT INTO xiangqi_broadcast_push_tokens (id, tour_slug, label, token_hash) VALUES ('bpt_00000001', $1, 'clock', $2)`,
      [tour.slug, hash],
    );
    let uniqueRejected = false;
    try {
      await getPool().query(
        `INSERT INTO xiangqi_broadcast_push_tokens (id, tour_slug, label, token_hash) VALUES ('bpt_00000002', $1, 'clock', $2)`,
        [tour.slug, hash],
      );
    } catch {
      uniqueRejected = true;
    }
    assert.equal(uniqueRejected, true); // Never serialize a PG error carrying the hash.
    await getPool().query(`DELETE FROM xiangqi_broadcast_tours WHERE slug = $1`, [tour.slug]);
    assert.equal(
      (await getPool().query(`SELECT id FROM xiangqi_broadcast_push_tokens`)).rowCount,
      0,
    );
    assert.equal(await getXiangqiBroadcastBoard(board.id), null);
  });

  test('CLI/token lifecycle stores only a hash, refuses overwrite, safely lists, revokes and throttles last-used writes', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'mbpush-pg-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const out = join(dir, 'token');
    await cli('create-test-event', '--slug', tour.slug, '--name', tour.name);
    const event = await getXiangqiBroadcastTour(tour.slug);
    assert.equal(event?.listed, false);
    assert.equal(event?.pollMode, 'off');
    assert.equal(event?.sourceUrl, undefined);
    const issued = await cli('issue', '--tour', tour.slug, '--label', 'clock', '--out', out);
    const token = (await readFile(out, 'utf8')).trim();
    const hash = createHash('sha256').update(token).digest('hex');
    assert.equal((await stat(out)).mode & 0o777, 0o600);
    assert.equal(
      JSON.stringify(issued).includes(token) || JSON.stringify(issued).includes(hash),
      false,
    );
    assert.equal(
      (
        await getPool().query(
          `SELECT token_hash FROM xiangqi_broadcast_push_tokens WHERE id = $1`,
          [issued.id],
        )
      ).rows[0]?.token_hash === hash,
      true,
    );
    assert.equal((await findXiangqiBroadcastPushToken(token))?.id, issued.id);
    assert.equal(await findXiangqiBroadcastPushToken(`mbpush_${'z'.repeat(43)}`), null);
    assert.equal((await findXiangqiBroadcastPushToken(token))?.lastUsedAt, null);
    const touched = await Promise.all(
      Array.from({ length: 6 }, () => touchXiangqiBroadcastPushToken(issued.id as string)),
    );
    assert.equal(touched.filter(Boolean).length, 1);
    const first = (await findXiangqiBroadcastPushToken(token))!.lastUsedAt;
    assert.ok(first);
    assert.equal(await touchXiangqiBroadcastPushToken(issued.id as string), false);
    assert.equal(
      (await findXiangqiBroadcastPushToken(token))?.lastUsedAt?.getTime(),
      first.getTime(),
    );
    await getPool().query(
      `UPDATE xiangqi_broadcast_push_tokens SET last_used_at = now() - interval '61 seconds' WHERE id = $1`,
      [issued.id],
    );
    assert.equal(await touchXiangqiBroadcastPushToken(issued.id as string), true);
    const listed = JSON.stringify(await cli('list', '--tour', tour.slug));
    assert.equal(
      listed.includes(token) || listed.includes(hash) || listed.includes('token_hash'),
      false,
    );
    let refused = false;
    try {
      await cli('issue', '--tour', tour.slug, '--label', 'other', '--out', out);
    } catch {
      refused = true;
    }
    assert.equal(refused, true);
    assert.equal((await readFile(out, 'utf8')).trim() === token, true);
    await cli('set-listed', '--tour', tour.slug, '--listed', 'true');
    assert.equal((await getXiangqiBroadcastTour(tour.slug))?.listed, true);
    await cli('revoke', '--id', issued.id as string);
    const revoked = (await findXiangqiBroadcastPushToken(token))!.revokedAt;
    assert.ok(revoked);
    assert.equal(await revokeXiangqiBroadcastPushTokenOn(getPool(), issued.id as string), true);
    assert.equal(
      (await findXiangqiBroadcastPushToken(token))?.revokedAt?.getTime(),
      revoked.getTime(),
    );
    assert.equal(await touchXiangqiBroadcastPushToken(issued.id as string), false);
  });

  test('writer creates, deduplicates, extends, corrects and accepts only newer-sequence takebacks', async () => {
    await seed();
    assert.equal((await applyXiangqiBroadcastBoardUpdate(board, options(4))).ok, true);
    assert.equal(await seq(), 4);
    const first = await getXiangqiBroadcastBoard(board.id);
    const duplicate = await applyXiangqiBroadcastBoardUpdate(board, options(5));
    assert.equal(duplicate.ok && duplicate.status, 'unchanged');
    assert.equal(
      (await getXiangqiBroadcastBoard(board.id))?.updatedAt.getTime(),
      first!.updatedAt.getTime(),
    );
    assert.equal(await seq(), 5);
    const longer = { ...board, moves: [...board.moves, { from: 'h1', to: 'g3' }] };
    const extended = await applyXiangqiBroadcastBoardUpdate(longer, options(6));
    assert.equal(extended.ok && extended.status, 'extended');
    const divergent = { ...longer, moves: [...board.moves, { from: 'b1', to: 'c3' }] };
    const corrected = await applyXiangqiBroadcastBoardUpdate(divergent, options(7));
    assert.equal(corrected.ok && corrected.status, 'corrected');
    for (const counter of [undefined, 6, 7]) {
      const stale = await applyXiangqiBroadcastBoardUpdate(board, options(counter));
      assert.equal(stale.ok && stale.stale, true);
      assert.deepEqual((await getXiangqiBroadcastBoard(board.id))?.moves, divergent.moves);
      assert.equal(await seq(), 7);
    }
    const takeback = await applyXiangqiBroadcastBoardUpdate(board, options(8));
    assert.equal(takeback.ok && takeback.status, 'corrected');
    assert.deepEqual((await getXiangqiBroadcastBoard(board.id))?.moves, board.moves);
    assert.equal(await seq(), 8);
    const finished = { ...board, status: 'complete', result: '1-0' };
    await applyXiangqiBroadcastBoardUpdate(finished, options(9));
    await applyXiangqiBroadcastBoardUpdate(board, options());
    await applyXiangqiBroadcastBoardUpdate(longer, options(9));
    assert.equal((await getXiangqiBroadcastBoard(board.id))?.status, 'complete');
    assert.equal((await getXiangqiBroadcastBoard(board.id))?.moves.length, 2);
    await applyXiangqiBroadcastBoardUpdate({ ...finished, result: '0-1' }, options(10));
    assert.equal((await getXiangqiBroadcastBoard(board.id))?.result, '0-1');
  });

  test('illegal/rejected writes and failed transactions leave board and sequence together unchanged', async () => {
    await seed();
    await applyXiangqiBroadcastBoardUpdate(board, options(4));
    const before = await getXiangqiBroadcastBoard(board.id);
    const invalid = await applyXiangqiBroadcastBoardUpdate(
      { ...board, moves: [{ from: 'a7', to: 'a6' }], clock: { redMs: 1, blackMs: 2, at: 3 } },
      options(99),
    );
    assert.equal(invalid.ok, false);
    assert.deepEqual(await getXiangqiBroadcastBoard(board.id), before);
    assert.equal(await seq(), 4);
    await assert.rejects(
      withTransaction(async (client) => {
        const result = await applyXiangqiBroadcastBoardUpdateOn(
          client,
          { ...board, moves: [] },
          options(5),
        );
        assert.equal(result.ok, true);
        throw new Error('planted transaction failure');
      }),
      /planted transaction failure/,
    );
    assert.deepEqual(await getXiangqiBroadcastBoard(board.id), before);
    assert.equal(await seq(), 4);
    await getPool().query(
      `UPDATE xiangqi_broadcast_tours SET source_url = 'https://source.invalid', poll_mode = 'auto' WHERE slug = $1`,
      [tour.slug],
    );
    const blocked = await applyXiangqiBroadcastBoardUpdate({ ...board, moves: [] }, options(100));
    assert.equal(!blocked.ok && blocked.kind, 'event_not_pushable');
    assert.equal(await seq(), 4);
    assert.deepEqual(await getXiangqiBroadcastBoard(board.id), before);
  });

  test('concurrent first posts serialize board creation and sequence comparison', async () => {
    await seed();
    const shorter = { ...board, moves: board.moves.slice(0, 1) };
    const results = await Promise.all([
      applyXiangqiBroadcastBoardUpdate(shorter, options(1)),
      applyXiangqiBroadcastBoardUpdate(board, options(2)),
    ]);
    assert.ok(results.every((r) => r.ok));
    assert.deepEqual((await getXiangqiBroadcastBoard(board.id))?.moves, board.moves);
    assert.equal(await seq(), 2);
  });
});

// Offline contract proof: no bearer value crosses the database boundary.
test('account token insertion sends only a hash and never issues without a grant or above the cap', async () => {
  const calls: { sql: string; args: unknown[] }[] = [];
  let granted = true;
  let count = 0;
  const client = {
    query: async (sql: string, args: unknown[] = []) => {
      calls.push({ sql, args });
      if (sql.includes('FROM users')) return { rows: [{ id: 'owner' }] };
      if (sql.includes('FROM xiangqi_broadcast_push_grants'))
        return { rows: granted ? [{ id: 'grant' }] : [] };
      if (sql.includes('count(*)')) return { rows: [{ count: String(count) }] };
      if (sql.includes('INSERT INTO'))
        return {
          rows: [
            {
              id: args[0],
              tour_slug: args[2],
              label: args[3],
              created_at: new Date(),
              revoked_at: null,
              last_used_at: null,
            },
          ],
        };
      throw new Error('unexpected query');
    },
  } as unknown as Parameters<typeof createAccountBroadcastPushTokenOn>[0];
  const result = await createAccountBroadcastPushTokenOn(client, 'owner', 'test', 'Clock');
  assert.ok(typeof result !== 'string');
  assert.match(result.token, /^mbpush_[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(calls).includes(result.token), false);
  const insert = calls.find((c) => c.sql.includes('INSERT INTO'))!;
  assert.equal(insert.args[4] === createHash('sha256').update(result.token).digest('hex'), true);
  count = 5;
  assert.equal(
    await createAccountBroadcastPushTokenOn(client, 'owner', 'test', 'Clock'),
    'token_limit',
  );
  granted = false;
  assert.equal(
    await createAccountBroadcastPushTokenOn(client, 'owner', 'test', 'Clock'),
    'not_found',
  );
  assert.equal(calls.filter((c) => c.sql.includes('INSERT INTO')).length, 1);
});
