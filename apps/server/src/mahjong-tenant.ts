/**
 * Hong Kong mahjong VariantTenant — the first four-seat variant on this
 * platform, and the first where the seat to move is not the only seat that may
 * act.
 *
 * Three things here are unlike every other tenant:
 *
 *   - Four seats, named for the winds. `oppositeColor` has no meaning at a
 *     table of four, so this supplies `forfeitWinner`, which returns null: a
 *     player timing out does not hand the hand to somebody in particular.
 *   - The wall is server-secret. It is the entire future of the deal in order,
 *     produced by `createSetup`, persisted in room-created, and stripped from
 *     the wire by `clientEventFor`. A client holding it knows every tile
 *     everyone will draw.
 *   - A discard opens a window in which up to three other seats may respond.
 *     `seatMayAct` widens who may act, and `pendingAction` closes the window if
 *     somebody goes quiet, so one dropped connection cannot hang the table.
 *
 * GATED TWICE, on purpose. The feature flag is off, and the variant is on the
 * per-account allowlist (136). The hand mathematics is proven against an
 * independent implementation over 18,000 hands; the faan values are not proven
 * at all, having been read off sources that disagree with each other by nobody
 * who plays the game. Until a player has checked the scoring, the only people
 * who should see it are people who know they are checking it.
 */

import { randomInt } from 'node:crypto';
import { type AbortReason, MAHJONG_SPEC_ID } from '@mistboard/game';
import {
  applyMahjongMove,
  CLAIM_WINDOW_MS,
  type ClaimKind,
  createMahjongState,
  MAHJONG_SEATS,
  type MahjongAbortReason,
  type MahjongMove,
  type MahjongPlayerView,
  type MahjongSeat,
  type MahjongTenantState,
  mahjongIsLegalMove,
  mahjongRevealedView,
  mahjongSeatMayAct,
  mahjongViewFor,
  orderedWall,
  seatName,
  shuffleWall,
  type WallTile,
} from '@mistboard/mahjong';
import { mahjongEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import { isMahjongBotClientId } from './server-mahjong-bots.js';
import { tenantForfeitDeadlineForClient, tenantPveEngineId } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

// The mahjong package spells out its own copy of AbortReason rather than
// depending on @mistboard/game. These lines are what stop the copies drifting:
// a reason added on either side fails to compile here.
type AbortReasonsAgree = MahjongAbortReason extends AbortReason ? true : never;
type AbortReasonsAgreeBothWays = AbortReason extends MahjongAbortReason ? true : never;
const abortReasonsAgree: [AbortReasonsAgree, AbortReasonsAgreeBothWays] = [true, true];
void abortReasonsAgree;

export const MAHJONG_ROOM_ID_PREFIX = 'mj_';

export type MahjongEvent = TenantRoomEvent<MahjongSeat, MahjongMove, typeof MAHJONG_SPEC_ID>;
export type MahjongClientEvent = TenantClientEvent<
  MahjongSeat,
  MahjongMove,
  typeof MAHJONG_SPEC_ID
>;

export type MahjongTenantType = VariantTenant<
  'mahjong',
  MahjongSeat,
  MahjongMove,
  MahjongTenantState,
  MahjongPlayerView,
  typeof MAHJONG_SPEC_ID
>;

function isMahjongSeat(value: unknown): value is MahjongSeat {
  return typeof value === 'string' && (MAHJONG_SEATS as readonly string[]).includes(value);
}

const CLAIM_KINDS: readonly ClaimKind[] = ['win', 'kong', 'pung', 'chow'];

function isTileIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 34;
}

function isMahjongMove(value: unknown): value is MahjongMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  if (!isMahjongSeat(move.by) || typeof move.at !== 'number') return false;
  switch (move.action) {
    case 'draw':
    case 'pass':
    case 'timeout':
    case 'self-draw':
      return true;
    case 'discard':
      return isTileIndex(move.tile);
    case 'claim':
      return (
        CLAIM_KINDS.includes(move.kind as ClaimKind) &&
        Array.isArray(move.fromHand) &&
        move.fromHand.every(isTileIndex)
      );
    default:
      return false;
  }
}

