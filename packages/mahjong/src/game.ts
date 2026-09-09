/**
 * The hand loop: wall, deal, draw, discard, claim window, end.
 *
 * Pure and immutable. Every function takes a game and returns a new one, so the
 * whole hand is a fold over actions and replay is free.
 *
 * The wall is MATERIALISED, never a seed. That is the pattern banqi and jieqi
 * already use for their deals: the shuffled result is what gets persisted into
 * the room-created event and fed back on every hydration, because the RNG is a
 * crypto source and cannot be replayed. Callers hand `dealGame` a wall; making
 * one is a separate, deliberately unexciting function.
 *
 * Not yet modelled, and deliberately: concealed and added kongs declared from
 * one's own hand, and robbing the kong. A hand is fully playable without them
 * and they add a second claim window with different rules.
 */

import { type Claim, type Seat, SEATS, nextSeat, seatAfterPass } from './claims.js';
import type { HandSet } from './decompose.js';
import { EAST, type TileIndex, TILE_COUNT } from './tiles.js';

/** Flowers ride in the wall above the 34 hand types, so a wall is one array. */
export const FLOWER_BASE = 34;
export const WALL_SIZE = 144;
export type WallTile = number;

export function isFlowerTile(tile: WallTile): boolean {
  return tile >= FLOWER_BASE;
}

/** The 14 tiles held back to replace flowers and kongs. */
export const DEAD_WALL_SIZE = 14;

export type Phase =
  | { readonly type: 'draw' }
  | { readonly type: 'discard' }
  | {
      readonly type: 'claim-window';
      readonly discard: TileIndex;
      readonly discarder: Seat;
    }
  | { readonly type: 'won'; readonly winners: readonly Seat[]; readonly selfDrawn: boolean }
  | { readonly type: 'exhausted' };

export interface MahjongGame {
  /** Live wall, drawn from the front. Excludes the dead wall. */
  readonly wall: readonly WallTile[];
  readonly deadWall: readonly WallTile[];
  /** Concealed tiles per seat, as 34-length counts. */
  readonly hands: readonly (readonly number[])[];
  readonly melds: readonly (readonly HandSet[])[];
  readonly discards: readonly (readonly TileIndex[])[];
  readonly flowers: readonly (readonly number[])[];
  /** The tile just drawn, if the seat to move drew rather than claimed. */
  readonly drawn: TileIndex | null;
  readonly turn: Seat;
  readonly phase: Phase;
  readonly dealer: Seat;
  readonly roundWind: TileIndex;
}

/** A full 144-tile wall in order. Shuffle it before dealing. */
export function orderedWall(): WallTile[] {
  const wall: WallTile[] = [];
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    for (let copy = 0; copy < 4; copy += 1) wall.push(tile);
  }
  for (let flower = 0; flower < 8; flower += 1) wall.push(FLOWER_BASE + flower);
  return wall;
}

/** Fisher-Yates over a caller-supplied source, so tests can be deterministic. */
export function shuffleWall(rng: () => number, wall: WallTile[] = orderedWall()): WallTile[] {
  const out = [...wall];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as WallTile, out[i] as WallTile];
  }
  return out;
}

const emptyCounts = () => new Array<number>(TILE_COUNT).fill(0);

/** Mutable view of the two walls and one seat's flowers, for the draw helpers. */
interface DrawSurface {
  live: WallTile[];
  dead: WallTile[];
  flowers: number[];
}

/**
 * Take a replacement from the back of the dead wall, topping it back up from
 * the back of the live wall.
 *
 * The top-up is the part that is easy to omit and wrong to omit: without it the
 * dead wall shrinks by one on every flower and every kong, so a flower-heavy
 * deal can leave nothing to draw a kong replacement from later in the hand.
 * The dead wall is a fixed fourteen; it is the LIVE wall that pays for
 * replacements.
 */
function takeReplacement(surface: DrawSurface): WallTile | undefined {
  const tile = surface.dead.pop();
  if (tile === undefined) return undefined;
  const shifted = surface.live.pop();
  if (shifted !== undefined) surface.dead.unshift(shifted);
  return tile;
}

/**
 * Resolve a drawn tile to a real one, setting aside flowers and drawing again.
 * Returns null when the walls run out. Shared by the deal, an ordinary draw and
 * a kong replacement so the three cannot drift apart.
 */
