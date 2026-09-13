/**
 * Chess Bughouse partner-bot protocol.
 *
 * This is a draft wire contract for the private mistboard-engine repo. It is
 * deliberately separate from `EngineTurnRequest`, because bughouse is a
 * two-board, four-seat match with partner reserves, concurrent clocks, and
 * structured teammate signals. The public Mistboard server should construct
 * this request from its canonical bughouse aggregate; engine code mirrors this
 * JSON shape and never imports Mistboard internals.
 *
 * Scope for protocol version 0:
 *   - ordinary perfect-information Chess Bughouse only
 *   - public reserves
 *   - structured team signals, not free chat
 *   - bot may choose to wait on its own clock as an engine policy decision
 *   - captures/promotions/en passant/drop legality are enforced by the server
 *
 * Future xiangqi bughouse variants should add sibling spec IDs and board
 * geometry fields after the chess contract has benchmark evidence.
 */

import type { Color, PieceRole, Square } from './types.js';

export type BughousePartnerProtocolVersion = '0';
export const BUGHOUSE_PARTNER_PROTOCOL_VERSION = '0' satisfies BughousePartnerProtocolVersion;

export type BughouseGameSpecId = 'chess-bughouse';
export type BughouseBoardId = 'A' | 'B';
export type BughouseTeamId = 'team-0' | 'team-1';
export type BughouseSeatId = 'A:white' | 'A:black' | 'B:white' | 'B:black';
export type BughouseActionId = string;
export type BughouseSignalId = string;

export type BughouseDropRole = Exclude<PieceRole, 'king'>;
export const BUGHOUSE_DROP_ROLES = [
  'queen',
  'rook',
  'bishop',
  'knight',
  'pawn',
] as const satisfies readonly BughouseDropRole[];

export type BughouseReserve = Partial<Record<BughouseDropRole, number>>;
export type BughouseReserves = Record<BughouseSeatId, BughouseReserve>;

export type BughousePiece = {
  color: Color;
  role: PieceRole;
};
export const BUGHOUSE_PIECE_ROLES = [
  'king',
  'queen',
  'rook',
  'bishop',
  'knight',
  'pawn',
] as const satisfies readonly PieceRole[];

export type BughouseCastlingRights = {
  white: Square[];
  black: Square[];
};

export type BughouseBoardView = {
  board: BughouseBoardId;
  sideToMove: Color;
  ply: number;
  fullmoveNumber: number;
  halfmoveClock: number;
  pieces: Array<[Square, BughousePiece]>;
  castlingRights: BughouseCastlingRights;
  enPassantSquare: Square | null;
  lastAction: BughouseBoardAction | null;
  status: BughouseBoardStatus;
};

export type BughouseBoardStatus =
  | { type: 'playing' }
  | { type: 'finished'; winner: Color | null; reason: BughouseTerminalReason };

export type BughouseTerminalReason =
  | 'checkmate'
  | 'draw'
  | 'timeout'
  | 'resignation'
  | 'abandonment';

export type BughouseMove = {
  from: Square;
  to: Square;
  promotion?: Exclude<PieceRole, 'king' | 'pawn'>;
};

export type BughouseDrop = {
  role: BughouseDropRole;
  to: Square;
};

export type BughouseBoardMoveAction = {
  id: BughouseActionId;
  kind: 'move';
  board: BughouseBoardId;
  seat: BughouseSeatId;
  move: BughouseMove;
  san?: string;
  uci?: string;
};

export type BughouseBoardDropAction = {
  id: BughouseActionId;
  kind: 'drop';
  board: BughouseBoardId;
  seat: BughouseSeatId;
  drop: BughouseDrop;
  san?: string;
};

export type BughouseBoardAction = BughouseBoardMoveAction | BughouseBoardDropAction;

export type BughouseBoardClock = {
  activeSeat: BughouseSeatId | null;
  remainingMs: Record<Color, number | null>;
  incrementMs: number;
  runningSinceEpochMs: number | null;
};

export type BughouseClockView = {
  serverNowEpochMs: number;
  boards: Record<BughouseBoardId, BughouseBoardClock>;
};

export type BughouseSignalKind =
  | 'need-piece'
  | 'have-piece'
  | 'hold-piece'
  | 'avoid-feed'
  | 'play-fast'
  | 'sit'
  | 'danger';
export const BUGHOUSE_SIGNAL_KINDS = [
  'need-piece',
  'have-piece',
  'hold-piece',
  'avoid-feed',
  'play-fast',
  'sit',
  'danger',
] as const satisfies readonly BughouseSignalKind[];

