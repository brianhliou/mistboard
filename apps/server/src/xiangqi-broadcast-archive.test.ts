import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { XIANGQI_BROADCAST_SCHEMA, type XiangqiBroadcastTour } from '@mistboard/game';
import {
  compareArchiveCatalog,
  createArchiveFetcher,
  prepareArchiveEvent,
} from './prepare-xiangqi-broadcast-archives.js';
import {
  type ArchivePairing,
  archiveMovesKey,
  archiveSourceUrl,
  assignArchiveRounds,
  type IqipuArchiveGame,
  iqipuArchiveBoard,
  parseElephantChessCatalog,
  parseElephantChessEvent,
  parseElephantChessMoves,
  parseIqipuCatalog,
  parseIqipuGame,
  parseIqipuGameLinks,
} from './xiangqi-broadcast-archive.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/broadcast-archive/qitian-records.json', import.meta.url),
    'utf8',
  ),
) as {
  games: IqipuArchiveGame[];
  pairings: Array<{
    id: string;
    round: number;
    red: string;
    black: string;
    result: string;
    moves: string[];
  }>;
};
const tour: XiangqiBroadcastTour = {
  schema: XIANGQI_BROADCAST_SCHEMA,
  slug: '2026-us-qitian-cup',
  name: 'Qitian Cup',
};
const primary = (red: string) =>
  iqipuArchiveBoard(fixture.games.find((g) => g.red_name === red)!, tour);
const secondary = (id: string) => {
  const g = fixture.pairings.find((p) => p.id === id)!;
  return {
    id,
    url: `https://elephantchess.io/database/game?id=${id}`,
    round: g.round,
    date: '2026-07-04',
    red: g.red,
    black: g.black,
    result: ({ '2-0': '1-0', '0-2': '0-1', '1-1': '1/2-1/2' } as const)[g.result as '2-0'],
    moves: parseElephantChessMoves(JSON.stringify({ moves: g.moves })),
  };
};
const eventHtml = (pairings: ArchivePairing[]) =>
  '<h1>Qitian Cup</h1>' +
  [...new Set(pairings.map((p) => p.round))]
    .map(
      (n) =>
        `<h2>Round ${n}</h2><span class="round-date">Saturday 4 July 2026</span><table>` +
        pairings
          .filter((p) => p.round === n)
          .map(
            (p) =>
              `<tr data-game-id="${p.id}"><td><a>${p.red}</a></td><td>${p.result === '1-0' ? '2-0' : p.result === '0-1' ? '0-2' : '1-1'}</td><td>${p.black}</td></tr>`,
          )
          .join('') +
        '</table>',
    )
    .join('');

test('archive catalogs retain source counts, deduplicate repeated SEO lists and reject arbitrary source hosts', () => {
  const row = '<a href="https://www.iqipu.com/events/2443">2026 Qitian</a>（24 局）';
  assert.equal(parseIqipuCatalog(row.repeat(2)).length, 1);
  assert.equal(parseIqipuCatalog(row)[0]!.games, 24);
  const ec =
    '<tr><td><a href="/database/event?id=abc">Qitian</a></td><td>4 Jul 2026</td><td>3</td><td>24</td></tr>';
  assert.deepEqual(parseElephantChessCatalog(ec)[0], {
    provider: 'elephantchess',
    url: 'https://elephantchess.io/database/event?id=abc',
    name: 'Qitian',
    date: '4 Jul 2026',
    rounds: 3,
    games: 24,
  });
  for (const url of [
    'http://www.iqipu.com/events/1',
    'https://user:pass@www.iqipu.com/events/1',
    'https://127.0.0.1/events/1',
    'https://elephantchess.io/api/admin',
  ])
    assert.throws(() => archiveSourceUrl(url));
});

test('iqipu parsing reads JSON without evaluating source JavaScript and pins record identity', () => {
  const game = fixture.games[0]!;
  const html = `<script>window.__IQIPU_GAME_BOOT__=${JSON.stringify({ success: true, game })};</script>`;
  assert.equal(parseIqipuGame(html, game.sourceUrl).red_name, game.red_name);
  assert.throws(() => parseIqipuGame(html, 'https://www.iqipu.com/game/games/wrong'), /identity/);
  assert.throws(() => parseIqipuGame('<p>Please log in</p>', game.sourceUrl), /No public/);
  assert.throws(
    () => parseIqipuGame('<script>window.__IQIPU_GAME_BOOT__=(()=>{})()</script>', game.sourceUrl),
    /No public/,
  );
  assert.deepEqual(
    parseIqipuGameLinks(
      `<a href="${game.sourceUrl}">game</a><a href="${game.sourceUrl}">again</a><a href="https://other.test/game/games/evil">other</a>`,
    ),
    [game.sourceUrl],
  );
});

test('equivalent initial piece ordering is accepted, altered positions and illegal moves fail closed', () => {
  const game = fixture.games[0]!;
  assert.equal(iqipuArchiveBoard(game, tour).moves.length, 82);
  assert.throws(
    () => iqipuArchiveBoard({ ...game, binit: `88${game.binit.slice(2)}` }, tour),
    /Non-standard/,
  );
  assert.throws(() => iqipuArchiveBoard({ ...game, movelist: '0000' }, tour), /illegal_movelist/);
});

test('a branched archive retains only the played mainline, not the analysis variations', () => {
  const board = primary('纪嘉庆');
  assert.equal(board.moves.length, 29);
  assert.equal(board.result, '1/2-1/2');
});

