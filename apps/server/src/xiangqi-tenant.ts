/**
 * Standard Xiangqi (9x10, open information) VariantTenant — the open-info
 * sibling of the Dark Xiangqi tenant. Same board, pieces, setup, and movement
 * kernel; the ONLY difference is that standard play is check-aware AND fully
 * public. There is no hidden information to protect: both seats AND spectators
 * receive the complete truth board on every update, so there is no per-seat
 * event redaction, no shrouded wire board, and no spectator empty view.
 *
 * Rules run through the standard (check-aware) module: applyStandardXiangqiMove
 * does terminal detection (checkmate → mover wins, stalemate → mover wins,
 * threefold / progress-clock → draw). No engine is wired yet (Pikafish arrives
 * in a later increment), so the engine block is a stub that recognizes no
 * engine client ids and every game is PvP.
 */

import {
  type AbortReason,
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiPlayerView,
  isStandardXiangqiLegalMove,
  type StandardXiangqiPlayerView,
  XIANGQI_SPEC_ID,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiSquare,
  xiangqiPerpetualCheckLoser,
} from '@mistboard/game';
import { xiangqiEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import {
  isXiangqiEngineClientId,
  xiangqiEngineDisplayName,
  xiangqiEngineVersion,
} from './server-xiangqi-engine.js';
import { tenantForfeitDeadlineForClient, tenantPveEngineId } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const XIANGQI_ROOM_ID_PREFIX = 'xq_';

type XiangqiSpecId = typeof XIANGQI_SPEC_ID;

type XiangqiEvent = TenantRoomEvent<XiangqiColor, XiangqiMove, XiangqiSpecId>;
type XiangqiClientEvent = TenantClientEvent<XiangqiColor, XiangqiMove, XiangqiSpecId>;

// Open information: the wire PlayerView IS the full StandardXiangqiPlayerView —
// a truth board of plain XiangqiPiece, no shrouding, no visibleSquares.
export type XiangqiWirePlayerView = StandardXiangqiPlayerView;

export type XiangqiTenant = VariantTenant<
  'xiangqi',
  XiangqiColor,
  XiangqiMove,
  XiangqiGameState,
  XiangqiWirePlayerView,
  XiangqiSpecId
>;

function isXiangqiColor(value: unknown): value is XiangqiColor {
  return value === 'red' || value === 'black';
}

function isXiangqiMove(value: unknown): value is XiangqiMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Partial<Record<keyof XiangqiMove, unknown>>;
  return typeof move.from === 'string' && typeof move.to === 'string';
}

// Open info: every event flows to every client unchanged (no per-seat move
// redaction, no null for spectators). ply is stamped on move-played so the wire
// carries the move index, matching the perfect-info tenants.
export function xiangqiClientEventFor(
  event: XiangqiEvent,
  _seat: TenantSeat<XiangqiColor>,
  ply: number,
): XiangqiClientEvent {
  if (event.type !== 'move-played') return event;
  return { ...event, ply };
}

// Open info: return the full truth board for the seat's perspective. Spectators
// get the full board from red's perspective (NOT an empty view). No lastMove
// stripping.
export function getXiangqiClientView(
  state: XiangqiGameState,
  client: TenantSnapshotClient<XiangqiColor>,
): XiangqiWirePlayerView {
  const perspective = client.seat === 'black' ? 'black' : 'red';
  return getStandardXiangqiPlayerView(state, perspective);
}

function xiangqiResult(winner: XiangqiColor | null): persistence.GameResult {
  if (winner === 'red') return 'red-wins';
  if (winner === 'black') return 'black-wins';
  return 'draw';
}

export const xiangqiTenant: XiangqiTenant = {
  kind: 'xiangqi',
  gameSpecId: XIANGQI_SPEC_ID,
  roomIdPrefix: XIANGQI_ROOM_ID_PREFIX,
  colors: ['red', 'black'],
  enabled: xiangqiEnabled,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  rules: {
    createInitialState: createInitialXiangqiState,
    // Apply the move, then enforce the chasing rule: a three-fold repetition
    // reached by one side's perpetual check is a LOSS for that side, not a draw.
    // Real xiangqi (AXF/WXF/CXA) has never scored it as a draw, and without this
    // a losing side can perpetual-check its way to half a point. The move
    // history rides along on state.moveLog, so this needs no shared runtime
    // change and reruns identically on event replay. Mirrors the Fortress
    // tenant; perpetual material *chase* is still out of scope on both.
    applyMove: (state, move) => {
      const next = applyStandardXiangqiMove(state, move);
      if (next.status.type === 'finished' && next.status.reason === 'repetition') {
        const loser = xiangqiPerpetualCheckLoser(next.moveLog ?? []);
        if (loser) {
          return {
            ...next,
            status: {
              type: 'finished',
              winner: loser === 'red' ? 'black' : 'red',
              reason: 'chasing',
            },
          };
        }
      }
      return next;
    },
    isLegalMove: isStandardXiangqiLegalMove,
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
    isColor: isXiangqiColor,
    isMove: isXiangqiMove,
    moveFromMessage: (message) => {
      if (typeof message.from !== 'string' || typeof message.to !== 'string') return null;
      return { from: message.from as XiangqiSquare, to: message.to as XiangqiSquare };
    },
  },
  visibility: {
    clientEventFor: xiangqiClientEventFor,
    viewForClient: (state, client) => getXiangqiClientView(state, client),
  },
  engine: {
    terminalContext: 'full-history',
    // Mainline Pikafish PvE (server-xiangqi-engine.ts). Open information, so the
    // engine sees the full truth board and replays from `position startpos moves`.
    isEngineClientId: isXiangqiEngineClientId,
    displayName: xiangqiEngineDisplayName,
    engineVersion: xiangqiEngineVersion,
    reservationReleaseTag: 'xq',
  },
  wire: {
    // PvE display parity with Fortress: surface roomMode + the bot's engine id +
    // forfeit deadline. Open info, so no board re-encoding is needed.
    snapshotExtras: (room, client) => {
      const pveEngineId = tenantPveEngineId(xiangqiTenant, room);
      return {
        roomMode: pveEngineId === null ? 'pvp' : 'pve',
        ...(pveEngineId === null ? {} : { pveEngineId }),
        rated: room.rated,
        forfeitDeadline: tenantForfeitDeadlineForClient(xiangqiTenant, room, client),
      };
    },
  },
  persistence: {
    resultForWinner: xiangqiResult,
    termination: (reason: string) =>
      reason === 'agreement' ? 'draw' : (reason as persistence.GameTermination),
    logKindPrefix: 'xiangqi',
    logLabel: 'Xiangqi',
  },
};
