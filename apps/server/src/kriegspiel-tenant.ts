/**
 * Kriegspiel (ICC wild-16) VariantTenant — a hidden-information tenant on the
 * generic Layer-3 contract, on the fog-tenant pattern.
 *
 * Kriegspiel is stricter than fog: a player sees ONLY their own pieces and
 * never the opponent's move. What the opponent receives instead is the UMPIRE
 * ANNOUNCEMENT — a public call carrying the capture square + pawn/piece and the
 * check category, with the move coordinates redacted away. The announcement is
 * computed once, server-side, in `canonicalMove` (which sees the before-state),
 * stamped onto the move object that is appended to the event log, and then
 * split per seat in `clientEventFor`:
 *
 *   - the mover gets the full move-played (their own move + the umpire's reply);
 *   - the opponent gets move-played with from/to/promotion stripped — only the
 *     announcement survives, so the move itself never leaks;
 *   - spectators get nothing (empty view, no events) for v1.
 *
 * The view already carries own-pieces-only board, pseudo-legal offered moves,
 * and the on-move player's private pawn-try count, so it is wire-safe as-is
 * (lastMove is stripped unless the viewer made it). The try-loop rides
 * `wire.rejectionFor`: an illegal try is rejected and the mover is told only
 * "illegal" — no information beyond "no". Win = checkmate (real chess).
 *
 * Wire move encoding: the generic move message is chess-shaped
 * ({from, to, promotion}); a Kriegspiel move rides it unchanged.
 */

import {
  type AbortReason,
  applyKriegspielMove,
  type Color,
  createInitialKriegspielState,
  getKriegspielPlayerView,
  isLegalKriegspielMove,
  KRIEGSPIEL_SPEC_ID,
  type KriegspielAnnouncement,
  type KriegspielGameState,
  type KriegspielPlayerView,
  kriegspielAnnouncementFor,
  type Move,
  type PieceRole,
  type Square,
} from '@mistboard/game';
import { kriegspielEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const KRIEGSPIEL_ROOM_ID_PREFIX = 'kr_';

type KriegspielSpecId = typeof KRIEGSPIEL_SPEC_ID;

// The wire/event move type. A real move always carries from+to; the redacted
// opponent move-played drops them and keeps only the umpire announcement, so
// from/to are optional at the type level (present for everything server-side).
export type KriegspielWireMove = {
  from?: Square;
  to?: Square;
  promotion?: Exclude<PieceRole, 'king' | 'pawn'>;
  announcement?: KriegspielAnnouncement;
};

// The own-pieces-only view is already wire-safe (no enemy square is ever sent).
export type KriegspielWirePlayerView = KriegspielPlayerView;

export type KriegspielTenant = VariantTenant<
  'kriegspiel',
  Color,
  KriegspielWireMove,
  KriegspielGameState,
  KriegspielWirePlayerView,
  KriegspielSpecId
>;

const SQUARE_RE = /^[a-h][1-8]$/;
const PROMOTION_ROLES: readonly Exclude<PieceRole, 'king' | 'pawn'>[] = [
  'queen',
  'rook',
  'bishop',
  'knight',
];

function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && SQUARE_RE.test(value);
}

function isColor(value: unknown): value is Color {
  return value === 'white' || value === 'black';
}

function isPromotion(value: unknown): value is Exclude<PieceRole, 'king' | 'pawn'> {
  return (PROMOTION_ROLES as readonly string[]).includes(value as string);
}

function isKriegspielMove(value: unknown): value is KriegspielWireMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  if (!isSquare(move.from) || !isSquare(move.to)) return false;
  return move.promotion === undefined || isPromotion(move.promotion);
}

// A move that has reached the server-side rules always carries from+to.
function toKernelMove(move: KriegspielWireMove): Move | null {
  if (!move.from || !move.to) return null;
  return { from: move.from, to: move.to, promotion: move.promotion };
}

function kriegspielMoveFromMessage(message: {
  from?: string;
  to?: string;
  promotion?: string;
}): KriegspielWireMove | null {
  if (!isSquare(message.from) || !isSquare(message.to)) return null;
  if (message.promotion !== undefined && !isPromotion(message.promotion)) return null;
  return { from: message.from, to: message.to, promotion: message.promotion };
}

