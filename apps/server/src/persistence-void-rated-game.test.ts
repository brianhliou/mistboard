// scripts/void-rated-game.mjs against a real Postgres: a rated Xiangqi Mahjong
// match (east/west seats, the 2026-10-26 case) is recorded through the real
// rating write, then voided by spawning the script the way prod:db runs it.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUser, recordGameEnd } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/void-rated-game.mjs',
);

function runVoid(...args: string[]): { status: number | null; out: string } {
  const child = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  return { status: child.status, out: `${child.stdout}${child.stderr}` };
}

async function seedPlayers(): Promise<void> {
  const now = new Date();
  for (const id of ['user_void_east', 'user_void_west']) {
    await createUser({
      id,
      email: `${id}@example.com`,
      emailVerifiedAt: now,
      handle: id.replace(/_/g, ''),
      displayName: id,
      now,
    });
  }
}

async function recordXmj(roomId: string, endedAt: Date, winner: 'east' | 'west'): Promise<void> {
  await recordGameEnd(roomId, {
    variant: 'xiangqi-mahjong',
    mode: 'pvp',
    rated: true,
    result: `${winner}-wins`,
    termination: 'resignation',
    plyCount: 40,
    startedAt: new Date(endedAt.getTime() - 600_000),
    endedAt,
    initialMs: 300_000, // 5+5: the rapid pool
    incrementMs: 5_000,
    whiteClient: 'browser',
    blackClient: 'browser',
    whiteName: 'East',
    blackName: 'West',
    corpusId: null,
    participants: [
      {
        color: 'east',
        displayName: 'East',
        subjectType: 'user',
        subjectId: 'user_void_east',
        visibility: 'public',
      },
      {
        color: 'west',
        displayName: 'West',
        subjectType: 'user',
        subjectId: 'user_void_west',
        visibility: 'public',
      },
    ],
    visibility: 'public',
  } as Parameters<typeof recordGameEnd>[1]);
}

type RatingRow = { user_id: string; elo_rating: number; games_played: number };

async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const ratings = (): Promise<RatingRow[]> =>
  withClient(async (client) => {
    const { rows } = await client.query<RatingRow>(
      `SELECT user_id, elo_rating, games_played FROM user_ratings
       WHERE variant = 'xiangqi_mahjong' AND time_class = 'rapid' ORDER BY user_id`,
    );
    return rows;
  });

const gameState = (
  roomId: string,
): Promise<{
  rated: boolean;
  elo: Array<{ elo_before: number | null; elo_after: number | null }>;
}> =>
  withClient(async (client) => {
    const game = await client.query<{ rated: boolean }>(
      'SELECT rated FROM games WHERE room_id = $1',
      [roomId],
    );
    const seats = await client.query<{ elo_before: number | null; elo_after: number | null }>(
      'SELECT elo_before, elo_after FROM game_participants WHERE game_id = $1 ORDER BY color',
      [roomId],
    );
    return { rated: game.rows[0]!.rated, elo: seats.rows };
  });

definePersistenceTests('void rated game script', () => {
  test('voids a first rated game: both players back on the default, game unrated, idempotent', async () => {
    await seedPlayers();
    await recordXmj('xmj_void_only', new Date('2026-10-26T10:00:00Z'), 'east');
    const before = await ratings();
    assert.equal(before.length, 2, 'both seats rated');
    assert.ok(before.find((r) => r.user_id === 'user_void_east')!.elo_rating > 1500);

    const dry = runVoid('xmj_void_only');
    assert.equal(dry.status, 0, dry.out);
    assert.match(dry.out, /"bucket":\{"variant":"xiangqi_mahjong","timeClass":"rapid"\}/);
    assert.match(dry.out, /Nothing changed/);
    assert.deepEqual(await ratings(), before, 'a dry run changes nothing');

    const run = runVoid('xmj_void_only', '--yes');
    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /Voided xmj_void_only/);
    assert.deepEqual(await ratings(), [], 'both rows gone: back to the 1500 default');
    const game = await gameState('xmj_void_only');
    assert.equal(game.rated, false);
    assert.ok(game.elo.every((s) => s.elo_before === null && s.elo_after === null));

    const again = runVoid('xmj_void_only', '--yes');
    assert.equal(again.status, 0, again.out);
    assert.match(again.out, /Already void/);
  });

  test('voids the latest of two rated games: each player back on the first game’s rating', async () => {
    await seedPlayers();
    await recordXmj('xmj_void_first', new Date('2026-10-25T10:00:00Z'), 'west');
    const afterFirst = await ratings();
    await recordXmj('xmj_void_second', new Date('2026-10-26T10:00:00Z'), 'east');

    const run = runVoid('xmj_void_second', '--yes');
    assert.equal(run.status, 0, run.out);
    assert.deepEqual(await ratings(), afterFirst, 'exact pre-game rating and count');
    assert.equal((await gameState('xmj_void_second')).rated, false);
    assert.equal((await gameState('xmj_void_first')).rated, true, 'the other game is untouched');
  });

  test('refuses a game with a later rated game in the bucket unless --allow-later', async () => {
    await seedPlayers();
    await recordXmj('xmj_void_early', new Date('2026-10-25T10:00:00Z'), 'east');
    const early = await gameState('xmj_void_early');
    await recordXmj('xmj_void_late', new Date('2026-10-26T10:00:00Z'), 'west');
    const current = await ratings();

    const refused = runVoid('xmj_void_early', '--yes');
    assert.equal(refused.status, 2, refused.out);
    assert.match(refused.out, /later rated game\(s\) in this bucket \(xmj_void_late\)/);
    assert.match(refused.out, /Nothing changed/);
    assert.deepEqual(await ratings(), current, 'a refusal changes nothing');
    assert.equal((await gameState('xmj_void_early')).rated, true);

    const shifted = runVoid('xmj_void_early', '--yes', '--allow-later');
    assert.equal(shifted.status, 0, shifted.out);
    assert.match(shifted.out, /approximate/);
    const after = await ratings();
    // east is the first seat by color order, west the second.
    const swing = early.elo.map((s) => s.elo_after! - s.elo_before!);
    const byUser = (rows: RatingRow[], id: string) => rows.find((r) => r.user_id === id)!;
    assert.equal(
      byUser(after, 'user_void_east').elo_rating,
      byUser(current, 'user_void_east').elo_rating - swing[0]!,
    );
    assert.equal(
      byUser(after, 'user_void_west').elo_rating,
      byUser(current, 'user_void_west').elo_rating - swing[1]!,
    );
    assert.equal(byUser(after, 'user_void_east').games_played, 1);
    assert.equal((await gameState('xmj_void_early')).rated, false);
  });
});
