/**
 * Dark chess VariantTenant — the flagship's rules + Model A visibility packaged
 * onto the Layer-3 tenant contract (variant-tenant/tenant.ts).
 *
 * P2 scope decision (2026-06-11): this module is the bottom-up first step of
 * the chess migration. It is deliberately UNREGISTERED — live dark-chess rooms
 * (unprefixed UUIDs) stay on the legacy room-manager stack, and the room-id
 * scheme below is fixed by the first consumer (the correspondence track, or
 * the live-stack swap behind dark-chess-golden-wire.test.ts). What this module
 * pins today: the tenant-shaped rules/visibility/persistence identity, proven
 * equivalent to the live stack by dark-chess-tenant.test.ts (projection replay
 * parity vs replayGameEvents; redaction parity vs payloads.ts).
 *
 * Capability boundaries (per the P2 decision table in
 * docs-private/variant-generalization-track.md):
 * - Pause/resume is NOT lifted: pause/resume events are rejected by the tenant
 *   event union, which is correct for tenant rooms (no live-clock fairness
 *   problem to solve) and keeps hydration of legacy paused rooms on the legacy
 *   stack.
 * - Visibility DELEGATES to payloads.ts (getClientView / filterEventForClient)
 *   so Model A keeps a single redaction point. Any fog-policy change lands in
 *   payloads.ts and both stacks inherit it.
 */

import {
  type AbortReason,
  type Color,
  clockPolicyKindFor,
  DARK_CHESS_SPEC_ID,
  type GameEvent,
  type GameState,
  type GameStatus,
  initialGameProjection,
  isGameEndReason,
  type Move,
  type PieceRole,
  type PlayerView,
  type Square,
  variantForId,
} from '@mistboard/game';
import { engineVersionDisplayName } from './engine-registry.js';
import {
  filterEventForClient,
  fullTruthView,
  getClientView,
  type SnapshotClient,
  type SnapshotRoom,
} from './payloads.js';
import type * as persistence from './persistence.js';
import { isServerEngineClient } from './server-policy.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

// Reserved for the first registered consumer; live rooms are unprefixed UUIDs
// and never route here.
export const DARK_CHESS_TENANT_ROOM_ID_PREFIX = 'dchx_';

// GameState as the tenant slice sees it. The status union used to be narrowed
// away from the Draft960 pregame; that phase is gone (2026-09-12, #396).
export type DarkChessTenantState = Omit<GameState, 'status'> & {
  status: GameStatus;
};

export type DarkChessTenant = VariantTenant<
  'dark-chess',
  Color,
  Move,
  DarkChessTenantState,
  PlayerView,
  typeof DARK_CHESS_SPEC_ID
>;

export type DarkChessTenantEvent = TenantRoomEvent<Color, Move, typeof DARK_CHESS_SPEC_ID>;

const darkChess = variantForId('dark-chess');

export function isChessSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}

function isChessColor(value: unknown): value is Color {
  return value === 'white' || value === 'black';
}

function isPromotionRole(value: unknown): value is Exclude<PieceRole, 'king' | 'pawn'> {
  return value === 'queen' || value === 'rook' || value === 'bishop' || value === 'knight';
}

function isChessMove(value: unknown): value is Move {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  return (
    isChessSquare(move.from) &&
    isChessSquare(move.to) &&
    (move.promotion === undefined || isPromotionRole(move.promotion))
  );
}

// Minimal SnapshotRoom around a bare state so the payloads.ts redaction
// helpers (which take the live-room shape) serve the tenant surface. The
// projection is a real initialGameProjection — empty offers, so the
// hidden-draft redaction branch is structurally unreachable.
function snapshotRoomSliceFor(state: DarkChessTenantState): SnapshotRoom {
  const projection = initialGameProjection(state.id, 'dark-chess');
  return {
    id: state.id,
    clients: new Set<{ seat: TenantSeat<Color>; displaced: boolean }>(),
    events: [],
    projection: { ...projection, state: state as GameState },
  };
}

// Event filtering reads only the projection's variant and (empty) draft
// offers, never the position, so one shared slice serves every event.
const eventFilterRoomSlice = snapshotRoomSliceFor(
  darkChess.createInitialState('dark-chess-tenant-event-filter') as DarkChessTenantState,
);

function snapshotClientFor(client: TenantSnapshotClient<Color>): SnapshotClient {
  return { devViews: false, id: client.id, seat: client.seat, solo: client.solo };
}

