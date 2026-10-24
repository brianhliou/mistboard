import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { rankBlunders } from './offline-blunder-ranker.js';

const fixtureUrl = new URL('../../../scripts/data/offline-blunders.json', import.meta.url);
type TestEvaluation = {
  ply: number;
  cp: number | null;
  mate: number | null;
  best?: string | null;
  unstable?: boolean;
};
type TestGame = {
  gameId: string;
  engineId: string;
  firstMover: 'red' | 'black';
  moves: string[];
  plies: TestEvaluation[];
  chancePlies?: number[];
};
const fixture = (): { version: number; scorePov: string; games: TestGame[] } =>
  JSON.parse(readFileSync(fixtureUrl, 'utf8'));
const cp = (ply: number, value: number | null): TestEvaluation => ({ ply, cp: value, mate: null });
const game = (overrides: Partial<TestGame> = {}): TestGame => ({
  gameId: 'test',
  engineId: 'pikafish-xiangqi-analysis@5',
  firstMover: 'red',
  moves: ['a0a1'],
  plies: [cp(0, 200), cp(1, -200)],
  ...overrides,
});
const input = (...games: TestGame[]) => ({ version: 1, scorePov: 'red', games });

test('offline ranker orders Red and Black blunders by mover win-chance loss, not raw cp', () => {
  const result = rankBlunders(fixture());
  assert.deepEqual(
    result.blunders.map(({ gameId, ply, mover }) => ({ gameId, ply, mover })),
    [
      { gameId: 'black-blunder', ply: 2, mover: 'black' },
      { gameId: 'red-blunder', ply: 1, mover: 'red' },
    ],
  );
  assert.equal(result.totalBlunders, 2);
  const [black, red] = result.blunders;
  assert.ok(black.winLoss > 35 && black.winLoss < 36);
  assert.ok(red.winLoss > 26 && red.winLoss < 27);
  assert.equal(black.bestMove, 'b9c7');
  assert.equal(black.move, 'h7e7');
  assert.equal(black.engineId, 'pikafish-xiangqi-analysis@5');
  assert.ok(black.winBefore > 67 && black.winAfter < 33);
});

test('Black can be the first mover, and improvements are not blunders', () => {
  assert.equal(rankBlunders(input(game({ firstMover: 'black' }))).totalBlunders, 0);
  const result = rankBlunders(
    input(game({ firstMover: 'black', plies: [cp(0, -200), cp(1, 200)] })),
  );
  assert.equal(result.blunders[0].mover, 'black');
  assert.equal(result.blunders[0].ply, 1);
});

test('only blunders qualify; inaccuracies, mistakes and unchanged scores are omitted', () => {
  for (const after of [-100, -150, 0, 100]) {
    assert.equal(rankBlunders(input(game({ plies: [cp(0, 0), cp(1, after)] }))).totalBlunders, 0);
  }
  assert.equal(rankBlunders(input(game({ plies: [cp(0, 0), cp(1, -200)] }))).totalBlunders, 1);
});

test('uses the stored engine curve rather than comparing raw cp across engines', () => {
  const plies = [cp(0, 100), cp(1, 0)];
  const result = rankBlunders(
    input(game({ gameId: 'pika', plies }), game({ gameId: 'ab', engineId: 'ab-jchess@1', plies })),
  );
  assert.deepEqual(
    result.blunders.map((row) => row.gameId),
    ['ab'],
  );
  assert.ok(result.blunders[0].winLoss > 22 && result.blunders[0].winLoss < 23);
});

test('handles signed mates and mate zero without treating null cp as equality', () => {
  for (const firstMover of ['red', 'black'] as const) {
    const sign = firstMover === 'red' ? 1 : -1;
    const result = rankBlunders(
      input(
        game({
          firstMover,
          plies: [
            { ply: 0, cp: null, mate: 3 * sign },
            { ply: 1, cp: null, mate: -sign },
          ],
        }),
      ),
    );
    assert.ok(result.blunders[0].winLoss > 99);
    assert.equal(result.blunders[0].mover, firstMover);
  }
  assert.equal(
    rankBlunders(
      input(
        game({
          plies: [cp(0, 0), { ply: 1, cp: null, mate: 0 }],
        }),
      ),
    ).totalBlunders,
    1,
  );
});

test('never bridges gaps or defaults null evaluations to 50 percent', () => {
  for (const plies of [[], [cp(0, 200), cp(2, -200)], [cp(0, null), cp(1, -200), cp(2, null)]]) {
    const result = rankBlunders(input(game({ moves: ['a0a1', 'a9a8'], plies })));
    assert.equal(result.totalBlunders, 0);
    assert.deepEqual(result.skipped, [
      { gameId: 'test', ply: 1, reason: 'missing-evaluation' },
      { gameId: 'test', ply: 2, reason: 'missing-evaluation' },
    ]);
  }
});

test('unstable evaluations taint both moves touching the position', () => {
  const result = rankBlunders(
    input(
      game({
        moves: ['a0a1', 'a9a8'],
        plies: [cp(0, 200), { ...cp(1, -200), unstable: true }, cp(2, 200)],
      }),
    ),
  );
  assert.equal(result.totalBlunders, 0);
  assert.deepEqual(result.skipped, [
    { gameId: 'test', ply: 1, reason: 'unstable-evaluation' },
    { gameId: 'test', ply: 2, reason: 'unstable-evaluation' },
  ]);
});