export type BughouseSignalUrgency = 'low' | 'medium' | 'high';
export const BUGHOUSE_SIGNAL_URGENCIES = [
  'low',
  'medium',
  'high',
] as const satisfies readonly BughouseSignalUrgency[];

export type BughouseTeamSignal = {
  id: BughouseSignalId;
  kind: BughouseSignalKind;
  from: BughouseSeatId;
  to: BughouseSeatId;
  createdAtPly: number;
  urgency: BughouseSignalUrgency;
  role?: BughouseDropRole;
  board?: BughouseBoardId;
  square?: Square;
  expiresAtPly?: number;
};

export type BughouseOutboundTeamSignal = Omit<
  BughouseTeamSignal,
  'id' | 'from' | 'to' | 'createdAtPly'
> & {
  to: BughouseSeatId;
};

export type BughouseSeatAssignment = {
  board: BughouseBoardId;
  color: Color;
  team: BughouseTeamId;
  teammate: BughouseSeatId;
};

export const BUGHOUSE_SEAT_ASSIGNMENTS = {
  'A:white': { board: 'A', color: 'white', team: 'team-0', teammate: 'B:black' },
  'B:black': { board: 'B', color: 'black', team: 'team-0', teammate: 'A:white' },
  'A:black': { board: 'A', color: 'black', team: 'team-1', teammate: 'B:white' },
  'B:white': { board: 'B', color: 'white', team: 'team-1', teammate: 'A:black' },
} as const satisfies Record<BughouseSeatId, BughouseSeatAssignment>;

export const BUGHOUSE_SEATS = Object.keys(BUGHOUSE_SEAT_ASSIGNMENTS) as BughouseSeatId[];
export const BUGHOUSE_BOARDS = ['A', 'B'] as const satisfies readonly BughouseBoardId[];

export type BughousePartnerRequest = {
  protocolVersion: BughousePartnerProtocolVersion;
  gameSpecId: BughouseGameSpecId;
  matchId: string;
  engineId: string;
  sessionId: string;
  seat: BughouseSeatId;
  team: BughouseTeamId;
  ply: number;
  engineSeed: number;
  boards: Record<BughouseBoardId, BughouseBoardView>;
  reserves: BughouseReserves;
  clocks: BughouseClockView;
  legalActions: BughouseBoardAction[];
  teamSignals: BughouseTeamSignal[];
};

export type BughousePartnerDecision =
  | { kind: 'play'; actionId: BughouseActionId }
  | {
      kind: 'wait';
      maxWaitMs: number;
      reason: 'need-incoming-piece' | 'avoid-feeding-mate' | 'protect-partner-clock' | 'other';
    }
  | { kind: 'resign'; reason?: string };

export type BughousePartnerResponse = {
  protocolVersion: BughousePartnerProtocolVersion;
  matchId: string;
  sessionId: string;
  decision: BughousePartnerDecision;
  signals?: BughouseOutboundTeamSignal[];
  diagnostics?: Record<string, unknown>;
};

export type BughouseProtocolValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export function isBughouseSeatId(value: unknown): value is BughouseSeatId {
  return typeof value === 'string' && value in BUGHOUSE_SEAT_ASSIGNMENTS;
}

export function validateBughousePartnerRequest(
  value: unknown,
): BughouseProtocolValidationResult<BughousePartnerRequest> {
  if (!isRecord(value)) return invalid('request is not an object');
  if (value.protocolVersion !== BUGHOUSE_PARTNER_PROTOCOL_VERSION) {
    return invalid('unsupported protocol version');
  }
  if (value.gameSpecId !== 'chess-bughouse') return invalid('unsupported game spec');
  if (!isNonEmptyString(value.matchId)) return invalid('missing matchId');
  if (!isNonEmptyString(value.engineId)) return invalid('missing engineId');
  if (!isNonEmptyString(value.sessionId)) return invalid('missing sessionId');
  if (!isBughouseSeatId(value.seat)) return invalid('invalid seat');
  const seat = value.seat;
  const assignment = BUGHOUSE_SEAT_ASSIGNMENTS[seat];
  if (value.team !== assignment.team) return invalid('seat/team mismatch');
  if (!isNonNegativeInteger(value.ply)) return invalid('invalid ply');
  if (!isNonNegativeInteger(value.engineSeed)) return invalid('invalid engineSeed');

  const boards = validateBoards(value.boards);
  if (!boards.ok) return boards;

  const reserves = validateReserves(value.reserves);
  if (!reserves.ok) return reserves;

  const clocks = validateClocks(value.clocks);
  if (!clocks.ok) return clocks;

  if (!Array.isArray(value.legalActions)) return invalid('legalActions is not an array');
  for (const action of value.legalActions) {
    const actionResult = validateBoardAction(action);
    if (!actionResult.ok) return actionResult;
    if (actionResult.value.seat !== seat) return invalid('legal action seat mismatch');
    if (actionResult.value.board !== assignment.board)
      return invalid('legal action board mismatch');
  }

  if (!Array.isArray(value.teamSignals)) return invalid('teamSignals is not an array');
  for (const signal of value.teamSignals) {
    const signalResult = validateTeamSignal(signal);
    if (!signalResult.ok) return signalResult;
    if (signalResult.value.to !== seat) return invalid('team signal recipient mismatch');
    if (signalResult.value.from !== assignment.teammate)
      return invalid('team signal sender mismatch');
  }

  return { ok: true, value: value as BughousePartnerRequest };
}

