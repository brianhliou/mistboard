/**
 * Banqi VariantTenant — 8×4 Chinese Dark Chess on the Layer-3 tenant contract
 * (variant-tenant/tenant.ts).
 *
 * Banqi is symmetric-information: every occupied square is public (face-down or
 * revealed), so the masked board is identical for both seats and the wire events
 * pass through unchanged. The ONE hidden thing is the deal — which face-down tile
 * holds which piece — and this tenant guards it in two places:
 *   - the per-game DEAL is a server secret. rules.createSetup mints it with a
 *     crypto RNG; the runtime persists it in the room-created event; this
 *     tenant's clientEventFor STRIPS it before any client sees the event.
 *   - the board's face-down tiles are redacted by getBanqiPlayerView (which
 *     carries no ink/identity for a face-down square), and viewForClient
 *     delegates to it.
 *
 * The tenant's C is the SEAT (BanqiSeat = 'red' | 'black', where 'red' = the
 * first mover). The red seat binds its ink on the opening flip and may end up
 * owning the black ink — so the seat axis is distinct from the piece ink, even
 * though both use red/black. resultForWinner records the winning seat directly;
 * the actual ink rides on the view's firstColor for rendering.
 */

import { randomInt } from 'node:crypto';
import {
  type AbortReason,
  applyBanqiMove,
  BANQI_SEATS,
  BANQI_SPEC_ID,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPlayerView,
  type BanqiSeat,
  type BanqiSquare,
  createBanqiDeal,
  createInitialBanqiState,
  getBanqiPlayerView,
  isBanqiLegalMove,
  oppositeBanqiSeat,
} from '@mistboard/game';
import {
  banqiEngineDisplayName,
  banqiEngineVersion,
  isBanqiEngineClientId,
} from './banqi-engine.js';
import { banqiEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import { tenantPveEngineId } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

// Live-room registration (HTTP create / lobby / ws plumbing) is gated behind the
// banqi flag; the spec id is first-class (@mistboard/game GAME_SPECS).
export const BANQI_ROOM_ID_PREFIX = 'bq_';

export type BanqiTenant = VariantTenant<
  'banqi',
  BanqiSeat,
  BanqiMove,
  BanqiGameState,
  BanqiPlayerView,
  typeof BANQI_SPEC_ID
>;

const SQUARE = /^[a-h][1-4]$/;

export function isBanqiSquare(value: unknown): value is BanqiSquare {
  return typeof value === 'string' && SQUARE.test(value);
}

function isBanqiSeat(value: unknown): value is BanqiSeat {
  return value === 'red' || value === 'black';
}

function isBanqiMove(value: unknown): value is BanqiMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  // A flip is the self-move from === to; both endpoints must still be squares.
  return isBanqiSquare(move.from) && isBanqiSquare(move.to);
}

// A crypto-backed float in [0, 1): the deal is a hidden-information secret, so it
// must not come from Math.random.
const RNG_RANGE = 2 ** 31;
function cryptoRng(): number {
  return randomInt(0, RNG_RANGE) / RNG_RANGE;
}

// Reconstruct a deal from the persisted room-created setup. createInitialBanqiState
// fully validates it (throws on a corrupt multiset); this only shape-checks the
// container. Returns undefined when absent so the kernel falls back to its default
// deal — that path is only hit by the runtime's throwaway seed projection (the
// room-created event always carries the real crypto deal for live rooms/replay).
function asBanqiDeal(setup: unknown): BanqiDeal | undefined {
  return Array.isArray(setup) ? (setup as BanqiDeal) : undefined;
}

// Identity is hidden, position is not: moves are public to both seats. The only
// redaction on the wire is stripping the server-secret deal from room-created.
// (Spectators receive no events for now — /room/ never reveals; a public masked
// spectator view can come with the spectator surface.)
export function banqiClientEventFor(
  event: TenantRoomEvent<BanqiSeat, BanqiMove, typeof BANQI_SPEC_ID>,
  seat: TenantSeat<BanqiSeat>,
  ply: number,
): TenantClientEvent<BanqiSeat, BanqiMove, typeof BANQI_SPEC_ID> | null {
  if (seat === 'spectator') return null;
  if (event.type === 'room-created') {
    if (event.setup === undefined) return event;
    const redacted = { ...event };
    delete redacted.setup;
    return redacted;
  }
  if (event.type === 'move-played') return { ...event, ply };
  return event;
}

function emptyBanqiView(state: BanqiGameState): BanqiPlayerView {
  return {
    id: state.id,
    perspective: 'red',
    board: {},
    legalMoves: [],
    captured: [],
    status: state.status,
    ply: state.ply,
    firstColor: null,
    moveNumber: state.moveNumber,
    lastMove: undefined,
  };
}

