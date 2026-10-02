/**
 * Crazyhouse Xiangqi VariantTenant: 9x10 xiangqi, open information, and a
 * captured piece joins the capturer's hand to be dropped back. Same wire shape
 * as the fortress tenant: a move is `{from, to}` or a drop `{drop, to}`, both
 * seats and spectators see the truth board and both hands, nothing is redacted
 * per seat. The rules live in packages/game/src/variants-crazyhouse-xiangqi.ts,
 * perpetual-check law included, so the tenant adds nothing to them.
 *
 * The bot is the stock Fairy-Stockfish ladder (crazyhouse-xiangqi-fsf-engine.ts,
 * loop in server-crazyhouse-xiangqi-engine.ts), seated by the rooms route.
 *
 * Admin playtest: the spec is on the per-account allowlist
 * (persistence-variant-access.ts), so the seat path refuses an account that is
 * neither an admin nor holding a grant.
 */

import {
  type AbortReason,
  abortCrazyhouseXiangqiGame,
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_DROP_ROLES,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiDropRole,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  type CrazyhouseXiangqiSquare,
  createInitialCrazyhouseXiangqiState,
  finishCrazyhouseXiangqiGame,
  getCrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiLegalMove,
  oppositeCrazyhouseXiangqiColor,
} from '@mistboard/game';
import {
  crazyhouseXiangqiEngineDisplayName,
  crazyhouseXiangqiEngineVersion,
  isCrazyhouseXiangqiEngineClientId,
} from './crazyhouse-xiangqi-fsf-engine.js';
import { crazyhouseXiangqiEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import { tenantForfeitDeadlineForClient, tenantPveEngineId } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const CRAZYHOUSE_XIANGQI_ROOM_ID_PREFIX = 'chx_';

type CrazyhouseXiangqiSpecId = typeof CRAZYHOUSE_XIANGQI_SPEC_ID;

export type CrazyhouseXiangqiEvent = TenantRoomEvent<
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiSpecId
>;

export type CrazyhouseXiangqiClientEvent = TenantClientEvent<
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiSpecId
>;

export type CrazyhouseXiangqiTenantType = VariantTenant<
  'crazyhouse-xiangqi',
  CrazyhouseXiangqiColor,
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  CrazyhouseXiangqiPlayerView,
  CrazyhouseXiangqiSpecId
>;

export function isCrazyhouseXiangqiSquare(value: unknown): value is CrazyhouseXiangqiSquare {
  return typeof value === 'string' && /^[a-i](?:10|[1-9])$/.test(value);
}

function isCrazyhouseXiangqiColor(value: unknown): value is CrazyhouseXiangqiColor {
  return value === 'red' || value === 'black';
}

export function isCrazyhouseXiangqiDropRole(value: unknown): value is CrazyhouseXiangqiDropRole {
  return (
    typeof value === 'string' &&
    (CRAZYHOUSE_XIANGQI_DROP_ROLES as readonly string[]).includes(value)
  );
}

function isCrazyhouseXiangqiMoveShape(value: unknown): value is CrazyhouseXiangqiMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  if ('drop' in move)
    return isCrazyhouseXiangqiDropRole(move.drop) && isCrazyhouseXiangqiSquare(move.to);
  return isCrazyhouseXiangqiSquare(move.from) && isCrazyhouseXiangqiSquare(move.to);
}

export function crazyhouseXiangqiClientEventFor(
  event: CrazyhouseXiangqiEvent,
  _seat: TenantSeat<CrazyhouseXiangqiColor>,
  ply: number,
): CrazyhouseXiangqiClientEvent {
  // Perfect information: nothing is redacted per seat, the ply is just stamped.
  if (event.type !== 'move-played') return event;
  return { ...event, ply };
}

export function getCrazyhouseXiangqiClientView(
  state: CrazyhouseXiangqiGameState,
  client: TenantSnapshotClient<CrazyhouseXiangqiColor>,
): CrazyhouseXiangqiPlayerView {
  const perspective = client.seat === 'black' ? 'black' : 'red';
  return getCrazyhouseXiangqiPlayerView(state, perspective);
}

