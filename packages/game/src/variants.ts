import { Board as ChessopsBoard } from 'chessops/board';
import { Chess, IllegalSetup } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import type { Setup } from 'chessops/setup';
import { SquareSet } from 'chessops/squareSet';
import type { Move as ChessopsMove, Square as ChessopsSquare, Role } from 'chessops/types';
import { makeSquare, parseSquare, squareRank } from 'chessops/util';
import type {
  Board,
  Color,
  GameState,
  Move,
  PieceRole,
  PlayerView,
  Square,
  Variant,
} from './types.js';

// Navigation index — grep for section name to jump to the right block
// SECTION: Standard chess variant   standardChessVariant
// SECTION: Fog of War variant        darkChessVariant
// SECTION: Fog visibility kernel     fogVisibleSquares, applyFogMove
// SECTION: Fog move generation       fogMovesFrom, getFogMovesForPlayer
// SECTION: Fog pawn moves            fogPawnMoves
// SECTION: Fog sliding/stepping      fogStepMoves, fogSlideMoves
// SECTION: Fog castling              fogCastlingMoves
// SECTION: Standard chess helpers    positionFromState, boardToChessops, boardFromChessops
// SECTION: Fog chess FEN             darkChessFen, parseDarkChessFen
// SECTION: Variant registry          variantForId

const initialBoard: Board = {
  a1: { color: 'white', role: 'rook' },
  b1: { color: 'white', role: 'knight' },
  c1: { color: 'white', role: 'bishop' },
  d1: { color: 'white', role: 'queen' },
  e1: { color: 'white', role: 'king' },
  f1: { color: 'white', role: 'bishop' },
  g1: { color: 'white', role: 'knight' },
  h1: { color: 'white', role: 'rook' },
  a2: { color: 'white', role: 'pawn' },
  b2: { color: 'white', role: 'pawn' },
  c2: { color: 'white', role: 'pawn' },
  d2: { color: 'white', role: 'pawn' },
  e2: { color: 'white', role: 'pawn' },
  f2: { color: 'white', role: 'pawn' },
  g2: { color: 'white', role: 'pawn' },
  h2: { color: 'white', role: 'pawn' },
  a7: { color: 'black', role: 'pawn' },
  b7: { color: 'black', role: 'pawn' },
  c7: { color: 'black', role: 'pawn' },
  d7: { color: 'black', role: 'pawn' },
  e7: { color: 'black', role: 'pawn' },
  f7: { color: 'black', role: 'pawn' },
  g7: { color: 'black', role: 'pawn' },
  h7: { color: 'black', role: 'pawn' },
  a8: { color: 'black', role: 'rook' },
  b8: { color: 'black', role: 'knight' },
  c8: { color: 'black', role: 'bishop' },
  d8: { color: 'black', role: 'queen' },
  e8: { color: 'black', role: 'king' },
  f8: { color: 'black', role: 'bishop' },
  g8: { color: 'black', role: 'knight' },
  h8: { color: 'black', role: 'rook' },
};

const standardCastlingRights: Square[] = ['a1', 'h1', 'a8', 'h8'];
const promotionRoles = ['queen', 'rook', 'bishop', 'knight'] satisfies PieceRole[];
const boardFiles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const boardRanks = [1, 2, 3, 4, 5, 6, 7, 8] as const;

