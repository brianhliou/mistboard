import assert from 'node:assert/strict';
import test from 'node:test';

import { type HandSet, decompose, isWinningHand } from './decompose.js';
import { formatTiles, parseTiles, toCounts } from './tiles.js';

const counts = (notation: string) => toCounts(parseTiles(notation));

const shapeOf = (sets: readonly HandSet[]) =>
  [...sets]
    .map((set) => `${set.kind}:${formatTiles([set.tile])}`)
    .sort()
    .join(' ');

test('an unambiguous hand has exactly one split', () => {
  const results = decompose(counts('123m456m789m123p11s'));
  assert.equal(results.length, 1);
  const only = results[0];
  assert.ok(only);
  assert.equal(formatTiles([only.pair]), '1s');
  assert.equal(only.sets.length, 4);
});

test('111222333 splits two ways and both are returned', () => {
  // Three pungs or three identical runs. A scorer that decomposes once picks
  // whichever the search happened to find first and silently misprices the
  // other: all-pungs is 3 faan in Hong Kong, the run split is not.
  const results = decompose(counts('111m222m333m456m11p'));
  assert.equal(results.length, 2);

  const shapes = results.map((result) => shapeOf(result.sets)).sort();
  assert.deepEqual(shapes, [
    'chow:1m chow:1m chow:1m chow:4m',
    'chow:4m pung:1m pung:2m pung:3m',
  ]);
  for (const result of results) assert.equal(formatTiles([result.pair]), '1p');
});

test('the split is not the way the tiles were written down', () => {
  // Written as 11m 22m 33m 123m 456m 78m, which reads like three pairs, a run,
  // a run and a loose 78m: not a hand at all. The only split that works pairs
  // the 3m and rebuilds everything else: 111m 222m 345m 678m. Any scorer that
  // trusts how a player grouped their tiles will price this wrong.
  const results = decompose(counts('11m22m33m123m456m78m'));
  assert.equal(results.length, 1);
  const only = results[0];
  assert.ok(only);
  assert.equal(formatTiles([only.pair]), '3m');
  assert.equal(shapeOf(only.sets), 'chow:3m chow:6m pung:1m pung:2m');
});

test('incomplete hands return no splits', () => {
  assert.deepEqual(decompose(counts('123m456m789m12p55s')), []);
  assert.equal(isWinningHand(counts('123m456m789m12p55s')), false);
  assert.equal(isWinningHand(counts('123m456m789m123p11s')), true);
});

test('exposed melds are carried through unchanged', () => {
  const melds: HandSet[] = [
    { kind: 'pung', tile: 27, concealed: false },
    { kind: 'chow', tile: 0, concealed: false },
  ];
  // Two melds down, so eight concealed tiles: two sets and the pair.
  const results = decompose(counts('456m789m11p'), melds);
  assert.equal(results.length, 1);
  const only = results[0];
  assert.ok(only);
  assert.equal(only.sets.length, 4);
  assert.equal(only.sets.filter((set) => !set.concealed).length, 2);
  assert.equal(shapeOf(only.sets), 'chow:1m chow:4m chow:7m pung:1z');
});

test('a kong does not change how many tiles stay concealed', () => {
  // A kong is four tiles but grants a replacement draw, so the hand is 14+k
  // tiles and the extra exactly cancels. Subtracting kongs from the expected
  // concealed count rejects every legal kong hand.
  const melds: HandSet[] = [{ kind: 'kong', tile: 33, concealed: false }];
  const results = decompose(counts('123m456m789m11p'), melds);
  assert.equal(results.length, 1);
  const only = results[0];
  assert.ok(only);
  assert.equal(only.sets.length, 4);
  assert.equal(only.sets.filter((set) => set.kind === 'kong').length, 1);
});

test('four melds leave only the pair', () => {
  const melds: HandSet[] = [
    { kind: 'pung', tile: 27, concealed: false },
    { kind: 'pung', tile: 28, concealed: false },
    { kind: 'kong', tile: 29, concealed: true },
    { kind: 'chow', tile: 0, concealed: false },
  ];
  const results = decompose(counts('55p'), melds);
  assert.equal(results.length, 1);
  assert.equal(formatTiles([results[0]?.pair as number]), '5p');
});
