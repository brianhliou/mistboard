/**
 * Acceptance (ukeire / 進張) and discard ranking.
 *
 * This is the half of mahjong analysis that needs no engine and no training
 * data: given a hand, which tiles improve it and how many of each are still
 * live. It is exact, it is fast, and it is what a learner actually wants to be
 * told. Judgement calls that depend on the score, the seat and the opponents -
 * push or fold, chasing a bigger hand - are NOT here and are not exact.
 */

import { type ShantenOptions, shanten } from './shanten.js';
import { TILE_COUNT, type TileIndex } from './tiles.js';

export interface AcceptanceTile {
  readonly tile: TileIndex;
  /** Copies not yet in the hand or visible elsewhere. Zero means dead. */
  readonly remaining: number;
}

export interface Acceptance {
  readonly shanten: number;
  readonly tiles: readonly AcceptanceTile[];
  /** Live copies across every accepting tile: the number that matters. */
  readonly total: number;
}

export interface DiscardOption {
  readonly discard: TileIndex;
  readonly shanten: number;
  readonly acceptance: Acceptance;
}

/** Tiles the player can see and that are therefore not in the live wall. */
export type VisibleCounts = readonly number[];

function remainingCopies(
  tile: TileIndex,
  counts: readonly number[],
  visible: VisibleCounts | undefined,
): number {
  const held = counts[tile] ?? 0;
  const seen = visible?.[tile] ?? 0;
  return Math.max(0, 4 - held - seen);
}

/**
 * Which tiles reduce the shanten of a waiting hand.
 *
 * `counts` must be a hand that is one tile short of a full hand: 13 tiles for a
 * fully concealed hand, three fewer for each meld.
 */
export function acceptance(
  counts: readonly number[],
  options: ShantenOptions = {},
  visible?: VisibleCounts,
): Acceptance {
  const current = shanten(counts, options).shanten;
  const working = [...counts];
  const tiles: AcceptanceTile[] = [];
  let total = 0;

  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if ((working[tile] ?? 0) >= 4) continue;
    working[tile] = (working[tile] ?? 0) + 1;
    const next = shanten(working, options).shanten;
    working[tile] = (working[tile] ?? 0) - 1;
    if (next >= current) continue;

    const remaining = remainingCopies(tile, counts, visible);
    tiles.push({ tile, remaining });
    total += remaining;
  }

  return { shanten: current, tiles, total };
}

/**
 * Rank every legal discard from a full hand.
 *
 * Sorted by the shape a player should actually prefer: lowest resulting
 * shanten first, then widest acceptance, then most distinct accepting tiles.
 * Ties are left in tile order so the output is stable.
 *
 * Note the ordering is a heuristic over exact inputs, not an evaluation. A
 * discard that keeps more tiles is not automatically better - it may be worth
 * fewer points, or be the dangerous one. Presenting this as "the best discard"
 * would overclaim; it is the widest one.
 */
export function rankDiscards(
  counts: readonly number[],
  options: ShantenOptions = {},
  visible?: VisibleCounts,
): DiscardOption[] {
  const working = [...counts];
  const out: DiscardOption[] = [];

  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if ((working[tile] ?? 0) === 0) continue;
    working[tile] = (working[tile] ?? 0) - 1;
    const result = acceptance(working, options, visible);
    out.push({ discard: tile, shanten: result.shanten, acceptance: result });
    working[tile] = (working[tile] ?? 0) + 1;
  }

  out.sort((a, b) => {
    if (a.shanten !== b.shanten) return a.shanten - b.shanten;
    if (a.acceptance.total !== b.acceptance.total) return b.acceptance.total - a.acceptance.total;
    if (a.acceptance.tiles.length !== b.acceptance.tiles.length) {
      return b.acceptance.tiles.length - a.acceptance.tiles.length;
    }
    return a.discard - b.discard;
  });

  return out;
}

/** The tiles a tenpai hand is waiting on. Empty when the hand is not tenpai. */
export function waits(
  counts: readonly number[],
  options: ShantenOptions = {},
  visible?: VisibleCounts,
): Acceptance {
  const result = acceptance(counts, options, visible);
  return result.shanten === 0 ? result : { shanten: result.shanten, tiles: [], total: 0 };
}
