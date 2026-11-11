import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  balancedOpenings,
  countShape,
  isEligible,
  screenPosition,
  summarizeSample,
} from './count-gomoku-openings.mjs';
import { boardLines, positionKey, SCREEN } from './screen-gomoku-openings.mjs';

const candidate = (black, white) => ({
  turn: 'black',
  stones: [
    ...black.map((square) => ({ square, color: 'black' })),
    ...white.map((square) => ({ square, color: 'white' })),
  ],
});

test('exact raw and post-symmetry counts for A and B match an independent Burnside count', () => {
  // Independently enumerate occupied subsets, then count fixed colourings via
  // transform-cycle generating polynomials. Details in the private opening-count notes.
  for (const [n, rawBeforeDistance, raw, postSymmetry] of [
    [2, 75_900, 51_318, 6_555],
    [3, 3_542_000, 3_024_960, 379_088],
  ]) {
    assert.deepEqual(countShape(n), {
      perColor: n,
      rawBeforeDistance,
      raw,
      postSymmetry,
      sample: [],
    });
  }
});

test('a stone three points from every other stone is excluded by the enumerator', () => {
  const isolated = candidate(['f6', 'i9'], ['i10', 'j9']);
  assert.equal(isEligible(isolated, 2), false);
  const key = positionKey(isolated);
  assert.ok(![...balancedOpenings(2)].some((opening) => positionKey(opening) === key));
  // At exactly two points the neighbour is allowed; it may be the other colour.
  assert.equal(isEligible(candidate(['f6', 'h8'], ['i9', 'j9']), 2), true);
});

test('shape validation requires the centre 5x5, distinct points, equal colours and Black to move', () => {
  const valid = candidate(['f6', 'g7'], ['h8', 'j10']);
  assert.equal(isEligible(valid, 2), true);
  for (const invalid of [
    { ...valid, turn: 'white' },
    candidate(['e6', 'g7'], ['h8', 'j10']),
    candidate(['f6', 'f6'], ['h8', 'j10']),
    candidate(['f6'], ['g7', 'h8', 'j10']),
  ])
    assert.equal(isEligible(invalid, 2), false);
});

test('a known rotated pair collapses without swapping Black and White', () => {
  const a = candidate(['f6', 'g7'], ['h8', 'j10']);
  const b = candidate(['j6', 'i7'], ['h8', 'f10']);
  assert.equal(positionKey(a), positionKey(b));
  const keys = [...balancedOpenings(2)].map(positionKey);
  assert.equal(keys.filter((key) => key === positionKey(a)).length, 1);
  assert.equal(new Set(keys).size, keys.length);
});

test('seeded sampling is reproducible, distinct and drawn from eligible D4 classes', () => {
  const a = countShape(2, { sampleSize: 40, seed: 36286 });
  const b = countShape(2, { sampleSize: 40, seed: 36286 });
  assert.deepEqual(a, b);
  assert.equal(a.sample.length, 40);
  assert.equal(new Set(a.sample.map(positionKey)).size, 40);
  assert.ok(a.sample.every((opening) => isEligible(opening, 2)));
});

const telemetry = (winrate, finalScore = 0) => ({
  screen: { score: 0, finalScore, winrate, forcedWin: false, nodes: 1_000_000, depth: 12 },
  lines: ['recorded telemetry'],
});

test('sampling uses the existing prefilter and deep budgets, and inclusive Black winrate limits', () => {
  const opening = candidate(['f6', 'g7'], ['h8', 'j10']);
  for (const winrate of [0.48, 0.52, 0.479, 0.521]) {
    const budgets = [];
    const engine = {
      search(position, nodes) {
        assert.equal(position.turn, 'black');
        budgets.push(nodes);
        return telemetry(winrate);
      },
    };
    const row = screenPosition(engine, opening);
    assert.deepEqual(budgets, [SCREEN.prefilterNodes, SCREEN.nodes]);
    assert.equal(row.inBand, winrate >= 0.48 && winrate <= 0.52);
    assert.ok(row.totalSeconds >= 0);
  }
});

test('prefilter rejections and missing deep telemetry count against the full sample denominator', () => {
  const opening = candidate(['f6', 'g7'], ['h8', 'j10']);
  const rows = [];
  for (const fast of [telemetry(0.5, 171), { screen: null, lines: [] }]) {
    let calls = 0;
    rows.push(
      screenPosition(
        {
          search: () => {
            calls += 1;
            return fast;
          },
        },
        opening,
      ),
    );
    assert.equal(calls, 1);
    assert.equal(rows.at(-1).deep, null);
  }
  rows.push(
    screenPosition(
      {
        search: (_, nodes) =>
          nodes === SCREEN.nodes ? { screen: null, lines: [] } : telemetry(0.5),
      },
      opening,
    ),
  );
  rows.push(screenPosition({ search: () => telemetry(0.5) }, opening));
  const summary = summarizeSample(rows);
  assert.equal(summary.positions, 4);
  assert.equal(summary.deepSearched, 2);
  assert.equal(summary.validDeepResults, 1);
  assert.equal(summary.inBand, 1);
  assert.equal(summary.shareInBand, 0.25);
});

test('BOARD lines end on the opponent stone whatever order the candidate lists', () => {
  const stones = [
    { square: 'f10', color: 'black' },
    { square: 'h8', color: 'black' },
    { square: 'i6', color: 'white' },
    { square: 'i7', color: 'white' },
  ];
  for (const order of [
    stones,
    [...stones].reverse(),
    [stones[2], stones[0], stones[3], stones[1]],
  ]) {
    const lines = boardLines({ turn: 'black', stones: order });
    assert.equal(lines.length, 4);
    assert.deepEqual(
      lines.map((line) => line.at(-1)),
      ['1', '2', '1', '2'],
      'alternate own and opponent, ending on the opponent so the engine searches for the side to move',
    );
  }
  const whiteToMove = boardLines({
    turn: 'white',
    stones: [...stones, { square: 'g9', color: 'black' }],
  });
  assert.equal(whiteToMove.at(-1).at(-1), '2');
  assert.equal(whiteToMove.filter((line) => line.endsWith(',1')).length, 2);
});
