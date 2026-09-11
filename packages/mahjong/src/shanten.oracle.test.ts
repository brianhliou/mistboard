/**
 * Independent verification of the shanten arithmetic.
 *
 * `standardShanten` is a formula: it counts blocks and subtracts. This file
 * checks it against a completely different method - exhaustively asking "can
 * this hand be finished?" - so a mistake in the formula cannot hide behind a
 * fixture that was written from the formula's own output.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { standardShanten } from './shanten.js';
import { canStartRun, formatTiles, TILE_COUNT, toCounts } from './tiles.js';

/** Can these tiles be split entirely into triplets and runs? */
function decomposesIntoSets(counts: number[], index: number): boolean {
  let i = index;
  while (i < TILE_COUNT && counts[i] === 0) i += 1;
  if (i >= TILE_COUNT) return true;

  if ((counts[i] as number) >= 3) {
    counts[i] -= 3;
    const ok = decomposesIntoSets(counts, i);
    counts[i] += 3;
    if (ok) return true;
  }

  if (canStartRun(i) && (counts[i + 1] as number) > 0 && (counts[i + 2] as number) > 0) {
    counts[i] -= 1;
    counts[i + 1] -= 1;
    counts[i + 2] -= 1;
    const ok = decomposesIntoSets(counts, i);
    counts[i] += 1;
    counts[i + 1] += 1;
    counts[i + 2] += 1;
    if (ok) return true;
  }

  return false;
}

/** Four sets and a pair, by exhaustive decomposition rather than arithmetic. */
function isComplete(counts: readonly number[], meldCount = 0): boolean {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total !== 14 - 3 * meldCount) return false;

  const working = [...counts];
  for (let pair = 0; pair < TILE_COUNT; pair += 1) {
    if ((working[pair] as number) < 2) continue;
    working[pair] -= 2;
    const ok = decomposesIntoSets(working, 0);
    working[pair] += 2;
    if (ok) return true;
  }
  return false;
}

/** Tenpai iff some single tile completes the hand. */
function oracleIsTenpai(counts: readonly number[], meldCount = 0): boolean {
  const working = [...counts];
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if ((working[tile] as number) >= 4) continue;
    working[tile] += 1;
    const complete = isComplete(working, meldCount);
    working[tile] -= 1;
    if (complete) return true;
  }
  return false;
}

function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
}

/** Build a genuinely complete 14-tile hand: four sets and a pair. */
function randomCompleteHand(next: () => number): number[] {
  for (;;) {
    const counts = new Array<number>(TILE_COUNT).fill(0);
    let ok = true;

    // The requested tiles can repeat (a triplet is the same tile three times),
    // so the check has to be against the total being added, not tile by tile
    // against the count as it stands. Getting this wrong builds hands with five
    // copies of a tile, which are structurally decomposable and completely
    // illegal.
    const take = (tiles: number[]): boolean => {
      const needed = new Map<number, number>();
      for (const tile of tiles) needed.set(tile, (needed.get(tile) ?? 0) + 1);
      for (const [tile, n] of needed) {
        if ((counts[tile] as number) + n > 4) return false;
      }
      for (const tile of tiles) counts[tile] = (counts[tile] as number) + 1;
      return true;
    };

    for (let set = 0; set < 4 && ok; set += 1) {
      const start = next() % TILE_COUNT;
      if (next() % 2 === 0 && canStartRun(start)) {
        ok = take([start, start + 1, start + 2]);
      } else {
        ok = take([start, start, start]);
      }
    }
    if (ok) {
      const pair = next() % TILE_COUNT;
      ok = take([pair, pair]);
    }
    if (ok) return counts;
  }
}

test('every constructed complete hand reads as -1', () => {
  const next = makeRng(770411);
  for (let trial = 0; trial < 300; trial += 1) {
    const counts = randomCompleteHand(next);
    assert.ok(
      counts.every((n) => n <= 4),
      'construction produced an illegal hand with more than four of a tile',
    );
    assert.ok(isComplete(counts), 'oracle disagrees that the construction is complete');
    assert.equal(
      standardShanten(counts),
      -1,
      `complete hand read as not complete: ${formatTiles(
        counts.flatMap((n, tile) => Array.from({ length: n }, () => tile)),
      )}`,
    );
  }
});

test('a complete hand minus any one tile is tenpai', () => {
  const next = makeRng(31337);
  for (let trial = 0; trial < 150; trial += 1) {
    const counts = randomCompleteHand(next);
    for (let tile = 0; tile < TILE_COUNT; tile += 1) {
      if ((counts[tile] as number) === 0) continue;
      counts[tile] -= 1;
      const value = standardShanten(counts);
      const oracle = oracleIsTenpai(counts);
      counts[tile] += 1;
      assert.equal(value, 0, 'formula says a hand one tile short of complete is not tenpai');
      assert.ok(oracle, 'oracle says a hand one tile short of complete is not tenpai');
    }
  }
});

test('formula and oracle agree on tenpai across random hands', () => {
  const next = makeRng(20260909);
  let tenpaiSeen = 0;

  for (let trial = 0; trial < 3000; trial += 1) {
    const wall: number[] = [];
    for (let tile = 0; tile < TILE_COUNT; tile += 1) {
      for (let copy = 0; copy < 4; copy += 1) wall.push(tile);
    }
    // Bias toward structured hands: deal from a wall narrowed to a few suits,
    // so tenpai actually turns up instead of being one in a million.
    const narrowed = wall.filter((tile) => tile < 18 || tile >= 27);
    const hand: number[] = [];
    for (let drawn = 0; drawn < 13; drawn += 1) {
      hand.push(...narrowed.splice(next() % narrowed.length, 1));
    }

    const counts = toCounts(hand);
    const byFormula = standardShanten(counts) === 0;
    const byOracle = oracleIsTenpai(counts);
    if (byOracle) tenpaiSeen += 1;

    assert.equal(
      byFormula,
      byOracle,
      `disagreement on ${formatTiles(hand)}: formula ${standardShanten(counts)}, oracle tenpai=${byOracle}`,
    );
  }

  // Guard against the test passing because it never generated a tenpai hand.
  assert.ok(tenpaiSeen > 0, 'no tenpai hand was generated, so the check proved nothing');
});