export function validateBughousePartnerResponse(
  value: unknown,
  request: BughousePartnerRequest,
): BughouseProtocolValidationResult<BughousePartnerResponse> {
  if (!isRecord(value)) return invalid('response is not an object');
  if (value.protocolVersion !== BUGHOUSE_PARTNER_PROTOCOL_VERSION) {
    return invalid('unsupported protocol version');
  }
  if (value.matchId !== request.matchId) return invalid('response matchId mismatch');
  if (value.sessionId !== request.sessionId) return invalid('response sessionId mismatch');

  const decision = validatePartnerDecision(value.decision, request);
  if (!decision.ok) return decision;

  if (value.signals !== undefined) {
    if (!Array.isArray(value.signals)) return invalid('signals is not an array');
    const teammate = BUGHOUSE_SEAT_ASSIGNMENTS[request.seat].teammate;
    for (const signal of value.signals) {
      const signalResult = validateOutboundSignal(signal);
      if (!signalResult.ok) return signalResult;
      if (signalResult.value.to !== teammate) return invalid('outbound signal recipient mismatch');
    }
  }

  if (value.diagnostics !== undefined && !isRecord(value.diagnostics)) {
    return invalid('diagnostics is not an object');
  }

  return { ok: true, value: value as BughousePartnerResponse };
}

function validateBoards(value: unknown): BughouseProtocolValidationResult<true> {
  if (!isRecord(value)) return invalid('boards is not an object');
  for (const board of BUGHOUSE_BOARDS) {
    const boardResult = validateBoardView(value[board], board);
    if (!boardResult.ok) return boardResult;
  }
  return { ok: true, value: true };
}

function validateBoardView(
  value: unknown,
  board: BughouseBoardId,
): BughouseProtocolValidationResult<BughouseBoardView> {
  if (!isRecord(value)) return invalid(`board ${board} is not an object`);
  if (value.board !== board) return invalid(`board ${board} id mismatch`);
  if (!isColor(value.sideToMove)) return invalid(`board ${board} sideToMove invalid`);
  if (!isNonNegativeInteger(value.ply)) return invalid(`board ${board} ply invalid`);
  if (!isPositiveInteger(value.fullmoveNumber)) {
    return invalid(`board ${board} fullmoveNumber invalid`);
  }
  if (!isNonNegativeInteger(value.halfmoveClock)) {
    return invalid(`board ${board} halfmoveClock invalid`);
  }
  if (!Array.isArray(value.pieces)) return invalid(`board ${board} pieces invalid`);
  for (const pieceEntry of value.pieces) {
    if (!Array.isArray(pieceEntry) || pieceEntry.length !== 2) {
      return invalid(`board ${board} piece entry invalid`);
    }
    const [square, piece] = pieceEntry;
    if (!isSquare(square)) return invalid(`board ${board} piece square invalid`);
    if (!isBughousePiece(piece)) return invalid(`board ${board} piece invalid`);
  }
  if (!isCastlingRights(value.castlingRights)) {
    return invalid(`board ${board} castling rights invalid`);
  }
  if (value.enPassantSquare !== null && !isSquare(value.enPassantSquare)) {
    return invalid(`board ${board} enPassantSquare invalid`);
  }
  if (value.lastAction !== null) {
    const action = validateBoardAction(value.lastAction);
    if (!action.ok) return action;
    if (action.value.board !== board) return invalid(`board ${board} lastAction board mismatch`);
  }
  if (!isBoardStatus(value.status)) return invalid(`board ${board} status invalid`);
  return { ok: true, value: value as BughouseBoardView };
}