function drawNonFlower(surface: DrawSurface, initial: WallTile | undefined): TileIndex | null {
  let tile = initial;
  while (tile !== undefined && isFlowerTile(tile)) {
    surface.flowers.push(tile - FLOWER_BASE);
    tile = takeReplacement(surface);
  }
  return tile === undefined ? null : tile;
}

/**
 * Deal a wall into a hand: 13 tiles each, dealer 14, flowers exposed and
 * replaced as they appear.
 */
export function dealGame(wall: readonly WallTile[], dealer: Seat = 0, roundWind = EAST): MahjongGame {
  if (wall.length !== WALL_SIZE) {
    throw new Error(`a wall is ${WALL_SIZE} tiles, got ${wall.length}`);
  }

  const live = [...wall];
  const deadWall = live.splice(live.length - DEAD_WALL_SIZE, DEAD_WALL_SIZE);
  const hands = SEATS.map(emptyCounts);
  const flowers: number[][] = SEATS.map(() => []);

  // Draw one tile into a seat, replacing flowers from the dead wall as they
  // come. A flower is set aside and does not join the hand.
  const drawInto = (seat: Seat) => {
    const surface: DrawSurface = { live, dead: deadWall, flowers: flowers[seat] as number[] };
    const tile = drawNonFlower(surface, live.shift());
    if (tile === null) throw new Error('wall exhausted during the deal');
    const hand = hands[seat] as number[];
    hand[tile] = (hand[tile] ?? 0) + 1;
    return tile;
  };

  for (let round = 0; round < 13; round += 1) {
    for (let i = 0; i < 4; i += 1) drawInto(((dealer + i) % 4) as Seat);
  }
  const dealerTile = drawInto(dealer);

  return {
    wall: live,
    deadWall,
    hands,
    melds: SEATS.map(() => []),
    discards: SEATS.map(() => []),
    flowers,
    drawn: dealerTile,
    turn: dealer,
    phase: { type: 'discard' },
    dealer,
    roundWind,
  };
}

function replaceSeat<T>(rows: readonly T[], seat: Seat, value: T): T[] {
  const next = [...rows];
  next[seat] = value;
  return next;
}

/**
 * Draw for the seat to move. Flowers are exposed and replaced, which can happen
 * several times in a row.
 */
export function applyDraw(game: MahjongGame): MahjongGame {
  if (game.phase.type !== 'draw') throw new Error(`cannot draw in phase ${game.phase.type}`);

  const surface: DrawSurface = {
    live: [...game.wall],
    dead: [...game.deadWall],
    flowers: [...(game.flowers[game.turn] as readonly number[])],
  };
  const tile = drawNonFlower(surface, surface.live.shift());
  if (tile === null) {
    return { ...game, wall: surface.live, deadWall: surface.dead, phase: { type: 'exhausted' } };
  }

  const hand = [...(game.hands[game.turn] as readonly number[])];
  hand[tile] = (hand[tile] ?? 0) + 1;
  return {
    ...game,
    wall: surface.live,
    deadWall: surface.dead,
    hands: replaceSeat(game.hands, game.turn, hand),
    flowers: replaceSeat(game.flowers, game.turn, surface.flowers),
    drawn: tile,
    phase: { type: 'discard' },
  };
}

/** Discard from the seat to move, opening the claim window. */
export function applyDiscard(game: MahjongGame, tile: TileIndex): MahjongGame {
  if (game.phase.type !== 'discard') {
    throw new Error(`cannot discard in phase ${game.phase.type}`);
  }
  const hand = [...(game.hands[game.turn] as readonly number[])];
  if ((hand[tile] ?? 0) === 0) throw new Error('cannot discard a tile that is not in hand');
  hand[tile] = (hand[tile] as number) - 1;

  return {
    ...game,
    hands: replaceSeat(game.hands, game.turn, hand),
    discards: replaceSeat(game.discards, game.turn, [
      ...(game.discards[game.turn] as readonly TileIndex[]),
      tile,
    ]),
    drawn: null,
    phase: { type: 'claim-window', discard: tile, discarder: game.turn },
  };
}

/**
 * Close the window with nothing claimed. The discard stays in the pond and the
 * turn passes to the next seat.
 */
export function applyPass(game: MahjongGame): MahjongGame {
  if (game.phase.type !== 'claim-window') {
    throw new Error(`no claim window open in phase ${game.phase.type}`);
  }
  const next = seatAfterPass(game.phase.discarder);
  if (game.wall.length === 0) return { ...game, phase: { type: 'exhausted' } };
  return { ...game, turn: next, phase: { type: 'draw' } };
}

