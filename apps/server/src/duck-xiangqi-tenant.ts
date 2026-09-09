/**
 * Duck Xiangqi VariantTenant — perfect-information 9x10 xiangqi with Duck
 * Chess's shared blocker. Both seats and spectators see everything; the only
 * variant-specific wire shape is that a move is a TURN, `{from, to, duckTo}`,
 * because a Duck Xiangqi turn is a piece move AND a duck placement.
 *
 * The one-message invariant is deliberate: the client collects both halves
 * locally and sends them together, so a client that disconnects between the
 * piece move and the duck placement has sent nothing at all, rather than half a
 * turn the server has to reason about.
 */

import {
  type AbortReason,
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  DUCK_XIANGQI_SPEC_ID,
  type DuckXiangqiColor,
  type DuckXiangqiGameState,
  type DuckXiangqiPlayerView,
  type DuckXiangqiSquare,
  type DuckXiangqiTurn,
  getDuckXiangqiPlayerView,
  isDuckXiangqiLegalTurn,
  oppositeDuckXiangqiColor,
} from '@mistboard/game';
import {
  duckXiangqiEngineDisplayName,
  duckXiangqiEngineVersion,
  isDuckXiangqiEngineClientId,
} from './duck-xiangqi-fsf-engine.js';
import { duckXiangqiEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import { tenantForfeitDeadlineForClient, tenantPveEngineId } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const DUCK_XIANGQI_ROOM_ID_PREFIX = 'dkx_';

export type DuckXiangqiEvent = TenantRoomEvent<
  DuckXiangqiColor,
  DuckXiangqiTurn,
  typeof DUCK_XIANGQI_SPEC_ID
>;

export type DuckXiangqiClientEvent = TenantClientEvent<
  DuckXiangqiColor,
  DuckXiangqiTurn,
  typeof DUCK_XIANGQI_SPEC_ID
>;

export type DuckXiangqiTenantType = VariantTenant<
  'duck-xiangqi',
  DuckXiangqiColor,
  DuckXiangqiTurn,
  DuckXiangqiGameState,
  DuckXiangqiPlayerView,
  typeof DUCK_XIANGQI_SPEC_ID
>;

export function isDuckXiangqiSquare(value: unknown): value is DuckXiangqiSquare {
  return typeof value === 'string' && /^[a-i](?:10|[1-9])$/.test(value);
}

function isDuckXiangqiColor(value: unknown): value is DuckXiangqiColor {
  return value === 'red' || value === 'black';
}

function isDuckXiangqiTurn(value: unknown): value is DuckXiangqiTurn {
  if (typeof value !== 'object' || value === null) return false;
  const turn = value as Record<string, unknown>;
  if (!isDuckXiangqiSquare(turn.from) || !isDuckXiangqiSquare(turn.to)) return false;
  // `duckTo: null` is legal on exactly one kind of turn - one that captures the
  // general, which ends the game before the duck would have moved. Anything else
  // with a null duck is rejected by the kernel, so shape-checking is enough here.
  return turn.duckTo === null || isDuckXiangqiSquare(turn.duckTo);
}

export function duckXiangqiClientEventFor(
  event: DuckXiangqiEvent,
  _seat: TenantSeat<DuckXiangqiColor>,
  ply: number,
): DuckXiangqiClientEvent {
  // Perfect information: nothing is redacted per seat, the ply is just stamped.
  if (event.type !== 'move-played') return event;
  return { ...event, ply };
}

export function getDuckXiangqiClientView(
  state: DuckXiangqiGameState,
  client: TenantSnapshotClient<DuckXiangqiColor>,
): DuckXiangqiPlayerView {
  const perspective = client.seat === 'black' ? 'black' : 'red';
  return getDuckXiangqiPlayerView(state, perspective);
}

/**
 * A TOTAL map, not a cast, and the difference is not stylistic.
 *
 * `games_termination_check` is a CHECK constraint. A value outside it fails
 * `recordGameEnd`'s whole transaction, so the games row AND its participants
 * roll back and the finished game ends up with no row at all - the postgame API
 * then 404s and the game vanishes from profiles. Migration 114 exists because
 * Flip Jungle shipped exactly that with `'dead-position'`.
 *
 * Duck Xiangqi walks into it too: the kernel's draw reason is `progress`, and
 * the allowlist has `progress-clock`. Mapped here rather than migrated, because
 * `progress-clock` already means this and a new value would need a migration for
 * nothing.
 */
const DUCK_XIANGQI_TERMINATION: Record<string, persistence.GameTermination> = {
  'general-captured': 'general-captured',
  stalemate: 'stalemate',
  repetition: 'repetition',
  // The 60-move no-capture draw. NOT 'progress' - that is not in the allowlist.
  progress: 'progress-clock',
  timeout: 'timeout',
  resignation: 'resignation',
  abandonment: 'abandonment',
};

export const duckXiangqiTenant: DuckXiangqiTenantType = {
  kind: 'duck-xiangqi',
  gameSpecId: DUCK_XIANGQI_SPEC_ID,
  roomIdPrefix: DUCK_XIANGQI_ROOM_ID_PREFIX,
  colors: ['red', 'black'],
  enabled: duckXiangqiEnabled,
  oppositeColor: oppositeDuckXiangqiColor,
  rules: {
    createInitialState: createInitialDuckXiangqiState,
    applyMove: applyDuckXiangqiTurn,
    isLegalMove: isDuckXiangqiLegalTurn,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    abort: (state, reason: AbortReason) => ({
      ...state,
      status: { type: 'aborted', reason },
    }),
    isColor: isDuckXiangqiColor,
    isMove: isDuckXiangqiTurn,
    moveFromMessage: (message) => {
      if (!isDuckXiangqiSquare(message.from) || !isDuckXiangqiSquare(message.to)) {
        return null;
      }
      // A missing duckTo means the client is claiming this turn ends the game by
      // capturing the general. It is not trusted: the kernel rejects a null duck
      // on any other turn, so a client cannot decline to move the duck.
      const duckTo = message.duckTo === undefined ? null : message.duckTo;
      if (duckTo !== null && !isDuckXiangqiSquare(duckTo)) return null;
      return { from: message.from, to: message.to, duckTo };
    },
  },
  visibility: {
    clientEventFor: duckXiangqiClientEventFor,
    viewForClient: (state, client) => getDuckXiangqiClientView(state, client),
  },
  engine: {
    // The engine is replayed from the whole move list every ply
    // (`position startpos moves …`), so it sees repetition and the no-progress
    // count exactly as the kernel does.
    terminalContext: 'full-history',
    isEngineClientId: isDuckXiangqiEngineClientId,
    displayName: duckXiangqiEngineDisplayName,
    engineVersion: duckXiangqiEngineVersion,
    reservationReleaseTag: 'duck-xiangqi',
  },
  wire: {
    snapshotExtras: (room, client) => {
      const pveEngineId = tenantPveEngineId(duckXiangqiTenant, room);
      return {
        roomMode: pveEngineId === null ? 'pvp' : 'pve',
        ...(pveEngineId === null ? {} : { pveEngineId }),
        rated: room.rated,
        forfeitDeadline: tenantForfeitDeadlineForClient(duckXiangqiTenant, room, client),
      };
    },
  },
  persistence: {
    resultForWinner: (winner: DuckXiangqiColor | null): persistence.GameResult => {
      if (winner === 'red') return 'red-wins';
      if (winner === 'black') return 'black-wins';
      return 'draw';
    },
    termination: (reason: string): persistence.GameTermination => {
      const mapped = DUCK_XIANGQI_TERMINATION[reason];
      if (!mapped) {
        // Loud, not silent. An unmapped reason is a new end condition somebody
        // added to the kernel without extending this map, and the alternative to
        // throwing is a rolled-back game row nobody notices for weeks.
        throw new Error(`duck-xiangqi: unmapped termination reason "${reason}"`);
      }
      return mapped;
    },
    logKindPrefix: 'duck_xiangqi',
    logLabel: 'Duck Xiangqi',
  },
};
