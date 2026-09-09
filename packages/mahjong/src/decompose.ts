/**
 * Splitting a complete hand into its sets and pair.
 *
 * Scoring is defined over a decomposition, not over a bag of tiles: "all
 * triplets" is a statement about how the hand splits. The catch is that a hand
 * can split more than one way, and the ways are not worth the same. 111222333m
 * is three triplets or three runs, and a ruleset that scores the first will pay
 * differently from one that scores the second.
 *
 * So this returns EVERY distinct split rather than one. Picking among them is
 * the scorer's job, because only the scorer knows which is worth more, and that
 * answer differs by ruleset. A scorer that decomposes once and scores that has
 * a silent bug in it that shows up on maybe one hand in fifty.
 */

import { TILE_COUNT, type TileIndex, canStartRun } from './tiles.js';

export type SetKind = 'pung' | 'chow' | 'kong';

export interface HandSet {
  readonly kind: SetKind;
  /** For a chow, the lowest tile of the run. Otherwise the tile itself. */
  readonly tile: TileIndex;
  /** False once the set has been claimed from another player. */
  readonly concealed: boolean;
}

export interface Decomposition {
  readonly sets: readonly HandSet[];
  readonly pair: TileIndex;
}

function setKey(set: HandSet): string {
  return `${set.kind}:${set.tile}:${set.concealed ? 'c' : 'o'}`;
}

function decompositionKey(decomposition: Decomposition): string {
  return `${[...decomposition.sets].map(setKey).sort().join(',')}|${decomposition.pair}`;
}

function collectSets(counts: number[], index: number, acc: HandSet[], out: HandSet[][]): void {
  let i = index;
  while (i < TILE_COUNT && counts[i] === 0) i += 1;

  if (i >= TILE_COUNT) {
    out.push([...acc]);
    return;
  }

  if ((counts[i] as number) >= 3) {
    counts[i] -= 3;
    acc.push({ kind: 'pung', tile: i, concealed: true });
    collectSets(counts, i, acc, out);
    acc.pop();
    counts[i] += 3;
  }

  if (canStartRun(i) && (counts[i + 1] as number) > 0 && (counts[i + 2] as number) > 0) {
    counts[i] -= 1;
    counts[i + 1] -= 1;
    counts[i + 2] -= 1;
    acc.push({ kind: 'chow', tile: i, concealed: true });
    collectSets(counts, i, acc, out);
    acc.pop();
    counts[i] += 1;
    counts[i + 1] += 1;
    counts[i + 2] += 1;
  }
}

/**
 * Every distinct way the concealed tiles split into sets plus one pair.
 *
 * `melds` are sets already exposed; they appear in each result unchanged.
 * Returns an empty array when the hand is not complete, which makes this
 * usable as a completeness test.
 */
export function decompose(
  counts: readonly number[],
  melds: readonly HandSet[] = [],
): Decomposition[] {
  const concealedTiles = counts.reduce((sum, n) => sum + n, 0);
  // Kongs cancel out and must NOT appear in this arithmetic. A kong holds four
  // tiles instead of three, but it also grants a replacement draw, so a hand
  // with k kongs is 14+k tiles of which the kongs absorb exactly the extra k.
  // Concealed tiles are 14 - 3*melds either way. Subtracting the kongs here
  // rejects every legal kong hand as incomplete.
  if (concealedTiles !== 14 - 3 * melds.length) return [];

  const working = [...counts];
  const seen = new Set<string>();
  const results: Decomposition[] = [];

  for (let pair = 0; pair < TILE_COUNT; pair += 1) {
    if ((working[pair] as number) < 2) continue;
    working[pair] -= 2;

    const found: HandSet[][] = [];
    collectSets(working, 0, [], found);
    for (const sets of found) {
      if (sets.length + melds.length !== 4) continue;
      const decomposition: Decomposition = { sets: [...melds, ...sets], pair };
      const key = decompositionKey(decomposition);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(decomposition);
    }

    working[pair] += 2;
  }

  return results;
}

/** True when the tiles form four sets and a pair by any split. */
export function isWinningHand(
  counts: readonly number[],
  melds: readonly HandSet[] = [],
): boolean {
  return decompose(counts, melds).length > 0;
}