// ── SECTION: Standard chess variant ──────────────────────────────────────
// Open-information orthodox chess. Not a spec of its own: the fog variant
// below derives from it, bughouse rides it, and the event tests use it as the
// plain kernel.
export const standardChessVariant: Variant = {
  id: 'chess',
  createInitialState(gameId: string): GameState {
    return {
      id: gameId,
      variant: 'chess',
      board: initialBoard,
      status: { type: 'playing', turn: 'white' },
      moveNumber: 1,
      castlingRights: standardCastlingRights,
      halfmoveClock: 0,
    };
  },
  getLegalMoves(state: GameState, player: Color): Move[] {
    return getLegalMoves(state, player);
  },
  applyMove(state: GameState, move: Move): GameState {
    if (state.status.type !== 'playing') return state;

    const position = positionFromState(state);
    const legalMove = normalizeCastlingMove(state, move) ?? move;
    const chessopsMove = toChessopsMove(legalMove);
    if (!chessopsMove || !position.isLegal(chessopsMove)) return state;

    position.play(chessopsMove);
    const setup = position.toSetup();
    const outcome = position.outcome();

    return {
      ...state,
      board: boardFromChessops(setup.board),
      status: outcome
        ? {
            type: 'finished',
            winner: outcome.winner ?? null,
            reason: outcome.winner ? 'checkmate' : 'draw',
          }
        : { type: 'playing', turn: setup.turn },
      moveNumber: setup.fullmoves,
      castlingRights: [...setup.castlingRights].map((square) => makeSquare(square) as Square),
      enPassantSquare:
        setup.epSquare === undefined ? undefined : (makeSquare(setup.epSquare) as Square),
      halfmoveClock: setup.halfmoves,
      lastMove: move,
    };
  },
  getPlayerView(state: GameState, player: Color): PlayerView {
    return {
      id: state.id,
      variant: state.variant,
      board: state.board,
      visibleSquares: Object.keys(state.board) as PlayerView['visibleSquares'],
      legalMoves: state.status.type === 'playing' ? getMovesForPlayer(state, player) : [],
      status: state.status,
      perspective: player,
      moveNumber: state.moveNumber,
      lastMove: state.lastMove,
      clock: state.clock,
    };
  },
  isGameOver() {
    return null;
  },
};

// ── SECTION: Fog of War variant ────────────────────────────────────────────
export const darkChessVariant: Variant = {
  ...standardChessVariant,
  id: 'dark-chess',
  createInitialState(gameId: string): GameState {
    const state: GameState = {
      ...standardChessVariant.createInitialState(gameId),
      variant: 'dark-chess',
      status: { type: 'playing', turn: 'white' },
    };
    return {
      ...state,
      positionCounts: { [positionRepetitionKey(state)]: 1 },
    };
  },
  getLegalMoves(state: GameState, player: Color): Move[] {
    if (state.status.type !== 'playing' || state.status.turn !== player) return [];
    return getFogMovesForPlayer(state, player);
  },
  applyMove(state: GameState, move: Move): GameState {
    return applyFogMove(state, move);
  },
  getPlayerView(state: GameState, player: Color): PlayerView {
    const ownSquares = ownPieceSquares(state.board, player);
    const visibleSquares = fogVisibleSquares(state, player);
    const board = boardVisibleTo(state.board, visibleSquares);
    const lastMove = visibleLastMoveForPlayer(state, player, ownSquares);

    return {
      id: state.id,
      variant: state.variant,
      board,
      visibleSquares,
      legalMoves: state.status.type === 'playing' ? getFogMovesForPlayer(state, player) : [],
      status: state.status,
      perspective: player,
      moveNumber: state.moveNumber,
      lastMove,
      clock: state.clock,
    };
  },
};

// ── SECTION: Fog visibility kernel ─────────────────────────────────────────
function fogVisibleSquares(state: GameState, player: Color): Square[] {
  const visible = new Set<Square>(ownPieceSquares(state.board, player));
  for (const move of getVisibilityMoves(state, player)) {
    visible.add(move.to);
    if (isEnPassantMove(state, move, player)) {
      visible.add(enPassantCaptureSquare(move.to, player));
    }
  }
  return [...visible].sort();
}

function ownPieceSquares(board: Board, player: Color): Square[] {
  return Object.entries(board)
    .filter(([, piece]) => piece?.color === player)
    .map(([square]) => square as Square);
}

function boardVisibleTo(board: Board, visibleSquares: Square[]): Board {
  const visible = new Set(visibleSquares);
  const playerBoard: Board = {};
  for (const [square, piece] of Object.entries(board)) {
    if (piece && visible.has(square as Square)) playerBoard[square as Square] = piece;
  }
  return playerBoard;
}

function visibleLastMoveForPlayer(
  state: GameState,
  player: Color,
  ownSquares: Square[],
): Move | undefined {
  const lastMove = state.lastMove;
  if (!lastMove) return undefined;
  if (state.status.type === 'playing') return state.status.turn === player ? undefined : lastMove;
  if (ownSquares.includes(lastMove.from)) return lastMove;
  return state.board[lastMove.to]?.color === player ? lastMove : undefined;
}

