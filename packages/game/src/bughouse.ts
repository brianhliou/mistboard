import {
  BUGHOUSE_BOARDS,
  BUGHOUSE_SEAT_ASSIGNMENTS,
  BUGHOUSE_SEATS,
  type BughouseBoardAction,
  type BughouseBoardId,
  type BughouseBoardStatus,
  type BughouseBoardView,
  type BughouseClockView,
  type BughouseDrop,
  type BughouseDropRole,
  type BughousePartnerRequest,
  type BughouseReserves,
  type BughouseSeatId,
  type BughouseTeamId,
  type BughouseTeamSignal,
  type BughouseTerminalReason,
} from './bughouse-engine-protocol.js';
import { defaultClockIncrementMs, defaultClockInitialMs } from './clocks.js';
import type { Board, Color, GameState, Move, PieceRole, Square } from './types.js';
import { isLegalStandardChessMove, positionFromState, standardChessVariant } from './variants.js';

export type BughouseBoardClockState = {
  activeSeat: BughouseSeatId | null;
  remainingMs: Record<Color, number>;
  runningSince: number | null;
};

export type BughouseClockState = {
  initialMs: number;
  incrementMs: number;
  boards: Record<BughouseBoardId, BughouseBoardClockState>;
};

export type BughouseBoardState = {
  board: BughouseBoardId;
  state: GameState;
  promoted: Square[];
  lastAction: BughouseBoardAction | null;
};

export type BughouseMatchStatus =
  | { type: 'playing' }
  | {
      type: 'finished';
      board: BughouseBoardId;
      winnerTeam: BughouseTeamId | null;
      reason: BughouseTerminalReason;
    };

export type BughouseMatchState = {
  id: string;
  status: BughouseMatchStatus;
  boards: Record<BughouseBoardId, BughouseBoardState>;
  reserves: BughouseReserves;
  lastAction: BughouseBoardAction | null;
  clock?: BughouseClockState;
};

export type BughouseEvent =
  | {
      type: 'match-created';
      at: number;
      matchId: string;
    }
  | {
      type: 'clock-started';
      at: number;
      matchId: string;
      clock: BughouseClockState;
    }
  | {
      type: 'seat-assigned';
      at: number;
      matchId: string;
      clientId: string;
      seat: BughouseSeatId;
    }
  | {
      type: 'clock-expired';
      at: number;
      matchId: string;
      seat: BughouseSeatId;
      clock?: BughouseClockState;
    }
  | {
      type: 'board-move';
      at: number;
      matchId: string;
      seat: BughouseSeatId;
      move: Move;
      clock?: BughouseClockState;
    }
  | {
      type: 'board-drop';
      at: number;
      matchId: string;
      seat: BughouseSeatId;
      drop: BughouseDrop;
      clock?: BughouseClockState;
    };

export type BuildBughousePartnerRequestOptions = {
  match: BughouseMatchState;
  seat: BughouseSeatId;
  engineId: string;
  engineSeed: number;
  serverNowEpochMs: number;
  sessionId?: string;
  teamSignals?: BughouseTeamSignal[];
};

const DROP_ROLES: readonly BughouseDropRole[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];
const ALL_SQUARES: readonly Square[] = (() => {
  const squares: Square[] = [];
  for (const rank of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      squares.push(`${file}${rank}` as Square);
    }
  }
  return squares;
})();

export function createInitialBughouseMatch(matchId: string): BughouseMatchState {
  return {
    id: matchId,
    status: { type: 'playing' },
    boards: {
      A: createInitialBughouseBoard(`${matchId}:A`, 'A'),
      B: createInitialBughouseBoard(`${matchId}:B`, 'B'),
    },
    reserves: emptyBughouseReserves(),
    lastAction: null,
  };
}

export function replayBughouseEvents(events: readonly BughouseEvent[]): BughouseMatchState {
  const matchId = events[0]?.matchId ?? 'unknown-bughouse-match';
  return events.reduce(
    (match, event) => applyBughouseEvent(match, event),
    createInitialBughouseMatch(matchId),
  );
}

