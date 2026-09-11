import { getPool } from './persistence-db.js';
import {
  generateMistboardReadout,
  latestMistboardReadout,
} from './persistence-mistboard-readout.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

type ParticipantFixture = {
  color: 'white' | 'black';
  subjectType: 'guest' | 'user' | 'engine-version';
  subjectId: string;
};

async function insertGame(input: {
  roomId: string;
  variant: string;
  mode: 'pvp' | 'pve' | 'eve';
  endedAt: string;
  status?: 'completed' | 'aborted';
  participants: ParticipantFixture[];
}): Promise<void> {
  const status = input.status ?? 'completed';
  await getPool().query(
    `INSERT INTO games
       (room_id, variant, mode, status, result, termination, ply_count, started_at, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, 20, $7::timestamptz - interval '10 minutes', $7)`,
    [
      input.roomId,
      input.variant,
      input.mode,
      status,
      // games_status_shape_check: a completed row carries a result, an aborted
      // row carries a termination and no result.
      status === 'completed' ? 'white-wins' : null,
      status === 'completed' ? 'checkmate' : 'engine-failure',
      input.endedAt,
    ],
  );
  for (const participant of input.participants) {
    await getPool().query(
      `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.roomId,
        participant.color,
        participant.subjectType,
        participant.subjectId,
        participant.subjectId,
      ],
    );
  }
}

definePersistenceTests('Mistboard readout', () => {
  test('weekly generation is durable and idempotent', async () => {
    const input = {
      trigger: 'weekly' as const,
      now: new Date('2026-07-20T17:23:00Z'),
      runtime: {
        revision: 'revision-1',
        activeGames: 0,
        databaseRequired: true,
        persistence: 'enabled' as const,
        persistenceErrors: { count1m: 0, lastAt: null },
      },
      db: getPool(),
    };
    const first = await generateMistboardReadout(input);
    const second = await generateMistboardReadout(input);

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.report.snapshotId, first.report.snapshotId);
    assert.equal((await latestMistboardReadout())?.snapshotId, first.report.snapshotId);
    const stored = await getPool().query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ops_readout_snapshots`,
    );
    assert.equal(stored.rows[0]?.count, 1);
  });

  test('product facts count people and periods, not just finished games', async () => {
    // periodStart 2026-07-13, periodEnd 2026-07-20, previous week from 07-06.
    // A counted seat needs a users row behind it (the exclusion flag lives
    // there), so the signed-in player exists as an account, created before the
    // previous period so it does not count as a new account.
    await getPool().query(
      `INSERT INTO users (id, email, handle, display_name, created_at)
       VALUES ('user-1', 'one@example.com', 'one', 'One', '2026-06-01T09:00:00Z')`,
    );
    await insertGame({
      roomId: 'room-current-pvp',
      variant: 'xiangqi',
      mode: 'pvp',
      endedAt: '2026-07-15T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'guest', subjectId: 'guest-1' },
        { color: 'black', subjectType: 'user', subjectId: 'user-1' },
      ],
    });
    await insertGame({
      roomId: 'room-current-pve',
      variant: 'xiangqi',
      mode: 'pve',
      endedAt: '2026-07-16T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'user', subjectId: 'user-1' },
        { color: 'black', subjectType: 'engine-version', subjectId: 'engine-1' },
      ],
    });
    await insertGame({
      roomId: 'room-previous-pvp',
      variant: 'jieqi',
      mode: 'pvp',
      endedAt: '2026-07-10T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'guest', subjectId: 'guest-2' },
        { color: 'black', subjectType: 'user', subjectId: 'user-1' },
      ],
    });
    await insertGame({
      roomId: 'room-current-aborted',
      variant: 'xiangqi',
      mode: 'pvp',
      status: 'aborted',
      endedAt: '2026-07-17T12:00:00Z',
      participants: [{ color: 'white', subjectType: 'guest', subjectId: 'guest-3' }],
    });
    await insertGame({
      roomId: 'room-current-eve',
      variant: 'xiangqi',
      mode: 'eve',
      endedAt: '2026-07-18T12:00:00Z',
      participants: [],
    });
    // An operator account excluded from statistics: neither the account nor
    // its game reaches any product figure.
    await getPool().query(
      `INSERT INTO users (id, email, handle, display_name, created_at, stats_excluded_at)
       VALUES ('user-op', 'op@example.com', 'op', 'Op', '2026-07-14T09:00:00Z', now())`,
    );
    await insertGame({
      roomId: 'room-current-internal',
      variant: 'jieqi',
      mode: 'pvp',
      endedAt: '2026-07-18T13:00:00Z',
      participants: [
        { color: 'white', subjectType: 'user', subjectId: 'user-op' },
        { color: 'black', subjectType: 'guest', subjectId: 'guest-4' },
      ],
    });

    const { report } = await generateMistboardReadout({
      trigger: 'manual',
      now: new Date('2026-07-20T17:23:00Z'),
      dryRun: true,
      runtime: {
        revision: null,
        activeGames: 0,
        databaseRequired: true,
        persistence: 'enabled',
        persistenceErrors: { count1m: 0, lastAt: null },
      },
      db: getPool(),
    });

    const product = report.product;
    assert.ok(product);
    // Bot-vs-bot and aborted rows stay out of the headline count, and out of
    // the player count: neither is a person choosing to play.
    assert.equal(product.completedGames, 2);
    assert.equal(product.previousCompletedGames, 1);
    assert.equal(product.abortedGames, 1);
    // Players are accounts plus guest browsers (a guest seat's subject id is
    // the device id since migration 137): guest-1 and user-1 this week,
    // guest-2 and user-1 the week before. The aborted guest-3 seat and the
    // excluded user-op / guest-4 game count for nobody.
    assert.equal(product.humanPlayers, 2);
    assert.equal(product.previousHumanPlayers, 2);
    assert.equal(product.signedInPlayers, 1);
    // user-1 played in the previous week too; guest-1 is new.
    assert.equal(product.returningPlayers, 1);
    // 28 days back from periodEnd (07-20) covers both weeks.
    assert.equal(product.activeAccounts28d, 3);
    assert.equal(product.previousActiveAccounts28d, 0);
    assert.deepEqual(product.completedGamesByMode, { eve: 1, pve: 1, pvp: 1 });
    assert.deepEqual(product.completedGamesByVariant, [{ variant: 'xiangqi', count: 2 }]);
    assert.equal(product.accountsCreated, 0);
  });

  test('the weekly trend reads prior weekly snapshots and skips daily ones', async () => {
    const runtime = {
      revision: null,
      activeGames: 0,
      databaseRequired: true,
      persistence: 'enabled' as const,
      persistenceErrors: { count1m: 0, lastAt: null },
    };
    await generateMistboardReadout({
      trigger: 'weekly',
      now: new Date('2026-07-13T17:23:00Z'),
      runtime,
      db: getPool(),
    });
    await generateMistboardReadout({
      trigger: 'daily',
      now: new Date('2026-07-19T17:23:00Z'),
      runtime,
      db: getPool(),
    });
    const { report } = await generateMistboardReadout({
      trigger: 'weekly',
      now: new Date('2026-07-20T17:23:00Z'),
      runtime,
      db: getPool(),
    });
    assert.equal(report.trend.length, 1);
    assert.equal(report.trend[0]?.completedGames, 0);
  });

  test('dry run does not store a snapshot', async () => {
    const result = await generateMistboardReadout({
      trigger: 'manual',
      now: new Date('2026-07-22T17:23:00Z'),
      dryRun: true,
      runtime: {
        revision: null,
        activeGames: 0,
        databaseRequired: true,
        persistence: 'enabled',
        persistenceErrors: { count1m: 0, lastAt: null },
      },
      db: getPool(),
    });
    assert.match(result.report.snapshotId, /^readout_dry_/);
    assert.equal(await latestMistboardReadout(), null);
  });
});
