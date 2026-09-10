/**
 * Reading a decomposed hand for the patterns it contains.
 *
 * Detection is separate from valuation (`hk-faan.ts`) and from splitting
 * (`decompose.ts`) because a hand can split several ways and the splits do not
 * score the same. `scoreHand` therefore detects and totals for EVERY split and
 * keeps the best, which is the only way to price 111222333m correctly.
 *
 * Patterns that depend on how the hand was won rather than what it contains -
 * self-draw, robbing a kong, winning on the last tile - cannot be seen in the
 * tiles and arrive through `HkHandContext`.
 */

import { type Decomposition, decompose, type HandSet } from './decompose.js';
import { type FaanOptions, type FaanResult, totalFaan } from './hk-faan.js';
import type { HkPatternId, ScoredPattern } from './hk-patterns.js';
import { DEFAULT_HK_PAYMENT, type HkPaymentRules, type Settlement, settle } from './hk-payment.js';
import { DRAGONS, isHonour, isTerminal, suitOf, type TileIndex, WINDS } from './tiles.js';

export interface HkHandContext {
  readonly selfDrawn?: boolean;
  /** 門風. The player's own wind, 27-30. */
  readonly seatWind?: TileIndex;
  /** 圈風. The prevailing wind. Scores separately from the seat wind. */
  readonly roundWind?: TileIndex;
  /** 正花. Flowers matching this seat; at most two can score. */
  readonly seatFlowers?: number;
  /** True when no flower or season was drawn all hand. */
  readonly noFlowers?: boolean;
  /** 一台花. All four flowers or all four seasons. */
  readonly fullFlowerSet?: boolean;
  readonly robbingKong?: boolean;
  readonly lastTile?: boolean;
  readonly kongReplacement?: boolean;
}

/** Every tile in a decomposition, sets expanded. */
function tilesOf(decomposition: Decomposition): TileIndex[] {
  const tiles: TileIndex[] = [decomposition.pair, decomposition.pair];
  for (const set of decomposition.sets) {
    if (set.kind === 'chow') {
      tiles.push(set.tile, set.tile + 1, set.tile + 2);
    } else {
      const copies = set.kind === 'kong' ? 4 : 3;
      for (let i = 0; i < copies; i += 1) tiles.push(set.tile);
    }
  }
  return tiles;
}

const isPungLike = (set: HandSet) => set.kind === 'pung' || set.kind === 'kong';