export function applyBughouseEvent(
  match: BughouseMatchState,
  event: BughouseEvent,
): BughouseMatchState {
  if (event.matchId !== match.id) return match;
  if (event.type === 'match-created') return match;
  if (event.type === 'clock-started') return { ...match, clock: event.clock };
  if (event.type === 'seat-assigned') return match;
  if (event.type === 'clock-expired') {
    return applyBughouseTimeout(match, event.seat, event.at, event.clock);
  }
  if (event.type === 'board-move') {
    const next = applyBughouseMove(match, event.seat, event.move, event.at);
    return event.clock ? { ...next, clock: event.clock } : next;
  }
  const next = applyBughouseDrop(match, event.seat, event.drop, event.at);
  return event.clock ? { ...next, clock: event.clock } : next;
}

export function buildBughousePartnerRequest(
  options: BuildBughousePartnerRequestOptions,
): BughousePartnerRequest {
  const { match, seat, engineId, engineSeed, serverNowEpochMs } = options;
  const assignment = BUGHOUSE_SEAT_ASSIGNMENTS[seat];
  return {
    protocolVersion: '0',
    gameSpecId: 'chess-bughouse',
    matchId: match.id,
    engineId,
    sessionId: options.sessionId ?? `${match.id}:${seat}:${engineId}`,
    seat,
    team: assignment.team,
    ply: matchPly(match),
    engineSeed,
    boards: {
      A: boardViewFor(match, 'A'),
      B: boardViewFor(match, 'B'),
    },
    reserves: match.reserves,
    clocks: clockViewFor(match.clock, serverNowEpochMs),
    legalActions: bughouseLegalActions(match, seat),
    teamSignals: (options.teamSignals ?? []).filter((signal) => signal.to === seat),
  };
}

export function createBughouseClock(
  _at: number,
  initialMs = defaultClockInitialMs,
  incrementMs = defaultClockIncrementMs,
): BughouseClockState {
  return {
    initialMs,
    incrementMs,
    boards: {
      A: createBughouseBoardClock(initialMs),
      B: createBughouseBoardClock(initialMs),
    },
  };
}

export function startBughouseClocks(
  match: BughouseMatchState,
  clock: BughouseClockState,
  at: number,
): BughouseClockState {
  return resumeBughouseClocks(match, clock, at);
}

export function resumeBughouseClocks(
  match: BughouseMatchState,
  clock: BughouseClockState,
  at: number,
): BughouseClockState {
  return {
    ...clock,
    boards: Object.fromEntries(
      BUGHOUSE_BOARDS.map((boardId) => {
        const activeSeat = activeSeatForBoard(match, boardId);
        return [
          boardId,
          {
            ...clock.boards[boardId],
            activeSeat,
            runningSince: activeSeat ? at : null,
          },
        ];
      }),
    ) as Record<BughouseBoardId, BughouseBoardClockState>,
  };
}

export function nextBughouseClockForAction(
  clock: BughouseClockState | undefined,
  at: number,
  seat: BughouseSeatId,
  nextMatch: BughouseMatchState,
): BughouseClockState | undefined {
  if (!clock) return clock;
  const assignment = BUGHOUSE_SEAT_ASSIGNMENTS[seat];
  const boardClock = clock.boards[assignment.board];
  if (boardClock.activeSeat !== seat || boardClock.runningSince === null) {
    return nextMatch.status.type === 'playing' ? clock : freezeBughouseClock(clock, at);
  }

  const remaining = bughouseClockRemainingMs(clock, seat, at);
  const nextActiveSeat = activeSeatForBoard(nextMatch, assignment.board);
  const nextBoardClock: BughouseBoardClockState = {
    ...boardClock,
    activeSeat: nextActiveSeat,
    remainingMs: {
      ...boardClock.remainingMs,
      [assignment.color]: nextActiveSeat ? remaining + clock.incrementMs : remaining,
    },
    runningSince: nextActiveSeat ? at : null,
  };
  const nextClock = {
    ...clock,
    boards: {
      ...clock.boards,
      [assignment.board]: nextBoardClock,
    },
  };
  return nextMatch.status.type === 'playing' ? nextClock : freezeBughouseClock(nextClock, at);
}

export function expireBughouseClock(
  clock: BughouseClockState | undefined,
  at: number,
  seat: BughouseSeatId,
): BughouseClockState | undefined {
  if (!clock) return clock;
  const assignment = BUGHOUSE_SEAT_ASSIGNMENTS[seat];
  const boardClock = clock.boards[assignment.board];
  const nextClock = {
    ...clock,
    boards: {
      ...clock.boards,
      [assignment.board]: {
        ...boardClock,
        activeSeat: null,
        remainingMs: {
          ...boardClock.remainingMs,
          [assignment.color]: Math.max(0, bughouseClockRemainingMs(clock, seat, at)),
        },
        runningSince: null,
      },
    },
  };
  return freezeBughouseClock(nextClock, at);
}

