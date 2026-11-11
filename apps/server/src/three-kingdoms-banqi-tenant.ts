/**
 * Three Kingdoms Banqi (三國暗棋, #628): public casual play, always unrated.
 * Runtime admission follows the flag, with an admin fallback when it is off.
 * The registration supplies lobby, TV, finished export and card capabilities.
 * Correspondence remains unavailable.
 *
 * Same hidden-information shape as banqi (banqi-tenant.ts): every occupied square
 * is public, so the masked board is the same for both seats; the one secret is
 * the deal. rules.createSetup mints it with a crypto RNG, the runtime keeps it in
 * the room-created event, and clientEventFor strips it before any client sees it.
 * viewForClient is the kernel's masked view, which carries no identity for a
 * face-down square. The full board goes out only once the game is over.
 */

import { randomInt } from 'node:crypto';
import {
  type AbortReason,
  ALL_THREE_KINGDOMS_BANQI_SQUARES,
  applyThreeKingdomsBanqiMove,
  type BanqiSeat,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiPlayerView,
  isThreeKingdomsBanqiLegalMove,
  oppositeBanqiSeat,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiPlayerView,
  type ThreeKingdomsBanqiSquare,
  type ThreeKingdomsBanqiState,
} from '@mistboard/game';
import type * as persistence from './persistence.js';
import {
  isThreeKingdomsBanqiEngineClientId,
  threeKingdomsBanqiEngineDisplayName,
  threeKingdomsBanqiEngineVersion,
} from './three-kingdoms-banqi-engine.js';
import { tenantPerPlyViews, tenantPveEngineId } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantClockState,
  TenantProjection,
  TenantRoomEvent,
  TenantRuntimeRoom,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const THREE_KINGDOMS_BANQI_ROOM_ID_PREFIX = 'tkb_';
const SEATS = ['red', 'black'] as const satisfies readonly BanqiSeat[];

export type ThreeKingdomsBanqiSpecId = typeof THREE_KINGDOMS_BANQI_SPEC_ID;
export type ThreeKingdomsBanqiTenant = VariantTenant<
  'three-kingdoms-banqi',
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiState,
  ThreeKingdomsBanqiPlayerView,
  ThreeKingdomsBanqiSpecId
>;
export type ThreeKingdomsBanqiEvent = TenantRoomEvent<
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiSpecId
>;
export type ThreeKingdomsBanqiClientEvent = TenantClientEvent<
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiSpecId
>;
export type ThreeKingdomsBanqiClockState = TenantClockState<BanqiSeat>;
export type ThreeKingdomsBanqiProjection = TenantProjection<
  BanqiSeat,
  ThreeKingdomsBanqiState,
  ThreeKingdomsBanqiSpecId
>;
export type ThreeKingdomsBanqiRuntimeRoom = TenantRuntimeRoom<
  'three-kingdoms-banqi',
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiState,
  ThreeKingdomsBanqiSpecId
>;

const SQUARES: ReadonlySet<string> = new Set(ALL_THREE_KINGDOMS_BANQI_SQUARES);

export function isThreeKingdomsBanqiSquare(value: unknown): value is ThreeKingdomsBanqiSquare {
  return typeof value === 'string' && SQUARES.has(value);
}

function isSeat(value: unknown): value is BanqiSeat {
  return value === 'red' || value === 'black';
}

function isMove(value: unknown): value is ThreeKingdomsBanqiMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  return isThreeKingdomsBanqiSquare(move.from) && isThreeKingdomsBanqiSquare(move.to);
}

// The deal is a hidden-information secret: crypto, never Math.random.
const RNG_RANGE = 2 ** 31;
function cryptoRng(): number {
  return randomInt(0, RNG_RANGE) / RNG_RANGE;
}

export function threeKingdomsBanqiClientEventFor(
  event: ThreeKingdomsBanqiEvent,
  _seat: TenantSeat<BanqiSeat>,
  ply: number,
): ThreeKingdomsBanqiClientEvent | null {
  if (event.type === 'room-created') {
    if (event.setup === undefined) return event;
    const redacted = { ...event };
    delete redacted.setup;
    return redacted;
  }
  if (event.type === 'move-played') return { ...event, ply };
  return event;
}

export function getThreeKingdomsBanqiClientView(
  state: ThreeKingdomsBanqiState,
  client: TenantSnapshotClient<BanqiSeat>,
): ThreeKingdomsBanqiPlayerView {
  // Symmetric hidden identity: the red seat's masked view is the public board; a
  // spectator gets it without the candidate moves.
  if (client.seat === 'spectator') {
    return { ...getThreeKingdomsBanqiPlayerView(state, 'red'), legalMoves: [] };
  }
  return getThreeKingdomsBanqiPlayerView(state, client.seat);
}

