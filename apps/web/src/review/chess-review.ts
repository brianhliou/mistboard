// Standard chess review surface: the study-only chess spec's presentation over
// the generic tree-review controller. The open-information sibling of
// dark-chess-review.ts: one interactive board (no fog, no POV triptych), SAN
// with suffixes in the move list, a Fairy-Stockfish panel on the engine's
// built-in `chess` variant with its MultiPV lines as arrows, the judgment
// badge on the moved piece, and drawn shapes. Same board factory as Fog Chess
// with fog switched off, so a piece-set or drag fix lands on both.

import type { Color, GameState, Move, PlayerView, Square } from '@mistboard/game';
import { darkChessFen } from '@mistboard/game';
import type { ChessBoardArrow, ChessBoardMarker } from '../dark-chess-render.js';
import { createDarkChessInteractiveBoard } from '../dark-chess-tree-board.js';
import { chessTreeAdapter } from './chess-tree-adapter.js';
import { formatDarkChessMove } from './dark-chess-review.js';
import { engineArrowsFromLinesWithParser } from './engine/engine-arrows.js';
import type { NodeShape } from './game-tree.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

export type ChessReviewConfig = TreeReviewConfig<Move, GameState>;
export type ChessReviewHandle = TreeReviewHandle;

/** Plain chess UCI ("e2e4", "a7a8q") to board squares; null for anything else. */
function chessUciSquares(uci: string): { from: Square; to: Square } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square };
}

const chessPresentation: TreePresentation<
  Move,
  GameState,
  PlayerView,
  Color,
  ChessBoardArrow,
  ChessBoardMarker
> = {
  adapter: chessTreeAdapter,
  engine: {
    panelVariant: 'chess',
    // Ordinary chess FEN: the kernel's writer is variant-agnostic on the board.
    fen: darkChessFen,
    formatPvMove: formatDarkChessMove,
    // MultiPV lines as arrows, the shared weight-by-gap rule (engine-arrows.ts).
    engineArrowsFromLines: (lines) => engineArrowsFromLinesWithParser(lines, chessUciSquares),
    bestMoveArrow: (uci): ChessBoardArrow[] => {
      const move = uci ? chessUciSquares(uci) : null;
      return move ? [{ ...move, className: 'xq-arrow--best' }] : [];
    },
  },
  fen: darkChessFen,
  formatBestMove: formatDarkChessMove,
  boardHostClassName: 'dxq-postgame__board dark-chess-live-board',
  boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
  defaultBoardAriaLabel: 'Chess board',
  boardAspect: 1,
  boardCols: 8,
  perspective: (flipped) => (flipped ? 'black' : 'white'),
  // Review plays both sides: the interactive seat is the side to move.
  seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
  createBoard: (opts) => createDarkChessInteractiveBoard({ ...opts, fog: false }),
  // The board re-renders on navigation; no glide animation.
  animateMove: () => {},
  shapeToArrow: (s: NodeShape): ChessBoardArrow => ({
    from: s.orig as Square,
    to: (s.dest ?? s.orig) as Square,
    className: `xq-arrow--draw xq-shape--${s.brush}`,
  }),
  shapeToMarker: (s: NodeShape): ChessBoardMarker => ({
    square: s.orig as Square,
    kind: 'circle',
    className: `xq-shape--${s.brush}`,
  }),
  // The badge rides the square the piece landed on: a verdict on the move.
  moveGlyphMarker: (move: Move, glyph): ChessBoardMarker => ({
    square: move.to,
    kind: 'glyph',
    text: glyph.text,
    className: `xq-marker--${glyph.tone}`,
  }),
};

export function mountChessReview(root: HTMLElement, config: ChessReviewConfig): ChessReviewHandle {
  return mountTreeReview(root, chessPresentation, config);
}