function applyFogMove(state: GameState, move: Move): GameState {
  if (state.status.type !== 'playing') return state;

  const player = state.status.turn;
  const requestedMove = normalizeCastlingMove(state, move) ?? move;
  const legalMove = getFogMovesForPlayer(state, player).find((candidate) =>
    movesMatch(candidate, requestedMove),
  );
  if (!legalMove) return state;

  const piece = state.board[legalMove.from];
  if (!piece || piece.color !== player) return state;

  const board = { ...state.board };
  const targetPiece = board[legalMove.to];
  const enPassantCapture =
    piece.role === 'pawn' &&
    legalMove.to === state.enPassantSquare &&
    targetPiece === undefined &&
    fileOf(legalMove.from) !== fileOf(legalMove.to);
  const castlingMove = isFogCastlingMove(state, legalMove);
  const capturedPiece = castlingMove ? undefined : targetPiece;

  delete board[legalMove.from];
  if (enPassantCapture) delete board[enPassantCaptureSquare(legalMove.to, player)];

  if (castlingMove) {
    applyFogCastling(board, legalMove, piece);
  } else {
    board[legalMove.to] = {
      color: piece.color,
      role: legalMove.promotion ?? piece.role,
    };
  }

  const nextMoveNumber = state.moveNumber + (player === 'black' ? 1 : 0);
  const updatedCastlingRights = nextCastlingRights(state, legalMove, piece.role);
  const updatedEnPassantSquare = nextEnPassantSquare(legalMove, piece.role, player);
  const nextHalfmoveClock =
    piece.role === 'pawn' || capturedPiece || enPassantCapture ? 0 : state.halfmoveClock + 1;
  const playingStatus = { type: 'playing', turn: oppositeColor(player) } as const;
  const nextPositionState: GameState = {
    ...state,
    board,
    status: playingStatus,
    moveNumber: nextMoveNumber,
    castlingRights: updatedCastlingRights,
    enPassantSquare: updatedEnPassantSquare,
    halfmoveClock: nextHalfmoveClock,
    lastMove: legalMove,
  };
  const positionCounts = nextPositionCounts(state, nextPositionState);
  const nextStatus =
    capturedPiece?.role === 'king'
      ? ({ type: 'finished', winner: player, reason: 'king-captured' } as const)
      : nextHalfmoveClock >= 100 || positionCounts[positionRepetitionKey(nextPositionState)]! >= 3
        ? ({ type: 'finished', winner: null, reason: 'draw' } as const)
        : playingStatus;

  return {
    ...state,
    board,
    status: nextStatus,
    moveNumber: nextMoveNumber,
    castlingRights: updatedCastlingRights,
    enPassantSquare: updatedEnPassantSquare,
    halfmoveClock: nextHalfmoveClock,
    lastMove: legalMove,
    positionCounts,
  };
}

function nextPositionCounts(
  previousState: GameState,
  nextState: GameState,
): Record<string, number> {
  const currentKey = positionRepetitionKey(previousState);
  const counts = { ...(previousState.positionCounts ?? { [currentKey]: 1 }) };
  counts[currentKey] ??= 1;
  const nextKey = positionRepetitionKey(nextState);
  counts[nextKey] = (counts[nextKey] ?? 0) + 1;
  return counts;
}

function positionRepetitionKey(state: GameState): string {
  const turn = state.status.type === 'playing' ? state.status.turn : '-';
  const board = Object.entries(state.board)
    .filter(([, piece]) => piece)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([square, piece]) => `${square}:${piece!.color[0]}${piece!.role[0]}`)
    .join(',');
  const castling = [...state.castlingRights].sort().join(',');
  return [
    `turn=${turn}`,
    `board=${board}`,
    `castling=${castling}`,
    `ep=${state.enPassantSquare ?? '-'}`,
  ].join('|');
}

function getFogMovesForPlayer(state: GameState, player: Color): Move[] {
  const moves: Move[] = [];
  for (const square of ownPieceSquares(state.board, player)) {
    moves.push(...fogMovesFrom(state, square));
  }
  return moves;
}