/**
 * A TOTAL map, not a cast (the duck tenant's scar: a value outside
 * `games_termination_check` rolls back the finished game's row and the
 * postgame 404s). The kernel spells every reason as persistence does, 'chasing'
 * included for the perpetual-check loss; a reason added to the kernel without
 * a decision here throws instead of reaching the database.
 */
const CRAZYHOUSE_XIANGQI_TERMINATION: Record<string, persistence.GameTermination> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  repetition: 'repetition',
  chasing: 'chasing',
  'progress-clock': 'progress-clock',
  timeout: 'timeout',
  resignation: 'resignation',
  abandonment: 'abandonment',
};

export const crazyhouseXiangqiTenant: CrazyhouseXiangqiTenantType = {
  kind: 'crazyhouse-xiangqi',
  gameSpecId: CRAZYHOUSE_XIANGQI_SPEC_ID,
  roomIdPrefix: CRAZYHOUSE_XIANGQI_ROOM_ID_PREFIX,
  colors: ['red', 'black'],
  enabled: crazyhouseXiangqiEnabled,
  oppositeColor: oppositeCrazyhouseXiangqiColor,
  rules: {
    createInitialState: createInitialCrazyhouseXiangqiState,
    applyMove: applyCrazyhouseXiangqiMove,
    isLegalMove: isCrazyhouseXiangqiLegalMove,
    finish: finishCrazyhouseXiangqiGame,
    abort: (state, reason: AbortReason) => abortCrazyhouseXiangqiGame(state, reason),
    isColor: isCrazyhouseXiangqiColor,
    isMove: isCrazyhouseXiangqiMoveShape,
    moveFromMessage: (message) => {
      if (isCrazyhouseXiangqiDropRole(message.drop) && isCrazyhouseXiangqiSquare(message.to)) {
        return { drop: message.drop, to: message.to };
      }
      if (!isCrazyhouseXiangqiSquare(message.from) || !isCrazyhouseXiangqiSquare(message.to)) {
        return null;
      }
      return { from: message.from, to: message.to };
    },
  },
  visibility: {
    clientEventFor: crazyhouseXiangqiClientEventFor,
    viewForClient: (state, client) => getCrazyhouseXiangqiClientView(state, client),
  },
  engine: {
    // The engine is replayed from the whole move list every ply
    // (`position startpos moves …`), so it sees repetition, hands included,
    // exactly as the kernel does.
    terminalContext: 'full-history',
    isEngineClientId: isCrazyhouseXiangqiEngineClientId,
    displayName: crazyhouseXiangqiEngineDisplayName,
    engineVersion: crazyhouseXiangqiEngineVersion,
    reservationReleaseTag: 'crazyhouse-xiangqi',
  },
  wire: {
    snapshotExtras: (room, client) => {
      const pveEngineId = tenantPveEngineId(crazyhouseXiangqiTenant, room);
      return {
        roomMode: pveEngineId === null ? 'pvp' : 'pve',
        ...(pveEngineId === null ? {} : { pveEngineId }),
        rated: room.rated,
        forfeitDeadline: tenantForfeitDeadlineForClient(crazyhouseXiangqiTenant, room, client),
      };
    },
  },
  persistence: {
    resultForWinner: (winner: CrazyhouseXiangqiColor | null): persistence.GameResult => {
      if (winner === 'red') return 'red-wins';
      if (winner === 'black') return 'black-wins';
      return 'draw';
    },
    termination: (reason: string): persistence.GameTermination => {
      const mapped = CRAZYHOUSE_XIANGQI_TERMINATION[reason];
      if (!mapped) throw new Error(`crazyhouse-xiangqi: unmapped termination reason "${reason}"`);
      return mapped;
    },
    logKindPrefix: 'crazyhouse_xiangqi',
    logLabel: 'Crazyhouse Xiangqi',
  },
};
