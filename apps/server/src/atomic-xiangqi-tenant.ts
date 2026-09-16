/**
 * Atomic Xiangqi VariantTenant — 9x10 xiangqi, open information, and a capture
 * is an explosion. Same wire shape as the standard xiangqi tenant: a move is
 * `{from, to}`, both seats and spectators see the truth board, nothing is
 * redacted per seat. The rules live in packages/game/src/variants-atomic-
 * xiangqi.ts over the configurable rule kernel; the tenant adds nothing to
 * them, which is the point of the kernel having the perpetual-check law inside
 * it (the standard tenant re-scores repetitions itself; this one does not need
 * to).
 *
 * The bot is the patched Fairy-Stockfish ladder (atomic-xiangqi-fsf-engine.ts,
 * loop in server-atomic-xiangqi-engine.ts), seated by the rooms route.
 */

import {
  type AbortReason,
  ATOMIC_XIANGQI_SPEC_ID,
  type AtomicXiangqiColor,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  type AtomicXiangqiPlayerView,
  type AtomicXiangqiSquare,
  abortAtomicXiangqiGame,
  applyAtomicXiangqiMove,
  createInitialAtomicXiangqiState,
  finishAtomicXiangqiGame,
  getAtomicXiangqiPlayerView,
  isAtomicXiangqiLegalMove,
  oppositeAtomicXiangqiColor,
} from '@mistboard/game';
import {
  atomicXiangqiEngineDisplayName,
  atomicXiangqiEngineVersion,
  isAtomicXiangqiEngineClientId,
} from './atomic-xiangqi-fsf-engine.js';
import { atomicXiangqiEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import { tenantForfeitDeadlineForClient, tenantPveEngineId } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const ATOMIC_XIANGQI_ROOM_ID_PREFIX = 'axq_';

type AtomicXiangqiSpecId = typeof ATOMIC_XIANGQI_SPEC_ID;

export type AtomicXiangqiEvent = TenantRoomEvent<
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  AtomicXiangqiSpecId
>;

export type AtomicXiangqiClientEvent = TenantClientEvent<
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  AtomicXiangqiSpecId
>;

export type AtomicXiangqiTenantType = VariantTenant<
  'atomic-xiangqi',
  AtomicXiangqiColor,
  AtomicXiangqiMove,
  AtomicXiangqiGameState,
  AtomicXiangqiPlayerView,
  AtomicXiangqiSpecId
>;

export function isAtomicXiangqiSquare(value: unknown): value is AtomicXiangqiSquare {
  return typeof value === 'string' && /^[a-i](?:10|[1-9])$/.test(value);
}

function isAtomicXiangqiColor(value: unknown): value is AtomicXiangqiColor {
  return value === 'red' || value === 'black';
}

function isAtomicXiangqiMove(value: unknown): value is AtomicXiangqiMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  return isAtomicXiangqiSquare(move.from) && isAtomicXiangqiSquare(move.to);
}

export function atomicXiangqiClientEventFor(
  event: AtomicXiangqiEvent,
  _seat: TenantSeat<AtomicXiangqiColor>,
  ply: number,
): AtomicXiangqiClientEvent {
  // Perfect information: nothing is redacted per seat, the ply is just stamped.
  if (event.type !== 'move-played') return event;
  return { ...event, ply };
}

export function getAtomicXiangqiClientView(
  state: AtomicXiangqiGameState,
  client: TenantSnapshotClient<AtomicXiangqiColor>,
): AtomicXiangqiPlayerView {
  const perspective = client.seat === 'black' ? 'black' : 'red';
  return getAtomicXiangqiPlayerView(state, perspective);
}

/**
 * A TOTAL map, not a cast (see the duck tenant for the scar: a value outside
 * `games_termination_check` rolls back the finished game's row and the postgame
 * 404s). The adapter already spells every reason as persistence spells it,
 * including 'chasing' for the perpetual-check loss, so this map is the identity
 * over the adapter's union; it exists so a reason added to the adapter without
 * a decision here throws instead of reaching the database.
 */
const ATOMIC_XIANGQI_TERMINATION: Record<string, persistence.GameTermination> = {
  'general-captured': 'general-captured',
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  repetition: 'repetition',
  chasing: 'chasing',
  'progress-clock': 'progress-clock',
  timeout: 'timeout',
  resignation: 'resignation',
  abandonment: 'abandonment',
};

export const atomicXiangqiTenant: AtomicXiangqiTenantType = {
  kind: 'atomic-xiangqi',
  gameSpecId: ATOMIC_XIANGQI_SPEC_ID,
  roomIdPrefix: ATOMIC_XIANGQI_ROOM_ID_PREFIX,
  colors: ['red', 'black'],
  enabled: atomicXiangqiEnabled,
  oppositeColor: oppositeAtomicXiangqiColor,
  rules: {
    createInitialState: createInitialAtomicXiangqiState,
    applyMove: applyAtomicXiangqiMove,
    isLegalMove: isAtomicXiangqiLegalMove,
    finish: finishAtomicXiangqiGame,
    abort: (state, reason: AbortReason) => abortAtomicXiangqiGame(state, reason),
    isColor: isAtomicXiangqiColor,
    isMove: isAtomicXiangqiMove,
    moveFromMessage: (message) => {
      if (!isAtomicXiangqiSquare(message.from) || !isAtomicXiangqiSquare(message.to)) return null;
      return { from: message.from, to: message.to };
    },
  },
  visibility: {
    clientEventFor: atomicXiangqiClientEventFor,
    viewForClient: (state, client) => getAtomicXiangqiClientView(state, client),
  },
  engine: {
    // The engine is replayed from the whole move list every ply
    // (`position startpos moves …`), so it sees repetition and the no-capture
    // count exactly as the kernel does.
    terminalContext: 'full-history',
    isEngineClientId: isAtomicXiangqiEngineClientId,
    displayName: atomicXiangqiEngineDisplayName,
    engineVersion: atomicXiangqiEngineVersion,
    reservationReleaseTag: 'atomic-xiangqi',
  },
  wire: {
    snapshotExtras: (room, client) => {
      const pveEngineId = tenantPveEngineId(atomicXiangqiTenant, room);
      return {
        roomMode: pveEngineId === null ? 'pvp' : 'pve',
        ...(pveEngineId === null ? {} : { pveEngineId }),
        rated: room.rated,
        forfeitDeadline: tenantForfeitDeadlineForClient(atomicXiangqiTenant, room, client),
      };
    },
  },
  persistence: {
    resultForWinner: (winner: AtomicXiangqiColor | null): persistence.GameResult => {
      if (winner === 'red') return 'red-wins';
      if (winner === 'black') return 'black-wins';
      return 'draw';
    },
    termination: (reason: string): persistence.GameTermination => {
      const mapped = ATOMIC_XIANGQI_TERMINATION[reason];
      if (!mapped) throw new Error(`atomic-xiangqi: unmapped termination reason "${reason}"`);
      return mapped;
    },
    logKindPrefix: 'atomic_xiangqi',
    logLabel: 'Atomic Xiangqi',
  },
};