// ── SECTION: Fog move generation ───────────────────────────────────────────
function fogMovesFrom(state: GameState, from: Square): Move[] {
  const piece = state.board[from];
  if (!piece) return [];

  if (piece.role === 'pawn') return fogPawnMoves(state, from, piece.color);
  if (piece.role === 'knight') return fogStepMoves(state, from, knightSteps);
  if (piece.role === 'bishop') return fogSlideMoves(state, from, bishopDirections);
  if (piece.role === 'rook') return fogSlideMoves(state, from, rookDirections);
  if (piece.role === 'queen')
    return fogSlideMoves(state, from, [...rookDirections, ...bishopDirections]);
  return [...fogStepMoves(state, from, kingSteps), ...fogCastlingMoves(state, from)];
}

// ── SECTION: Fog pawn moves ─────────────────────────────────────────────────
function fogPawnMoves(state: GameState, from: Square, color: Color): Move[] {
  const moves: Move[] = [];
  const direction = color === 'white' ? 1 : -1;
  const startRank = color === 'white' ? 2 : 7;
  const epCaptureFromRank = color === 'white' ? 5 : 4;
  const oneStep = offsetSquare(from, 0, direction);
  if (oneStep && !state.board[oneStep]) {
    addMaybePromotion(moves, from, oneStep);

    const twoStep = offsetSquare(from, 0, direction * 2);
    if (rankOf(from) === startRank && twoStep && !state.board[twoStep]) {
      moves.push({ from, to: twoStep });
    }
  }

  for (const fileOffset of [-1, 1]) {
    const to = offsetSquare(from, fileOffset, direction);
    if (!to) continue;
    const target = state.board[to];
    const isEnPassantCapture = to === state.enPassantSquare && rankOf(from) === epCaptureFromRank;
    if ((target && target.color !== color) || isEnPassantCapture) {
      addMaybePromotion(moves, from, to);
    }
  }

  return moves;
}

// ── SECTION: Fog sliding and stepping moves ─────────────────────────────────
function fogStepMoves(state: GameState, from: Square, steps: readonly Direction[]): Move[] {
  return steps.flatMap(([fileOffset, rankOffset]) => {
    const to = offsetSquare(from, fileOffset, rankOffset);
    return to && canOccupy(state, from, to) ? [{ from, to }] : [];
  });
}

function fogSlideMoves(state: GameState, from: Square, directions: readonly Direction[]): Move[] {
  const moves: Move[] = [];
  for (const [fileOffset, rankOffset] of directions) {
    let to = offsetSquare(from, fileOffset, rankOffset);
    while (to) {
      if (!canOccupy(state, from, to)) break;
      moves.push({ from, to });
      if (state.board[to]) break;
      to = offsetSquare(to, fileOffset, rankOffset);
    }
  }
  return moves;
}

// ── SECTION: Fog castling ───────────────────────────────────────────────────
function fogCastlingMoves(state: GameState, from: Square): Move[] {
  const piece = state.board[from];
  if (piece?.role !== 'king') return [];

  const moves: Move[] = [];
  for (const rookSquare of state.castlingRights) {
    const rook = state.board[rookSquare];
    if (!rook || rook.color !== piece.color || rook.role !== 'rook') continue;
    if (rankOf(rookSquare) !== rankOf(from)) continue;
    if (!clearForFogCastling(state.board, from, rookSquare)) continue;
    moves.push({ from, to: rookSquare });
  }
  return moves;
}

// ── SECTION: Standard chess helpers ────────────────────────────────────────
function getLegalMoves(state: GameState, player: Color): Move[] {
  if (state.status.type !== 'playing' || state.status.turn !== player) return [];
  return getMovesForPlayer(state, player);
}

function getVisibilityMoves(state: GameState, player: Color): Move[] {
  // Fog visibility is a pure function of piece placement, so it must stay
  // defined for finished states too — otherwise the captured side's view
  // collapses to its own piece squares the instant the game ends, and any
  // post-finish render (replay, articles, postgame fog) "loses" all vision.
  if (state.variant === 'dark-chess') return getFogMovesForPlayer(state, player);
  if (state.status.type !== 'playing') return [];
  return getMovesForPlayer(state, player);
}

function getMovesForPlayer(state: GameState, player: Color): Move[] {
  const position = positionFromState(state, player);
  const moves: Move[] = [];
  const context = position.ctx();

  for (const [from, destinations] of position.allDests(context)) {
    for (const to of destinations) {
      const piece = position.board.get(from);
      if (piece?.role === 'pawn' && isPromotionDestination(to)) {
        for (const promotion of promotionRoles) {
          moves.push(toMove(from, to, promotion));
        }
      } else {
        moves.push(toMove(from, to));
      }
    }
  }

  return withCastlingAliases(state, moves);
}