export function freezeBughouseClock(
  clock: BughouseClockState | undefined,
  at: number,
): BughouseClockState | undefined {
  if (!clock) return clock;
  return {
    ...clock,
    boards: Object.fromEntries(
      BUGHOUSE_BOARDS.map((boardId) => {
        const boardClock = clock.boards[boardId];
        if (!boardClock.activeSeat || boardClock.runningSince === null)
          return [boardId, boardClock];
        const color = BUGHOUSE_SEAT_ASSIGNMENTS[boardClock.activeSeat].color;
        return [
          boardId,
          {
            ...boardClock,
            activeSeat: null,
            remainingMs: {
              ...boardClock.remainingMs,
              [color]: bughouseClockRemainingMs(clock, boardClock.activeSeat, at),
            },
            runningSince: null,
          },
        ];
      }),
    ) as Record<BughouseBoardId, BughouseBoardClockState>,
  };
}

export function bughouseClockRemainingMs(
  clock: BughouseClockState,
  seat: BughouseSeatId,
  at: number,
): number {
  const assignment = BUGHOUSE_SEAT_ASSIGNMENTS[seat];
  const boardClock = clock.boards[assignment.board];
  const remaining = boardClock.remainingMs[assignment.color];
  if (boardClock.activeSeat !== seat || boardClock.runningSince === null) return remaining;
  return Math.max(0, remaining - Math.max(0, at - boardClock.runningSince));
}

export function emptyBughouseReserves(): BughouseReserves {
  return Object.fromEntries(BUGHOUSE_SEATS.map((seat) => [seat, {}])) as BughouseReserves;
}

export function bughouseLegalActions(
  match: BughouseMatchState,
  seat: BughouseSeatId,
): BughouseBoardAction[] {
  if (match.status.type !== 'playing') return [];
  const assignment = BUGHOUSE_SEAT_ASSIGNMENTS[seat];
  const board = match.boards[assignment.board];
  if (board.state.status.type !== 'playing' || board.state.status.turn !== assignment.color) {
    return [];
  }

  const moves = standardChessVariant
    .getLegalMoves(board.state, assignment.color)
    .map((move) => moveAction(assignment.board, seat, move));
  const drops = legalBughouseDrops(board, assignment.color, match.reserves[seat]).map((drop) =>
    dropAction(assignment.board, seat, drop),
  );
  return [...moves, ...drops];
}

export function applyBughouseMove(
  match: BughouseMatchState,
  seat: BughouseSeatId,
  move: Move,
  at?: number,
): BughouseMatchState {
  if (match.status.type !== 'playing') return match;
  const assignment = BUGHOUSE_SEAT_ASSIGNMENTS[seat];
  const board = match.boards[assignment.board];
  if (board.state.status.type !== 'playing' || board.state.status.turn !== assignment.color) {
    return match;
  }
  if (!isLegalStandardChessMove(board.state, move)) return match;

  const movingPiece = board.state.board[move.from];
  if (!movingPiece) return match;
  const capture = capturedPieceForBughouse(board, move, movingPiece.color);
  const nextStateRaw = standardChessVariant.applyMove(board.state, move);
  if (nextStateRaw === board.state) return match;

  const nextTurn = oppositeColor(assignment.color);
  const action = moveAction(board.board, seat, move);
  const nextBoard: BughouseBoardState = {
    board: board.board,
    state: {
      ...nextStateRaw,
      status: { type: 'playing', turn: nextTurn },
    },
    promoted: nextPromotedSquaresForMove(board, move, movingPiece, capture?.square),
    lastAction: action,
  };

  const reserves = capture
    ? addReserve(match.reserves, BUGHOUSE_SEAT_ASSIGNMENTS[seat].teammate, capture.reserveRole)
    : match.reserves;
  const nextMatch = withBoardAndReserves(match, nextBoard, reserves, action);
  return withAdvancedClock(
    match,
    applyBoardTerminal(nextMatch, board.board, assignment.color),
    seat,
    at,
  );
}