// Resolve a parsed move to the exact object to append: reject illegal tries
// (→ the try-loop bounce) and stamp the umpire announcement onto legal ones.
function kriegspielCanonicalMove(
  state: KriegspielGameState,
  move: KriegspielWireMove,
): KriegspielWireMove | null {
  const kernelMove = toKernelMove(move);
  if (!kernelMove || !isLegalKriegspielMove(state, kernelMove)) return null;
  const after = applyKriegspielMove(state, kernelMove);
  const announcement = kriegspielAnnouncementFor(state, kernelMove, after);
  return { ...kernelMove, announcement };
}

// Fog rule: only move-played is per-seat. The opponent sees the announcement
// with the move coordinates stripped; the mover sees the full move; spectators
// see nothing. Every other event flows to both seats.
export function kriegspielClientEventFor(
  event: TenantRoomEvent<Color, KriegspielWireMove, KriegspielSpecId>,
  seat: TenantSeat<Color>,
  ply: number,
): TenantClientEvent<Color, KriegspielWireMove, KriegspielSpecId> | null {
  if (event.type !== 'move-played') return event;
  if (seat === 'spectator') return null;
  if (event.color === seat) return { ...event, ply };
  // The opponent: redact the move to its umpire announcement only.
  const announcement = event.move.announcement;
  return { ...event, ply, move: announcement ? { announcement } : {} };
}

function emptyKriegspielView(
  state: KriegspielGameState,
  perspective: Color,
): KriegspielWirePlayerView {
  return {
    id: state.id,
    perspective,
    board: {},
    visibleSquares: [],
    legalMoves: [],
    pawnTries: 0,
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: undefined,
  };
}

export function getKriegspielClientView(
  state: KriegspielGameState,
  client: TenantSnapshotClient<Color>,
  latestVisibleMoveColor?: Color,
): KriegspielWirePlayerView {
  const perspective: Color = client.seat === 'white' ? 'white' : 'black';
  if (client.seat === 'spectator') return emptyKriegspielView(state, perspective);
  const view = getKriegspielPlayerView(state, perspective);
  // Strip lastMove unless the viewer made the latest move (else the opponent's
  // from/to — which the viewer must never see — would leak through the board).
  if (latestVisibleMoveColor !== client.seat) return { ...view, lastMove: undefined };
  return view;
}

function latestVisibleKriegspielMoveColor(
  events: readonly TenantRoomEvent<Color, KriegspielWireMove, KriegspielSpecId>[],
  client: TenantSnapshotClient<Color>,
): Color | undefined {
  if (client.seat === 'spectator') return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === 'move-played') return event.color === client.seat ? event.color : undefined;
  }
  return undefined;
}

function kriegspielResult(winner: Color | null): persistence.GameResult {
  if (winner === 'black') return 'black-wins';
  if (winner === 'white') return 'white-wins';
  return 'draw';
}

export const kriegspielTenant: KriegspielTenant = {
  kind: 'kriegspiel',
  gameSpecId: KRIEGSPIEL_SPEC_ID,
  roomIdPrefix: KRIEGSPIEL_ROOM_ID_PREFIX,
  colors: ['white', 'black'],
  enabled: kriegspielEnabled,
  oppositeColor: (color) => (color === 'white' ? 'black' : 'white'),
  rules: {
    createInitialState: createInitialKriegspielState,
    applyMove: (state, move) => {
      const kernelMove = toKernelMove(move);
      return kernelMove ? applyKriegspielMove(state, kernelMove) : state;
    },
    isLegalMove: (state, move) => {
      const kernelMove = toKernelMove(move);
      return kernelMove ? isLegalKriegspielMove(state, kernelMove) : false;
    },
    canonicalMove: kriegspielCanonicalMove,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    abort: (state, reason: AbortReason) => ({
      ...state,
      status: { type: 'aborted', reason },
    }),
    isColor,
    isMove: isKriegspielMove,
    moveFromMessage: kriegspielMoveFromMessage,
  },
  visibility: {
    clientEventFor: kriegspielClientEventFor,
    viewForClient: (state, client, events) =>
      getKriegspielClientView(state, client, latestVisibleKriegspielMoveColor(events, client)),
  },
  wire: {
    acceptsSeatVacated: true,
    // The try-loop bounce: an illegal try is rejected and the mover is told
    // only "illegal" (echoing their attempt so the client can reset it). No
    // information about why beyond "no".
    rejectionFor: (_state, move, seat) => {
      if (seat === 'spectator') return null;
      return { type: 'kriegspiel-illegal', from: move.from, to: move.to };
    },
  },
  persistence: {
    resultForWinner: kriegspielResult,
    termination: (reason: string) => reason as persistence.GameTermination,
    logKindPrefix: 'kriegspiel',
    logLabel: 'Kriegspiel',
  },
};