export function getBanqiClientView(
  state: BanqiGameState,
  client: TenantSnapshotClient<BanqiSeat>,
): BanqiPlayerView {
  // Spectator policy: empty view for now (/room/ never reveals). A public masked
  // view for observers can come with the spectator surface — banqi leaks nothing
  // to a spectator except the deal, which the masked view already hides.
  if (client.seat === 'spectator') return emptyBanqiView(state);
  return getBanqiPlayerView(state, client.seat);
}

// The unredacted board, served to every client once the game is FINISHED
// (docs-private/spectator-visibility-matrix.md). The runtime owns the WHEN via
// roomViewPolicy; this only says what truth looks like on the wire.
//
// Tiles that were never flipped come back with their dealt identity, which
// exposes the deal. That is not a new disclosure: the postgame truth history
// already reveals all 32 tiles once a game ends, and an earlier session
// reconstructed a whole deal from exactly that public data to build the rules
// page (commit f2ad3e9). The room was the last surface still withholding it.
export function getBanqiTruthView(state: BanqiGameState): BanqiPlayerView {
  const base = getBanqiPlayerView(state, BANQI_SEATS[0]);
  const board: BanqiPlayerView['board'] = {};
  for (const [square, piece] of Object.entries(state.board)) {
    if (!piece) continue;
    board[square as BanqiSquare] = { color: piece.color, role: piece.role, faceDown: false };
  }
  return { ...base, board, legalMoves: [] };
}

export const banqiTenant: BanqiTenant = {
  kind: 'banqi',
  gameSpecId: BANQI_SPEC_ID,
  roomIdPrefix: BANQI_ROOM_ID_PREFIX,
  colors: BANQI_SEATS,
  enabled: banqiEnabled,
  oppositeColor: oppositeBanqiSeat,
  rules: {
    createInitialState: (roomId, setup) => createInitialBanqiState(roomId, asBanqiDeal(setup)),
    createSetup: () => createBanqiDeal(cryptoRng),
    applyMove: (state, move) => applyBanqiMove(state, move),
    isLegalMove: isBanqiLegalMove,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    abort: (state, reason: AbortReason) => ({
      ...state,
      status: { type: 'aborted', reason },
    }),
    isColor: isBanqiSeat,
    isMove: isBanqiMove,
    moveFromMessage: (message) => {
      if (!isBanqiSquare(message.from) || !isBanqiSquare(message.to)) return null;
      return { from: message.from, to: message.to };
    },
  },
  visibility: {
    clientEventFor: banqiClientEventFor,
    viewForClient: (state, client) => getBanqiClientView(state, client),
    truthView: (state) => getBanqiTruthView(state),
  },
  // Mark the MistyBanqi engine seat as always-present so the disconnect-forfeit
  // logic never forfeits it (a PvE engine has no WS client). Without this, the
  // engine seat reads as "disconnected" and the game self-forfeits mid-play
  // ("the human wins by abandonment") once the forfeit window elapses.
  engine: {
    terminalContext: 'repetition-window',
    isEngineClientId: isBanqiEngineClientId,
    displayName: banqiEngineDisplayName,
    engineVersion: banqiEngineVersion,
    reservationReleaseTag: 'banqi',
  },
  // Banqi's core snapshot has no forfeit/rematch surface; the only extras are
  // the room mode + engine id. Without them the client can't tell a finished
  // PvE game from a PvP one, so "Play again" fell back to a PvP invite instead
  // of re-creating a PvE game vs the same engine.
  wire: {
    snapshotExtras: (room) => {
      const pveEngineId = tenantPveEngineId(banqiTenant, room);
      return pveEngineId === null ? { roomMode: 'pvp' } : { roomMode: 'pve', pveEngineId };
    },
  },
  persistence: {
    // The winner is a SEAT ('red' = first mover). Recorded directly; the actual
    // ink rides on the view's firstColor for rendering/review.
    resultForWinner: (winner: BanqiSeat | null): persistence.GameResult => {
      if (winner === 'red') return 'red-wins';
      if (winner === 'black') return 'black-wins';
      return 'draw';
    },
    // The kernel spells the 40-ply no-progress draw 'no-progress'; the canonical
    // GameTermination value (shared with xiangqi/mini-xiangqi, and the
    // only one the games_termination_check CHECK accepts) is 'progress-clock'.
    // Translate it — a blind cast launders the invalid string past TS and only
    // fails at the DB write, silently dropping every no-progress draw.
    termination: (reason: string): persistence.GameTermination =>
      reason === 'no-progress' ? 'progress-clock' : (reason as persistence.GameTermination),
    logKindPrefix: 'banqi',
    logLabel: 'Banqi',
  },
};