export function applyBughouseDrop(
  match: BughouseMatchState,
  seat: BughouseSeatId,
  drop: BughouseDrop,
  at?: number,
): BughouseMatchState {
  if (match.status.type !== 'playing') return match;
  const assignment = BUGHOUSE_SEAT_ASSIGNMENTS[seat];
  const board = match.boards[assignment.board];
  if (board.state.status.type !== 'playing' || board.state.status.turn !== assignment.color) {
    return match;
  }
  if (!isLegalBughouseDrop(board, assignment.color, match.reserves[seat], drop)) return match;

  const nextBoardState = placeDrop(board.state, assignment.color, drop);
  const action = dropAction(board.board, seat, drop);
  const nextBoard: BughouseBoardState = {
    board: board.board,
    state: nextBoardState,
    promoted: board.promoted,
    lastAction: action,
  };
  const reserves = removeReserve(match.reserves, seat, drop.role);
  const nextMatch = withBoardAndReserves(match, nextBoard, reserves, action);
  return withAdvancedClock(
    match,
    applyBoardTerminal(nextMatch, board.board, assignment.color),
    seat,
    at,
  );
}

export function applyBughouseTimeout(
  match: BughouseMatchState,
  seat: BughouseSeatId,
  at: number,
  clock?: BughouseClockState,
): BughouseMatchState {
  if (match.status.type !== 'playing') return match;
  const assignment = BUGHOUSE_SEAT_ASSIGNMENTS[seat];
  const board = match.boards[assignment.board];
  if (board.state.status.type !== 'playing') return match;
  const winner = oppositeColor(assignment.color);
  const winnerSeat = seatFor(assignment.board, winner);
  return {
    ...match,
    clock: clock ?? expireBughouseClock(match.clock, at, seat),
    status: {
      type: 'finished',
      board: assignment.board,
      winnerTeam: BUGHOUSE_SEAT_ASSIGNMENTS[winnerSeat].team,
      reason: 'timeout',
    },
    boards: {
      ...match.boards,
      [assignment.board]: {
        ...board,
        state: {
          ...board.state,
          status: { type: 'finished', winner, reason: 'timeout' },
        },
      },
    },
  };
}

export function isLegalBughouseDrop(
  board: BughouseBoardState,
  color: Color,
  reserve: Partial<Record<BughouseDropRole, number>>,
  drop: BughouseDrop,
): boolean {
  if ((reserve[drop.role] ?? 0) <= 0) return false;
  if (board.state.board[drop.to]) return false;
  if (drop.role === 'pawn' && isBackRank(drop.to)) return false;
  const nextBoard = {
    ...board.state.board,
    [drop.to]: { color, role: drop.role },
  } satisfies Board;
  return !isInCheck({ ...board.state, board: nextBoard }, color);
}

function createInitialBughouseBoard(id: string, board: BughouseBoardId): BughouseBoardState {
  const state = standardChessVariant.createInitialState(id);
  return {
    board,
    state: {
      ...state,
      status: { type: 'playing', turn: 'white' },
      positionCounts: {},
    },
    promoted: [],
    lastAction: null,
  };
}

function createBughouseBoardClock(initialMs: number): BughouseBoardClockState {
  return {
    activeSeat: null,
    remainingMs: { white: initialMs, black: initialMs },
    runningSince: null,
  };
}

function legalBughouseDrops(
  board: BughouseBoardState,
  color: Color,
  reserve: Partial<Record<BughouseDropRole, number>>,
): BughouseDrop[] {
  const drops: BughouseDrop[] = [];
  for (const role of DROP_ROLES) {
    if ((reserve[role] ?? 0) <= 0) continue;
    for (const to of ALL_SQUARES) {
      const drop = { role, to };
      if (isLegalBughouseDrop(board, color, reserve, drop)) drops.push(drop);
    }
  }
  return drops;
}

function placeDrop(state: GameState, color: Color, drop: BughouseDrop): GameState {
  const nextTurn = oppositeColor(color);
  return {
    ...state,
    board: {
      ...state.board,
      [drop.to]: { color, role: drop.role },
    },
    status: { type: 'playing', turn: nextTurn },
    moveNumber: state.moveNumber + (color === 'black' ? 1 : 0),
    enPassantSquare: undefined,
    halfmoveClock: state.halfmoveClock + 1,
    lastMove: undefined,
  };
}

