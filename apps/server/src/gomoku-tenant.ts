// Hidden freestyle Gomoku referee. The kernel owns legality and five/full-board
// endings; the generic runtime owns seats, clocks, reconnects and event replay.
import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  GOMOKU_SPEC_ID,
  type GomokuColor,
  type GomokuMove,
  type GomokuPlayerView,
  type GomokuRoomState,
  getGomokuPlayerView,
  isGomokuColor,
  parseGomokuMove,
} from '@mistboard/game';
import { gomokuEnabled } from './feature-flags.js';
import type { GameTermination } from './persistence.js';
import { tenantForfeitDeadlineForClient } from './variant-tenant/runtime.js';
import type { TenantRoomEvent, TenantRuntimeRoom, VariantTenant } from './variant-tenant/tenant.js';

export type GomokuEvent = TenantRoomEvent<GomokuColor, GomokuMove, typeof GOMOKU_SPEC_ID>;
export type GomokuRuntimeRoom = TenantRuntimeRoom<
  'gomoku',
  GomokuColor,
  GomokuMove,
  GomokuRoomState,
  typeof GOMOKU_SPEC_ID
>;

function moveFromMessage(message: Record<string, unknown>): GomokuMove | null {
  return typeof message.to === 'string' ? parseGomokuMove(message.to) : null;
}

const TERMINATIONS: Record<string, GameTermination> = {
  five: 'race',
  'board-full': 'draw',
  agreement: 'draw',
  timeout: 'timeout',
  resignation: 'resignation',
  abandonment: 'abandonment',
};

export const gomokuTenant: VariantTenant<
  'gomoku',
  GomokuColor,
  GomokuMove,
  GomokuRoomState,
  GomokuPlayerView,
  typeof GOMOKU_SPEC_ID
> = {
  kind: 'gomoku',
  gameSpecId: GOMOKU_SPEC_ID,
  roomIdPrefix: 'gmk_',
  colors: ['black', 'white'],
  enabled: gomokuEnabled,
  oppositeColor: (color) => (color === 'black' ? 'white' : 'black'),
  rules: {
    createInitialState: createGomokuRoomState,
    applyMove: (state, move) => {
      const next = applyGomokuRoomMove(state, move);
      if (next === state) throw new Error(`gomoku: illegal placement ${move.to}`);
      return next;
    },
    isLegalMove: (state, move) => applyGomokuRoomMove(state, move) !== state,
    isColor: isGomokuColor,
    isMove: (value): value is GomokuMove =>
      typeof value === 'object' &&
      value !== null &&
      moveFromMessage(value as Record<string, unknown>) !== null,
    moveFromMessage,
    finish: (state, winner, reason) => ({ ...state, status: { type: 'finished', winner, reason } }),
    finishDraw: (state) => ({
      ...state,
      status: { type: 'finished', winner: null, reason: 'agreement' },
    }),
    abort: (state, reason) => ({ ...state, status: { type: 'aborted', reason } }),
  },
  visibility: {
    clientEventFor: (event, _seat, ply) =>
      event.type === 'move-played' ? { ...event, ply } : event,
    viewForClient: (state, client) =>
      getGomokuPlayerView(
        state,
        isGomokuColor(client.seat) ? client.seat : 'black',
        client.seat === 'spectator',
      ),
  },
  wire: {
    snapshotExtras: (room, client) => ({
      roomMode: 'pvp',
      forfeitDeadline: tenantForfeitDeadlineForClient(gomokuTenant, room, client),
    }),
  },
  persistence: {
    resultForWinner: (winner) =>
      winner === 'black' ? 'black-wins' : winner === 'white' ? 'white-wins' : 'draw',
    termination: (reason) => {
      const termination = TERMINATIONS[reason];
      if (!termination) throw new Error(`gomoku: unmapped termination ${reason}`);
      return termination;
    },
    logKindPrefix: 'gomoku',
    logLabel: 'Gomoku',
  },
};
