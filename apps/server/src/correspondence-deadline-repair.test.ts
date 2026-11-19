import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MISSING_DEADLINE_SQL,
  parseRepairArgs,
  redactedError,
  repairCorrespondenceDeadlines,
} from './correspondence-deadline-repair.js';

const candidate = {
  room_id: 'jq_stranded',
  variant: 'jieqi',
  event_count: 4,
  last_seq: 3,
  started_at: new Date(1_000),
  room_created_at: new Date(1_000),
  days_per_move: 3,
  seat_events: 2,
  reserved_seats: 2,
  last_reservation_at: new Date(2_000),
  accepted_path: null,
};
const deadline = { seat: 'red', dueAt: 10_000 };

function fixture(rows = [candidate]) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const reports: Record<string, unknown>[] = [];
  const database = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: sql === MISSING_DEADLINE_SQL ? rows : [], rowCount: 1 };
    },
  };
  return { calls, reports, database: database as never };
}

test('repair defaults to read-only inspection and requires explicit ids for any write', async () => {
  assert.deepEqual(parseRepairArgs([]), { action: 'inspect', roomIds: [] });
  for (const args of [['--abort'], ['--backfill'], ['--room'], ['--abort', '--backfill']])
    assert.throws(() => parseRepairArgs(args));
  const f = fixture();
  await repairCorrespondenceDeadlines(f.database, {
    action: 'inspect',
    roomIds: [],
    inspectRoom: async () => ({ eventCount: 4, deadline }),
    print: (report) => f.reports.push(report),
  });
  assert.equal(f.calls[0]?.sql, 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
  assert.equal(f.calls.at(-1)?.sql, 'COMMIT');
  assert.equal(f.calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql)).length, 0);
  assert.equal(f.reports[0]?.result, 'deadline-can-be-backfilled');
  for (const term of ['token_hash', 'client_id', 'email', 'setup', 'user_id'])
    assert.ok(!JSON.stringify(f.reports).includes(term), `report contains ${term}`);
});

test('backfill uses the replay deadline without resetting its time or naming a guessed first mover', async () => {
  const f = fixture();
  await repairCorrespondenceDeadlines(f.database, {
    action: 'backfill',
    roomIds: [candidate.room_id],
    inspectRoom: async () => ({ eventCount: 4, deadline }),
    print() {},
  });
  const insert = f.calls.find(({ sql }) => sql.startsWith('INSERT INTO room_deadlines'));
  assert.deepEqual(insert?.values, ['jq_stranded', 'jieqi', 'red', new Date(10_000)]);
  assert.match(insert!.sql, /ON CONFLICT \(room_id\) DO NOTHING/);
});

test('abort appends a replayable terminal event and updates the running game in one transaction', async () => {
  const f = fixture();
  await repairCorrespondenceDeadlines(f.database, {
    action: 'abort',
    roomIds: [candidate.room_id],
    now: () => 20_000,
    inspectRoom: async () => ({ eventCount: 4, deadline: null }),
    print: (report) => f.reports.push(report),
  });
  assert.deepEqual(f.calls[2]?.values, [
    'jq_stranded',
    4,
    'game-aborted',
    {
      type: 'game-aborted',
      roomId: 'jq_stranded',
      at: 20_000,
      reason: 'user-abort',
    },
  ]);
  assert.match(f.calls[3]!.sql, /UPDATE games SET status = 'aborted'/);
  assert.equal(f.calls.at(-1)?.sql, 'COMMIT');
  assert.equal(f.reports[0]?.result, 'aborted');
});

test('stale or un-replayable candidates and unseated backfills roll back without reporting success', async () => {
  for (const inspected of [null, { eventCount: 5, deadline }, { eventCount: 4, deadline: null }]) {
    const f = fixture();
    await assert.rejects(
      repairCorrespondenceDeadlines(f.database, {
        action: 'backfill',
        roomIds: [candidate.room_id],
        inspectRoom: async () => inspected,
        print: (report) => f.reports.push(report),
      }),
    );
    assert.equal(f.calls.at(-1)?.sql, 'ROLLBACK');
    assert.deepEqual(f.reports, []);
  }
  const f = fixture([]);
  await assert.rejects(
    repairCorrespondenceDeadlines(f.database, {
      action: 'abort',
      roomIds: [candidate.room_id],
      inspectRoom: async () => null,
      print() {},
    }),
    /no longer/,
  );
  assert.equal(f.calls.at(-1)?.sql, 'ROLLBACK');
});

test('a read-only scan reports a room it cannot replay and keeps scanning', async () => {
  // Prod 2026-11-18: the first candidate was a dark chess room whose registration
  // lacked the deadline hook, and the scan aborted before reporting any room.
  const second = { ...candidate, room_id: 'jq_second' };
  const f = fixture([candidate, second]);
  await repairCorrespondenceDeadlines(f.database, {
    action: 'inspect',
    roomIds: [],
    inspectRoom: async (roomId) => (roomId === second.room_id ? { eventCount: 4, deadline } : null),
    print: (report) => f.reports.push(report),
  });
  assert.deepEqual(
    f.reports.map((report) => [report.roomId, report.result, report.deadline]),
    [
      [candidate.room_id, 'cannot-replay', null],
      [second.room_id, 'deadline-can-be-backfilled', { seat: 'red', dueAt: new Date(10_000) }],
    ],
  );
  assert.equal(f.calls.at(-1)?.sql, 'COMMIT');
  assert.ok(!f.calls.some((call) => /INSERT|UPDATE/.test(call.sql)));
});

test('the operator error drops any connection URL from the message', () => {
  const line = redactedError(
    new Error('connect failed for postgresql://user:planted-secret@db.internal:5432/railway'),
  );
  assert.ok(!line.includes('planted-secret'), line);
  assert.ok(!line.includes('db.internal'), line);
  assert.equal(line, 'Error: connect failed for <url>');
  assert.equal(redactedError('plain'), 'Error: plain');
});

test('candidate query excludes moves and terminal events rather than trusting games.ply_count', () => {
  for (const fragment of [
    "g.status = 'running'",
    "g.mode = 'pvp'",
    'daysPerMove',
    'room_deadlines',
    "'move-played'",
    "'game-aborted'",
    "'clock-expired'",
    "'draw-agreed'",
  ])
    assert.ok(MISSING_DEADLINE_SQL.includes(fragment), fragment);
});
