/**
 * Dark Xiangqi (9x10, hidden/dev-only) VariantTenant — the P1 near-copy
 * migration of the Layer-3 tenant contract.
 *
 * Dark Xiangqi policy that lives here: per-seat event redaction (only
 * move-played is redacted; non-move events flow to both seats AND spectators,
 * unlike DMX), the shrouded-piece wire board ({color, shrouded: true} entries
 * so hidden piece identity never reaches the wire), the spectator empty view,
 * lastMove stripping, seat-vacated acceptance in event logs, and the legacy
 * GameSummary shape (no time-control fields; guests named by color). The
 * snapshot has NO extras — it is exactly the tenant core payload.
 */

import {
  type AbortReason,
  applyMove as applyXiangqiMove,
  createInitialXiangqiState,
  DARK_XIANGQI_SPEC_ID,
  getPlayerView as getXiangqiPlayerView,
  isLegalMove as isXiangqiLegalMove,
  type XiangqiCapture,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPiece,
  type XiangqiPieceRole,
  type XiangqiPlayerView,
  type XiangqiSquare,
  xiangqiCaptureLedger,
} from '@mistboard/game';
import { engineFailureAbort } from './engine-failure-abort.js';
import { engineVersionDisplayName, isDarkXiangqiEngineClientId } from './engines/registry.js';
import { darkXiangqiEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import { tenantParticipant } from './variant-tenant/events.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantRuntimeRoom,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const DARK_XIANGQI_ROOM_ID_PREFIX = 'dxq_';

type DarkXiangqiSpecId = typeof DARK_XIANGQI_SPEC_ID;

type DarkXiangqiWireBoardEntry =
  | { piece: XiangqiPiece; shrouded: false }
  | { color: XiangqiColor; shrouded: true };

// Observed captures: the DEAD pieces of each color, in capture order. In a
// two-player fog game these are common knowledge between the seats (every
// capture is either made by the seat, victim visible per field-of-fire vision,
// or suffered by it, own pieces always visible), so both seats AND the truth
// view carry the full dead lists. Only spectators are redacted to empty arrays,
// matching the tenant's empty-board policy (material count is information).
export type DarkXiangqiObservedCaptures = {
  red: XiangqiPieceRole[];
  black: XiangqiPieceRole[];
};

export type DarkXiangqiWirePlayerView = Omit<XiangqiPlayerView, 'board'> & {
  board: Partial<Record<XiangqiSquare, DarkXiangqiWireBoardEntry>>;
  captures: DarkXiangqiObservedCaptures;
};

export type DarkXiangqiTenant = VariantTenant<
  'dark-xiangqi',
  XiangqiColor,
  XiangqiMove,
  XiangqiGameState,
  DarkXiangqiWirePlayerView,
  DarkXiangqiSpecId
>;

type DarkXiangqiTenantRoom = TenantRuntimeRoom<
  'dark-xiangqi',
  XiangqiColor,
  XiangqiMove,
  XiangqiGameState,
  DarkXiangqiSpecId
>;

function isXiangqiColor(value: unknown): value is XiangqiColor {
  return value === 'red' || value === 'black';
}

function isXiangqiMove(value: unknown): value is XiangqiMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Partial<Record<keyof XiangqiMove, unknown>>;
  return typeof move.from === 'string' && typeof move.to === 'string';
}

// Fog rule: only move-played is per-seat (own moves only); every other event
// flows to both seats and spectators. Looser than DMX by design — pinned by
// the dxq golden wire fixture.
export function darkXiangqiClientEventFor(
  event: TenantRoomEvent<XiangqiColor, XiangqiMove, DarkXiangqiSpecId>,
  seat: TenantSeat<XiangqiColor>,
  ply: number,
): TenantClientEvent<XiangqiColor, XiangqiMove, DarkXiangqiSpecId> | null {
  if (event.type !== 'move-played') return event;
  if (seat === 'spectator' || event.color !== seat) return null;
  return { ...event, ply };
}

// Replay the event log's move list into a capture ledger. Pure: derived only
// from move-played events + the tenant's own initial state, so it exactly
// mirrors a normal projection replay's board sequence.
//
// Memoized per events-array identity: broadcastEventAppended builds a
// snapshot-shaped payload for EVERY client on EVERY move, so without the memo
// the O(plies) replay would run per client per event. The room appends to one
// long-lived array, so (reference, length) keys a game-long cache and the
// replay runs once per appended event.
const ledgerMemo = new WeakMap<object, { length: number; ledger: XiangqiCapture[] }>();

