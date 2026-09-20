// Standard chess adapter for the shared GameTree spine: the open-information
// sibling of dark-chess-tree-adapter. One projection (the board is the truth),
// standard-chess legality (check-aware, castling aliases resolved by the kernel)
// and SAN labels with the check/mate suffixes. UCI in and out is the plain
// chess dialect ("e2e4", "a7a8q"), the same as Fog Chess and the server's
// engine artifacts, so a chapter tree written for one reads in the other.

import {
  type Color,
  type GameState,
  type Move,
  type PieceRole,
  type PlayerView,
  type Square,
  standardChessSan,
  standardChessVariant,
} from '@mistboard/game';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

const PROMOTION_UCI: Record<Exclude<PieceRole, 'king' | 'pawn'>, string> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
};
const UCI_PROMOTION: Record<string, Exclude<PieceRole, 'king' | 'pawn'>> = {
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
};

/** Every board square (a1..h8): the open board lists them all as visible so the
 *  shared fog-capable renderer paints no fog. */
const ALL_CHESS_SQUARES: Square[] = (() => {
  const squares: Square[] = [];
  for (let file = 0; file < 8; file += 1) {
    for (let rank = 1; rank <= 8; rank += 1) {
      squares.push(`${String.fromCharCode(97 + file)}${rank}` as Square);
    }
  }
  return squares;
})();

export function chessMoveToUci(move: Move): string {
  return `${move.from}${move.to}${move.promotion ? PROMOTION_UCI[move.promotion] : ''}`;
}

export function chessUciToMove(uci: string): Move | null {
  if (uci.length < 4) return null;
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci.length > 4 ? UCI_PROMOTION[uci[4]!] : undefined;
  return { from, to, ...(promotion ? { promotion } : {}) };
}

/** The whole board with the side to move's legal moves, so the interactive board
 *  plays both sides. */
export function chessOpenView(truth: GameState): PlayerView {
  const sideToMove: Color = truth.status.type === 'playing' ? truth.status.turn : 'white';
  return {
    id: truth.id,
    variant: truth.variant,
    board: truth.board,
    visibleSquares: ALL_CHESS_SQUARES,
    legalMoves:
      truth.status.type === 'playing' ? standardChessVariant.getLegalMoves(truth, sideToMove) : [],
    status: truth.status,
    perspective: sideToMove,
    moveNumber: truth.moveNumber,
    lastMove: truth.lastMove,
    clock: truth.clock,
  };
}

export const chessTreeAdapter: VariantTreeAdapter<Move, GameState, PlayerView> = {
  mode: 'perfect-info',
  initialTruth: () => standardChessVariant.createInitialState('analysis'),
  isLegal: (truth, move) => {
    if (truth.status.type !== 'playing') return false;
    return standardChessVariant
      .getLegalMoves(truth, truth.status.turn)
      .some((m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
  },
  applyMove: (truth, move) => standardChessVariant.applyMove(truth, move),
  project: (truth): ProjectedView<PlayerView>[] => [
    { key: 'board', label: 'Board', tier: 'primary', view: chessOpenView(truth) },
  ],
  moveLabel: (move, parentTruth) => standardChessSan(parentTruth, move),
  moveKey: (move) => chessMoveToUci(move),
  toEngineUci: (move) => chessMoveToUci(move),
  fromUci: (uci) => chessUciToMove(uci),
};