/** The unredacted board, for a finished game only (the runtime owns the when). */
export function getThreeKingdomsBanqiTruthView(
  state: ThreeKingdomsBanqiState,
): ThreeKingdomsBanqiPlayerView {
  const base = getThreeKingdomsBanqiPlayerView(state, 'red');
  const board: ThreeKingdomsBanqiPlayerView['board'] = {};
  for (const [square, piece] of Object.entries(state.board)) {
    if (!piece) continue;
    board[square as ThreeKingdomsBanqiSquare] = {
      color: piece.color,
      role: piece.role,
      faceDown: false,
    };
  }
  return { ...base, board, legalMoves: [] };
}

const TERMINATION: Record<string, persistence.GameTermination> = {
  score: 'points',
  'no-progress': 'progress-clock',
  'no-legal-move': 'no-legal-moves',
  agreement: 'draw',
  timeout: 'timeout',
  resignation: 'resignation',
  abandonment: 'abandonment',
};

export const threeKingdomsBanqiTenant: ThreeKingdomsBanqiTenant = {
  kind: 'three-kingdoms-banqi',
  gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
  roomIdPrefix: THREE_KINGDOMS_BANQI_ROOM_ID_PREFIX,
  colors: SEATS,
  // The runtime stays on so historical rooms replay and admins can test
  // while the runtime flag is off. Who may start one is decided at the doors
  // (three-kingdoms-banqi-access.ts); every start path carries its own admission.
  enabled: () => true,
  oppositeColor: oppositeBanqiSeat,
  rules: {
    createInitialState: (roomId, setup) => createThreeKingdomsBanqiStateFromSetup(roomId, setup),
    createSetup: () => createThreeKingdomsBanqiSetup(cryptoRng),
    applyMove: (state, move) => applyThreeKingdomsBanqiMove(state, move),
    isLegalMove: isThreeKingdomsBanqiLegalMove,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    finishDraw: (state) => ({
      ...state,
      status: { type: 'finished', winner: null, reason: 'agreement' },
    }),
    abort: (state, reason: AbortReason) => ({
      ...state,
      status: { type: 'aborted', reason },
    }),
    isColor: isSeat,
    isMove,
    moveFromMessage: (message) => {
      if (!isThreeKingdomsBanqiSquare(message.from) || !isThreeKingdomsBanqiSquare(message.to)) {
        return null;
      }
      return { from: message.from, to: message.to };
    },
  },
  visibility: {
    clientEventFor: threeKingdomsBanqiClientEventFor,
    viewForClient: (state, client) => getThreeKingdomsBanqiClientView(state, client),
    // The deal is a server secret, so a reload gets the server's per-ply masked
    // views rather than replaying the log itself.
    liveHistory: (events, viewer) => tenantPerPlyViews(threeKingdomsBanqiTenant, events, viewer),
    // Keep covered identities masked after completion, including every per-ply view.
    liveHistoryWhenFinished: true,
  },
  // Keep the existing Play again flow; rematch is a separate product change.
  rematch: { optOut: 'Play again creates a fresh room (#628)' },
  engine: {
    terminalContext: 'repetition-window',
    isEngineClientId: isThreeKingdomsBanqiEngineClientId,
    displayName: threeKingdomsBanqiEngineDisplayName,
    engineVersion: threeKingdomsBanqiEngineVersion,
    reservationReleaseTag: 'three-kingdoms-banqi',
  },
  wire: {
    snapshotExtras: (room) => {
      const pveEngineId = tenantPveEngineId(threeKingdomsBanqiTenant, room);
      return pveEngineId === null ? { roomMode: 'pvp' } : { roomMode: 'pve', pveEngineId };
    },
  },
  persistence: {
    resultForWinner: (winner: BanqiSeat | null): persistence.GameResult => {
      if (winner === 'red') return 'red-wins';
      if (winner === 'black') return 'black-wins';
      return 'draw';
    },
    termination: (reason: string): persistence.GameTermination => {
      const mapped = TERMINATION[reason];
      if (!mapped) throw new Error(`three kingdoms banqi: unmapped termination ${reason}`);
      return mapped;
    },
    logKindPrefix: 'three_kingdoms_banqi',
    logLabel: 'Three Kingdoms Banqi',
  },
};
