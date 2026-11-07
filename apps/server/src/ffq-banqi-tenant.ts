/**
 * Unregistered FFQ banqi tenant. No route, room map, engine or public surface
 * is installed here. The shared access policy lives in ffq-banqi-access.ts.
 * The crypto deal is server-secret; snapshots and per-ply history remain
 * masked for both seats and observers, including after any game ending.
 */
import { randomInt } from 'node:crypto';
import {
  applyFFQBanqiMove,
  type BanqiColor,
  createFFQBanqiSetup,
  createFFQBanqiStateFromSetup,
  FFQ_BANQI_SPEC_ID,
  type FFQBanqiEndReason,
  type FFQBanqiMove,
  type FFQBanqiPlayerView,
  type FFQBanqiState,
  getFFQBanqiPlayerView,
  isFFQBanqiLegalMove,
  oppositeBanqiColor,
} from '@mistboard/game';
import { FFQ_BANQI_ROOM_ID_PREFIX } from './ffq-banqi-access.js';
import type * as persistence from './persistence.js';
import { tenantPerPlyViews } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantRuntimeRoom,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export { FFQ_BANQI_ROOM_ID_PREFIX } from './ffq-banqi-access.js';
export type FFQBanqiTenant = VariantTenant<
  'ffq-banqi',
  BanqiColor,
  FFQBanqiMove,
  FFQBanqiState,
  FFQBanqiPlayerView,
  typeof FFQ_BANQI_SPEC_ID
>;
export type FFQBanqiEvent = TenantRoomEvent<BanqiColor, FFQBanqiMove, typeof FFQ_BANQI_SPEC_ID>;
export type FFQBanqiClientEvent = TenantClientEvent<
  BanqiColor,
  FFQBanqiMove,
  typeof FFQ_BANQI_SPEC_ID
>;
export type FFQBanqiRuntimeRoom = TenantRuntimeRoom<
  'ffq-banqi',
  BanqiColor,
  FFQBanqiMove,
  FFQBanqiState,
  typeof FFQ_BANQI_SPEC_ID
>;

function isSquare(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 32;
}

function isMove(value: unknown): value is FFQBanqiMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  return isSquare(move.from) && isSquare(move.to);
}

// No predictable seed or RNG state survives in a room's setup.
const RNG_RANGE = 2 ** 31;
function cryptoRng(): number {
  return randomInt(0, RNG_RANGE) / RNG_RANGE;
}

export function ffqBanqiClientEventFor(
  event: FFQBanqiEvent,
  _seat: TenantSeat<BanqiColor>,
  ply: number,
): FFQBanqiClientEvent | null {
  if (event.type === 'room-created') {
    const redacted = { ...event };
    delete redacted.setup;
    return redacted;
  }
  if (event.type === 'move-played') return { ...event, ply };
  return event;
}

export function getFFQBanqiClientView(
  state: FFQBanqiState,
  client: TenantSnapshotClient<BanqiColor>,
): FFQBanqiPlayerView {
  return getFFQBanqiPlayerView(state, client.seat === 'spectator' ? 'observer' : client.seat);
}

const TERMINATION = {
  hp: 'points',
  'no-progress': 'progress-clock',
  'no-legal-move': 'no-legal-moves',
  timeout: 'timeout',
  resignation: 'resignation',
  abandonment: 'abandonment',
  agreement: 'draw',
} as const satisfies Record<FFQBanqiEndReason, persistence.GameTermination>;

export const ffqBanqiTenant: FFQBanqiTenant = {
  kind: 'ffq-banqi',
  gameSpecId: FFQ_BANQI_SPEC_ID,
  roomIdPrefix: FFQ_BANQI_ROOM_ID_PREFIX,
  colors: ['red', 'black'],
  // Runtime plumbing only. No registry entry or network door reaches it.
  enabled: () => true,
  oppositeColor: oppositeBanqiColor,
  rules: {
    createInitialState: createFFQBanqiStateFromSetup,
    createSetup: () => createFFQBanqiSetup(cryptoRng),
    applyMove: applyFFQBanqiMove,
    isLegalMove: isFFQBanqiLegalMove,
    finish: (state, winner, reason) => ({ ...state, status: { type: 'finished', winner, reason } }),
    finishDraw: (state) => ({
      ...state,
      status: { type: 'finished', winner: null, reason: 'agreement' },
    }),
    abort: (state, reason) => ({ ...state, status: { type: 'aborted', reason } }),
    isColor: (value): value is BanqiColor => value === 'red' || value === 'black',
    isMove,
    // FFQ uses integer indices 0..31 on the wire, exactly as in its kernel.
    moveFromMessage: (message) => (isMove(message) ? { from: message.from, to: message.to } : null),
  },
  visibility: {
    clientEventFor: ffqBanqiClientEventFor,
    viewForClient: getFFQBanqiClientView,
    // No truthView: the generic runtime must keep the mask at game end.
    liveHistory: (events, viewer) => tenantPerPlyViews(ffqBanqiTenant, events, viewer),
    liveHistoryWhenFinished: true,
  },
  rematch: { optOut: 'unregistered playtest with no room factory' },
  wire: { snapshotExtras: () => ({ roomMode: 'pvp' }) },
  persistence: {
    resultForWinner: (winner) =>
      winner === 'red' ? 'red-wins' : winner === 'black' ? 'black-wins' : 'draw',
    termination: (reason) => {
      if (!Object.hasOwn(TERMINATION, reason)) {
        throw new Error(`FFQ banqi: unmapped termination ${reason}`);
      }
      return TERMINATION[reason as FFQBanqiEndReason];
    },
    logKindPrefix: 'ffq_banqi',
    logLabel: 'Fanfanqi',
  },
};