/**
 * Apply a resolved claim. The claimant takes the discard out of the pond, melds
 * it, and becomes the seat to move - skipping anyone in between, which is why
 * turn order is a seat and never a counter.
 */
export function applyClaim(game: MahjongGame, claim: Claim): MahjongGame {
  if (game.phase.type !== 'claim-window') {
    throw new Error(`no claim window open in phase ${game.phase.type}`);
  }
  const { discard, discarder } = game.phase;

  const pond = [...(game.discards[discarder] as readonly TileIndex[])];
  if (pond[pond.length - 1] !== discard) throw new Error('claimed discard is not the last one');
  pond.pop();
  const discards = replaceSeat(game.discards, discarder, pond);

  if (claim.kind === 'win') {
    return { ...game, discards, phase: { type: 'won', winners: [claim.seat], selfDrawn: false } };
  }

  const hand = [...(game.hands[claim.seat] as readonly number[])];
  for (const tile of claim.fromHand) {
    if ((hand[tile] ?? 0) === 0) throw new Error('claim uses a tile the seat does not hold');
    hand[tile] = (hand[tile] as number) - 1;
  }

  const meld: HandSet =
    claim.kind === 'chow'
      ? { kind: 'chow', tile: Math.min(discard, ...claim.fromHand), concealed: false }
      : { kind: claim.kind === 'kong' ? 'kong' : 'pung', tile: discard, concealed: false };

  const next: MahjongGame = {
    ...game,
    discards,
    hands: replaceSeat(game.hands, claim.seat, hand),
    melds: replaceSeat(game.melds, claim.seat, [
      ...(game.melds[claim.seat] as readonly HandSet[]),
      meld,
    ]),
    drawn: null,
    turn: claim.seat,
    phase: { type: 'discard' },
  };

  // A kong leaves the hand a tile short, so it draws a replacement before
  // discarding. Nothing else does.
  if (claim.kind !== 'kong') return next;
  return applyKongReplacement(next);
}

function applyKongReplacement(game: MahjongGame): MahjongGame {
  const surface: DrawSurface = {
    live: [...game.wall],
    dead: [...game.deadWall],
    flowers: [...(game.flowers[game.turn] as readonly number[])],
  };
  const tile = drawNonFlower(surface, takeReplacement(surface));
  if (tile === null) {
    return { ...game, wall: surface.live, deadWall: surface.dead, phase: { type: 'exhausted' } };
  }

  const hand = [...(game.hands[game.turn] as readonly number[])];
  hand[tile] = (hand[tile] ?? 0) + 1;
  return {
    ...game,
    wall: surface.live,
    deadWall: surface.dead,
    hands: replaceSeat(game.hands, game.turn, hand),
    flowers: replaceSeat(game.flowers, game.turn, surface.flowers),
    drawn: tile,
    phase: { type: 'discard' },
  };
}

/** Declare a self-drawn win. The caller is responsible for it being legal. */
export function applySelfDraw(game: MahjongGame): MahjongGame {
  if (game.phase.type !== 'discard') {
    throw new Error(`cannot declare a self-draw in phase ${game.phase.type}`);
  }
  return { ...game, phase: { type: 'won', winners: [game.turn], selfDrawn: true } };
}

export function isFinished(game: MahjongGame): boolean {
  return game.phase.type === 'won' || game.phase.type === 'exhausted';
}

/** Tiles a seat can see: their own hand, every meld, every pond. */
export function visibleToSeat(game: MahjongGame, seat: Seat): number[] {
  const seen = new Array<number>(TILE_COUNT).fill(0);
  for (const pond of game.discards) {
    for (const tile of pond) seen[tile] = (seen[tile] ?? 0) + 1;
  }
  for (const melds of game.melds) {
    for (const meld of melds) {
      if (meld.kind === 'chow') {
        for (let i = 0; i < 3; i += 1) seen[meld.tile + i] = (seen[meld.tile + i] ?? 0) + 1;
      } else {
        const copies = meld.kind === 'kong' ? 4 : 3;
        seen[meld.tile] = (seen[meld.tile] ?? 0) + copies;
      }
    }
  }
  const own = game.hands[seat] as readonly number[];
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    seen[tile] = (seen[tile] ?? 0) + (own[tile] ?? 0);
  }
  return seen;
}
