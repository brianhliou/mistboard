/**
 * What one seat is allowed to know.
 *
 * Mahjong hides more than most variants on this platform: a seat sees its own
 * fourteen tiles and nothing of the other three hands beyond how many tiles
 * they hold. Everything else at the table is public by construction, because it
 * is face up on the mat: melds, ponds, flowers, and the count of tiles left in
 * the wall.
 *
 * The wall itself is the thing that must never leave the server. It is the
 * whole future of the hand in order, so leaking it is not a small mistake: one
 * client with the wall knows every tile every player will draw. It is kept in
 * the room's server-secret setup and stripped from room-created on the wire,
 * and it is absent from this type by construction rather than by filtering, so
 * a future field cannot accidentally carry it.
 */

import type { Claim } from './claims.js';
import type { HandSet, SetKind } from './decompose.js';
import type { MahjongSeat, MahjongStatus, MahjongTenantState } from './tenant-state.js';
import { claimsFor, MAHJONG_SEATS, pendingClaimants, seatIndex, seatName } from './tenant-state.js';
import type { TileIndex } from './tiles.js';

/**
 * A meld as one seat sees it.
 *
 * `tile` is null for another player's CONCEALED kong (暗槓), which is declared
 * face down. Whether the tile is revealed at declaration or only at the end of
 * the hand is one of the rules nobody here has confirmed, so this hides it: if
 * the real rule reveals it, a client shows less than it could, which costs a
 * little polish. If the real rule hides it and we revealed it, we would be
 * leaking a tile that changes how opponents play. The two mistakes are not the
 * same size.
 */
export interface MahjongMeldView {
  readonly kind: SetKind;
  readonly concealed: boolean;
  readonly tile: TileIndex | null;
}

/** What a seat knows about one player at the table, themselves included. */
export interface MahjongSeatView {
  readonly seat: MahjongSeat;
  /** Declared sets. Public, apart from the tile of another seat's concealed kong. */
  readonly melds: readonly MahjongMeldView[];
  /** Everything this seat has discarded, in order. Public. */
  readonly discards: readonly TileIndex[];
  /** Flowers set aside. Public, and they score. */
  readonly flowers: readonly number[];
  /** How many concealed tiles they hold. Public; the tiles themselves are not. */
  readonly handSize: number;
  /** Present only for the viewer's own seat. */
  readonly hand?: readonly TileIndex[];
}

export interface MahjongPlayerView {
  readonly perspective: MahjongSeat | 'spectator';
  readonly status: MahjongStatus;
  readonly moveNumber: number;
  readonly seats: readonly MahjongSeatView[];
  readonly turn: MahjongSeat;
  readonly phase: MahjongTenantState['game']['phase']['type'];
  /** Tiles left to draw. Public: everyone can see the wall shrink. */
  readonly wallRemaining: number;
  readonly dealer: MahjongSeat;
  readonly roundWind: TileIndex;
  /** The tile under claim, when a window is open. */
  readonly discardUnderClaim: TileIndex | null;
  /** Claims THIS viewer could make right now. Empty for everyone else. */
  readonly ownClaims: readonly Claim[];
  /** Seats the open window is still waiting on. Public: the table can see who is thinking. */
  readonly awaiting: readonly MahjongSeat[];
  /** When the open window settles itself, so a client can show a countdown. */
  readonly windowClosesAt: number | null;
}

/** Expand a 34-length count vector into the tiles it represents. */
function tilesOf(counts: readonly number[]): TileIndex[] {
  const tiles: TileIndex[] = [];
  counts.forEach((count, tile) => {
    for (let i = 0; i < count; i += 1) tiles.push(tile);
  });
  return tiles;
}

function handSizeOf(counts: readonly number[]): number {
  return counts.reduce((total, count) => total + count, 0);
}

export function mahjongViewFor(
  state: MahjongTenantState,
  perspective: MahjongSeat | 'spectator',
): MahjongPlayerView {
  const { game } = state;
  const phase = game.phase;
  // A spectator is treated as holding no seat rather than as a special case
  // below, so there is one code path and no branch that could hand a watcher a
  // hand by omission.
  const ownIndex = perspective === 'spectator' ? null : seatIndex(perspective);

  const seats = MAHJONG_SEATS.map((seat, index): MahjongSeatView => {
    const counts = (game.hands[index] ?? []) as readonly number[];
    return {
      seat,
      melds: ((game.melds[index] ?? []) as readonly HandSet[]).map((meld) => ({
        kind: meld.kind,
        concealed: meld.concealed,
        tile: meld.concealed && index !== ownIndex ? null : meld.tile,
      })),
      discards: [...((game.discards[index] ?? []) as readonly TileIndex[])],
      flowers: [...((game.flowers[index] ?? []) as readonly number[])],
      handSize: handSizeOf(counts),
      ...(index === ownIndex ? { hand: tilesOf(counts) } : {}),
    };
  });

  return {
    perspective,
    status: state.status,
    moveNumber: state.moveNumber,
    seats,
    turn: seatName(game.turn),
    phase: phase.type,
    wallRemaining: game.wall.length,
    dealer: seatName(game.dealer),
    roundWind: game.roundWind,
    discardUnderClaim: phase.type === 'claim-window' ? phase.discard : null,
    ownClaims: ownIndex === null ? [] : claimsFor(state, ownIndex),
    awaiting: pendingClaimants(state),
    windowClosesAt: state.windowClosesAt,
  };
}

/**
 * The view a finished game is revealed with: every hand face up.
 *
 * Only correct once the hand is over. Calling it mid-game would hand a seat the
 * other three hands, so it refuses rather than trusting its caller.
 */
export function mahjongRevealedView(
  state: MahjongTenantState,
  perspective: MahjongSeat | 'spectator',
): MahjongPlayerView {
  if (state.status.type === 'playing') {
    throw new Error('cannot reveal hands while the game is still being played');
  }
  const base = mahjongViewFor(state, perspective);
  return {
    ...base,
    seats: base.seats.map((seat, index) => ({
      ...seat,
      hand: tilesOf((state.game.hands[index] ?? []) as readonly number[]),
      // A concealed kong's tile is part of the score, so it cannot stay hidden
      // in the record of a finished hand.
      melds: ((state.game.melds[index] ?? []) as readonly HandSet[]).map((meld) => ({
        kind: meld.kind,
        concealed: meld.concealed,
        tile: meld.tile,
      })),
    })),
  };
}
