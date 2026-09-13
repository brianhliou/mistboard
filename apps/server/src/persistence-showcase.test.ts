import { gameAggregates, listShowcaseGames, queryGames } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

type SeedGame = {
  roomId: string;
  mode: 'pvp' | 'pve' | 'eve';
  result: string;
  termination: string;
  plyCount: number;
  endedAt: Date;
  visibility?: string;
  variant?: string;
  corpusId?: string | null;
  withEvent?: boolean;
};

async function seed(games: SeedGame[]): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    for (const g of games) {
      const variant = g.variant ?? 'dark-chess';
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_name, black_name, corpus_id, mode, status, visibility)
         VALUES ($1, $2, $3, $4, $5, $6, $6, 'White', 'Black', $7, $8, 'completed', $9)`,
        [
          g.roomId,
          variant,
          g.result,
          g.termination,
          g.plyCount,
          g.endedAt,
          g.corpusId ?? null,
          g.mode,
          g.visibility ?? 'public',
        ],
      );
      if (g.withEvent !== false) {
        await client.query(
          `INSERT INTO events (room_id, seq, type, payload) VALUES ($1, 0, 'room-created', $2)`,
          [g.roomId, { type: 'room-created', at: g.endedAt.getTime(), roomId: g.roomId, variant }],
        );
      }
    }
  } finally {
    await client.end();
  }
}

definePersistenceTests('showcase + browse queries', () => {
  test('listShowcaseGames recency-leads, includes substantial PvP, excludes short games', async () => {
    const t = (min: number) => new Date(Date.UTC(2026, 5, 1, 12, min, 0));
    await seed([
      {
        roomId: 'sc-pvp-kc',
        mode: 'pvp',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 40,
        endedAt: t(10),
      },
      {
        roomId: 'sc-pvp-timeout',
        mode: 'pvp',
        result: 'black-wins',
        termination: 'timeout',
        plyCount: 35,
        endedAt: t(8),
      },
      {
        roomId: 'sc-pvp-short',
        mode: 'pvp',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 12,
        endedAt: t(9),
      },
      {
        roomId: 'sc-pvp-abandon',
        mode: 'pvp',
        result: 'white-wins',
        termination: 'abandonment',
        plyCount: 50,
        endedAt: t(11),
      },
      {
        roomId: 'sc-pvp-abandon-short',
        mode: 'pvp',
        result: 'white-wins',
        termination: 'abandonment',
        plyCount: 8,
        endedAt: t(12),
      },
      {
        roomId: 'sc-eve-x',
        mode: 'eve',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 60,
        endedAt: t(20),
        corpusId: 'run-x',
      },
    ]);

    const ids = (await listShowcaseGames({ limit: 8 })).map((g) => g.roomId);
    // Recency-lead: the most-recent finished HUMAN game leads, so the showcase
    // reflects the site's latest real activity; the tiered interleave then fills.
    // The EvE game at t20 is fresher than all of them and still never appears.
    // A 50-ply walk-away is a game someone played (rule since 2026-09-10): it
    // leads on recency like any other finish past the floor.
    assert.deepEqual(ids.slice(0, 3), ['sc-pvp-abandon', 'sc-pvp-kc', 'sc-pvp-timeout']);
    assert.ok(!ids.includes('sc-eve-x'), 'engine-vs-engine never fronts the homepage');
    // The ply floor is the whole bar: short games fall to it whatever the
    // termination, including an 8-ply abandonment fresher than everything else.
    assert.ok(!ids.includes('sc-pvp-short'));
    assert.ok(!ids.includes('sc-pvp-abandon-short'));
  });

  // Regression (2026-07-30): the recency lead is elected over the full tiered
  // input, not over the interleaved pool. Two variants against limit 2 saturates
  // the breadth interleave, so the site's freshest game (a PvE game, which sorts
  // after PvP inside its variant) is truncated out — it must still lead, or the
  // homepage viewer freezes on a game hours older than the latest activity.
  test('listShowcaseGames leads with the freshest game even when breadth truncates it', async () => {
    const t = (min: number) => new Date(Date.UTC(2026, 5, 1, 15, min, 0));
    await seed([
      {
        roomId: 'sc-trunc-dc-pvp',
        mode: 'pvp',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 40,
        endedAt: t(10),
      },
      {
        roomId: 'sc-trunc-xq-pvp',
        mode: 'pvp',
        result: 'red-wins',
        termination: 'checkmate',
        plyCount: 40,
        endedAt: t(9),
        variant: 'xiangqi',
      },
      {
        roomId: 'sc-trunc-dc-pvp-older',
        mode: 'pvp',
        result: 'black-wins',
        termination: 'timeout',
        plyCount: 40,
        endedAt: t(8),
      },
      {
        roomId: 'sc-trunc-freshest-pve',
        mode: 'pve',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 60,
        endedAt: t(50),
      },
    ]);

    const games = await listShowcaseGames({ limit: 2, variants: ['dark-chess', 'xiangqi'] });
    const ids = games.map((g) => g.roomId);
    assert.equal(ids[0], 'sc-trunc-freshest-pve');
    assert.equal(games.length, 2, 'the injected lead drops the tail, it does not grow the pool');
  });

  // The human floor is 20 plies: a game someone actually sat through is real
  // activity, and the floor alone covers the rage-quits.
  test('listShowcaseGames admits 20+ ply human games and still rejects shorter ones', async () => {
    const t = (min: number) => new Date(Date.UTC(2026, 5, 1, 16, min, 0));
    await seed([
      {
        roomId: 'sc-floor-pvp-24',
        mode: 'pvp',
        result: 'black-wins',
        termination: 'resignation',
        plyCount: 24,
        endedAt: t(2),
      },
      {
        roomId: 'sc-floor-pve-20',
        mode: 'pve',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 20,
        endedAt: t(1),
      },
      {
        roomId: 'sc-floor-pvp-19',
        mode: 'pvp',
        result: 'white-wins',
        termination: 'resignation',
        plyCount: 19,
        endedAt: t(3),
      },
      {
        roomId: 'sc-floor-eve-60',
        mode: 'eve',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 60,
        endedAt: t(4),
        corpusId: 'run-floor',
      },
    ]);

    const ids = (await listShowcaseGames({ limit: 8 })).map((g) => g.roomId);
    assert.ok(ids.includes('sc-floor-pvp-24'), '24-ply PvP resignation is a real game');
    assert.ok(ids.includes('sc-floor-pve-20'), '20 plies is exactly the human floor');
    assert.ok(!ids.includes('sc-floor-pvp-19'), 'one ply under the human floor stays out');
    assert.ok(!ids.includes('sc-floor-eve-60'), 'EvE is excluded on mode, not on ply count');
  });

  // 2026-08-08: EvE is no longer a filler tier. The homepage board is the site's
  // "is anyone here" signal, so a bakeoff dump must never fill it — an empty pool
  // (the board holds its last position) is the honest answer.
  test('listShowcaseGames returns nothing when only EvE games exist', async () => {
    const t = (min: number) => new Date(Date.UTC(2026, 5, 1, 13, min, 0));
    await seed([
      {
        roomId: 'sc-a-old',
        mode: 'eve',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 40,
        endedAt: t(1),
        corpusId: 'run-a',
      },
      {
        roomId: 'sc-a-new',
        mode: 'eve',
        result: 'black-wins',
        termination: 'king-captured',
        plyCount: 50,
        endedAt: t(5),
        corpusId: 'run-a',
      },
      {
        roomId: 'sc-b',
        mode: 'eve',
        result: 'white-wins',
        termination: 'checkmate',
        plyCount: 45,
        endedAt: t(3),
        corpusId: 'run-b',
      },
    ]);

    const games = await listShowcaseGames({ limit: 8 });
    assert.equal(games.length, 0, 'no human game, no showcase pool');
  });

  test('queryGames filters + paginates; gameAggregates computes the win split', async () => {
    const t = (min: number) => new Date(Date.UTC(2026, 5, 1, 14, min, 0));
    await seed([
      {
        roomId: 'q-w1',
        mode: 'eve',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 40,
        endedAt: t(1),
        withEvent: false,
      },
      {
        roomId: 'q-w2',
        mode: 'eve',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 41,
        endedAt: t(2),
        withEvent: false,
      },
      {
        roomId: 'q-b1',
        mode: 'eve',
        result: 'black-wins',
        termination: 'king-captured',
        plyCount: 42,
        endedAt: t(3),
        withEvent: false,
      },
      {
        roomId: 'q-draw',
        mode: 'eve',
        result: 'draw',
        termination: 'draw',
        plyCount: 43,
        endedAt: t(4),
        withEvent: false,
      },
      {
        roomId: 'q-960',
        mode: 'eve',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 44,
        endedAt: t(5),
        variant: 'no-such-variant',
        withEvent: false,
      },
    ]);

    const whiteWins = await queryGames({ result: 'white-wins', variant: 'dark-chess' });
    assert.deepEqual(new Set(whiteWins.games.map((g) => g.roomId)), new Set(['q-w1', 'q-w2']));
    assert.equal(whiteWins.total, 2);

    const page = await queryGames({ variant: 'dark-chess', limit: 2, offset: 0 });
    assert.equal(page.games.length, 2);
    assert.equal(
      page.total,
      4,
      '4 dark-chess; the unknown-variant game is excluded by the variant filter',
    );

    const agg = await gameAggregates({ variant: 'dark-chess' });
    assert.equal(agg.total, 4);
    assert.equal(agg.results.whiteWins, 2);
    assert.equal(agg.results.blackWins, 1);
    assert.equal(agg.results.draws, 1);
  });

  // The public games database asks for a subset of modes and public rows only,
  // and it reports a count. Both have to come out of one WHERE clause: a page
  // narrowed in JS after the query can report a total that describes a wider
  // set than the rows beside it.
  test('queryGames narrows by mode set, visibility, player and event in SQL', async () => {
    const t = (min: number) => new Date(Date.UTC(2026, 6, 2, 9, min, 0));
    await seed([
      {
        roomId: 'f-lab-1',
        mode: 'eve',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 50,
        endedAt: t(1),
        variant: 'xiangqi',
        withEvent: false,
      },
      {
        roomId: 'f-lab-2',
        mode: 'eve',
        result: 'draw',
        termination: 'draw',
        plyCount: 60,
        endedAt: t(2),
        variant: 'xiangqi',
        withEvent: false,
      },
      {
        roomId: 'f-human-1',
        mode: 'pvp',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 70,
        endedAt: t(3),
        variant: 'xiangqi',
        corpusId: 'club-night',
        withEvent: false,
      },
      {
        roomId: 'f-bot-1',
        mode: 'pve',
        result: 'black-wins',
        termination: 'king-captured',
        plyCount: 80,
        endedAt: t(4),
        variant: 'xiangqi',
        withEvent: false,
      },
      {
        roomId: 'f-hidden',
        mode: 'pvp',
        result: 'draw',
        termination: 'draw',
        plyCount: 90,
        endedAt: t(5),
        variant: 'xiangqi',
        visibility: 'private',
        withEvent: false,
      },
    ]);

    const listed = await queryGames({
      variant: 'xiangqi',
      modes: ['pvp', 'pve'],
      visibility: 'public',
    });
    assert.deepEqual(
      new Set(listed.games.map((g) => g.roomId)),
      new Set(['f-human-1', 'f-bot-1']),
      'engine-lab and private rows stay out of the public set',
    );
    assert.equal(listed.total, 2);

    // The count has to survive a limit: it describes the filtered slice, not the
    // page. This is the shape the games-DB listing reports as "N games".
    const firstPage = await queryGames({
      variant: 'xiangqi',
      modes: ['pvp', 'pve'],
      visibility: 'public',
      limit: 1,
    });
    assert.equal(firstPage.games.length, 1);
    assert.equal(firstPage.total, 2, 'total counts the slice, not the rows returned');

    const byPlayer = await queryGames({ variant: 'xiangqi', player: 'whi' });
    assert.ok(
      byPlayer.games.every((g) => g.whiteName === 'White'),
      'player filter matches a seat name substring',
    );
    assert.equal(byPlayer.total, byPlayer.games.length);

    const byEvent = await queryGames({ variant: 'xiangqi', event: 'club' });
    assert.deepEqual(
      byEvent.games.map((g) => g.roomId),
      ['f-human-1'],
    );
    assert.equal(byEvent.total, 1);

    // An empty allowlist means "no modes", never "every mode".
    const none = await queryGames({ variant: 'xiangqi', modes: [] });
    assert.equal(none.total, 0);
    assert.equal(none.games.length, 0);
  });
});
