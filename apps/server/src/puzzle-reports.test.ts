import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test, { beforeEach } from 'node:test';
import {
  attemptStandardXiangqiPuzzleLine,
  puzzleShortCode,
  type XiangqiPuzzle,
} from '@mistboard/game';
import { loadSeedPuzzleRegistry } from '@mistboard/game/puzzle-seed';
import { close, getPool, init } from './persistence-db.js';
import {
  PUZZLE_REPORT_WITHHOLD_THRESHOLD,
  recordPuzzleReport,
  resetPuzzleStoreForTests,
  reviewPuzzleReports,
} from './puzzle-store.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle } from './routes/puzzles.js';

const puzzle = loadSeedPuzzleRegistry('xiangqi')[0]! as XiangqiPuzzle;

beforeEach(resetPuzzleStoreForTests);

async function route(path: string, method = 'GET', body?: unknown) {
  let status = 0;
  let payload = '';
  let headers: Record<string, string> = {};
  const request = {
    method,
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body ?? {}));
    },
  } as unknown as IncomingMessage;
  const response = {
    writeHead(code: number, values: Record<string, string> = {}) {
      status = code;
      headers = values;
      return this;
    },
    end(value = '') {
      payload = value;
      return this;
    },
  } as unknown as ServerResponse;
  const url = new URL(path, 'http://localhost');
  const handled = await tryHandle({} as HttpApiContext, request, response, url.pathname, url);
  return { handled, status, headers, payload };
}

test('puzzle report stores the position and move with the guest identity', async () => {
  const move = puzzle.solution[0]!;
  const response = await route(`/api/puzzles/${puzzle.id}/report`, 'POST', {
    reason: 'second-winning-move',
    deviceId: 'guest-report-evidence',
    userId: 'spoofed-account',
    moves: [move],
  });
  assert.equal(response.handled, true);
  assert.equal(response.status, 201);
  const queue = await route('/api/puzzles/reports');
  const { reports } = JSON.parse(queue.payload);
  const report = reports.find(
    (item: { deviceId: string }) => item.deviceId === 'guest-report-evidence',
  );
  assert.ok(report);
  assert.equal(report.reason, 'second-winning-move');
  assert.equal(report.userId, null);
  assert.deepEqual(report.evidence.initial, puzzle.initial);
  assert.deepEqual(report.evidence.movePlayed, move);
  assert.deepEqual(report.evidence.moves, [move]);
  assert.deepEqual(
    report.evidence.position,
    attemptStandardXiangqiPuzzleLine(puzzle, [move]).state,
  );
  assert.deepEqual(JSON.parse(response.payload), { reported: true });
  assert.equal(queue.headers['cache-control'], 'private, no-store');
});

test('distinct-report threshold withholds list, detail, short codes, daily and ramps until review', async () => {
  assert.equal(PUZZLE_REPORT_WITHHOLD_THRESHOLD, 3);
  const puzzle = JSON.parse((await route('/api/puzzles/daily')).payload).puzzle as { id: string };
  const path = `/api/puzzles/${puzzle.id}/report`;
  const report = (id: number) =>
    route(path, 'POST', {
      reason: 'wrong-theme',
      deviceId: `guest-threshold-${id}`,
      moves: [],
    });
  for (let i = 1; i < PUZZLE_REPORT_WITHHOLD_THRESHOLD; i++) {
    assert.equal((await report(i)).status, 201);
  }
  assert.equal((await report(1)).status, 201);
  assert.equal((await route(`/api/puzzles/${puzzle.id}`)).status, 200);
  assert.equal((await report(PUZZLE_REPORT_WITHHOLD_THRESHOLD)).status, 201);
  assert.equal((await route(`/api/puzzles/${puzzle.id}`)).status, 404);
  assert.equal((await route(`/api/puzzles/${puzzleShortCode(puzzle.id)}`)).status, 404);
  assert.notEqual(JSON.parse((await route('/api/puzzles/daily')).payload).puzzle.id, puzzle.id);
  for (const url of ['/api/puzzles', '/api/puzzles/ramp']) {
    const response = await route(url);
    assert.equal(
      JSON.parse(response.payload).puzzles.some((p: { id: string }) => p.id === puzzle.id),
      false,
    );
  }
  const reviewed = await route('/api/puzzles/reports', 'POST', {
    puzzleId: puzzle.id,
    decision: 'dismiss',
  });
  assert.equal(reviewed.status, 200);
  assert.equal((await route(`/api/puzzles/${puzzle.id}`)).status, 200);
  assert.deepEqual(JSON.parse((await route('/api/puzzles/reports')).payload), { reports: [] });
  // A reviewed reporter cannot vote again to put the puzzle back on hold.
  await report(1);
  assert.deepEqual(JSON.parse((await route('/api/puzzles/reports')).payload), { reports: [] });
});

