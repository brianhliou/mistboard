import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiBroadcastBoard } from '@mistboard/game';
import type pg from 'pg';
import { applyXiangqiBroadcastBoardUpdateOn } from './persistence-xiangqi-broadcasts.js';

// Exercise the real writer without Postgres; persistence tests cover transactions/locks.
function database(board: XiangqiBroadcastBoard, seq: number | null = null) {
  const state = { board: structuredClone(board), seq, writes: 0 };
  const client = {
    async query(sql: string, args: unknown[] = []) {
      if (sql.includes('FROM xiangqi_broadcast_tours'))
        return { rows: [{ source_url: null, poll_mode: 'off' }], rowCount: 1 };
      if (sql.includes('FROM xiangqi_broadcast_rounds')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('SELECT * FROM xiangqi_broadcast_boards'))
        return {
          rows: [
            {
              payload: state.board,
              ply_count: state.board.moves.length,
              last_accepted_seq: state.seq,
              final_status: { state: 'playing' },
            },
          ],
        };
      if (sql.includes('INSERT INTO xiangqi_broadcast_boards')) {
        state.board = JSON.parse(args[13] as string);
        if (args[14] !== undefined && args[14] !== null)
          state.seq = Math.max(state.seq ?? -1, args[14] as number);
        state.writes++;
      }
      if (sql.includes('UPDATE xiangqi_broadcast_boards SET last_accepted_seq'))
        state.seq = args[1] as number;
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Pick<pg.PoolClient, 'query'>;
  return { state, client };
}
const board: XiangqiBroadcastBoard = {
  schema: 'mistboard.xiangqi.broadcast.v1',
  id: 'push-r1-b01',
  tourSlug: 'push',
  roundId: 'r1',
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
// Kept structurally typed so this test demonstrates the missing behavior on part 2.
const push = (seq?: number) => ({ allowCorrection: true, allowTakeback: true, push: { seq } });

test('push writer saves clock-only and timeControl-only updates', async () => {
  const { state, client } = database(board);
  const clock = { redMs: 1000, blackMs: 2000, at: 100 };
  const result = await applyXiangqiBroadcastBoardUpdateOn(client, { ...board, clock }, push());
  assert.equal(result.ok && result.status, 'updated');
  assert.deepEqual(state.board.clock, clock);
  await applyXiangqiBroadcastBoardUpdateOn(
    client,
    { ...board, clock, details: { timeControl: '90+30' } },
    push(),
  );
  assert.equal(state.board.details?.timeControl, '90+30');
});

test('push writer ignores shorter posts without a newer sequence and accepts explicit takebacks', async () => {
  for (const seq of [undefined, 3, 4]) {
    const { state, client } = database(board, 4);
    const result = await applyXiangqiBroadcastBoardUpdateOn(
      client,
      { ...board, moves: board.moves.slice(0, 1) },
      push(seq),
    );
    assert.equal(result.ok && 'stale' in result && result.stale, true);
    assert.equal(state.writes, 0);
    assert.equal(state.seq, 4);
  }
  const { state, client } = database(board, 4);
  const result = await applyXiangqiBroadcastBoardUpdateOn(
    client,
    { ...board, moves: board.moves.slice(0, 1) },
    push(5),
  );
  assert.equal(result.ok && result.status, 'corrected');
  assert.equal(state.board.moves.length, 1);
  assert.equal(state.seq, 5);
});

test('finished push boards stay finished; only a newer sequence can correct them', async () => {
  const finished = { ...board, status: 'complete' as const, result: '1-0' as const };
  const { state, client } = database(finished, 4);
  const retry = await applyXiangqiBroadcastBoardUpdateOn(client, board, push());
  assert.equal(retry.ok && retry.status, 'unchanged');
  assert.equal(state.board.status, 'complete');
  const shorter = { ...board, moves: board.moves.slice(0, 1) };
  await applyXiangqiBroadcastBoardUpdateOn(client, shorter, push(4));
  assert.equal(state.writes, 0);
  await applyXiangqiBroadcastBoardUpdateOn(client, shorter, push(5));
  assert.equal(state.board.moves.length, 1);
  assert.equal(state.board.status, 'complete');
  assert.equal(state.board.result, '1-0');
});

test('rejected push writes cannot advance sequence or change metadata', async () => {
  const { state, client } = database(board, 4);
  const result = await applyXiangqiBroadcastBoardUpdateOn(
    client,
    { ...board, red: { name: 'Wrong' }, moves: [{ from: 'a7', to: 'a6' }] },
    push(99),
  );
  assert.equal(result.ok, false);
  assert.equal(state.seq, 4);
  assert.deepEqual(state.board, board);
});

test('public board replay includes the persisted clock', async () => {
  const { buildXiangqiBroadcastBoardReplay } = await import('./xiangqi-broadcast-serving.js');
  const clock = { redMs: 1000, blackMs: 2000, at: 100 };
  const payload = buildXiangqiBroadcastBoardReplay({
    ...board,
    clock,
    plyCount: 2,
    finalStatus: { type: 'playing', turn: 'red' },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  assert.equal('clock' in payload.board, true);
  assert.deepEqual((payload.board as { clock?: unknown }).clock, clock);
});

test('push writer deduplicates, extends and corrects divergent moves; sequence watermark never decreases', async () => {
  const { state, client } = database(board, 4);
  const duplicate = await applyXiangqiBroadcastBoardUpdateOn(client, board, push(8));
  assert.equal(duplicate.ok && duplicate.status, 'unchanged');
  assert.equal(state.writes, 0);
  assert.equal(state.seq, 8);
  const next = { ...board, moves: [...board.moves, { from: 'h1', to: 'g3' }] };
  const extension = await applyXiangqiBroadcastBoardUpdateOn(client, next, push(9));
  assert.equal(extension.ok && extension.status, 'extended');
  const divergent = { ...next, moves: [...board.moves, { from: 'b1', to: 'c3' }] };
  const correction = await applyXiangqiBroadcastBoardUpdateOn(client, divergent, push(10));
  assert.equal(correction.ok && correction.status, 'corrected');
  assert.deepEqual(state.board.moves, divergent.moves);
  await applyXiangqiBroadcastBoardUpdateOn(client, divergent, push(2));
  assert.equal(state.seq, 10);
});

test('pushability checks the configured source and poll mode, independently of the schedule', async () => {
  for (const mode of ['auto', 'on', 'off']) {
    for (const source of [null, 'https://source.invalid']) {
      const { state, client } = database(board);
      const original = client.query.bind(client);
      const query = (async (sql: string, args: unknown[]) =>
        sql.includes('FROM xiangqi_broadcast_tours')
          ? { rows: [{ source_url: source, poll_mode: mode }] }
          : original(sql, args)) as typeof client.query;
      const result = await applyXiangqiBroadcastBoardUpdateOn(
        { query },
        { ...board, details: { timeControl: '90+30' } },
        push(1),
      );
      const blocked = source !== null && mode !== 'off';
      assert.equal(result.ok, !blocked);
      if (!result.ok) assert.equal(result.kind, 'event_not_pushable');
      assert.equal(state.writes, blocked ? 0 : 1);
    }
  }
});

test('takeback is opt-in and does not change poller/simulator shorter-prefix behavior', async () => {
  for (const options of [{ allowCorrection: true }, { ...push(5), allowTakeback: false }]) {
    const { state, client } = database(board, 4);
    const result = await applyXiangqiBroadcastBoardUpdateOn(
      client,
      { ...board, moves: board.moves.slice(0, 1) },
      options,
    );
    assert.equal(result.ok && result.status, 'unchanged');
    assert.equal(state.writes, 0);
  }
});

test('token lookup is hash-only, read-only and returns safe metadata including revocation', async () => {
  const { createHash, randomBytes } = await import('node:crypto');
  const { findXiangqiBroadcastPushTokenOn } = await import(
    './persistence-xiangqi-broadcast-push.js'
  );
  const token = `mbpush_${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(token).digest('hex');
  let calls = 0;
  const client = {
    query: (async (sql: string, args: unknown[]) => {
      calls++;
      assert.equal(sql.trim().startsWith('SELECT'), true);
      assert.equal(sql.includes('token_hash = $1'), true);
      assert.equal(args[0] === hash, true);
      assert.equal(JSON.stringify(args).includes(token), false);
      return {
        rows: [
          {
            id: 'bpt_12345678',
            tour_slug: 'push',
            label: 'clock',
            created_at: new Date(0),
            revoked_at: new Date(1),
            last_used_at: null,
            token_hash: hash,
          },
        ],
      };
    }) as pg.PoolClient['query'],
  };
  const result = await findXiangqiBroadcastPushTokenOn(client, token);
  assert.equal(result?.revokedAt?.getTime(), 1);
  assert.equal(
    JSON.stringify(result).includes(hash) || JSON.stringify(result).includes(token),
    false,
  );
  assert.equal(await findXiangqiBroadcastPushTokenOn(client, 'invalid'), null);
  assert.equal(calls, 1);
});

test('push omissions preserve clock/timeControl; identical clock retries keep the saved receipt time', async () => {
  const clock = { redMs: 1000, blackMs: 2000, at: 100 };
  const saved = { ...board, clock, details: { timeControl: '90+30' } };
  const { state, client } = database(saved, 1);
  await applyXiangqiBroadcastBoardUpdateOn(client, board, push(2));
  assert.deepEqual(state.board.clock, clock);
  assert.equal(state.board.details?.timeControl, '90+30');
  const result = await applyXiangqiBroadcastBoardUpdateOn(
    client,
    { ...saved, clock: { ...clock, at: 200 } },
    push(3),
  );
  assert.equal(result.ok && result.status, 'unchanged');
  assert.equal(state.board.clock?.at, 100);
});

test('sequence accepts increasing finite numbers and rejects non-finite values without writes', async () => {
  const { state, client } = database(board, -1);
  await applyXiangqiBroadcastBoardUpdateOn(
    client,
    { ...board, moves: board.moves.slice(0, 1) },
    push(0.5),
  );
  assert.equal(state.seq, 0.5);
  for (const seq of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = await applyXiangqiBroadcastBoardUpdateOn(client, board, push(seq));
    assert.equal(!result.ok && result.kind, 'invalid_body');
    assert.equal(state.seq, 0.5);
  }
});
