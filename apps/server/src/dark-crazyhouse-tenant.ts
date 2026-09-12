/**
 * Dark Crazyhouse (chess + drops, under fog) VariantTenant — a fog tenant on the
 * generic Layer-3 contract, with private hands and drops over
 * the dark-chess fog kernel (8x8 chess board, chess vision).
 *
 * Crazyhouse-specific policy that lives here: the fog player view carries hands
 * (the viewer's OWN reserve only — private under fog) and only pieces on visible
 * squares, so it is wire-safe as-is; per-seat move-played redaction; own-moves-
 * only lastMove; the spectator empty view; the bare snapshot. PvP-only, no PvE.
 * Win = king-capture (no checkmate).
 *
 * Wire move encoding: the generic move message is chess-shaped
 * ({from, to, promotion}). A DROP is `from: "*<letter>"` (Q/R/B/N/P), and a board
 * promotion is `promotion: "q"|"queen"|...`. moveFromMessage decodes both into a
 * real CrazyhouseMove; the event log stores the typed move, not the wire shape.
 *
 * Drop rule = the PARACHUTE (any-legal-square): the player may offer a drop onto
 * any square that looks empty from their view (incl. fog). A drop onto a square
 * that is occupied in truth is rejected, and `wire.rejectionFor` tells only the
 * mover (the bounce/probe).
 */

import {
  type AbortReason,
  applyCrazyhouseMove,
  type Color,
  type CrazyhouseDropRole,
  type CrazyhouseGameState,
  type CrazyhouseMove,
  type CrazyhousePlayerView,
  createInitialCrazyhouseState,
  DARK_CRAZYHOUSE_SPEC_ID,
  getCrazyhousePlayerView,
  isCrazyhouseDrop,
  isCrazyhouseDropRole,
  isLegalCrazyhouseMove,
  type PieceRole,
  type Square,
} from '@mistboard/game';
import { darkCrazyhouseEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const DARK_CRAZYHOUSE_ROOM_ID_PREFIX = 'dczh_';

type DarkCrazyhouseSpecId = typeof DARK_CRAZYHOUSE_SPEC_ID;

// The fog view is already wire-safe: pieces appear only on visible squares and
// `hand` is the viewer's own reserve (the kernel redacts the opponent's).
export type DarkCrazyhouseWirePlayerView = CrazyhousePlayerView;

export type DarkCrazyhouseTenant = VariantTenant<
  'dark-crazyhouse',
  Color,
  CrazyhouseMove,
  CrazyhouseGameState,
  DarkCrazyhouseWirePlayerView,
  DarkCrazyhouseSpecId
>;

const CHESS_SQUARE_RE = /^[a-h][1-8]$/;
const DROP_LETTERS: Record<string, CrazyhouseDropRole> = {
  Q: 'queen',
  R: 'rook',
  B: 'bishop',
  N: 'knight',
  P: 'pawn',
};
const PROMOTION_BY_TOKEN: Record<string, Exclude<PieceRole, 'king' | 'pawn'>> = {
  q: 'queen',
  queen: 'queen',
  r: 'rook',
  rook: 'rook',
  b: 'bishop',
  bishop: 'bishop',
  n: 'knight',
  knight: 'knight',
};

function isChessSquare(value: unknown): value is Square {
  return typeof value === 'string' && CHESS_SQUARE_RE.test(value);
}

function isColor(value: unknown): value is Color {
  return value === 'white' || value === 'black';
}

function opponentOf(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

function isCrazyhouseMove(value: unknown): value is CrazyhouseMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  if ('drop' in move) return isCrazyhouseDropRole(move.drop) && isChessSquare(move.to);
  if (!isChessSquare(move.from) || !isChessSquare(move.to)) return false;
  return move.promotion === undefined || typeof move.promotion === 'string';
}

// Decode the chess-shaped wire message into a CrazyhouseMove. A `*<letter>` from
// is a drop; a `promotion` token flags a promoting board move.
function crazyhouseMoveFromMessage(message: {
  from?: string;
  to?: string;
  promotion?: string;
}): CrazyhouseMove | null {
  if (!isChessSquare(message.to)) return null;
  if (typeof message.from === 'string' && message.from.startsWith('*')) {
    const role = DROP_LETTERS[message.from.slice(1)];
    if (!role) return null;
    return { drop: role, to: message.to };
  }
  if (!isChessSquare(message.from)) return null;
  const promotion = message.promotion ? PROMOTION_BY_TOKEN[message.promotion] : undefined;
  return promotion
    ? { from: message.from, to: message.to, promotion }
    : { from: message.from, to: message.to };
}

// Fog rule: only move-played is per-seat (own moves only); every other event
// flows to both seats and spectators. Pinned by the dark-crazyhouse golden fixture.
export function darkCrazyhouseClientEventFor(
  event: TenantRoomEvent<Color, CrazyhouseMove, DarkCrazyhouseSpecId>,
  seat: TenantSeat<Color>,
  ply: number,
): TenantClientEvent<Color, CrazyhouseMove, DarkCrazyhouseSpecId> | null {
  if (event.type !== 'move-played') return event;
  if (seat === 'spectator' || event.color !== seat) return null;
  return { ...event, ply };
}

export function getDarkCrazyhouseClientView(
  state: CrazyhouseGameState,
  client: TenantSnapshotClient<Color>,
  latestVisibleMoveColor?: Color,
): DarkCrazyhouseWirePlayerView {
  const perspective: Color = client.seat === 'black' ? 'black' : 'white';
  if (client.seat === 'spectator') return emptyDarkCrazyhouseView(state, perspective);
  const view = getCrazyhousePlayerView(state, perspective);
  // Strip lastMove unless the latest move was the viewer's own (else the
  // opponent's from/to — possibly outside the viewer's vision — would leak).
  if (latestVisibleMoveColor !== client.seat) return { ...view, lastMove: undefined };
  return view;
}

function latestVisibleCrazyhouseMoveColor(
  events: readonly TenantRoomEvent<Color, CrazyhouseMove, DarkCrazyhouseSpecId>[],
  client: TenantSnapshotClient<Color>,
): Color | undefined {
  if (client.seat === 'spectator') return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === 'move-played') return event.color === client.seat ? event.color : undefined;
  }
  return undefined;
}