function validateReserves(value: unknown): BughouseProtocolValidationResult<true> {
  if (!isRecord(value)) return invalid('reserves is not an object');
  for (const seat of BUGHOUSE_SEATS) {
    const reserve = value[seat];
    if (!isRecord(reserve)) return invalid(`reserve ${seat} invalid`);
    for (const [role, count] of Object.entries(reserve)) {
      if (!isDropRole(role)) return invalid(`reserve ${seat} role invalid`);
      if (!isNonNegativeInteger(count)) return invalid(`reserve ${seat} count invalid`);
    }
  }
  return { ok: true, value: true };
}

function validateClocks(value: unknown): BughouseProtocolValidationResult<true> {
  if (!isRecord(value)) return invalid('clocks is not an object');
  if (!isFiniteNumber(value.serverNowEpochMs)) return invalid('serverNowEpochMs invalid');
  if (!isRecord(value.boards)) return invalid('clock boards invalid');
  for (const board of BUGHOUSE_BOARDS) {
    const clock = value.boards[board];
    if (!isRecord(clock)) return invalid(`clock ${board} invalid`);
    if (clock.activeSeat !== null) {
      if (!isBughouseSeatId(clock.activeSeat)) return invalid(`clock ${board} activeSeat invalid`);
      if (BUGHOUSE_SEAT_ASSIGNMENTS[clock.activeSeat].board !== board) {
        return invalid(`clock ${board} activeSeat board mismatch`);
      }
    }
    if (!isRecord(clock.remainingMs)) return invalid(`clock ${board} remainingMs invalid`);
    for (const color of ['white', 'black'] as const) {
      const remaining = clock.remainingMs[color];
      if (remaining !== null && !isNonNegativeFiniteNumber(remaining)) {
        return invalid(`clock ${board} ${color} remainingMs invalid`);
      }
    }
    if (!isNonNegativeFiniteNumber(clock.incrementMs))
      return invalid(`clock ${board} increment invalid`);
    if (clock.runningSinceEpochMs !== null && !isFiniteNumber(clock.runningSinceEpochMs)) {
      return invalid(`clock ${board} runningSince invalid`);
    }
  }
  return { ok: true, value: true };
}

function validatePartnerDecision(
  value: unknown,
  request: BughousePartnerRequest,
): BughouseProtocolValidationResult<BughousePartnerDecision> {
  if (!isRecord(value)) return invalid('decision is not an object');
  if (value.kind === 'play') {
    if (!isNonEmptyString(value.actionId)) return invalid('play actionId invalid');
    if (!request.legalActions.some((action) => action.id === value.actionId)) {
      return invalid('play action is not legal');
    }
    return { ok: true, value: value as BughousePartnerDecision };
  }
  if (value.kind === 'wait') {
    if (!isPositiveFiniteNumber(value.maxWaitMs)) return invalid('wait maxWaitMs invalid');
    if (
      value.reason !== 'need-incoming-piece' &&
      value.reason !== 'avoid-feeding-mate' &&
      value.reason !== 'protect-partner-clock' &&
      value.reason !== 'other'
    ) {
      return invalid('wait reason invalid');
    }
    return { ok: true, value: value as BughousePartnerDecision };
  }
  if (value.kind === 'resign') {
    if (value.reason !== undefined && typeof value.reason !== 'string') {
      return invalid('resign reason invalid');
    }
    return { ok: true, value: value as BughousePartnerDecision };
  }
  return invalid('decision kind invalid');
}

function validateBoardAction(
  value: unknown,
): BughouseProtocolValidationResult<BughouseBoardAction> {
  if (!isRecord(value)) return invalid('board action is not an object');
  if (!isNonEmptyString(value.id)) return invalid('board action id invalid');
  if (!isBoardId(value.board)) return invalid('board action board invalid');
  if (!isBughouseSeatId(value.seat)) return invalid('board action seat invalid');
  if (BUGHOUSE_SEAT_ASSIGNMENTS[value.seat].board !== value.board) {
    return invalid('board action seat/board mismatch');
  }
  if (value.kind === 'move') {
    if (!isMove(value.move)) return invalid('board action move invalid');
    if (value.san !== undefined && typeof value.san !== 'string') return invalid('san invalid');
    if (value.uci !== undefined && typeof value.uci !== 'string') return invalid('uci invalid');
    return { ok: true, value: value as BughouseBoardAction };
  }
  if (value.kind === 'drop') {
    if (!isDrop(value.drop)) return invalid('board action drop invalid');
    if (value.san !== undefined && typeof value.san !== 'string') return invalid('san invalid');
    return { ok: true, value: value as BughouseBoardAction };
  }
  return invalid('board action kind invalid');
}

