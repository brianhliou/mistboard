// The achievements ledger: facts derive from existing rows, awards are
// idempotent and keep the earliest date, the live hooks award after commit,
// the backfill script is dry-run by default and a rerun is a no-op, and public
// holder counts leave stats-excluded accounts out while they still earn.

import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  drainAchievementTriggers,
  installAchievementEvaluator,
  onAchievementsAwarded,
} from './achievement-triggers.js';
import {
  addForumPost,
  awardAchievements,
  createForumTopic,
  createUser,
  evaluateAchievements,
  getAchievementCatalog,
  getUserAchievements,
  getUserProfileByHandle,
  type NewAchievementAward,
  recordGameEnd,
} from './persistence.js';
import { recordPuzzleAttempt } from './persistence-puzzle-ratings.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { seedPuzzleRating } from './puzzle-rating.js';
import { tryHandle as tryHandleAchievements } from './routes/achievements.js';

const NOW = new Date('2026-09-01T00:00:00Z');

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, params);
  } finally {
    await client.end();
  }
}

async function ledger(): Promise<Array<{ user: string; id: string; at: string; source: string }>> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{
      user_id: string;
      achievement_id: string;
      awarded_at: Date;
      source_id: string;
    }>(
      `SELECT user_id, achievement_id, awarded_at, source_id FROM user_achievements
       ORDER BY user_id, achievement_id`,
    );
    return rows.map((row) => ({
      user: row.user_id,
      id: row.achievement_id,
      at: row.awarded_at.toISOString(),
      source: row.source_id,
    }));
  } finally {
    await client.end();
  }
}

async function seedUsers(): Promise<void> {
  for (const [id, handle, visibility] of [
    ['u_alice', 'alice', 'public'],
    ['u_bob', 'bob', 'public'],
    ['u_carol', 'carol', 'private'],
    ['u_dev', 'dev', 'public'],
  ] as const) {
    await createUser({
      id,
      email: `${handle}@example.com`,
      emailVerifiedAt: NOW,
      handle,
      displayName: handle,
      profileVisibility: visibility,
      now: NOW,
    });
  }
  // The operator's own account: earns, never counted in public numbers.
  await sql(`UPDATE users SET stats_excluded_at = now() WHERE id = 'u_dev'`);
}

type Seat = { color: string; subjectType: 'user' | 'guest' | 'bot'; subjectId: string };

async function seedGame(
  roomId: string,
  opts: {
    variant?: string;
    mode?: 'pvp' | 'pve' | 'eve';
    status?: 'completed' | 'aborted';
    ply?: number;
    rated?: boolean;
    endedAt: string;
    seats: Array<Seat & { eloAfter?: number }>;
  },
): Promise<void> {
  await sql(
    `INSERT INTO games (room_id, variant, result, termination, ply_count, started_at, ended_at,
       mode, status, visibility, rated)
     VALUES ($1, $2, CASE WHEN $6 = 'aborted' THEN NULL ELSE 'red-wins' END, 'resignation', $3, $4::timestamptz - interval '10 minutes', $4,
       $5, $6, 'public', $7)`,
    [
      roomId,
      opts.variant ?? 'xiangqi',
      opts.ply ?? 30,
      opts.endedAt,
      opts.mode ?? 'pvp',
      opts.status ?? 'completed',
      opts.rated ?? false,
    ],
  );
  for (const seat of opts.seats) {
    await sql(
      `INSERT INTO game_participants
         (game_id, color, subject_type, subject_id, display_name, visibility, elo_after)
       VALUES ($1, $2, $3, $4, $4, 'public', $5)`,
      [roomId, seat.color, seat.subjectType, seat.subjectId, seat.eloAfter ?? null],
    );
  }
}

const user = (id: string, color: string, eloAfter?: number) => ({
  color,
  subjectType: 'user' as const,
  subjectId: id,
  eloAfter,
});
const bot = (color: string): Seat => ({ color, subjectType: 'bot', subjectId: 'bot-1' });