/**
 * Parse a move off the wire.
 *
 * The result is deliberately INCOMPLETE: `by` and `at` are placeholders here,
 * because a client does not get to say who it is or what time it is. They are
 * stamped in canonicalMove, which is the only path a live move takes. Nothing
 * applies the output of this function directly.
 */
function mahjongMoveFromMessage(message: {
  action?: string;
  tiles?: string[];
}): MahjongMove | null {
  const placeholder = { by: 'east' as MahjongSeat, at: 0 };
  const tiles = (message.tiles ?? []).map(Number);
  if (tiles.some((tile) => !isTileIndex(tile))) return null;
  switch (message.action) {
    case 'draw':
      return { ...placeholder, action: 'draw' };
    case 'pass':
      return { ...placeholder, action: 'pass' };
    case 'self-draw':
      return { ...placeholder, action: 'self-draw' };
    case 'discard': {
      const [tile] = tiles;
      return tile === undefined ? null : { ...placeholder, action: 'discard', tile };
    }
    case 'win':
    case 'kong':
    case 'pung':
    case 'chow':
      return { ...placeholder, action: 'claim', kind: message.action, fromHand: tiles };
    default:
      // 'timeout' is deliberately absent: it is the runtime's move, never a
      // client's. A seat that could send it would be able to cut short a window
      // other people are still thinking in.
      return null;
  }
}

export function mahjongClientEventFor(
  event: MahjongEvent,
  _seat: TenantSeat<MahjongSeat>,
  ply: number,
): MahjongClientEvent | null {
  if (event.type === 'room-created') {
    // The wall. Everything else about the room is public; this is the hand's
    // entire future in order.
    if (event.setup === undefined) return event;
    const redacted = { ...event };
    delete redacted.setup;
    return redacted;
  }
  // A move is safe to broadcast as-is: a draw names no tile (the tile comes off
  // the wall, which lives in state), and a discard or a claim is face up on the
  // mat the moment it happens.
  if (event.type === 'move-played') return { ...event, ply };
  return event;
}

export function getMahjongClientView(
  state: MahjongTenantState,
  client: TenantSnapshotClient<MahjongSeat>,
): MahjongPlayerView {
  const perspective = client.seat === 'spectator' ? 'spectator' : client.seat;
  // Once the hand is over the tiles are turned face up, the way they are at a
  // table: the losers' hands are how you check the winner was paid correctly.
  return state.status.type === 'playing'
    ? mahjongViewFor(state, perspective)
    : mahjongRevealedView(state, perspective);
}

/**
 * A TOTAL map, not a cast.
 *
 * `games_termination_check` is a CHECK constraint, so a value outside it fails
 * the whole recordGameEnd transaction: the games row and its participants roll
 * back together and a finished hand ends up with no record at all. Migration
 * 114 exists because Flip Jungle shipped that exact bug.
 */
const MAHJONG_TERMINATION: Record<string, persistence.GameTermination> = {
  // A hand nobody won: the wall ran out. 'draw' is the allowlisted spelling.
  exhausted: 'draw',
  'self-draw': 'checkmate',
  discard: 'checkmate',
  timeout: 'timeout',
  resignation: 'resignation',
  abandonment: 'abandonment',
};