export function darkXiangqiCaptureLedger(
  events: readonly TenantRoomEvent<XiangqiColor, XiangqiMove, DarkXiangqiSpecId>[],
): XiangqiCapture[] {
  const cached = ledgerMemo.get(events);
  if (cached && cached.length === events.length) return cached.ledger;
  const roomId = events[0]?.roomId ?? 'unknown-room';
  const moves: XiangqiMove[] = [];
  for (const event of events) {
    if (event.type === 'move-played') moves.push(event.move);
  }
  const ledger = xiangqiCaptureLedger(createInitialXiangqiState(roomId), moves);
  ledgerMemo.set(events, { length: events.length, ledger });
  return ledger;
}

// Project the ledger to one viewer's honest capture knowledge.
//
// In a two-player fog game the dead-piece lists are COMMON KNOWLEDGE between the
// seats: every capture was either made by the seat (victim visible at capture,
// per field-of-fire vision) or suffered by it (own pieces are always visible).
// So both seats and the truth view carry the full dead lists — no per-seat
// filtering. Only spectators differ: they follow the tenant's empty-board
// policy, so their capture arrays are empty (material count is information).
export function darkXiangqiObservedCaptures(
  ledger: readonly XiangqiCapture[],
  seat: TenantSeat<XiangqiColor> | 'truth',
): DarkXiangqiObservedCaptures {
  if (seat === 'spectator') return { red: [], black: [] };
  return {
    red: capturedRoles(ledger, 'red'),
    black: capturedRoles(ledger, 'black'),
  };
}

function capturedRoles(ledger: readonly XiangqiCapture[], color: XiangqiColor): XiangqiPieceRole[] {
  const roles: XiangqiPieceRole[] = [];
  for (const capture of ledger) {
    if (capture.victim.color === color) roles.push(capture.victim.role);
  }
  return roles;
}

export function getDarkXiangqiClientView(
  state: XiangqiGameState,
  client: TenantSnapshotClient<XiangqiColor>,
  latestVisibleMoveColor?: XiangqiColor,
  ledger: readonly XiangqiCapture[] = [],
): DarkXiangqiWirePlayerView {
  const perspective = client.seat === 'black' ? 'black' : 'red';
  const captures = darkXiangqiObservedCaptures(ledger, client.seat);
  if (client.seat === 'spectator') return emptyDarkXiangqiView(state, perspective, captures);
  const view = redactShroudedXiangqiView(getXiangqiPlayerView(state, perspective), captures);
  if (latestVisibleMoveColor !== client.seat) return { ...view, lastMove: undefined };
  return view;
}

// The unredacted board. Lives here beside the per-seat view builders rather
// than in the postgame route, so the room and the API cannot drift about what
// "truth" means for this variant.
export function darkXiangqiTruthView(
  state: XiangqiGameState,
  captures: DarkXiangqiWirePlayerView['captures'],
): DarkXiangqiWirePlayerView {
  return {
    id: state.id,
    perspective: 'red',
    board: Object.fromEntries(
      Object.entries(state.board).map(([square, piece]) => [square, { piece, shrouded: false }]),
    ) as DarkXiangqiWirePlayerView['board'],
    visibleSquares: allXiangqiSquares(),
    legalMoves: [],
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
    captures,
  };
}

function allXiangqiSquares(): XiangqiSquare[] {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const squares: XiangqiSquare[] = [];
  for (let rank = 1; rank <= 10; rank += 1) {
    for (const file of files) {
      squares.push(`${file}${rank}` as XiangqiSquare);
    }
  }
  return squares;
}

function latestVisibleXiangqiMoveColor(
  events: readonly TenantRoomEvent<XiangqiColor, XiangqiMove, DarkXiangqiSpecId>[],
  client: TenantSnapshotClient<XiangqiColor>,
): XiangqiColor | undefined {
  if (client.seat === 'spectator') return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === 'move-played') return event.color === client.seat ? event.color : undefined;
  }
  return undefined;
}

// Re-encode the rules-level view for the wire: shrouded entries carry only the
// occupying color, never piece identity.
function redactShroudedXiangqiView(
  view: XiangqiPlayerView,
  captures: DarkXiangqiObservedCaptures,
): DarkXiangqiWirePlayerView {
  const board: DarkXiangqiWirePlayerView['board'] = {};
  for (const [square, entry] of Object.entries(view.board)) {
    if (!entry) continue;
    board[square as XiangqiSquare] = entry.shrouded
      ? { color: entry.piece.color, shrouded: true }
      : { piece: entry.piece, shrouded: false };
  }
  return { ...view, board, captures };
}