async function seedHistory(): Promise<void> {
  await seedUsers();
  // Never counts: the bot opened and alice left before moving.
  await seedGame('g_short', {
    mode: 'pve',
    ply: 1,
    endedAt: '2026-07-01T10:00:00Z',
    seats: [user('u_alice', 'red'), bot('black')],
  });
  // Never counts: a retired variant.
  await seedGame('g_retired', {
    variant: 'fortress-xiangqi',
    endedAt: '2026-07-15T10:00:00Z',
    seats: [user('u_alice', 'red'), user('u_bob', 'black')],
  });
  // Never counts: aborted.
  await seedGame('g_aborted', {
    status: 'aborted',
    endedAt: '2026-07-20T10:00:00Z',
    seats: [user('u_alice', 'red'), user('u_bob', 'black')],
  });
  await seedGame('g_bot', {
    mode: 'pve',
    endedAt: '2026-08-01T10:00:00Z',
    seats: [user('u_alice', 'red'), bot('black')],
  });
  await seedGame('g_casual', {
    endedAt: '2026-08-02T10:00:00Z',
    seats: [user('u_alice', 'red'), user('u_bob', 'black')],
  });
  // rated=true on the row alone is not enough (old rows default true): the
  // seat's rating must have moved.
  await seedGame('g_rated_flag_only', {
    rated: true,
    endedAt: '2026-08-02T12:00:00Z',
    seats: [user('u_carol', 'red'), user('u_dev', 'black')],
  });
  await seedGame('g_rated', {
    rated: true,
    endedAt: '2026-08-03T10:00:00Z',
    seats: [user('u_alice', 'red', 1530), user('u_bob', 'black', 1470)],
  });
  await sql(
    `INSERT INTO puzzle_attempts (user_id, puzzle_id, variant, solved, rated, created_at) VALUES
       ('u_alice', 'xq-2', 'xiangqi', true, true, '2026-08-05T10:00:00Z'),
       ('u_alice', 'xq-1', 'xiangqi', false, true, '2026-08-04T10:00:00Z'),
       ('u_bob', 'xq-1', 'xiangqi', false, true, '2026-08-04T10:00:00Z'),
       ('u_carol', 'fx-1', 'fortress-xiangqi', true, true, '2026-08-04T10:00:00Z')`,
  );
  // dev opens a thread; bob's only reply is hidden by a moderator.
  const topic = await createForumTopic({
    id: 'topic_a',
    postId: 'post_dev',
    categorySlug: 'general-discussion',
    authorAccountId: 'u_dev',
    authorRole: 'player',
    title: 'Hello',
    slug: 'hello',
    bodyText: 'First post.',
    now: new Date('2026-08-06T10:00:00Z'),
  });
  assert.equal(topic.ok, true);
  const reply = await addForumPost({
    id: 'post_bob',
    topicId: 'topic_a',
    authorAccountId: 'u_bob',
    bodyText: 'Spam.',
    now: new Date('2026-08-07T10:00:00Z'),
  });
  assert.equal(reply.ok, true);
  await sql(`UPDATE forum_posts SET hidden_at = now() WHERE id = 'post_bob'`);
}

const EXPECTED = [
  { user: 'u_alice', id: 'first-game', at: '2026-08-01T10:00:00.000Z', source: 'g_bot' },
  { user: 'u_alice', id: 'first-puzzle', at: '2026-08-05T10:00:00.000Z', source: 'xq-2' },
  { user: 'u_alice', id: 'first-pvp', at: '2026-08-02T10:00:00.000Z', source: 'g_casual' },
  { user: 'u_alice', id: 'first-rated', at: '2026-08-03T10:00:00.000Z', source: 'g_rated' },
  { user: 'u_bob', id: 'first-game', at: '2026-08-02T10:00:00.000Z', source: 'g_casual' },
  { user: 'u_bob', id: 'first-pvp', at: '2026-08-02T10:00:00.000Z', source: 'g_casual' },
  { user: 'u_bob', id: 'first-rated', at: '2026-08-03T10:00:00.000Z', source: 'g_rated' },
  {
    user: 'u_carol',
    id: 'first-game',
    at: '2026-08-02T12:00:00.000Z',
    source: 'g_rated_flag_only',
  },
  { user: 'u_carol', id: 'first-pvp', at: '2026-08-02T12:00:00.000Z', source: 'g_rated_flag_only' },
  { user: 'u_dev', id: 'first-forum-post', at: '2026-08-06T10:00:00.000Z', source: 'post_dev' },
  { user: 'u_dev', id: 'first-game', at: '2026-08-02T12:00:00.000Z', source: 'g_rated_flag_only' },
  { user: 'u_dev', id: 'first-pvp', at: '2026-08-02T12:00:00.000Z', source: 'g_rated_flag_only' },
];

