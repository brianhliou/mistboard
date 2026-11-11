import { randomUUID } from 'node:crypto';
import { XIANGQI_SPEC_ID } from '@mistboard/game';
import { createUser } from './persistence-accounts.js';
import { getAdminMetrics } from './persistence-admin-metrics.js';
import { countedPuzzlePlayerRow } from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { getPuzzleStore } from './puzzle-store.js';

// now is a Wednesday; the current week starts Monday 2026-07-20 and the
// 3-week window opens on 2026-07-06.
const NOW = new Date('2026-07-22T12:00:00Z');

async function makeUser(id: string, excluded = false): Promise<void> {
  await createUser({
    id,
    email: `${id}@example.com`,
    emailVerifiedAt: NOW,
    handle: id.replace(/[^a-z0-9]/g, ''),
    displayName: id,
    now: new Date('2026-07-01T09:00:00Z'),
  });
  if (excluded) {
    await getPool().query(`UPDATE users SET stats_excluded_at = now() WHERE id = $1`, [id]);
  }
}

async function xiangqiPuzzleId(): Promise<string> {
  const puzzle = (await getPuzzleStore()).puzzles.find(
    (candidate) => candidate.variant === XIANGQI_SPEC_ID,
  );
  assert.ok(puzzle);
  return puzzle.id;
}

// One puzzle opened. startedAt null is an open with no move: not a player.
async function insertSession(input: {
  puzzleId: string;
  startedAt: string | null;
  userId?: string | null;
  deviceId?: string | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO puzzle_quality_sessions
       (puzzle_id, session_id, variant, viewed_at, started_at, user_id, device_id)
     VALUES ($1, $2::uuid, 'xiangqi', COALESCE($3::timestamptz, $6::timestamptz), $3, $4, $5)`,
    [
      input.puzzleId,
      randomUUID(),
      input.startedAt,
      input.userId ?? null,
      input.deviceId ?? null,
      '2026-07-15T12:00:00Z',
    ],
  );
}

definePersistenceTests('admin metrics puzzles', () => {
  test('puzzle attempts leave out stats-excluded accounts', async () => {
    const puzzleId = await xiangqiPuzzleId();
    await makeUser('user-1');
    await makeUser('user-op', true);
    await getPool().query(
      `INSERT INTO puzzle_attempts (user_id, puzzle_id, variant, solved, created_at) VALUES
         ('user-1', $1, 'xiangqi', true, '2026-07-15T12:00:00Z'),
         ('user-op', $1, 'xiangqi', true, '2026-07-15T12:05:00Z')`,
      [puzzleId],
    );
    const metrics = await getAdminMetrics({ now: NOW, weeks: 3 });
    assert.deepEqual(
      metrics.weekly.map((w) => w.puzzleAttempts),
      [0, 1, 0],
    );
  });

  test('puzzle players are accounts plus guest browsers, exclusions applied', async () => {
    const puzzleId = await xiangqiPuzzleId();
    await makeUser('user-1');
    await makeUser('user-op', true);
    // A browser the excluded account has used: its signed-out puzzles are out.
    await getPool().query(
      `INSERT INTO stats_excluded_devices (device_id, account_id) VALUES ('device-op', 'user-op')`,
    );

    // Week of 07-06: user-1 starts two puzzles (one player), device-a one.
    await insertSession({ puzzleId, startedAt: '2026-07-07T10:00:00Z', userId: 'user-1' });
    await insertSession({ puzzleId, startedAt: '2026-07-07T10:05:00Z', userId: 'user-1' });
    await insertSession({ puzzleId, startedAt: '2026-07-08T10:00:00Z', deviceId: 'device-a' });

    // Week of 07-13: user-1 returns, device-b is new. Left out: the excluded
    // account (signed in on an ordinary browser), the excluded browser, a
    // pre-177 row with no identity, and an open with no move.
    await insertSession({ puzzleId, startedAt: '2026-07-14T10:00:00Z', userId: 'user-1' });
    await insertSession({ puzzleId, startedAt: '2026-07-14T11:00:00Z', deviceId: 'device-b' });
    await insertSession({
      puzzleId,
      startedAt: '2026-07-15T10:00:00Z',
      userId: 'user-op',
      deviceId: 'device-z',
    });
    await insertSession({ puzzleId, startedAt: '2026-07-15T11:00:00Z', deviceId: 'device-op' });
    await insertSession({ puzzleId, startedAt: '2026-07-15T12:00:00Z' });
    await insertSession({ puzzleId, startedAt: null, deviceId: 'device-c' });

    // Week of 07-20: device-a returns after a gap, device-b twice (once), and
    // device-c's first move: new, though it opened a puzzle the week before.
    await insertSession({ puzzleId, startedAt: '2026-07-20T10:00:00Z', deviceId: 'device-a' });
    await insertSession({ puzzleId, startedAt: '2026-07-21T10:00:00Z', deviceId: 'device-b' });
    await insertSession({ puzzleId, startedAt: '2026-07-21T11:00:00Z', deviceId: 'device-b' });
    await insertSession({ puzzleId, startedAt: '2026-07-21T12:00:00Z', deviceId: 'device-c' });
    // After `now`: outside every window.
    await insertSession({ puzzleId, startedAt: '2026-07-23T10:00:00Z', deviceId: 'device-d' });

    // The fixture carries the rows the exclusion must remove: four distinct
    // identities started a puzzle in week 2, so a count of 2 below is the
    // exclusion at work, not an empty fixture.
    const raw = await getPool().query<{ n: number }>(
      `SELECT count(DISTINCT COALESCE(user_id, device_id))::int AS n
       FROM puzzle_quality_sessions
       WHERE started_at >= '2026-07-13' AND started_at < '2026-07-20'`,
    );
    assert.equal(raw.rows[0]?.n, 4);
    // The row filter on its own, without the weekly query's join (which would
    // drop a NULL identity by itself): of week 2's five started rows only
    // user-1's and device-b's pass. The no-identity row fails it here, not by accident.
    const passing = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM puzzle_quality_sessions q
       WHERE q.started_at >= '2026-07-13' AND q.started_at < '2026-07-20'
         AND ${countedPuzzlePlayerRow('q')}`,
    );
    assert.equal(passing.rows[0]?.n, 2);

    const metrics = await getAdminMetrics({ now: NOW, weeks: 3 });
    assert.deepEqual(
      metrics.weekly.map((w) => [w.puzzlePlayers, w.returningPuzzlePlayers]),
      [
        [2, 0],
        [2, 1],
        [3, 2],
      ],
    );
    // The puzzles-started line still counts every started row, identity or not.
    assert.deepEqual(
      metrics.weekly.map((w) => w.puzzleSessions),
      [3, 5, 4],
    );
  });
});