function emptyDarkXiangqiView(
  state: XiangqiGameState,
  perspective: XiangqiColor,
  captures: DarkXiangqiObservedCaptures,
): DarkXiangqiWirePlayerView {
  return {
    id: state.id,
    perspective,
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: undefined,
    captures,
  };
}

// Legacy persisted-record shape, with the DXQ-specific no-clock fields kept,
// but PvE metadata preserved so finished bot games remain attributable.
export function buildDarkXiangqiGameSummary(room: DarkXiangqiTenantRoom): persistence.GameSummary {
  const status = room.projection.state.status;
  if (status.type !== 'finished') {
    throw new Error('buildDarkXiangqiGameSummary called on non-terminal state');
  }
  const moveEvents = room.events.filter((event) => event.type === 'move-played');
  const firstAt = room.events[0]?.at ?? Date.now();
  const lastAt = room.events[room.events.length - 1]?.at ?? Date.now();
  const engineSeat = darkXiangqiEngineSeat(room);
  const mode = engineSeat ? 'pve' : 'pvp';
  // Finished Fog Xiangqi games are public like every other variant; the fog
  // live-spectate gate is separate and unaffected.
  const visibility: persistence.GameVisibility = 'public';
  return {
    variant: DARK_XIANGQI_SPEC_ID,
    mode,
    result: darkXiangqiResult(status.winner),
    termination: status.reason as persistence.GameTermination,
    plyCount: moveEvents.length,
    startedAt: new Date(firstAt),
    endedAt: new Date(lastAt),
    whiteClient: null,
    blackClient: null,
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility,
    participants: [
      tenantParticipant(darkXiangqiTenant, 'red', room, visibility),
      tenantParticipant(darkXiangqiTenant, 'black', room, visibility),
    ],
    // An engine cannot abandon: record the failure, not a win for the human.
    abortedAs: engineFailureAbort({
      engineSeat,
      winner: status.winner,
      reason: status.reason,
    }),
  };
}

function darkXiangqiResult(winner: XiangqiColor | null): persistence.GameResult {
  if (winner === 'red') return 'red-wins';
  if (winner === 'black') return 'black-wins';
  return 'draw';
}

function darkXiangqiEngineSeat(room: DarkXiangqiTenantRoom): XiangqiColor | null {
  for (const color of ['red', 'black'] as const) {
    if (isDarkXiangqiEngineClientId(room.projection.seats[color])) return color;
  }
  return null;
}

export const darkXiangqiTenant: DarkXiangqiTenant = {
  kind: 'dark-xiangqi',
  gameSpecId: DARK_XIANGQI_SPEC_ID,
  roomIdPrefix: DARK_XIANGQI_ROOM_ID_PREFIX,
  colors: ['red', 'black'],
  enabled: darkXiangqiEnabled,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  rules: {
    createInitialState: createInitialXiangqiState,
    applyMove: applyXiangqiMove,
    isLegalMove: isXiangqiLegalMove,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    abort: (state, reason: AbortReason) => ({
      ...state,
      status: { type: 'aborted', reason },
    }),
    isColor: isXiangqiColor,
    isMove: isXiangqiMove,
    moveFromMessage: (message) => {
      if (typeof message.from !== 'string' || typeof message.to !== 'string') return null;
      return { from: message.from as XiangqiSquare, to: message.to as XiangqiSquare };
    },
  },
  visibility: {
    clientEventFor: darkXiangqiClientEventFor,
    // Runs per client on EVERY broadcast: ws.ts broadcastEventAppended builds a
    // snapshot-shaped payload (view included) for each client on each move. The
    // ledger replay inside is O(plies), amortized by the memo in
    // darkXiangqiCaptureLedger to once per appended event.
    viewForClient: (state, client, events) =>
      getDarkXiangqiClientView(
        state,
        client,
        latestVisibleXiangqiMoveColor(events, client),
        darkXiangqiCaptureLedger(events),
      ),
    truthView: (state, events) =>
      darkXiangqiTruthView(state, darkXiangqiObservedCaptures(darkXiangqiCaptureLedger(events), 'truth')),
  },
  engine: {
    terminalContext: 'fog-observation',
    isEngineClientId: isDarkXiangqiEngineClientId,
    displayName: engineVersionDisplayName,
    reservationColor: (color) => (color === 'red' ? 'white' : 'black'),
    reservationReleaseTag: 'dxq',
  },
  wire: {
    acceptsSeatVacated: true,
  },
  persistence: {
    resultForWinner: darkXiangqiResult,
    termination: (reason: string) => reason as persistence.GameTermination,
    buildGameSummary: buildDarkXiangqiGameSummary,
    logKindPrefix: 'dark_xiangqi',
    logLabel: 'Dark Xiangqi',
  },
};
