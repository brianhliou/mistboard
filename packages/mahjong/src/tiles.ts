/**
 * Tile model shared by every mahjong ruleset.
 *
 * The 34 tile types are ruleset-independent: Hong Kong, MCR, riichi and the
 * regional Chinese variants all draw from the same wall. What differs between
 * them is scoring, not tiles, so nothing in this file knows about faan, yaku or
 * fan. Flowers are the one exception and are modelled separately, because they
 * are not part of any hand's structure - they sit beside it.
 */

export const SUITS = ['m', 'p', 's', 'z'] as const;
export type Suit = (typeof SUITS)[number];

/**
 * Tile index 0-33.
 *
 *   0-8    m  萬 characters (wan / craks), 1-9
 *   9-17   p  筒 dots (tong / circles), 1-9
 *   18-26  s  索 bamboo (suo / sticks), 1-9
 *   27-33  z  honours, in the conventional order below
 *
 * Honour order follows the notation the whole mahjong software world uses
 * (z1-z7 = E S W N white green red). It is a Japanese-origin convention, but it
 * is the interchange format every tool reads, so we speak it rather than invent
 * a Cantonese-ordered one that nothing else parses.
 */
export type TileIndex = number;

export const TILE_COUNT = 34;
export const HONOUR_START = 27;

export const EAST = 27;
export const SOUTH = 28;
export const WEST = 29;
export const NORTH = 30;
export const WHITE_DRAGON = 31; // 白 baak baan
export const GREEN_DRAGON = 32; // 發 faat
export const RED_DRAGON = 33; // 中 zung

export const WINDS: readonly TileIndex[] = [EAST, SOUTH, WEST, NORTH];
export const DRAGONS: readonly TileIndex[] = [WHITE_DRAGON, GREEN_DRAGON, RED_DRAGON];

/** 1m 9m 1p 9p 1s 9s plus the seven honours. */
export const TERMINALS_AND_HONOURS: readonly TileIndex[] = [
  0,
  8,
  9,
  17,
  18,
  26,
  EAST,
  SOUTH,
  WEST,
  NORTH,
  WHITE_DRAGON,
  GREEN_DRAGON,
  RED_DRAGON,
];

export function isHonour(tile: TileIndex): boolean {
  return tile >= HONOUR_START;
}

export function isTerminal(tile: TileIndex): boolean {
  if (isHonour(tile)) return false;
  const rank = tile % 9;
  return rank === 0 || rank === 8;
}

export function isSimple(tile: TileIndex): boolean {
  return !isHonour(tile) && !isTerminal(tile);
}

export function suitOf(tile: TileIndex): Suit {
  if (tile >= HONOUR_START) return 'z';
  return SUITS[Math.floor(tile / 9)] as Suit;
}

/** 1-based rank within the suit; honours return 1-7 in the z-order above. */
export function rankOf(tile: TileIndex): number {
  return (tile >= HONOUR_START ? tile - HONOUR_START : tile % 9) + 1;
}

export function tileIndex(suit: Suit, rank: number): TileIndex {
  if (suit === 'z') {
    if (rank < 1 || rank > 7) throw new Error(`honour rank out of range: ${rank}`);
    return HONOUR_START + rank - 1;
  }
  if (rank < 1 || rank > 9) throw new Error(`rank out of range: ${rank}`);
  return SUITS.indexOf(suit) * 9 + rank - 1;
}

/** True when a run starting at `tile` stays inside one numbered suit. */
export function canStartRun(tile: TileIndex): boolean {
  if (isHonour(tile)) return false;
  return tile % 9 <= 6;
}

// ---------------------------------------------------------------- notation

/**
 * Parse the standard interchange notation: digits grouped by a trailing suit
 * letter, e.g. `123m456p789s11z`. Whitespace is ignored so hands can be written
 * with spaces between groups for readability.
 */
export function parseTiles(notation: string): TileIndex[] {
  const tiles: TileIndex[] = [];
  let pending: number[] = [];
  for (const ch of notation.replace(/\s+/g, '')) {
    if (ch >= '0' && ch <= '9') {
      pending.push(Number(ch));
      continue;
    }
    if (!SUITS.includes(ch as Suit)) throw new Error(`unknown suit letter: ${ch}`);
    if (pending.length === 0) throw new Error(`suit letter ${ch} with no preceding ranks`);
    for (const rank of pending) tiles.push(tileIndex(ch as Suit, rank));
    pending = [];
  }
  if (pending.length > 0)
    throw new Error(`trailing ranks with no suit letter: ${pending.join('')}`);
  return tiles;
}

/** Inverse of {@link parseTiles}, normalised: sorted, grouped, one letter per suit. */
export function formatTiles(tiles: readonly TileIndex[]): string {
  const bySuit = new Map<Suit, number[]>();
  for (const tile of [...tiles].sort((a, b) => a - b)) {
    const suit = suitOf(tile);
    const group = bySuit.get(suit) ?? [];
    group.push(rankOf(tile));
    bySuit.set(suit, group);
  }
  let out = '';
  for (const suit of SUITS) {
    const group = bySuit.get(suit);
    if (group && group.length > 0) out += `${group.join('')}${suit}`;
  }
  return out;
}

/** Counts array of length 34. Throws when a tile appears more than four times. */
export function toCounts(tiles: readonly TileIndex[]): number[] {
  const counts = new Array<number>(TILE_COUNT).fill(0);
  for (const tile of tiles) {
    if (tile < 0 || tile >= TILE_COUNT) throw new Error(`tile index out of range: ${tile}`);
    counts[tile] = (counts[tile] ?? 0) + 1;
    if ((counts[tile] ?? 0) > 4) throw new Error(`more than four of tile ${formatTiles([tile])}`);
  }
  return counts;
}

export function fromCounts(counts: readonly number[]): TileIndex[] {
  const tiles: TileIndex[] = [];
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    for (let n = 0; n < (counts[tile] ?? 0); n += 1) tiles.push(tile);
  }
  return tiles;
}

// ------------------------------------------------------------------ flowers

/**
 * 花牌. Eight singleton tiles that are set aside and replaced when drawn, so
 * they never participate in hand structure. Hong Kong scores them; riichi does
 * not use them at all. Indexed 0-7: the four flowers 梅蘭菊竹 then the four
 * seasons 春夏秋冬, each in E/S/W/N seat order.
 */
export type FlowerIndex = number;
export const FLOWER_COUNT = 8;

export function flowerSeat(flower: FlowerIndex): TileIndex {
  if (flower < 0 || flower >= FLOWER_COUNT) throw new Error(`flower out of range: ${flower}`);
  return WINDS[flower % 4] as TileIndex;
}
