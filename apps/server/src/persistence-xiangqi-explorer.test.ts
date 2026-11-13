/**
 * Opening-explorer storage, and the gate that decides which games may reach it.
 *
 * The gate is the important half. Mistboard holds xiangqi corpora it is NOT
 * licensed to republish (a scraped test corpus kept for private puzzle mining);
 * publishing aggregate statistics derived from one would republish it in
 * statistical form. These pins fail closed: cleared in, everything else out,
 * including a source whose clearance was simply never recorded.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { XiangqiMove } from '@mistboard/game';
import { seedBroadcastDiscoveryFixture } from './broadcast-discovery-test-support.js';
import {
  insertHistoricalXiangqiGame,
  listAggregatableXiangqiBroadcastGames,
  listAggregatableXiangqiGames,
  lookupXiangqiOpeningMoves,
  readXiangqiOpeningBuild,
  replaceXiangqiOpeningMoves,
  upsertHistoricalXiangqiSource,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { tryHandle as tryHandleExplorerRoute } from './routes/xiangqi-explorer.js';
import { accumulateGame, createAccumulator } from './xiangqi-opening-aggregate.js';

type ResponseCapture = { body: string; status: number | null };

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    setHeader() {
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}

const MOVES: XiangqiMove[] = [
  { from: 'h3', to: 'e3' },
  { from: 'h10', to: 'g8' },
];

definePersistenceTests('xiangqi opening explorer', () => {
  test('unlisted games never enter explorer aggregates or sample links', async () => {
    const { tours, boards } = await seedBroadcastDiscoveryFixture();
    const games = await listAggregatableXiangqiBroadcastGames({ limit: 100 });
    assert.deepEqual(
      games.map((game) => game.id),
      [boards[0]!.id],
    );
    const accumulator = createAccumulator();
    for (const game of games) {
      accumulateGame(accumulator, { ...game, kind: 'broadcast' });
    }
    const serialized = JSON.stringify([...accumulator].map(([key, moves]) => [key, [...moves]]));
    assert.ok(!serialized.includes(tours[1]!.slug));
    assert.deepEqual(
      await listAggregatableXiangqiBroadcastGames({ limit: 100, afterId: boards[0]!.id }),
      [],
    );
  });
  test('aggregation admits cleared sources and refuses every other status', async () => {
    const cleared = await upsertHistoricalXiangqiSource({
      slug: 'explorer-cleared-test',
      name: 'Cleared Corpus',
      sourceType: 'platform-export',
      license: 'GPL-3.0',
      licenseStatus: 'cleared',
    });
    const scraped = await upsertHistoricalXiangqiSource({
      slug: 'explorer-scraped-test',
      name: 'Scraped Corpus',
      sourceType: 'scrape',
      license: 'test-only',
      licenseStatus: 'test-only',
    });
    const unrecorded = await upsertHistoricalXiangqiSource({
      slug: 'explorer-unknown-test',
      name: 'Unrecorded Corpus',
      sourceType: 'fixture',
      licenseStatus: 'unknown',
    });

    for (const [source, sourceGameId] of [
      [cleared, 'cleared-1'],
      [scraped, 'scraped-1'],
      [unrecorded, 'unknown-1'],
    ] as const) {
      await insertHistoricalXiangqiGame({
        sourceId: source.id,
        sourceGameId,
        result: '1-0',
        moveFormat: 'coordinate',
        moves: MOVES,
      });
    }

    const admitted = await listAggregatableXiangqiGames({ limit: 100 });
    const slugs = new Set(admitted.map((game) => game.sourceSlug));
    assert.equal(slugs.has('explorer-cleared-test'), true);
    assert.equal(
      slugs.has('explorer-scraped-test'),
      false,
      'a scraped corpus must never aggregate',
    );
    assert.equal(
      slugs.has('explorer-unknown-test'),
      false,
      'an unrecorded clearance must fail closed, not default to allowed',
    );
  });

  // Broadcast boards are the explorer's second source (#125). They are admitted
  // on a different basis than the corpus: every one of them is already published
  // in full at /broadcast/xiangqi, so an aggregate over them republishes nothing
  // the site does not already serve. What this pins is the one rule that IS
  // enforced — a game still being played must not be folded, because its move
  // list is still growing.
  test('broadcast aggregation takes finished boards only, with their names', async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO xiangqi_broadcast_tours (slug, name, payload)
         VALUES ('explorer-tour', '团体赛', $1)`,
        [{ nameEn: 'Team Championship' }],
      );
      await client.query(
        `INSERT INTO xiangqi_broadcast_rounds (id, tour_slug, name, starts_at, payload)
         VALUES ('explorer-round', 'explorer-tour', '第一轮', '2026-08-02T00:00:00Z', $1)`,
        [{ nameEn: 'Round 1' }],
      );
      const insertBoard = async (id: string, result: string, boardNumber: number) => {
        await client.query(
          `INSERT INTO xiangqi_broadcast_boards
             (id, tour_slug, round_id, source_board_id, board_number, red, black,
              status, result, moves, ply_count, final_status, payload)
           VALUES ($1, 'explorer-tour', 'explorer-round', $1, $2, $3, $4,
                   $5, $6, $7, $8, $9, '{}'::jsonb)`,
          [
            id,
            boardNumber,
            { name: '孟辰', nameEn: 'Meng Chen' },
            { name: '李彦阳', nameEn: 'Li Yanyang' },
            result === '*' ? 'live' : 'complete',
            result,
            JSON.stringify(MOVES),
            MOVES.length,
            { type: 'playing' },
          ],
        );
      };
      await insertBoard('explorer-board-done', '1-0', 1);
      await insertBoard('explorer-board-live', '*', 2);

      const admitted = await listAggregatableXiangqiBroadcastGames({ limit: 100 });
      const ids = admitted.map((game) => game.id);
      assert.equal(ids.includes('explorer-board-done'), true);
      assert.equal(
        ids.includes('explorer-board-live'),
        false,
        'a game still in progress must not be folded: its move list is still growing',
      );

      const game = admitted.find((entry) => entry.id === 'explorer-board-done');
      assert.equal(game?.redName, 'Meng Chen');
      assert.equal(game?.blackName, 'Li Yanyang');
      assert.equal(game?.event, 'Team Championship');
      assert.equal(game?.playedOn, '2026-08-02');

      // Folded through the shared accumulator, the sample keeps the source it
      // came from, so the reader can build the right review link.
      const accumulator = createAccumulator();
      assert.equal(
        accumulateGame(accumulator, {
          id: game?.id ?? '',
          kind: 'broadcast',
          result: game?.result ?? '*',
          moves: game?.moves ?? [],
          redName: game?.redName,
          blackName: game?.blackName,
          event: game?.event,
          playedOn: game?.playedOn,
        }),
        true,
      );
      const samples = [...accumulator.values()]
        .flatMap((moves) => [...moves.values()])
        .flatMap((stats) => stats.sampleGames);
      assert.equal(samples.length > 0, true);
      assert.equal(samples[0]?.kind, 'broadcast');
      assert.equal(samples[0]?.redName, 'Meng Chen');
    } finally {
      await client.end();
    }
  });

  test('a private game drops out of aggregation without touching its source', async () => {
    const source = await upsertHistoricalXiangqiSource({
      slug: 'explorer-visibility-test',
      name: 'Cleared With A Private Game',
      sourceType: 'platform-export',
      license: 'GPL-3.0',
      licenseStatus: 'cleared',
    });
    // Two DIFFERENT games. Row identity is the content digest and not the
    // source labels, so sharing MOVES here would make these one row and the
    // count below would be measuring an upsert rather than the rights gate.
    await insertHistoricalXiangqiGame({
      sourceId: source.id,
      sourceGameId: 'listed-1',
      result: '1-0',
      moveFormat: 'coordinate',
      moves: MOVES,
      visibility: 'unlisted',
    });
    await insertHistoricalXiangqiGame({
      sourceId: source.id,
      sourceGameId: 'hidden-1',
      result: '1-0',
      moveFormat: 'coordinate',
      moves: [MOVES[0]!, { from: 'h10', to: 'i8' }] as XiangqiMove[],
      visibility: 'private',
    });

    const admitted = (await listAggregatableXiangqiGames({ limit: 500 })).filter(
      (game) => game.sourceSlug === 'explorer-visibility-test',
    );
    // Unlisted still aggregates: the corpus is fuel for statistics even when it
    // is deliberately absent from the browsable game list. Only the private
    // game is withheld.
    assert.equal(admitted.length, 1);
  });

  test('pages through the corpus by ascending id without repeating a game', async () => {
    const source = await upsertHistoricalXiangqiSource({
      slug: 'explorer-paging-test',
      name: 'Paging Corpus',
      sourceType: 'platform-export',
      license: 'GPL-3.0',
      licenseStatus: 'cleared',
    });
    // Five DIFFERENT games. Each needs its own move list: row identity is the
    // content digest, so games separated only by sourceGameId collapse into one
    // row and the paging assertion below would run over fewer games than it
    // thinks. The knight's five destinations give five distinct digests.
    const knightTo = ['g8', 'i8', 'g6', 'i6', 'f9'] as const;
    for (let i = 0; i < 5; i += 1) {
      await insertHistoricalXiangqiGame({
        sourceId: source.id,
        sourceGameId: `page-${i}`,
        result: '1-0',
        moveFormat: 'coordinate',
        moves: [MOVES[0]!, { from: 'h10', to: knightTo[i]! }] as XiangqiMove[],
      });
    }

    const seen = new Set<string>();
    let afterId: string | null = null;
    for (;;) {
      const page: Awaited<ReturnType<typeof listAggregatableXiangqiGames>> =
        await listAggregatableXiangqiGames({ limit: 2, afterId });
      if (page.length === 0) break;
      for (const game of page) {
        assert.equal(seen.has(game.id), false, 'a paged game must not repeat');
        seen.add(game.id);
      }
      afterId = page[page.length - 1]?.id ?? null;
    }
    assert.ok(seen.size >= 5);
  });

  // The explorer route merges the per-move sample lists into one position-level
  // "Top games". That merge has to use the SAME ordering the lists were built
  // with. It did not: the accumulator put named games first and the route
  // re-sorted the union by rating, so on the real corpus (10k anonymous games
  // rated ~1000-1250, 14 unrated named professional games) every slot went back
  // to club games and the broadcast games were invisible at every position.
  test('the route orders top games the way the samples were built', async () => {
    const acc = createAccumulator();
    // publiclyListed so it is eligible to be a SAMPLE at all; this test is about
    // the ordering of the merge, not about the rights gate that precedes it.
    accumulateGame(acc, {
      id: 'club-1',
      publiclyListed: true,
      result: '1-0',
      moves: MOVES,
      rating: 1200,
    });
    accumulateGame(acc, {
      id: 'pro-1',
      kind: 'broadcast',
      result: '0-1',
      moves: MOVES,
      redName: 'Meng Chen',
      blackName: 'Li Yanyang',
    });
    await replaceXiangqiOpeningMoves(acc, {
      gameCount: 2,
      positionCount: acc.size,
      maxPly: 24,
      sourceSlugs: ['broadcast', 'explorer-cleared-test'],
    });

    const start = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r';
    const capture = captureResponse();
    await tryHandleExplorerRoute(
      {} as never,
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      capture,
      '/api/xiangqi/explorer',
      new URL(`http://test.local/api/xiangqi/explorer?fen=${encodeURIComponent(start)}`),
    );
    assert.equal(capture.status, 200);
    const body = JSON.parse(capture.body) as {
      topGames: { id: string; kind?: string; redName?: string | null }[];
    };
    assert.deepEqual(
      body.topGames.map((game) => game.id),
      ['pro-1', 'club-1'],
      'the named game leads, as it does inside the per-move sample list',
    );
    assert.equal(body.topGames[0]?.kind, 'broadcast');
    assert.equal(body.topGames[0]?.redName, 'Meng Chen');
  });

  test('a rebuild replaces the previous corpus wholesale', async () => {
    const first = createAccumulator();
    accumulateGame(first, { id: 'g1', result: '1-0', moves: MOVES });
    await replaceXiangqiOpeningMoves(first, {
      gameCount: 1,
      positionCount: first.size,
      maxPly: 24,
      sourceSlugs: ['explorer-cleared-test'],
    });

    const start = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r';
    const afterFirst = await lookupXiangqiOpeningMoves(start);
    assert.equal(afterFirst.length, 1);
    // Stored mirror-canonically: h3e3 is written as its mirror b3e3, which is
    // the same opening. The route un-mirrors for the caller.
    assert.deepEqual(afterFirst[0]?.move, { from: 'b3', to: 'e3' });
    assert.equal(afterFirst[0]?.games, 1);
    assert.equal(afterFirst[0]?.redWins, 1);

    // A second build with a DIFFERENT opening must not leave the first behind:
    // stale rows would inflate every count the explorer reports.
    const second = createAccumulator();
    accumulateGame(second, {
      id: 'g2',
      result: '0-1',
      moves: [{ from: 'b1', to: 'c3' }] as XiangqiMove[],
    });
    await replaceXiangqiOpeningMoves(second, {
      gameCount: 1,
      positionCount: second.size,
      maxPly: 24,
      sourceSlugs: ['explorer-cleared-test'],
    });

    const afterSecond = await lookupXiangqiOpeningMoves(start);
    assert.equal(afterSecond.length, 1);
    assert.deepEqual(afterSecond[0]?.move, { from: 'b1', to: 'c3' });
    assert.equal(afterSecond[0]?.blackWins, 1);

    const build = await readXiangqiOpeningBuild();
    assert.equal(build?.gameCount, 1);
    assert.equal(build?.maxPly, 24);
  });
});