export function positionFromState(state: GameState, turnOverride?: Color): Chess {
  return Chess.fromSetup(setupFromState(state, turnOverride)).unwrap();
}

// Standard-chess legality (respects check), shared by bughouse to resolve a
// player's pseudo-legal try against the canonical truth. Mirrors the gate
// inside standardChessVariant.applyMove so the two never diverge.
export function isLegalStandardChessMove(state: GameState, move: Move): boolean {
  if (state.status.type !== 'playing') return false;
  const position = positionFromState(state);
  const legalMove = normalizeCastlingMove(state, move) ?? move;
  const chessopsMove = toChessopsMove(legalMove);
  return chessopsMove != null && position.isLegal(chessopsMove);
}

function setupFromState(state: GameState, turnOverride?: Color): Setup {
  let castlingRights = SquareSet.empty();
  for (const square of state.castlingRights) {
    castlingRights = castlingRights.with(parseSquare(square));
  }

  return {
    board: boardToChessops(state.board),
    pockets: undefined,
    turn: turnOverride ?? (state.status.type === 'playing' ? state.status.turn : 'white'),
    castlingRights,
    epSquare: state.enPassantSquare ? parseSquare(state.enPassantSquare) : undefined,
    remainingChecks: undefined,
    halfmoves: state.halfmoveClock,
    fullmoves: state.moveNumber,
  };
}

function boardToChessops(board: Board): ChessopsBoard {
  const chessopsBoard = ChessopsBoard.empty();
  for (const [square, piece] of Object.entries(board)) {
    if (!piece) continue;
    const chessopsSquare = parseSquare(square);
    if (chessopsSquare === undefined) continue;
    chessopsBoard.set(chessopsSquare, {
      color: piece.color,
      role: piece.role,
    });
  }
  return chessopsBoard;
}

function boardFromChessops(board: ChessopsBoard): Board {
  const nextBoard: Board = {};
  for (const [square, piece] of board) {
    nextBoard[makeSquare(square) as Square] = {
      color: piece.color,
      role: piece.role,
    };
  }
  return nextBoard;
}

// ── SECTION: Fog chess FEN ──────────────────────────────────────────────────
// Standard chess FEN in and out of the fog state, so a hand-set position can seed
// a study chapter or an analysis board. The dialect is ordinary chess FEN: fog
// changes what each player SEES, never the position itself, so there is nothing
// extra to encode.

export function darkChessFen(state: GameState): string {
  return makeFen(setupFromState(state));
}

export type ParseDarkChessFenResult = { ok: true; state: GameState } | { ok: false; error: string };

// Legality is chessops' with ONE rule dropped: a position where the side NOT to
// move stands in check is legal under fog. Neither player sees the whole board,
// so walking into check (and being taken) is ordinary play here rather than the
// contradiction it is in standard chess.
const FOG_TOLERATED_SETUP_ERRORS: ReadonlySet<string> = new Set([IllegalSetup.OppositeCheck]);

const SETUP_ERROR_MESSAGES: Record<string, string> = {
  [IllegalSetup.Empty]: 'The board is empty.',
  [IllegalSetup.Kings]: 'A fog chess position needs exactly one king per side.',
  [IllegalSetup.PawnsOnBackrank]: 'A pawn is on a back rank, which no move can produce.',
  [IllegalSetup.Variant]: 'That position is not reachable in chess.',
};

export function parseDarkChessFen(fen: string, gameId = 'fen-import'): ParseDarkChessFenResult {
  return parseFen(fen.trim()).unwrap<ParseDarkChessFenResult>(
    (setup) => {
      const invalid = Chess.fromSetup(setup).unwrap<string | null>(
        () => null,
        (error) => error.message,
      );
      if (invalid && !FOG_TOLERATED_SETUP_ERRORS.has(invalid)) {
        return {
          ok: false,
          error: SETUP_ERROR_MESSAGES[invalid] ?? `Illegal position (${invalid}).`,
        };
      }
      const state: GameState = {
        id: gameId,
        variant: 'dark-chess',
        board: boardFromChessops(setup.board),
        status: { type: 'playing', turn: setup.turn },
        moveNumber: setup.fullmoves,
        castlingRights: [...setup.castlingRights].map((square) => makeSquare(square) as Square),
        enPassantSquare:
          setup.epSquare === undefined ? undefined : (makeSquare(setup.epSquare) as Square),
        halfmoveClock: setup.halfmoves,
        positionCounts: {},
      };
      return {
        ok: true,
        state: { ...state, positionCounts: { [positionRepetitionKey(state)]: 1 } },
      };
    },
    (error) => ({ ok: false, error: `Could not read that FEN (${error.message}).` }),
  );
}

