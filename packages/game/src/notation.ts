import { makeSan } from 'chessops/san';
import {
  applyGameEvent,
  type GameEvent,
  type GameProjection,
  initialGameProjection,
} from './events.js';
import type { Board, GameState, Move, PieceRole, Square } from './types.js';
import { positionFromState, standardChessLegalChessopsMove } from './variants.js';

type PromotionRole = Exclude<PieceRole, 'king' | 'pawn'>;

const pieceLetters: Record<Exclude<PieceRole, 'pawn'>, string> = {
  bishop: 'B',
  king: 'K',
  knight: 'N',
  queen: 'Q',
  rook: 'R',
};

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/** Standard algebraic notation with the check and mate suffixes (chessops'
 *  makeSan), for open chess. moveToAlgebraic below is the suffix-free spelling
 *  the fog surfaces use, where "check" is not a concept. Falls back to it when
 *  chessops does not accept the move. */
export function standardChessSan(state: GameState, move: Move): string {
  const chessopsMove = standardChessLegalChessopsMove(state, move);
  if (chessopsMove == null) return moveToAlgebraic(state, move);
  return makeSan(positionFromState(state), chessopsMove);
}

export function moveToAlgebraic(state: GameState, move: Move): string {
  const piece = state.board[move.from];
  if (!piece) return coordinateMoveLabel(move);

  const castlingSide = castlingMoveSide(state, move);
  if (castlingSide) return castlingSide === 'king' ? 'O-O' : 'O-O-O';

  const capture = isCapture(state, move);
  const promotion = move.promotion ? `=${promotionLetter(move.promotion)}` : '';

  if (piece.role === 'pawn') {
    return `${capture ? `${fileOf(move.from)}x` : ''}${move.to}${promotion}`;
  }

  return [
    pieceLetters[piece.role],
    disambiguation(state, move),
    capture ? 'x' : '',
    move.to,
    promotion,
  ].join('');
}

export function algebraicMoveLabels(
  events: GameEvent[],
  roomId = events[0]?.roomId ?? 'replay',
): Map<number, string> {
  const labels = new Map<number, string>();
  let projection = initialGameProjection(roomId);

  for (const [index, event] of events.entries()) {
    if (event.type !== 'move-played') {
      projection = applyGameEvent(projection, event);
      continue;
    }

    const labelProjection = projectionForVisibleMove(projection, event);
    labels.set(index + 1, moveToAlgebraic(labelProjection.state, event.move));
    projection = applyVisibleMoveEvent(labelProjection, event);
  }

  return labels;
}

export function coordinateMoveLabel(move: Move): string {
  return `${move.from}${move.to}${move.promotion ? `=${promotionLetter(move.promotion)}` : ''}`;
}

function projectionForVisibleMove(
  projection: GameProjection,
  event: Extract<GameEvent, { type: 'move-played' }>,
): GameProjection {
  if (projection.state.status.type !== 'playing') return projection;
  if (projection.state.status.turn === event.color) return projection;
  return {
    ...projection,
    state: {
      ...projection.state,
      status: { type: 'playing', turn: event.color },
    },
  };
}

function applyVisibleMoveEvent(
  projection: GameProjection,
  event: Extract<GameEvent, { type: 'move-played' }>,
): GameProjection {
  const applied = applyGameEvent(projection, event);
  if (applied !== projection) return applied;
  if (projection.state.status.type !== 'playing') return projection;

  const piece = projection.state.board[event.move.from];
  if (!piece || piece.color !== event.color) return projection;

  const board = { ...projection.state.board };
  delete board[event.move.from];
  board[event.move.to] = {
    color: piece.color,
    role: event.move.promotion ?? piece.role,
  };

  return {
    ...projection,
    state: {
      ...projection.state,
      board,
      clock: event.clock ?? projection.state.clock,
      lastMove: event.move,
      moveNumber: projection.state.moveNumber + (event.color === 'black' ? 1 : 0),
      status: { type: 'playing', turn: event.color === 'white' ? 'black' : 'white' },
    },
  };
}

export function promotionLetter(role: PromotionRole): string {
  return pieceLetters[role];
}