type Captured = { status: number; body: unknown };

async function callRoute(pathname: string): Promise<Captured> {
  const captured: Captured = { status: 0, body: null };
  const response = {
    writeHead(status: number) {
      captured.status = status;
      return this;
    },
    end(chunk?: string) {
      if (chunk) captured.body = JSON.parse(chunk);
    },
  } as unknown as ServerResponse;
  const request = {
    method: 'GET',
    url: pathname,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const handled = await tryHandleAchievements(
    {},
    request,
    response,
    pathname,
    new URL(`http://localhost${pathname}`),
  );
  assert.equal(handled, true, `${pathname} was not handled`);
  return captured;
}

const BACKFILL = fileURLToPath(
  new URL('../../../scripts/backfill-achievements.mjs', import.meta.url),
);

async function runBackfill(...args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(process.execPath, [BACKFILL, ...args], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  return stdout;
}

definePersistenceTests('achievements', () => {
  test('evaluation derives first events from existing rows and a rerun awards nothing', async () => {
    await seedHistory();
    const dry = await evaluateAchievements({ userIds: null, dryRun: true });
    assert.equal(dry.newAwards.length, EXPECTED.length);
    assert.deepEqual(await ledger(), [], 'a dry run writes nothing');

    const wrote = await evaluateAchievements({ userIds: null });
    assert.equal(wrote.newAwards.length, EXPECTED.length);
    assert.deepEqual(await ledger(), EXPECTED);
    assert.equal(wrote.qualified['first-game'], 4);

    const again = await evaluateAchievements({ userIds: null });
    assert.deepEqual(again.newAwards, []);
    assert.equal(again.qualified['first-game'], 4, 'held awards still qualify');
    assert.deepEqual(await ledger(), EXPECTED);
  });

  test('an award is written once and the first date stands', async () => {
    await seedUsers();
    const award = (at: string): NewAchievementAward => ({
      userId: 'u_alice',
      achievementId: 'first-game',
      awardedAt: new Date(at),
      sourceKind: 'game',
      sourceId: at,
    });
    assert.equal((await awardAchievements([award('2026-08-01T00:00:00Z')])).length, 1);
    assert.deepEqual(await awardAchievements([award('2026-07-01T00:00:00Z')]), []);
    assert.deepEqual(await getUserAchievements('u_alice'), [
      { id: 'first-game', awardedAt: new Date('2026-08-01T00:00:00Z') },
    ]);
  });

  test('the live hooks award after commit, and the awarded slot hears each one', async () => {
    await seedUsers();
    const heard: NewAchievementAward[] = [];
    installAchievementEvaluator((input) => evaluateAchievements(input));
    onAchievementsAwarded((awards) => heard.push(...awards));
    try {
      await recordGameEnd('live_rated', {
        variant: 'xiangqi',
        mode: 'pvp',
        result: 'red-wins',
        termination: 'resignation',
        plyCount: 40,
        startedAt: new Date('2026-09-01T10:00:00Z'),
        endedAt: new Date('2026-09-01T10:10:00Z'),
        whiteClient: 'web',
        blackClient: 'web',
        whiteName: 'alice',
        blackName: 'bob',
        corpusId: null,
        rated: true,
        visibility: 'public',
        initialMs: 180_000,
        incrementMs: 2_000,
        participants: [
          {
            color: 'red',
            displayName: 'alice',
            subjectType: 'user',
            subjectId: 'u_alice',
            visibility: 'public',
          },
          {
            color: 'black',
            displayName: 'bob',
            subjectType: 'user',
            subjectId: 'u_bob',
            visibility: 'public',
          },
        ],
      });
      await recordPuzzleAttempt({
        userId: 'u_alice',
        puzzleId: 'xq-live',
        variant: 'xiangqi',
        solved: true,
        rated: true,
        seedRating: seedPuzzleRating(3),
      });
      const topic = await createForumTopic({
        id: 'topic_live',
        postId: 'post_live_1',
        categorySlug: 'general-discussion',
        authorAccountId: 'u_bob',
        authorRole: 'player',
        title: 'Good game',
        slug: 'good-game',
        bodyText: 'Thanks alice.',
        now: new Date('2026-09-01T11:00:00Z'),
      });
      assert.equal(topic.ok, true);
      await addForumPost({
        id: 'post_live_2',
        topicId: 'topic_live',
        authorAccountId: 'u_alice',
        bodyText: 'Thanks bob.',
        now: new Date('2026-09-01T11:05:00Z'),
      });
      await drainAchievementTriggers();
    } finally {
      installAchievementEvaluator(null);
      onAchievementsAwarded(null);
    }
    const ids = (rows: Array<{ user: string; id: string }>) =>
      rows.map((row) => `${row.user}:${row.id}`).sort();
    const expected = [
      'u_alice:first-forum-post',
      'u_alice:first-game',
      'u_alice:first-puzzle',
      'u_alice:first-pvp',
      'u_alice:first-rated',
      'u_bob:first-forum-post',
      'u_bob:first-game',
      'u_bob:first-pvp',
      'u_bob:first-rated',
    ];
    assert.deepEqual(ids(await ledger()), expected);
    assert.deepEqual(
      ids(heard.map((award) => ({ user: award.userId, id: award.achievementId }))),
      expected,
    );
    // The backfill finds nothing the live path missed.
    assert.deepEqual((await evaluateAchievements({ userIds: null })).newAwards, []);
  });

  test('with no evaluator installed, writers award nothing', async () => {
    await seedHistory();
    await drainAchievementTriggers();
    assert.deepEqual(await ledger(), []);
  });

  test('holder counts leave stats-excluded accounts out; they still earn', async () => {
    await seedHistory();
    await evaluateAchievements({ userIds: null });
    const catalog = await getAchievementCatalog();
    const holders = Object.fromEntries(catalog.achievements.map((a) => [a.id, a.holders]));
    assert.deepEqual(holders, {
      'first-game': 3,
      'first-pvp': 3,
      'first-rated': 2,
      'first-puzzle': 1,
      'first-forum-post': 0,
    });
    assert.equal(catalog.accounts, 3);
    assert.equal((await getUserAchievements('u_dev')).length, 3, 'dev earned three');
  });

  test('the API serves the catalog and a profile gate, and never the source', async () => {
    await seedHistory();
    await evaluateAchievements({ userIds: null });

    const catalog = await callRoute('/api/achievements');
    assert.equal(catalog.status, 200);
    assert.equal((catalog.body as { achievements: unknown[] }).achievements.length, 5);

    const alice = await callRoute('/api/users/ALICE/achievements');
    assert.equal(alice.status, 200);
    assert.deepEqual(alice.body, {
      achievements: [
        { id: 'first-game', awardedAt: '2026-08-01T10:00:00.000Z' },
        { id: 'first-pvp', awardedAt: '2026-08-02T10:00:00.000Z' },
        { id: 'first-rated', awardedAt: '2026-08-03T10:00:00.000Z' },
        { id: 'first-puzzle', awardedAt: '2026-08-05T10:00:00.000Z' },
      ],
    });
    assert.equal((await callRoute('/api/users/carol/achievements')).status, 404);
    assert.equal((await callRoute('/api/users/nobody/achievements')).status, 404);
    assert.equal((await callRoute('/api/users/bad%20handle/achievements')).status, 400);

    const profile = await getUserProfileByHandle('alice', null);
    assert.deepEqual(
      profile?.achievements.map((a) => a.id),
      ['first-game', 'first-pvp', 'first-rated', 'first-puzzle'],
    );
    const carolOwn = await getUserProfileByHandle('carol', 'u_carol');
    assert.deepEqual(
      carolOwn?.achievements.map((a) => a.id),
      ['first-game', 'first-pvp'],
    );
  });

  test('the backfill script is a dry run by default and a second write is a no-op', async () => {
    await seedHistory();
    const dry = await runBackfill();
    assert.match(dry, /dry run/);
    assert.match(dry, /total new: 12/);
    assert.deepEqual(await ledger(), []);

    const wrote = await runBackfill('--write');
    assert.match(wrote, /first-game\s+qualified\s+4\s+awarded\s+4/);
    assert.deepEqual(await ledger(), EXPECTED);

    const again = await runBackfill('--write');
    assert.match(again, /total new: 0/);
    assert.deepEqual(await ledger(), EXPECTED);
  });
});
