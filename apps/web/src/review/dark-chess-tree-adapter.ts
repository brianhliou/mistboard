// Fog Chess (dark-chess) adapter for the shared GameTree spine — the FIRST
// chess-family fog consumer, and the sibling of dark-xiangqi-tree-adapter. It
// shares every hook with an open adapter EXCEPT `project`, which returns the
// triptych: the fully-revealed truth board (primary) plus each seat's fogged view
// (secondary). In analysis the game is over, so the tree replays and branches on
// the TRUE move history like an open variant.
//
// Dark chess fog is simpler to mask than xiangqi's: the kernel's getPlayerView
// already OMITS hidden squares from the board (there is no shrouded-with-color
// entry), so a POV projection leaks nothing — a hidden piece is simply absent, and
// the renderer fogs the empty square. The truth projection reveals the whole board.

import {
  type Color,
  canonicalChessCastlingMove,
  darkChessVariant,
  type GameState,
  type Move,
  moveToAlgebraic,
  type PieceRole,
  type PlayerView,
  type Square,
} from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import { revealKingCaptureForLoser } from '../replay-board.js';
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

/** Every board square (a1..h8). The truth view lists them ALL as visible so the
 *  renderer draws no fog on it. */
const ALL_CHESS_SQUARES: Square[] = (() => {
  const squares: Square[] = [];
  for (let file = 0; file < 8; file += 1) {
    for (let rank = 1; rank <= 8; rank += 1) {
      squares.push(`${String.fromCharCode(97 + file)}${rank}` as Square);
    }
  }
  return squares;
})();

function moveToUci(move: Move): string {
  return `${move.from}${move.to}${move.promotion ? PROMOTION_UCI[move.promotion] : ''}`;
}

function uciToMove(uci: string): Move | null {
  if (uci.length < 4) return null;
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci.length > 4 ? UCI_PROMOTION[uci[4]!] : undefined;
  return { from, to, ...(promotion ? { promotion } : {}) };
}

/** The fully-revealed truth board: every piece shown, every square visible (so the
 *  fog layer paints nothing), and the side-to-move's legal moves so the interactive
 *  board plays both sides. */
function godView(truth: GameState): PlayerView {
  const sideToMove: Color = truth.status.type === 'playing' ? truth.status.turn : 'white';
  return {
    id: truth.id,
    variant: truth.variant,
    board: truth.board,
    visibleSquares: ALL_CHESS_SQUARES,
    legalMoves:
      truth.status.type === 'playing' ? darkChessVariant.getLegalMoves(truth, sideToMove) : [],
    status: truth.status,
    perspective: sideToMove,
    moveNumber: truth.moveNumber,
    lastMove: truth.lastMove,
    clock: truth.clock,
  };
}

/** A seat's fogged view. On a finished king-capture position the loser saw their
 *  king die, so reveal the attacker on the capture square in the loser's POV
 *  (matching the linear postgame + the live replay). */
function povView(truth: GameState, color: Color): PlayerView {
  const view = darkChessVariant.getPlayerView(truth, color);
  if (
    truth.status.type === 'finished' &&
    truth.status.reason === 'king-captured' &&
    truth.lastMove
  ) {
    const attacker = truth.board[truth.lastMove.to];
    const loser = truth.status.winner === 'white' ? 'black' : 'white';
    if (attacker && color === loser) {
      return revealKingCaptureForLoser(view, truth.lastMove, attacker);
    }
  }
  return view;
}

export const darkChessTreeAdapter: VariantTreeAdapter<Move, GameState, PlayerView> = {
  mode: 'fog',
  initialTruth: () => darkChessVariant.createInitialState('analysis'),
  isLegal: (truth, move) => {
    if (truth.status.type !== 'playing') return false;
    const legal = canonicalChessCastlingMove(truth, move);
    return darkChessVariant
      .getLegalMoves(truth, truth.status.turn)
      .some((m) => m.from === legal.from && m.to === legal.to && m.promotion === legal.promotion);
  },
  applyMove: (truth, move) => darkChessVariant.applyMove(truth, move),
  project: (truth): ProjectedView<PlayerView>[] => [
    {
      key: 'truth',
      label: t('watch.truth'),
      shortLabel: t('watch.truth'),
      tier: 'primary',
      view: godView(truth),
    },
    {
      key: 'white',
      label: t('replay.whitesView'),
      shortLabel: t('setup.white'),
      tier: 'secondary',
      view: povView(truth, 'white'),
    },
    {
      key: 'black',
      label: t('replay.blacksView'),
      shortLabel: t('setup.black'),
      tier: 'secondary',
      view: povView(truth, 'black'),
    },
  ],
  moveLabel: (move, parentTruth) => moveToAlgebraic(parentTruth, move),
  moveKey: (move) => moveToUci(move),
  toEngineUci: (move) => moveToUci(move),
  // The board spells castling king-onto-rook (e1h1); Misty's own records and any
  // UCI engine write e1g1. Normalise at this boundary so a saved tree, a URL line
  // or an engine PV in either spelling replays past the castle and keys the same
  // node as a castle played on the board (#451).
  fromUci: (uci, parentTruth) => {
    const move = uciToMove(uci);
    return move ? canonicalChessCastlingMove(parentTruth, move) : null;
  },
};