// Model A fog on the event stream, delegated to the live stack's single
// redaction point. The tenant event union is a structural subset of GameEvent
// for every shared type (extra optional fields like capturedRole simply pass
// through), and the redaction branches that read chess-only event fields are
// unreachable with empty draft offers — hence the contained casts.
export function darkChessClientEventFor(
  event: DarkChessTenantEvent,
  seat: TenantSeat<Color>,
  ply: number,
): TenantClientEvent<Color, Move, typeof DARK_CHESS_SPEC_ID> | null {
  const client: SnapshotClient = { devViews: false, id: '', seat, solo: false };
  const filtered = filterEventForClient(
    eventFilterRoomSlice,
    client,
    event as unknown as GameEvent,
  );
  if (!filtered) return null;
  const visible = filtered as unknown as DarkChessTenantEvent;
  if (visible.type === 'move-played') return { ...visible, ply };
  return visible;
}

export const darkChessTenant: DarkChessTenant = {
  kind: 'dark-chess',
  gameSpecId: DARK_CHESS_SPEC_ID,
  roomIdPrefix: DARK_CHESS_TENANT_ROOM_ID_PREFIX,
  colors: ['white', 'black'],
  enabled: () => true,
  oppositeColor: (color) => (color === 'white' ? 'black' : 'white'),
  rules: {
    createInitialState: (roomId) => darkChess.createInitialState(roomId) as DarkChessTenantState,
    applyMove: (state, move) => darkChess.applyMove(state, move) as DarkChessTenantState,
    // Chess legality is applyMove identity: an illegal move returns the same
    // state object (the live stack's playMove rule).
    isLegalMove: (state, move) => darkChess.applyMove(state, move) !== state,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    abort: (state, reason: AbortReason) => ({
      ...state,
      status: { type: 'aborted', reason },
    }),
    isColor: isChessColor,
    isMove: isChessMove,
    // Mirrors the live stack's inbound-move parsing: invalid promotion values
    // are dropped (not rejected), squares must be on-board.
    moveFromMessage: (message) => {
      if (!isChessSquare(message.from) || !isChessSquare(message.to)) return null;
      return {
        from: message.from,
        to: message.to,
        promotion: isPromotionRole(message.promotion) ? message.promotion : undefined,
      };
    },
    // The applied move's canonical form is what the live stack appends
    // (nextState.lastMove re-attaches normalization the parser can't know).
    canonicalMove: (state, move) => {
      const nextState = darkChess.applyMove(state, move);
      if (nextState === state) return null;
      return nextState.lastMove ?? move;
    },
  },
  visibility: {
    clientEventFor: darkChessClientEventFor,
    viewForClient: (state, client) =>
      getClientView(snapshotRoomSliceFor(state), snapshotClientFor(client)),
    // The finished-game reveal, declared so the runtime opens the board AND
    // the event log together. Without this the board half still opened
    // (getClientView above reads the real status) while clientEventFor kept
    // filtering against the shared slice, whose status is the initial
    // 'playing', so a finished correspondence room served a truth board
    // beside an own-moves-only log. Fixed perspective, as the other tenants'
    // truth views: the client orients by seat.
    truthView: (state) => fullTruthView(snapshotRoomSliceFor(state), 'white'),
  },
  engine: {
    terminalContext: 'fog-observation',
    isEngineClientId: isServerEngineClient,
    displayName: engineVersionDisplayName,
    reservationReleaseTag: 'dark-chess',
  },
  wire: {
    // Live-stack logs may contain pre-first-move seat-vacated events (the
    // pendingVacates flow); accept them so such logs replay here.
    acceptsSeatVacated: true,
    // The chess liveState shell hosts dchx_ rooms (correspondence C1): these
    // fields keep its frame projection truthful where the shell's defaults
    // would lie (rated defaults TRUE there) or where correspondence chrome
    // keys off them (mode hides rematch, enables day-scale clocks).
    // seatDisplayNames moved into the core snapshot (tenantSnapshotPayload).
    snapshotExtras: (room) => ({
      mode:
        clockPolicyKindFor(room.projection.timeControl) === 'days-per-move'
          ? 'correspondence'
          : 'pvp',
      rated: room.rated,
    }),
  },
  persistence: {
    resultForWinner: (winner: Color | null): persistence.GameResult => {
      if (winner === 'white') return 'white-wins';
      if (winner === 'black') return 'black-wins';
      return 'draw';
    },
    termination: (reason: string) => {
      if (!isGameEndReason(reason)) {
        throw new Error(`unknown finished-game reason: ${reason}`);
      }
      return reason;
    },
    logKindPrefix: 'dark_chess',
    logLabel: 'dark chess',
  },
};
