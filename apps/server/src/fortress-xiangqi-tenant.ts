/**
 * Fortress Xiangqi VariantTenant — perfect-information 7x8 "xiangqi with a
 * pocket": faithful movement + the Treasure + crazyhouse drops + the chasing
 * rule. Events and board state are public to both seats and spectators; the only
 * variant-specific wire shape is that a move may be a board move ({from,to}) or
 * a drop ({drop,to}).
 */

import {
  type AbortReason,
  applyFortressXiangqiMove,
  createInitialFortressXiangqiState,
  FORTRESS_DROP_ROLES,
  FORTRESS_XIANGQI_SPEC_ID,
  type FortressXiangqiColor,
  type FortressXiangqiDropMove,
  type FortressXiangqiDropRole,
  type FortressXiangqiGameState,
  type FortressXiangqiMove,
  type FortressXiangqiPlayerView,
  type FortressXiangqiSquare,
  fortressXiangqiPerpetualCheckLoser,
  getFortressXiangqiPlayerView,
  isFortressXiangqiLegalMove,
  oppositeFortressXiangqiColor,
} from '@mistboard/game';
import { fortressXiangqiEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import {
  fortressXiangqiEngineDisplayName,
  fortressXiangqiEngineVersion,
  isFortressXiangqiEngineClientId,
} from './server-fortress-xiangqi-engine.js';
import { tenantForfeitDeadlineForClient, tenantPveEngineId } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const FORTRESS_XIANGQI_ROOM_ID_PREFIX = 'fxq_';

export type FortressXiangqiEvent = TenantRoomEvent<
  FortressXiangqiColor,
  FortressXiangqiMove,
  typeof FORTRESS_XIANGQI_SPEC_ID
>;

export type FortressXiangqiClientEvent = TenantClientEvent<
  FortressXiangqiColor,
  FortressXiangqiMove,
  typeof FORTRESS_XIANGQI_SPEC_ID
>;

export type FortressXiangqiTenant = VariantTenant<
  'fortress-xiangqi',
  FortressXiangqiColor,
  FortressXiangqiMove,
  FortressXiangqiGameState,
  FortressXiangqiPlayerView,
  typeof FORTRESS_XIANGQI_SPEC_ID
>;

export function isFortressXiangqiSquare(value: unknown): value is FortressXiangqiSquare {
  return typeof value === 'string' && /^[a-g][1-8]$/.test(value);
}

function isFortressXiangqiColor(value: unknown): value is FortressXiangqiColor {
  return value === 'red' || value === 'black';
}

function isFortressXiangqiDropRole(value: unknown): value is FortressXiangqiDropRole {
  return typeof value === 'string' && (FORTRESS_DROP_ROLES as readonly string[]).includes(value);
}

function isFortressXiangqiDropMove(value: unknown): value is FortressXiangqiDropMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  return isFortressXiangqiDropRole(move.drop) && isFortressXiangqiSquare(move.to);
}

function isFortressXiangqiBoardMove(
  value: unknown,
): value is Extract<
  FortressXiangqiMove,
  { from: FortressXiangqiSquare; to: FortressXiangqiSquare }
> {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  return isFortressXiangqiSquare(move.from) && isFortressXiangqiSquare(move.to);
}

function isFortressXiangqiMove(value: unknown): value is FortressXiangqiMove {
  return isFortressXiangqiBoardMove(value) || isFortressXiangqiDropMove(value);
}

export function fortressXiangqiClientEventFor(
  event: FortressXiangqiEvent,
  _seat: TenantSeat<FortressXiangqiColor>,
  ply: number,
): FortressXiangqiClientEvent {
  if (event.type !== 'move-played') return event;
  return { ...event, ply };
}

export function getFortressXiangqiClientView(
  state: FortressXiangqiGameState,
  client: TenantSnapshotClient<FortressXiangqiColor>,
): FortressXiangqiPlayerView {
  const perspective = client.seat === 'black' ? 'black' : 'red';
  return getFortressXiangqiPlayerView(state, perspective);
}

export const fortressXiangqiTenant: FortressXiangqiTenant = {
  kind: 'fortress-xiangqi',
  gameSpecId: FORTRESS_XIANGQI_SPEC_ID,
  roomIdPrefix: FORTRESS_XIANGQI_ROOM_ID_PREFIX,
  colors: ['red', 'black'],
  enabled: fortressXiangqiEnabled,
  oppositeColor: oppositeFortressXiangqiColor,
  rules: {
    createInitialState: createInitialFortressXiangqiState,
    // Apply the move, then enforce the chasing rule: a three-fold repetition
    // reached by one side's perpetual check is a LOSS for that side, not a draw.
    // The move history rides along on state.moveLog, so this needs no shared
    // runtime change and reruns identically on event replay.
    applyMove: (state, move) => {
      const next = applyFortressXiangqiMove(state, move);
      if (next.status.type === 'finished' && next.status.reason === 'repetition') {
        const loser = fortressXiangqiPerpetualCheckLoser(next.moveLog ?? []);
        if (loser) {
          return {
            ...next,
            status: {
              type: 'finished',
              winner: oppositeFortressXiangqiColor(loser),
              reason: 'chasing',
            },
          };
        }
      }
      return next;
    },
    isLegalMove: isFortressXiangqiLegalMove,
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
    isColor: isFortressXiangqiColor,
    isMove: isFortressXiangqiMove,
    moveFromMessage: (message) => {
      if (isFortressXiangqiDropRole(message.drop) && isFortressXiangqiSquare(message.to)) {
        return { drop: message.drop, to: message.to };
      }
      if (!isFortressXiangqiSquare(message.from) || !isFortressXiangqiSquare(message.to)) {
        return null;
      }
      return { from: message.from, to: message.to };
    },
  },
  visibility: {
    clientEventFor: fortressXiangqiClientEventFor,
    viewForClient: (state, client) => getFortressXiangqiClientView(state, client),
  },
  engine: {
    terminalContext: 'full-history',
    isEngineClientId: isFortressXiangqiEngineClientId,
    displayName: fortressXiangqiEngineDisplayName,
    engineVersion: fortressXiangqiEngineVersion,
    reservationReleaseTag: 'fortress-xiangqi',
  },
  wire: {
    snapshotExtras: (room, client) => {
      const pveEngineId = tenantPveEngineId(fortressXiangqiTenant, room);
      return {
        roomMode: pveEngineId === null ? 'pvp' : 'pve',
        ...(pveEngineId === null ? {} : { pveEngineId }),
        rated: room.rated,
        forfeitDeadline: tenantForfeitDeadlineForClient(fortressXiangqiTenant, room, client),
      };
    },
  },
  persistence: {
    resultForWinner: (winner: FortressXiangqiColor | null): persistence.GameResult => {
      if (winner === 'red') return 'red-wins';
      if (winner === 'black') return 'black-wins';
      return 'draw';
    },
    termination: (reason: string) =>
      reason === 'agreement' ? 'draw' : (reason as persistence.GameTermination),
    logKindPrefix: 'fortress_xiangqi',
    logLabel: 'Fortress Xiangqi',
  },
};
