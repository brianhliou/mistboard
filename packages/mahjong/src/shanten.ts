/**
 * Shanten: how many tile exchanges a hand is away from winning.
 *
 *   -1  complete hand
 *    0  tenpai (waiting)
 *    n  n tiles away
 *
 * Deliberately ruleset-independent. Hand *structure* (four sets and a pair) is
 * the same in Hong Kong, MCR and riichi; only scoring differs, and scoring lives
 * elsewhere. The two special shapes that are NOT structural - seven pairs and
 * thirteen orphans - are opt-in, because whether a ruleset recognises them is a
 * ruleset question and HK Old Style tables disagree about both.
 */

import { canStartRun, isHonour, TERMINALS_AND_HONOURS, TILE_COUNT } from './tiles.js';

export interface ShantenOptions {
  /** Sets already exposed or declared (pung, chow, kong). Each is one of the four. */
  readonly meldCount?: number;
  /** 七對子. Off by default: it is standard in riichi, contested in HK. */
  readonly sevenPairs?: boolean;
  /** 十三么. Off by default, for the same reason. */
  readonly thirteenOrphans?: boolean;
}

export interface ShantenResult {
  readonly shanten: number;
  /** Which shape produced the number, useful for explaining a hand. */
  readonly shape: 'standard' | 'seven-pairs' | 'thirteen-orphans';
}

const MAX_BLOCKS = 5;

/**
 * Standard four-sets-and-a-pair shanten.
 *
 * The arithmetic is the classical formula: every complete set removes two from
 * the distance and every partial set removes one, from a base of 8.
 *
 *   shanten = 8 - 2*sets - partials
 *
 * with at most five blocks in total, plus one correction: five blocks and no
 * pair among them means one block has to be broken up to make the pair, which
 * costs an extra exchange. Both the cap and the correction are load-bearing -
 * without them a hand like 123m 456m 789m 12p 45s reads as tenpai when it is
 * one away.
 */
export function standardShanten(counts: readonly number[], meldCount = 0): number {
  const working = [...counts];
  const best = { value: Number.POSITIVE_INFINITY };
  search(working, 0, 0, 0, false, meldCount, best);
  return best.value;
}

function search(
  counts: number[],
  index: number,
  sets: number,
  partials: number,
  hasPair: boolean,
  meldCount: number,
  best: { value: number },
): void {
  let i = index;
  while (i < TILE_COUNT && counts[i] === 0) i += 1;

  if (i >= TILE_COUNT) {
    const totalSets = sets + meldCount;
    let shanten = 8 - 2 * totalSets - partials;
    if (totalSets + partials === MAX_BLOCKS && !hasPair) shanten += 1;
    if (shanten < best.value) best.value = shanten;
    return;
  }

  const blocks = sets + meldCount + partials;
  const count = counts[i] as number;

  // The cap applies to SETS as well as partials. A set is a block, and gating
  // only the partials lets the search build five partials and then add a set on
  // top of them, reporting six blocks and a hand one tile closer to winning
  // than it is. Every ordering is explored, so a hand that genuinely wants the
  // set reaches it by forming the set first.
  if (blocks < MAX_BLOCKS) {
    if (count >= 3) {
      counts[i] = count - 3;
      search(counts, i, sets + 1, partials, hasPair, meldCount, best);
      counts[i] = count;
    }

    if (canStartRun(i) && (counts[i + 1] as number) > 0 && (counts[i + 2] as number) > 0) {
      counts[i] -= 1;
      counts[i + 1] -= 1;
      counts[i + 2] -= 1;
      search(counts, i, sets + 1, partials, hasPair, meldCount, best);
      counts[i] += 1;
      counts[i + 1] += 1;
      counts[i + 2] += 1;
    }
  }

  if (blocks < MAX_BLOCKS) {
    if (count >= 2) {
      counts[i] = count - 2;
      search(counts, i, sets, partials + 1, true, meldCount, best);
      counts[i] = count;
    }

    if (!isHonour(i)) {
      // Adjacent pair of ranks, e.g. 34m waiting on 2m/5m.
      if (i % 9 <= 7 && (counts[i + 1] as number) > 0) {
        counts[i] -= 1;
        counts[i + 1] -= 1;
        search(counts, i, sets, partials + 1, hasPair, meldCount, best);
        counts[i] += 1;
        counts[i + 1] += 1;
      }
      // Gap, e.g. 35m waiting on 4m.
      if (i % 9 <= 6 && (counts[i + 2] as number) > 0) {
        counts[i] -= 1;
        counts[i + 2] -= 1;
        search(counts, i, sets, partials + 1, hasPair, meldCount, best);
        counts[i] += 1;
        counts[i + 2] += 1;
      }
    }
  }

  // Leave this tile unused and move on.
  search(counts, i + 1, sets, partials, hasPair, meldCount, best);
}

/**
 * 七對子. Seven distinct pairs. Requires a fully concealed hand, and four of a
 * kind counts as one pair rather than two - the second pair has no distinct
 * tile to be made from.
 */
export function sevenPairsShanten(counts: readonly number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    const n = counts[tile] ?? 0;
    if (n > 0) kinds += 1;
    if (n >= 2) pairs += 1;
  }
  let shanten = 6 - pairs;
  if (kinds < 7) shanten += 7 - kinds;
  return shanten;
}

/** 十三么. One of each terminal and honour, plus a duplicate of any of them. */
export function thirteenOrphansShanten(counts: readonly number[]): number {
  let kinds = 0;
  let hasPair = false;
  for (const tile of TERMINALS_AND_HONOURS) {
    const n = counts[tile] ?? 0;
    if (n > 0) kinds += 1;
    if (n >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/** Best shanten across every shape the ruleset allows, with the shape that won. */
export function shanten(counts: readonly number[], options: ShantenOptions = {}): ShantenResult {
  const meldCount = options.meldCount ?? 0;
  let best: ShantenResult = { shanten: standardShanten(counts, meldCount), shape: 'standard' };

  // Both special shapes need a fully concealed hand: melding breaks them.
  if (meldCount === 0) {
    if (options.sevenPairs) {
      const value = sevenPairsShanten(counts);
      if (value < best.shanten) best = { shanten: value, shape: 'seven-pairs' };
    }
    if (options.thirteenOrphans) {
      const value = thirteenOrphansShanten(counts);
      if (value < best.shanten) best = { shanten: value, shape: 'thirteen-orphans' };
    }
  }

  return best;
}