test('rounds come from explicit source headings; duplicate game IDs or absent round structure fail', () => {
  const p = secondary('QZ4JEYvtiS2H');
  const parsed = parseElephantChessEvent(eventHtml([p]));
  assert.equal(parsed.pairings[0]!.round, 1);
  assert.equal(parsed.pairings[0]!.date, '2026-07-04');
  assert.throws(() => parseElephantChessEvent('<h1>Event</h1><p>24 games</p>'), /Empty/);
  assert.throws(() => parseElephantChessEvent(eventHtml([p, p])), /duplicate/);
});

test('mirrored move records join exactly without relying on romanized player names', () => {
  const board = primary('任冠百');
  const p = secondary('QZ4JEYvtiS2H');
  assert.notDeepEqual(board.moves, p.moves);
  assert.equal(archiveMovesKey(board.moves), archiveMovesKey(p.moves));
  const pack = assignArchiveRounds({ tour, games: [board], pairings: [p] });
  assert.equal(pack.boards[0]!.roundId, '2026-us-qitian-cup-r01');
  assert.deepEqual(pack.boards[0]!.moves, board.moves);
});

test('result conflicts, ambiguous duplicates and unmatched game records stop preparation', () => {
  const board = primary('任冠百');
  const p = secondary('QZ4JEYvtiS2H');
  assert.throws(
    () => assignArchiveRounds({ tour, games: [board], pairings: [{ ...p, result: '1-0' }] }),
    /Result disagreement/,
  );
  assert.throws(
    () => assignArchiveRounds({ tour, games: [board, board], pairings: [p, p] }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      assignArchiveRounds({
        tour,
        games: [board],
        pairings: [{ ...p, moves: p.moves.slice(0, 10) }],
      }),
    /exact move match/,
  );
});

test('reviewed source discrepancy retains the full legal primary and needs a long matching prefix', () => {
  const board = primary('赵健华');
  const p = secondary('QY1tB5LE1DIi');
  const p1 = secondary('QZ4JEYvtiS2H');
  const b1 = primary('任冠百');
  assert.equal(board.moves.length, 147);
  assert.equal(p.moves.length, 120);
  assert.throws(
    () => assignArchiveRounds({ tour, games: [b1, board], pairings: [p1, p] }),
    /exact move match/,
  );
  const exception = {
    sourceBoardId: board.sourceBoardId,
    pairingId: p.id,
    reason: 'Reviewed: 119 shared plies; secondary truncates and reverses player labels.',
  };
  const pack = assignArchiveRounds({
    tour,
    games: [b1, board],
    pairings: [p1, p],
    exceptions: [exception],
  });
  assert.equal(pack.boards[1]!.moves.length, 147);
  assert.equal(pack.boards[1]!.result, '1-0');
  assert.throws(
    () =>
      assignArchiveRounds({
        tour,
        games: [b1, board],
        pairings: [p1, { ...p, moves: p1.moves }],
        exceptions: [exception],
      }),
    /same game/,
  );
});

test('coverage audit reports count discrepancies for review and does not call unmatched names new events', () => {
  const rows = compareArchiveCatalog(
    [
      { provider: 'iqipu', url: 'https://www.iqipu.com/events/1', name: 'Qualifier', games: 84 },
      {
        provider: 'iqipu',
        url: 'https://www.iqipu.com/events/2',
        name: 'Different translation',
        games: 75,
      },
    ],
    {
      tours: [{ tour: { slug: 'qualifier', name: 'Qualifier' }, recordedBoardCount: 79 }],
    },
  );
  assert.equal(rows[0]!.status, 'possible-gap-review');
  assert.equal(rows[1]!.status, 'unmatched-review');
});

test('batch preparation enforces the reviewed count before requesting records', async () => {
  const pairing = secondary('QZ4JEYvtiS2H');
  const spec = {
    tour,
    expectedGames: 2,
    expectedRounds: 1,
    roundSourceUrl: 'https://elephantchess.io/database/event?id=event',
  };
  await assert.rejects(
    prepareArchiveEvent(spec, async () => eventHtml([pairing])),
    /count differs/,
  );
});

test('a batch event can prepare directly from a round-stated archive without a second source', async () => {
  const pairs = [secondary('QZ4JEYvtiS2H'), secondary('QcoEVYoQFAfY')];
  const result = await prepareArchiveEvent(
    {
      tour,
      expectedGames: 2,
      expectedRounds: 1,
      roundSourceUrl: 'https://elephantchess.io/database/event?id=event',
    },
    async (url) => {
      if (url.includes('/database/event')) return eventHtml(pairs);
      const id = new URL(url).searchParams.get('gameId');
      return JSON.stringify({ moves: fixture.pairings.find((p) => p.id === id)!.moves });
    },
  );
  assert.equal(result.pack.boards.length, 2);
  assert.equal(result.pack.rounds.length, 1);
  assert.equal(result.audit.imported, false);
});

test('source caches refresh old indexes so a repeated audit can discover newly added events', async (t) => {
  const cache = await mkdtemp(join(tmpdir(), 'mistboard-archive-cache-'));
  const url = 'https://www.iqipu.com/events/year/2026';
  const name = `${createHash('sha256').update(url).digest('hex')}.json`;
  await writeFile(
    join(cache, name),
    JSON.stringify({
      url,
      body: 'old index',
      retrievedAt: new Date(Date.now() - 7 * 60 * 60_000).toISOString(),
    }),
  );
  const fetched = t.mock.method(globalThis, 'fetch', async () => new Response('new index'));
  const get = createArchiveFetcher(cache, 0);
  assert.equal(await get(url), 'new index');
  assert.equal(await get(url), 'new index');
  assert.equal(fetched.mock.calls.length, 1);
});