function castlingMoveSide(state: GameState, move: Move): 'king' | 'queen' | null {
  const piece = state.board[move.from];
  if (piece?.role !== 'king' || rankOf(move.from) !== rankOf(move.to)) return null;

  const target = state.board[move.to];
  if (
    target?.color === piece.color &&
    target.role === 'rook' &&
    state.castlingRights.includes(move.to)
  ) {
    return fileIndex(move.to) > fileIndex(move.from) ? 'king' : 'queen';
  }

  const kingSide = fileOf(move.to) === 'g';
  const queenSide = fileOf(move.to) === 'c';
  if (!kingSide && !queenSide) return null;

  const fromFile = fileIndex(move.from);
  const rookSquare = state.castlingRights.find((square) => {
    const rook = state.board[square];
    if (!rook || rook.color !== piece.color || rook.role !== 'rook') return false;
    if (rankOf(square) !== rankOf(move.from)) return false;
    return kingSide ? fileIndex(square) > fromFile : fileIndex(square) < fromFile;
  });
  if (!rookSquare) return null;
  return kingSide ? 'king' : 'queen';
}

function disambiguation(state: GameState, move: Move): string {
  const piece = state.board[move.from];
  if (!piece || piece.role === 'pawn') return '';

  const alternatives = Object.entries(state.board)
    .filter(
      ([from, candidate]) =>
        from !== move.from &&
        candidate?.color === piece.color &&
        candidate.role === piece.role &&
        canPieceReach(state.board, from as Square, move.to),
    )
    .map(([from]) => from as Square);

  if (alternatives.length === 0) return '';

  const sharesRank = alternatives.some((from) => rankOf(from) === rankOf(move.from));
  const sharesFile = alternatives.some((from) => fileOf(from) === fileOf(move.from));
  return `${sharesRank ? fileOf(move.from) : ''}${sharesFile ? rankOf(move.from) : ''}`;
}

function canPieceReach(board: Board, from: Square, to: Square): boolean {
  const piece = board[from];
  const target = board[to];
  if (!piece || target?.color === piece.color) return false;

  const fileDelta = fileIndex(to) - fileIndex(from);
  const rankDelta = rankOf(to) - rankOf(from);
  const absFile = Math.abs(fileDelta);
  const absRank = Math.abs(rankDelta);

  if (piece.role === 'knight')
    return (absFile === 1 && absRank === 2) || (absFile === 2 && absRank === 1);
  if (piece.role === 'king') return Math.max(absFile, absRank) === 1;
  if (piece.role === 'bishop') return absFile === absRank && isClearPath(board, from, to);
  if (piece.role === 'rook')
    return (fileDelta === 0 || rankDelta === 0) && isClearPath(board, from, to);
  if (piece.role === 'queen')
    return (
      (fileDelta === 0 || rankDelta === 0 || absFile === absRank) && isClearPath(board, from, to)
    );
  if (piece.role === 'pawn') {
    const direction = piece.color === 'white' ? 1 : -1;
    return rankDelta === direction && absFile === 1;
  }
  return false;
}

function isClearPath(board: Board, from: Square, to: Square): boolean {
  const fileStep = Math.sign(fileIndex(to) - fileIndex(from));
  const rankStep = Math.sign(rankOf(to) - rankOf(from));
  let file = fileIndex(from) + fileStep;
  let rank = rankOf(from) + rankStep;

  while (file !== fileIndex(to) || rank !== rankOf(to)) {
    if (board[`${files[file]}${rank}` as Square]) return false;
    file += fileStep;
    rank += rankStep;
  }
  return true;
}

function isCapture(state: GameState, move: Move): boolean {
  const piece = state.board[move.from];
  if (!piece) return false;
  const target = state.board[move.to];
  if (target && target.color !== piece.color) return true;
  if (piece.role !== 'pawn' || fileOf(move.from) === fileOf(move.to)) return false;
  if (target?.color === piece.color) return false;
  return state.variant === 'dark-chess' || move.to === state.enPassantSquare;
}

function fileOf(square: Square): string {
  return square[0];
}

function fileIndex(square: Square): number {
  return files.indexOf(square[0] as (typeof files)[number]);
}

function rankOf(square: Square): number {
  return Number(square[1]);
}