export const mahjongTenant: MahjongTenantType = {
  kind: 'mahjong',
  gameSpecId: MAHJONG_SPEC_ID,
  roomIdPrefix: MAHJONG_ROOM_ID_PREFIX,
  // Turn order, which is also the seating order: play passes to the right.
  colors: MAHJONG_SEATS,
  enabled: mahjongEnabled,
  oppositeColor: () => {
    // Unreachable: assertForfeitPolicy refuses to build a room for a tenant with
    // more than two seats and no forfeitWinner, and forfeitWinnerOf prefers
    // forfeitWinner when present. Throwing rather than returning a plausible
    // seat means a new caller that forgets shows up immediately.
    throw new Error('mahjong has four seats: "the opposite seat" has no meaning');
  },
  // Nobody wins because somebody left. The hand is over, and no seat is awarded
  // it: a two-player forfeit hands the game to the other player, and there is no
  // "the other player" here.
  forfeitWinner: () => null,
  rules: {
    createSetup: () => shuffleWall(() => randomInt(2 ** 30) / 2 ** 30, orderedWall()),
    createInitialState: (roomId, setup) => {
      // A room with no persisted wall is a programming error, not a recoverable
      // state: dealing a fresh one here would give a reconnecting player a
      // different hand from the one they were holding.
      if (!Array.isArray(setup)) throw new Error('mahjong room has no persisted wall');
      return createMahjongState(setup as readonly WallTile[], roomId);
    },
    applyMove: applyMahjongMove,
    isLegalMove: mahjongIsLegalMove,
    seatMayAct: mahjongSeatMayAct,
    pendingAction: (state) => {
      if (state.windowClosesAt === null) return null;
      const phase = state.game.phase;
      if (phase.type !== 'claim-window') return null;
      // Played BY the discarder, whose window it is, and it settles the whole
      // window in one move rather than one per silent seat.
      const by = seatName(phase.discarder);
      return {
        at: state.windowClosesAt,
        color: by,
        move: { by, at: state.windowClosesAt, action: 'timeout' },
      };
    },
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    // Somebody left. The hand is over and nobody won it: there is no seat to
    // award it to, and awarding it to whoever happens to sit next would be an
    // invented rule.
    finishNoWinner: (state, reason) => ({
      ...state,
      status: { type: 'finished', winner: null, reason },
    }),
    abort: (state, reason: AbortReason) => ({ ...state, status: { type: 'aborted', reason } }),
    isColor: isMahjongSeat,
    isMove: isMahjongMove,
    moveFromMessage: mahjongMoveFromMessage,
    canonicalMove: (state, move, seat) => {
      // Where a parsed message becomes a real move: the seat is the socket's,
      // never the client's claim about itself, and the time is the server's.
      const stamped = { ...move, by: seat, at: Date.now() } as MahjongMove;
      if (!mahjongSeatMayAct(state, seat)) return null;
      if (!mahjongIsLegalMove(state, stamped)) return null;
      return stamped;
    },
  },
  // The bots are not an engine SERVICE, but the runtime's notion of "engine
  // seat" is what marks a seat as present without a socket behind it. Without
  // this block every bot seat reads as a disconnected player, the forfeit timer
  // arms on all three, and the hand ends itself about thirty seconds in with an
  // abandonment nobody committed. That is exactly what it did before this.
  engine: {
    // The bots are handed the whole state each move and hold nothing between
    // moves, so there is no history for them to be missing.
    terminalContext: 'full-history',
    isEngineClientId: isMahjongBotClientId,
    displayName: () => 'Mahjong bot',
    // In-process: no reservation is ever taken, so nothing is released.
    reservationReleaseTag: 'mahjong',
  },
  visibility: {
    clientEventFor: mahjongClientEventFor,
    viewForClient: (state, client) => getMahjongClientView(state, client),
  },
  wire: {
    snapshotExtras: (room, client) => {
      const pveEngineId = tenantPveEngineId(mahjongTenant, room);
      return {
        roomMode: pveEngineId === null ? 'pvp' : 'pve',
        ...(pveEngineId === null ? {} : { pveEngineId }),
        rated: room.rated,
        forfeitDeadline: tenantForfeitDeadlineForClient(mahjongTenant, room, client),
        // So a client can render the countdown on an open claim window without
        // knowing the rule that sets it.
        claimWindowMs: CLAIM_WINDOW_MS,
      };
    },
  },
  persistence: {
    resultForWinner: (winner: MahjongSeat | null): persistence.GameResult => {
      if (winner === null) return 'draw';
      return `${winner}-wins`;
    },
    termination: (reason: string): persistence.GameTermination => {
      const mapped = MAHJONG_TERMINATION[reason];
      if (!mapped) {
        throw new Error(`mahjong: unmapped termination reason "${reason}"`);
      }
      return mapped;
    },
    logKindPrefix: 'mahjong',
    logLabel: 'Mahjong',
  },
};