test('admin HTML escapes saved evidence and retirement keeps a reviewed puzzle withheld', async () => {
  const move = { from: '</pre><script>alert(1)</script>', to: 'a1' };
  await recordPuzzleReport({
    puzzleId: puzzle.id,
    userId: null,
    deviceId: 'guest-html-safety',
    reason: 'other',
    evidence: {
      initial: puzzle.initial,
      position: puzzle.initial,
      moves: [move],
      movePlayed: move,
      solution: puzzle.solution,
    },
  });
  const page = await route('/api/puzzles/reports?format=html');
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.ok(page.payload.includes('&#60;/pre&#62;&#60;script&#62;'));
  assert.ok(!page.payload.includes(move.from));
  const retired = await route('/api/puzzles/reports', 'POST', {
    puzzleId: puzzle.id,
    decision: 'retire',
  });
  assert.equal(retired.status, 200);
  assert.equal((await route(`/api/puzzles/${puzzle.id}`)).status, 404);
  assert.deepEqual(JSON.parse((await route('/api/puzzles/reports')).payload), { reports: [] });
  await route('/api/puzzles/reports', 'POST', { puzzleId: puzzle.id, decision: 'dismiss' });
  assert.equal((await route(`/api/puzzles/${puzzle.id}`)).status, 404);
});

test('reports validate identity, category and moves and admin reads are gated', async (t) => {
  const path = `/api/puzzles/${puzzle.id}/report`;
  for (const body of [
    { reason: 'wrong-theme', moves: [], userId: 'spoofed' },
    { reason: 'arbitrary', moves: [], deviceId: 'guest-validation' },
    { reason: 'other', moves: [{}], deviceId: 'guest-validation' },
  ])
    assert.equal((await route(path, 'POST', body)).status, 400);
  assert.equal((await route(path)).status, 405);
  assert.equal((await route('/api/puzzles/missing/report', 'POST')).status, 404);
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  });
  for (const method of ['GET', 'POST']) {
    const denied = await route('/api/puzzles/reports', method, {
      puzzleId: puzzle.id,
      decision: 'dismiss',
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(JSON.parse(denied.payload), { error: 'admin_required' });
  }
});

test('durable reports serialize threshold counting and preserve evidence; review preserves other holds', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never');
  t.after(close);
  const statements: { sql: string; values: unknown[] }[] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      statements.push({ sql, values });
      return { rows: [{ id: puzzle.id }], rowCount: 1 };
    },
    release() {},
  };
  t.mock.method(getPool(), 'connect', async () => client);
  const evidence = {
    initial: puzzle.initial,
    position: puzzle.initial,
    moves: [],
    movePlayed: null,
    solution: puzzle.solution,
  };
  await recordPuzzleReport({
    puzzleId: puzzle.id,
    userId: 'account-alice',
    deviceId: null,
    reason: 'other',
    evidence,
  });
  assert.equal(statements[0]!.sql, 'BEGIN');
  assert.match(statements[1]!.sql, /FOR UPDATE/);
  assert.match(statements[2]!.sql, /ON CONFLICT \(puzzle_id, reporter\) DO NOTHING/);
  assert.deepEqual(statements[2]!.values, [
    puzzle.id,
    'account:account-alice',
    'account-alice',
    null,
    'other',
    JSON.stringify(evidence),
  ]);
  assert.match(statements[3]!.sql, /hidden_reason IS NULL/);
  assert.match(statements[3]!.sql, /reviewed_at IS NULL/);
  assert.equal(statements[3]!.values[2], PUZZLE_REPORT_WITHHOLD_THRESHOLD);
  assert.equal(statements[4]!.sql, 'COMMIT');
  statements.length = 0;
  await reviewPuzzleReports(puzzle.id, 'dismiss', 'admin-bob');
  assert.match(statements[1]!.sql, /FOR UPDATE/);
  assert.deepEqual(statements[2]!.values, [puzzle.id, 'admin-bob', 'dismiss']);
  assert.match(statements[3]!.sql, /hidden_reason IS NULL OR hidden_reason = \$3/);
  assert.deepEqual(statements[3]!.values, [puzzle.id, null, 'puzzle-reports']);
});