function applyBoardTerminal(
  match: BughouseMatchState,
  boardId: BughouseBoardId,
  mover: Color,
): BughouseMatchState {
  const board = match.boards[boardId];
  if (board.state.status.type !== 'playing') return match;
  const defender = board.state.status.turn;
  const defenderSeat = seatFor(boardId, defender);
  const hasBoardMove = standardChessVariant.getLegalMoves(board.state, defender).length > 0;
  const hasDrop = legalBughouseDrops(board, defender, match.reserves[defenderSeat]).length > 0;
  if (hasBoardMove || hasDrop) return match;

  const reason: BughouseTerminalReason = isInCheck(board.state, defender) ? 'checkmate' : 'draw';
  return {
    ...match,
    status: {
      type: 'finished',
      board: boardId,
      winnerTeam:
        reason === 'checkmate' ? BUGHOUSE_SEAT_ASSIGNMENTS[seatFor(boardId, mover)].team : null,
      reason,
    },
    boards: {
      ...match.boards,
      [boardId]: {
        ...board,
        state: {
          ...board.state,
          status:
            reason === 'checkmate'
              ? { type: 'finished', winner: mover, reason: 'checkmate' }
              : { type: 'finished', winner: null, reason: 'draw' },
        },
      },
    },
  };
}

function withBoardAndReserves(
  match: BughouseMatchState,
  board: BughouseBoardState,
  reserves: BughouseReserves,
  action: BughouseBoardAction,
): BughouseMatchState {
  return {
    ...match,
    boards: {
      ...match.boards,
      [board.board]: board,
    },
    reserves,
    lastAction: action,
  };
}

function withAdvancedClock(
  previous: BughouseMatchState,
  next: BughouseMatchState,
  seat: BughouseSeatId,
  at: number | undefined,
): BughouseMatchState {
  if (at === undefined || !previous.clock) return next;
  return { ...next, clock: nextBughouseClockForAction(previous.clock, at, seat, next) };
}

function boardViewFor(match: BughouseMatchState, boardId: BughouseBoardId): BughouseBoardView {
  const board = match.boards[boardId];
  return {
    board: boardId,
    sideToMove: board.state.status.type === 'playing' ? board.state.status.turn : 'white',
    ply: boardPly(board.state),
    fullmoveNumber: board.state.moveNumber,
    halfmoveClock: board.state.halfmoveClock,
    pieces: (Object.entries(board.state.board) as Array<[Square, NonNullable<Board[Square]>]>)
      .filter(([, piece]) => !!piece)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([square, piece]) => [square, piece]),
    castlingRights: castlingRightsByColor(board.state),
    enPassantSquare: board.state.enPassantSquare ?? null,
    lastAction: board.lastAction,
    status: boardStatusFor(board.state),
  };
}

function clockViewFor(
  clock: BughouseClockState | undefined,
  serverNowEpochMs: number,
): BughouseClockView {
  if (!clock) return noClockView(serverNowEpochMs);
  return {
    serverNowEpochMs,
    boards: {
      A: clockBoardViewFor(clock, 'A'),
      B: clockBoardViewFor(clock, 'B'),
    },
  };
}

function clockBoardViewFor(
  clock: BughouseClockState,
  boardId: BughouseBoardId,
): BughouseClockView['boards']['A'] {
  const boardClock = clock.boards[boardId];
  return {
    activeSeat: boardClock.activeSeat,
    remainingMs: boardClock.remainingMs,
    incrementMs: clock.incrementMs,
    runningSinceEpochMs: boardClock.runningSince,
  };
}

function noClockView(serverNowEpochMs: number): BughouseClockView {
  return {
    serverNowEpochMs,
    boards: {
      A: noClockBoard(),
      B: noClockBoard(),
    },
  };
}

function noClockBoard(): BughouseClockView['boards']['A'] {
  return {
    activeSeat: null,
    remainingMs: { white: null, black: null },
    incrementMs: 0,
    runningSinceEpochMs: null,
  };
}

function castlingRightsByColor(state: GameState): { white: Square[]; black: Square[] } {
  const rights = { white: [] as Square[], black: [] as Square[] };
  for (const square of state.castlingRights) {
    const piece = state.board[square];
    if (piece?.role === 'rook') rights[piece.color].push(square);
  }
  return rights;
}

function boardStatusFor(state: GameState): BughouseBoardStatus {
  if (state.status.type === 'playing') return { type: 'playing' };
  if (state.status.type === 'aborted') {
    return { type: 'finished', winner: null, reason: 'abandonment' };
  }
  return {
    type: 'finished',
    winner: state.status.winner,
    reason: bughouseTerminalReasonFor(state.status.reason),
  };
}

