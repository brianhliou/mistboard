// Hidden freestyle Gomoku referee. The kernel owns legality and five/full-board
// endings; the generic runtime owns seats, clocks, reconnects and event replay.
import { randomInt } from 'node:crypto';
import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  GOMOKU_OPENINGS,
  GOMOKU_SPEC_ID,
  type GomokuColor,
  type GomokuMove,
  type GomokuOpening,
  type GomokuPlayerView,
  type GomokuRoomState,
  getGomokuPlayerView,
  isGomokuColor,
  parseGomokuMove,
} from '@mistboard/game';
import type { GameTermination } from './persistence.js';
import { tenantForfeitDeadlineForClient, tenantPveEngineId } from './variant-tenant/runtime.js';
import type { TenantRoomEvent, TenantRuntimeRoom, VariantTenant } from './variant-tenant/tenant.js';

export type GomokuEvent = TenantRoomEvent<GomokuColor, GomokuMove, typeof GOMOKU_SPEC_ID>;
export type GomokuRuntimeRoom = TenantRuntimeRoom<
  'gomoku',
  GomokuColor,
  GomokuMove,
  GomokuRoomState,
  typeof GOMOKU_SPEC_ID
>;

export function isGomokuEngineClientId(id: string | undefined): boolean {
  return typeof id === 'string' && /^rapfi-level-[1-8]$/.test(id) && id.length === 13;
}

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
  // The runtime ships in every build, like Three Kingdoms banqi. The create
  // and socket doors enforce gomokuAdmits; the registration's enabled() stays
  // the flag so lobby, TV, challenges and bot profiles remain unlisted.
  enabled: () => true,
  oppositeColor: (color) => (color === 'black' ? 'white' : 'black'),
  rules: {
    createSetup: () => {
      const { stones, turn } = GOMOKU_OPENINGS[randomInt(GOMOKU_OPENINGS.length)]!;
      return { stones, turn };
    },
    createInitialState: (id, setup) => {
      // Missing setup means a pre-pool log. Never re-deal during hydration.
      if (setup === undefined) return createGomokuRoomState(id);
      if (
        typeof setup !== 'object' ||
        setup === null ||
        !('stones' in setup) ||
        !Array.isArray(setup.stones) ||
        !('turn' in setup) ||
        !isGomokuColor(setup.turn)
      )
        throw new Error('gomoku: invalid opening setup');
      return createGomokuRoomState(id, setup as GomokuOpening);
    },
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
  engine: {
    terminalContext: 'full-history',
    isEngineClientId: isGomokuEngineClientId,
    displayName: (id) => {
      if (!isGomokuEngineClientId(id)) throw new Error(`gomoku: unknown engine ${id}`);
      return `Rapfi Level ${id.at(-1)}`;
    },
    engineVersion: () => '1387d11312',
    reservationReleaseTag: 'gomoku-browser',
  },
  wire: {
    snapshotExtras: (room, client) => ({
      roomMode: tenantPveEngineId(gomokuTenant, room) ? 'pve' : 'pvp',
      pveEngineId: tenantPveEngineId(gomokuTenant, room),
      browserBotPaused: Boolean(room.projection.paused),
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