function emptyDarkCrazyhouseView(
  state: CrazyhouseGameState,
  perspective: Color,
): DarkCrazyhouseWirePlayerView {
  return {
    // The fog views carry the chess-family variant id (the kernel's player view
    // rides darkChessVariant.getPlayerView); match it for the spectator view.
    id: state.id,
    variant: 'dark-chess',
    perspective,
    board: {},
    hand: {},
    visibleSquares: [],
    legalMoves: [],
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: undefined,
    clock: state.clock,
  };
}

function darkCrazyhouseResult(winner: Color | null): persistence.GameResult {
  if (winner === 'white') return 'white-wins';
  if (winner === 'black') return 'black-wins';
  return 'draw';
}

export const darkCrazyhouseTenant: DarkCrazyhouseTenant = {
  kind: 'dark-crazyhouse',
  gameSpecId: DARK_CRAZYHOUSE_SPEC_ID,
  roomIdPrefix: DARK_CRAZYHOUSE_ROOM_ID_PREFIX,
  colors: ['white', 'black'],
  enabled: darkCrazyhouseEnabled,
  oppositeColor: opponentOf,
  rules: {
    createInitialState: (roomId) => createInitialCrazyhouseState(roomId, 'any-legal-square'),
    applyMove: applyCrazyhouseMove,
    isLegalMove: isLegalCrazyhouseMove,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    abort: (state, reason: AbortReason) => ({
      ...state,
      status: { type: 'aborted', reason },
    }),
    isColor,
    isMove: isCrazyhouseMove,
    moveFromMessage: crazyhouseMoveFromMessage,
  },
  visibility: {
    clientEventFor: darkCrazyhouseClientEventFor,
    viewForClient: (state, client, events) =>
      getDarkCrazyhouseClientView(state, client, latestVisibleCrazyhouseMoveColor(events, client)),
  },
  wire: {
    acceptsSeatVacated: true,
    // The parachute bounce: a drop onto a square that is occupied in truth is
    // rejected. Tell ONLY the mover (a probe) — reveals occupancy, not identity.
    rejectionFor: (state, move, seat) => {
      if (seat === 'spectator') return null;
      if (!isCrazyhouseDrop(move)) return null;
      if (!state.board[move.to]) return null; // a non-occupancy rejection stays silent
      return { type: 'drop-rejected', to: move.to, reason: 'occupied' };
    },
  },
  persistence: {
    resultForWinner: darkCrazyhouseResult,
    termination: (reason: string) => reason as persistence.GameTermination,
    logKindPrefix: 'dark_crazyhouse',
    logLabel: 'Dark Crazyhouse',
  },
};