function bughouseTerminalReasonFor(
  reason: GameState['status'] extends infer Status
    ? Status extends { type: 'finished'; reason: infer Reason }
      ? Reason
      : never
    : never,
): BughouseTerminalReason {
  if (
    reason === 'checkmate' ||
    reason === 'draw' ||
    reason === 'timeout' ||
    reason === 'resignation' ||
    reason === 'abandonment'
  ) {
    return reason;
  }
  return 'checkmate';
}

function matchPly(match: BughouseMatchState): number {
  return boardPly(match.boards.A.state) + boardPly(match.boards.B.state);
}

function boardPly(state: GameState): number {
  if (state.status.type === 'playing') {
    return (state.moveNumber - 1) * 2 + (state.status.turn === 'black' ? 1 : 0);
  }
  return Math.max(0, (state.moveNumber - 1) * 2);
}

function capturedPieceForBughouse(
  board: BughouseBoardState,
  move: Move,
  color: Color,
): { square: Square; reserveRole: BughouseDropRole } | null {
  const target = board.state.board[move.to];
  if (target && target.color !== color) {
    return {
      square: move.to,
      reserveRole: reserveRoleForCapturedPiece(board, move.to, target.role),
    };
  }
  const moving = board.state.board[move.from];
  if (
    moving?.role === 'pawn' &&
    move.to === board.state.enPassantSquare &&
    move.from[0] !== move.to[0]
  ) {
    const square = enPassantCaptureSquare(move.to, color);
    return { square, reserveRole: 'pawn' };
  }
  return null;
}

function reserveRoleForCapturedPiece(
  board: BughouseBoardState,
  square: Square,
  role: PieceRole,
): BughouseDropRole {
  if (role === 'king') throw new Error('king captures are not legal in checkmate chess');
  return board.promoted.includes(square) ? 'pawn' : role;
}

function nextPromotedSquaresForMove(
  board: BughouseBoardState,
  move: Move,
  movingPiece: NonNullable<Board[Square]>,
  capturedSquare: Square | undefined,
): Square[] {
  const promoted = new Set(board.promoted);
  const movingWasPromoted = promoted.delete(move.from);
  if (capturedSquare) promoted.delete(capturedSquare);
  promoted.delete(move.to);
  if (move.promotion && movingPiece.role === 'pawn') promoted.add(move.to);
  else if (movingWasPromoted) promoted.add(move.to);
  return [...promoted].sort();
}

function moveAction(board: BughouseBoardId, seat: BughouseSeatId, move: Move): BughouseBoardAction {
  return {
    id: `${seat}:move:${move.from}-${move.to}${move.promotion ? `=${move.promotion}` : ''}`,
    kind: 'move',
    board,
    seat,
    move,
  };
}

function dropAction(
  board: BughouseBoardId,
  seat: BughouseSeatId,
  drop: BughouseDrop,
): BughouseBoardAction {
  return {
    id: `${seat}:drop:${drop.role}-${drop.to}`,
    kind: 'drop',
    board,
    seat,
    drop,
  };
}

function addReserve(
  reserves: BughouseReserves,
  seat: BughouseSeatId,
  role: BughouseDropRole,
): BughouseReserves {
  const current = reserves[seat] ?? {};
  return {
    ...reserves,
    [seat]: {
      ...current,
      [role]: (current[role] ?? 0) + 1,
    },
  };
}

function removeReserve(
  reserves: BughouseReserves,
  seat: BughouseSeatId,
  role: BughouseDropRole,
): BughouseReserves {
  const current = reserves[seat] ?? {};
  return {
    ...reserves,
    [seat]: {
      ...current,
      [role]: Math.max(0, (current[role] ?? 0) - 1),
    },
  };
}

function seatFor(board: BughouseBoardId, color: Color): BughouseSeatId {
  return `${board}:${color}` as BughouseSeatId;
}

function activeSeatForBoard(
  match: BughouseMatchState,
  boardId: BughouseBoardId,
): BughouseSeatId | null {
  if (match.status.type !== 'playing') return null;
  const board = match.boards[boardId];
  if (board.state.status.type !== 'playing') return null;
  return seatFor(boardId, board.state.status.turn);
}

function isInCheck(state: GameState, color: Color): boolean {
  return positionFromState({ ...state, status: { type: 'playing', turn: color } }).isCheck();
}

function isBackRank(square: Square): boolean {
  return square[1] === '1' || square[1] === '8';
}

function enPassantCaptureSquare(to: Square, color: Color): Square {
  const rank = Number(to[1]) + (color === 'white' ? -1 : 1);
  return `${to[0]}${rank}` as Square;
}

function oppositeColor(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}