function toChessopsMove(move: Move): ChessopsMove | null {
  const from = parseSquare(move.from);
  const to = parseSquare(move.to);
  if (from === undefined || to === undefined) return null;
  return {
    from,
    to,
    promotion: move.promotion as Role | undefined,
  };
}

function toMove(from: ChessopsSquare, to: ChessopsSquare, promotion?: PieceRole): Move {
  return {
    from: makeSquare(from) as Square,
    to: makeSquare(to) as Square,
    promotion: promotion === 'king' || promotion === 'pawn' ? undefined : promotion,
  };
}

function isPromotionDestination(square: ChessopsSquare): boolean {
  const rank = squareRank(square);
  return rank === 0 || rank === 7;
}

type Direction = readonly [fileOffset: number, rankOffset: number];

const knightSteps: Direction[] = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];
const kingSteps: Direction[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
const rookDirections: Direction[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const bishopDirections: Direction[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function addMaybePromotion(moves: Move[], from: Square, to: Square): void {
  if (rankOf(to) === 1 || rankOf(to) === 8) {
    for (const promotion of promotionRoles) moves.push({ from, to, promotion });
    return;
  }
  moves.push({ from, to });
}

function canOccupy(state: GameState, from: Square, to: Square): boolean {
  const piece = state.board[from];
  const target = state.board[to];
  return !!piece && (!target || target.color !== piece.color);
}

function movesMatch(candidate: Move, move: Move): boolean {
  return (
    candidate.from === move.from &&
    candidate.to === move.to &&
    (candidate.promotion ?? undefined) === (move.promotion ?? undefined)
  );
}

function withCastlingAliases(state: GameState, moves: Move[]): Move[] {
  const aliases: Move[] = [];
  for (const move of moves) {
    const piece = state.board[move.from];
    const target = state.board[move.to];
    if (piece?.role !== 'king' || !target || target.role !== 'rook' || target.color !== piece.color)
      continue;
    if (!state.castlingRights.includes(move.to)) continue;
    const kingDestination = castlingKingDestination(move.from, move.to);
    if (!moves.some((candidate) => movesMatch(candidate, { ...move, to: kingDestination }))) {
      aliases.push({ ...move, to: kingDestination });
    }
  }
  return aliases.length > 0 ? [...moves, ...aliases] : moves;
}

function normalizeCastlingMove(state: GameState, move: Move): Move | null {
  const piece = state.board[move.from];
  if (piece?.role !== 'king') return null;
  if (rankOf(move.from) !== rankOf(move.to)) return null;
  const target = state.board[move.to];
  if (
    target?.color === piece.color &&
    target.role === 'rook' &&
    state.castlingRights.includes(move.to)
  ) {
    return move;
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
  return rookSquare ? { ...move, to: rookSquare } : null;
}

function castlingKingDestination(from: Square, rookSquare: Square): Square {
  return `${fileIndex(rookSquare) > fileIndex(from) ? 'g' : 'c'}${rankOf(from)}` as Square;
}

function castlingRookDestination(from: Square, rookSquare: Square): Square {
  return `${fileIndex(rookSquare) > fileIndex(from) ? 'f' : 'd'}${rankOf(from)}` as Square;
}

function nextCastlingRights(state: GameState, move: Move, role: PieceRole): Square[] {
  return state.castlingRights.filter((square) => {
    if (square === move.from || square === move.to) return false;
    if (role !== 'king') return true;
    return rankOf(square) !== rankOf(move.from);
  });
}

function nextEnPassantSquare(move: Move, role: PieceRole, color: Color): Square | undefined {
  if (role !== 'pawn') return undefined;
  if (Math.abs(rankOf(move.to) - rankOf(move.from)) !== 2) return undefined;
  return offsetSquare(move.from, 0, color === 'white' ? 1 : -1);
}

function enPassantCaptureSquare(to: Square, color: Color): Square {
  const captured = offsetSquare(to, 0, color === 'white' ? -1 : 1);
  if (!captured) throw new Error('invalid en passant capture square');
  return captured;
}

function isFogCastlingMove(state: GameState, move: Move): boolean {
  const piece = state.board[move.from];
  const target = state.board[move.to];
  return (
    !!piece &&
    piece.role === 'king' &&
    !!target &&
    target.color === piece.color &&
    target.role === 'rook' &&
    state.castlingRights.includes(move.to)
  );
}

function isEnPassantMove(state: GameState, move: Move, color: Color): boolean {
  const piece = state.board[move.from];
  return (
    piece?.role === 'pawn' &&
    piece.color === color &&
    move.to === state.enPassantSquare &&
    state.board[move.to] === undefined &&
    fileOf(move.from) !== fileOf(move.to)
  );
}

function applyFogCastling(board: Board, move: Move, king: NonNullable<Board[Square]>): void {
  const rook = board[move.to];
  if (!rook) return;

  const kingTo = castlingKingDestination(move.from, move.to);
  const rookTo = castlingRookDestination(move.from, move.to);
  delete board[move.to];
  delete board[move.from];
  board[kingTo] = king;
  board[rookTo] = rook;
}

function clearForFogCastling(board: Board, kingFrom: Square, rookFrom: Square): boolean {
  const kingTo = castlingKingDestination(kingFrom, rookFrom);
  const rookTo = castlingRookDestination(kingFrom, rookFrom);
  const allowedOccupied = new Set<Square>([kingFrom, rookFrom]);
  for (const square of [...rankPath(kingFrom, kingTo), ...rankPath(rookFrom, rookTo)]) {
    const piece = board[square];
    if (piece && !allowedOccupied.has(square)) return false;
  }
  return true;
}

function rankPath(from: Square, to: Square): Square[] {
  const step = Math.sign(fileIndex(to) - fileIndex(from));
  if (step === 0) return [from];
  const squares: Square[] = [];
  for (let file = fileIndex(from); file !== fileIndex(to) + step; file += step) {
    squares.push(`${boardFiles[file]}${rankOf(from)}` as Square);
  }
  return squares;
}

function offsetSquare(square: Square, fileOffset: number, rankOffset: number): Square | undefined {
  const file = fileIndex(square) + fileOffset;
  const rank = rankOf(square) + rankOffset;
  if (file < 0 || file >= boardFiles.length) return undefined;
  if (!boardRanks.includes(rank as (typeof boardRanks)[number])) return undefined;
  return `${boardFiles[file]}${rank}` as Square;
}

function fileOf(square: Square): string {
  return square[0];
}

function fileIndex(square: Square): number {
  return boardFiles.indexOf(fileOf(square) as (typeof boardFiles)[number]);
}

function rankOf(square: Square): number {
  return Number(square[1]);
}

function oppositeColor(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

// ── SECTION: Variant registry ───────────────────────────────────────────────
// Detects the piece role (if any) that a move captures from the perspective of the
// pre-move state. Returns undefined for non-capturing moves and for castling (the
// piece on move.to is the mover's own rook). Handles en-passant for pawn moves.
export function capturedRoleFor(state: GameState, move: Move): PieceRole | undefined {
  if (state.status.type !== 'playing') return undefined;
  const moving = state.board[move.from];
  if (!moving || moving.color !== state.status.turn) return undefined;
  const target = state.board[move.to];
  if (target && target.color !== moving.color) return target.role;
  if (
    moving.role === 'pawn' &&
    !target &&
    move.to === state.enPassantSquare &&
    move.from[0] !== move.to[0]
  ) {
    return 'pawn';
  }
  return undefined;
}

export function variantForId(id: GameState['variant']): Variant {
  if (id === 'dark-chess') return darkChessVariant;
  if (id === 'chess') return standardChessVariant;
  // Fail loud on an unknown slug. After migrations 022/023 no persisted
  // 'fog-of-war' remains, so anything else is a real bug, not a legacy spelling —
  // surfacing it beats silently rendering the wrong variant.
  throw new Error(`unknown variant id: ${JSON.stringify(id)}`);
}