test('chance moves and engine best moves are not blamed for realized eval drops', () => {
  const result = rankBlunders(
    input(
      game({ gameId: 'chance', chancePlies: [1] }),
      game({ gameId: 'best', plies: [{ ...cp(0, 200), best: 'a0a1' }, cp(1, -200)] }),
    ),
  );
  assert.equal(result.totalBlunders, 0);
  assert.deepEqual(result.skipped, [
    { gameId: 'best', ply: 1, reason: 'best-played' },
    { gameId: 'chance', ply: 1, reason: 'chance-move' },
  ]);
});

test('sorts full precision before limiting, with deterministic game-id and ply tie breaks', () => {
  const a = game({
    gameId: 'a',
    moves: ['a0a1', 'a9a8', 'b0c2'],
    plies: [cp(0, 200), cp(1, -200), cp(2, 200), cp(3, -200)],
  });
  const z = game({ gameId: 'z' });
  const expected = rankBlunders(input(a, z));
  assert.deepEqual(
    expected.blunders.map(({ gameId, ply }) => [gameId, ply]),
    [
      ['a', 1],
      ['a', 2],
      ['a', 3],
      ['z', 1],
    ],
  );
  const reversed = structuredClone(input(z, a));
  for (const g of reversed.games) g.plies.reverse();
  assert.deepEqual(rankBlunders(reversed), expected);
  const limited = rankBlunders(input(z, a), 1);
  assert.equal(limited.totalBlunders, 4);
  assert.deepEqual(limited.blunders, expected.blunders.slice(0, 1));
  const slightlyWorse = game({ gameId: 'z', plies: [cp(0, 200), cp(1, -200.001)] });
  assert.equal(rankBlunders(input(a, slightlyWorse), 1).blunders[0].gameId, 'z');
});

test('does not mutate the fixture or copy arbitrary payload fields into the report', () => {
  const source = { ...input(game()), privateState: 'do-not-copy' };
  const original = structuredClone(source);
  const result = rankBlunders(source);
  assert.deepEqual(source, original);
  assert.equal(JSON.stringify(result).includes('do-not-copy'), false);
  assert.deepEqual(rankBlunders(input()), { totalBlunders: 0, blunders: [], skipped: [] });
});

test('rejects malformed fixtures instead of emitting a partial or misleading ranking', () => {
  const cases: [unknown, RegExp][] = [
    [null, /fixture must be an object/],
    [{ ...input(), version: 2 }, /version must be 1/],
    [{ ...input(), scorePov: 'side-to-move' }, /scorePov must be red/],
    [{ ...input(), games: null }, /games must be an array/],
    [input(game(), game()), /duplicate gameId/],
    [input(game({ gameId: ' ' })), /gameId/],
    [input(game({ engineId: '' })), /engineId/],
    [input(game({ firstMover: 'white' as 'red' })), /firstMover/],
    [input(game({ moves: [''] })), /moves\[0\]/],
    [input(game({ plies: [cp(0, 1), cp(0, 2)] })), /duplicate ply/],
    [input(game({ plies: [cp(-1, 0)] })), /integer in 0\.\.1/],
    [input(game({ plies: [cp(2, 0)] })), /integer in 0\.\.1/],
    [input(game({ plies: [cp(0.5, 0)] })), /integer in 0\.\.1/],
    [input(game({ plies: [cp(0, Number.NaN)] })), /cp must be finite/],
    [input(game({ plies: [cp(0, Infinity)] })), /cp must be finite/],
    [input(game({ plies: [{ ply: 0, cp: null, mate: 1.5 }] })), /mate must be an integer/],
    [input(game({ plies: [{ ply: 0, cp: 1, mate: 1 }] })), /cp and mate are both set/],
    [input(game({ plies: [{ ...cp(0, 0), unstable: 'true' as unknown as boolean }] })), /unstable/],
    [input(game({ chancePlies: [0] })), /chancePlies/],
    [input(game({ chancePlies: [2] })), /chancePlies/],
    [input(game({ plies: [{ ...cp(0, 0), best: '' }] })), /best/],
  ];
  for (const [value, error] of cases) assert.throws(() => rankBlunders(value), error);
  for (const limit of [0, -1, 1.5, Infinity, Number.NaN]) {
    assert.throws(() => rankBlunders(input(), limit), /limit must be a positive integer/);
  }
});

const command = (args: string[]) =>
  spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('../../../scripts/rank-blunders.mjs', import.meta.url)),
      ...args,
    ],
    { encoding: 'utf8' },
  );

test('offline command reads the committed JSON fixture and emits the ranked report', () => {
  const result = command([fileURLToPath(fixtureUrl), '--limit', '1']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, 1);
  assert.equal(report.totalBlunders, 2);
  assert.equal(report.blunders.length, 1);
  assert.equal(report.blunders[0].gameId, 'black-blunder');
  assert.deepEqual(report.skipped, [{ gameId: 'black-blunder', ply: 1, reason: 'best-played' }]);
});

test('offline command exits nonzero without partial JSON on invalid input or arguments', () => {
  for (const args of [
    [],
    [fileURLToPath(fixtureUrl), '--limit', '0'],
    [fileURLToPath(fixtureUrl), '--unknown'],
    [fileURLToPath(new URL('../../../docs/offline-blunder-ranker.md', import.meta.url))],
  ]) {
    const result = command(args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
    assert.equal(result.stderr.includes('Input contract'), false);
  }
  const help = command(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);
});