function validateTeamSignal(value: unknown): BughouseProtocolValidationResult<BughouseTeamSignal> {
  const common = validateSignalCommon(value);
  if (!common.ok) return common;
  if (!isRecord(value) || !isNonEmptyString(value.id)) return invalid('team signal id invalid');
  if (!isBughouseSeatId(value.from)) return invalid('team signal from invalid');
  if (!isBughouseSeatId(value.to)) return invalid('team signal to invalid');
  if (!isNonNegativeInteger(value.createdAtPly)) return invalid('team signal createdAtPly invalid');
  if (BUGHOUSE_SEAT_ASSIGNMENTS[value.from].teammate !== value.to) {
    return invalid('team signal partner mismatch');
  }
  return { ok: true, value: value as BughouseTeamSignal };
}

function validateOutboundSignal(
  value: unknown,
): BughouseProtocolValidationResult<BughouseOutboundTeamSignal> {
  const common = validateSignalCommon(value);
  if (!common.ok) return common;
  if (!isRecord(value) || !isBughouseSeatId(value.to)) return invalid('outbound signal to invalid');
  return { ok: true, value: value as BughouseOutboundTeamSignal };
}

function validateSignalCommon(value: unknown): BughouseProtocolValidationResult<true> {
  if (!isRecord(value)) return invalid('signal is not an object');
  if (!isSignalKind(value.kind)) return invalid('signal kind invalid');
  if (!isSignalUrgency(value.urgency)) return invalid('signal urgency invalid');
  if (value.role !== undefined && !isDropRole(value.role)) return invalid('signal role invalid');
  if (value.board !== undefined && !isBoardId(value.board)) return invalid('signal board invalid');
  if (value.square !== undefined && !isSquare(value.square))
    return invalid('signal square invalid');
  if (value.expiresAtPly !== undefined && !isNonNegativeInteger(value.expiresAtPly)) {
    return invalid('signal expiresAtPly invalid');
  }
  return { ok: true, value: true };
}

function isBoardStatus(value: unknown): value is BughouseBoardStatus {
  if (!isRecord(value)) return false;
  if (value.type === 'playing') return true;
  if (value.type !== 'finished') return false;
  return (
    (isColor(value.winner) || value.winner === null) &&
    (value.reason === 'checkmate' ||
      value.reason === 'draw' ||
      value.reason === 'timeout' ||
      value.reason === 'resignation' ||
      value.reason === 'abandonment')
  );
}

function isCastlingRights(value: unknown): value is BughouseCastlingRights {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.white) &&
    value.white.every(isSquare) &&
    Array.isArray(value.black) &&
    value.black.every(isSquare)
  );
}

function isBughousePiece(value: unknown): value is BughousePiece {
  return isRecord(value) && isColor(value.color) && isPieceRole(value.role);
}

function isMove(value: unknown): value is BughouseMove {
  if (!isRecord(value)) return false;
  if (!isSquare(value.from) || !isSquare(value.to)) return false;
  return value.promotion === undefined || isPromotionRole(value.promotion);
}

function isDrop(value: unknown): value is BughouseDrop {
  return isRecord(value) && isDropRole(value.role) && isSquare(value.to);
}

function isBoardId(value: unknown): value is BughouseBoardId {
  return value === 'A' || value === 'B';
}

function isColor(value: unknown): value is Color {
  return value === 'white' || value === 'black';
}

function isPieceRole(value: unknown): value is PieceRole {
  return typeof value === 'string' && (BUGHOUSE_PIECE_ROLES as readonly string[]).includes(value);
}

function isDropRole(value: unknown): value is BughouseDropRole {
  return typeof value === 'string' && (BUGHOUSE_DROP_ROLES as readonly string[]).includes(value);
}

function isPromotionRole(value: unknown): value is BughouseMove['promotion'] {
  return value === 'queen' || value === 'rook' || value === 'bishop' || value === 'knight';
}

function isSignalKind(value: unknown): value is BughouseSignalKind {
  return typeof value === 'string' && (BUGHOUSE_SIGNAL_KINDS as readonly string[]).includes(value);
}

function isSignalUrgency(value: unknown): value is BughouseSignalUrgency {
  return (
    typeof value === 'string' && (BUGHOUSE_SIGNAL_URGENCIES as readonly string[]).includes(value)
  );
}

function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function invalid<T>(reason: string): BughouseProtocolValidationResult<T> {
  return { ok: false, reason };
}