/** The patterns visible in one particular split of a hand. */
export function detectPatterns(
  decomposition: Decomposition,
  context: HkHandContext = {},
): ScoredPattern[] {
  const found: ScoredPattern[] = [];
  const add = (id: HkPatternId, count = 1) => {
    if (count > 0) found.push({ id, count });
  };

  const { sets, pair } = decomposition;
  const tiles = tilesOf(decomposition);
  const suits = new Set(tiles.map(suitOf));
  const numberedSuits = [...suits].filter((suit) => suit !== 'z');

  // --- shape of the sets
  if (sets.every((set) => set.kind === 'chow')) add('all-chows');

  const allPungs = sets.every(isPungLike);
  const allConcealed = sets.every((set) => set.concealed);
  const kongs = sets.filter((set) => set.kind === 'kong').length;

  if (kongs === 4) add('four-kongs');
  else if (kongs === 3) add('three-kongs');

  // --- suit composition, strongest first
  const everyTileHonour = tiles.every(isHonour);
  const everyTileTerminal = tiles.every(isTerminal);
  const everyTileTerminalOrHonour = tiles.every((tile) => isHonour(tile) || isTerminal(tile));

  if (everyTileHonour) {
    add('all-honours');
  } else if (everyTileTerminal) {
    add('all-terminals');
  } else if (everyTileTerminalOrHonour) {
    add('all-terminals-and-honours');
  } else if (numberedSuits.length === 1 && !suits.has('z')) {
    add('full-flush');
  } else if (numberedSuits.length === 1) {
    add('half-flush');
  }

  // 對對糊 is reported even when a stronger all-pung pattern is present; the
  // resolver's exclusion rules are what stop it being counted twice, and doing
  // it here would put that knowledge in two places.
  if (allPungs && !everyTileHonour) add('all-pungs');
  if (allPungs && allConcealed) add('four-concealed-pungs');

  // --- honour sets
  const dragonPungs = sets.filter((set) => isPungLike(set) && DRAGONS.includes(set.tile));
  const windPungs = sets.filter((set) => isPungLike(set) && WINDS.includes(set.tile));
  const pairIsDragon = DRAGONS.includes(pair);
  const pairIsWind = WINDS.includes(pair);

  if (dragonPungs.length === 3) add('big-three-dragons');
  else if (dragonPungs.length === 2 && pairIsDragon) add('little-three-dragons');
  else add('dragon-pung', dragonPungs.length);

  if (windPungs.length === 4) add('big-four-winds');
  else if (windPungs.length === 3 && pairIsWind) add('little-four-winds');
  else if (windPungs.length === 3) add('big-three-winds');

  if (windPungs.length < 4) {
    const seat = context.seatWind;
    const round = context.roundWind;
    if (seat !== undefined && windPungs.some((set) => set.tile === seat)) add('seat-wind');
    if (round !== undefined && windPungs.some((set) => set.tile === round)) add('round-wind');
  }

  // --- house-rule shapes, reported always and filtered by the resolver
  if (numberedSuits.length === 1 && !suits.has('z')) {
    const suit = numberedSuits[0];
    const chowStarts = sets.filter((set) => set.kind === 'chow').map((set) => set.tile % 9);
    if (suit && [0, 3, 6].every((start) => chowStarts.includes(start))) add('pure-straight');
  }
  if (numberedSuits.length <= 2) add('one-voided-suit');

  const chowTiles = sets.filter((set) => set.kind === 'chow').map((set) => set.tile);
  if (new Set(chowTiles).size < chowTiles.length) add('pure-double-chow');

  // --- how the hand was won
  if (context.selfDrawn) add('self-draw');
  if (allConcealed) add('concealed');
  if (context.robbingKong) add('robbing-kong');
  if (context.lastTile) add('last-tile');
  if (context.kongReplacement) add('kong-replacement');

  // --- flowers
  if (context.fullFlowerSet) add('full-flower-set');
  if (context.noFlowers) add('no-flowers');
  add('seat-flower', context.seatFlowers ?? 0);

  return found;
}

export interface HkScore extends FaanResult {
  readonly decomposition: Decomposition;
  readonly settlement: Settlement;
  /** False when the hand does not reach the table's 起糊 minimum. */
  readonly meetsMinimum: boolean;
}

export interface HkScoreOptions extends FaanOptions {
  readonly payment?: HkPaymentRules;
  /** 起糊. Three is standard; flowers count toward it in HK, unlike MCR. */
  readonly minFaan?: number;
}

/**
 * Score a complete hand, taking the best-paying split.
 *
 * Returns null when the tiles are not a winning hand at all. A hand that wins
 * but falls short of the minimum still scores - `meetsMinimum` says whether it
 * may actually be declared.
 */
export function scoreHand(
  counts: readonly number[],
  melds: readonly HandSet[] = [],
  context: HkHandContext = {},
  options: HkScoreOptions = {},
): HkScore | null {
  const splits = decompose(counts, melds);
  if (splits.length === 0) return null;

  const payment = options.payment ?? DEFAULT_HK_PAYMENT;
  const limit = options.limit ?? payment.limit;
  const minFaan = options.minFaan ?? 3;

  let best: HkScore | null = null;
  for (const decomposition of splits) {
    const result = totalFaan(detectPatterns(decomposition, context), { ...options, limit });
    const settlement = settle(result.faan, context.selfDrawn ?? false, { ...payment, limit });
    const candidate: HkScore = {
      ...result,
      decomposition,
      settlement,
      meetsMinimum: result.faan >= minFaan,
    };
    if (!best || candidate.faan > best.faan) best = candidate;
  }

  return best;
}
