// Fog Xiangqi (dark xiangqi) adapter for the shared GameTree spine. It shares
// every hook with the open xiangqi adapter EXCEPT `project`: an open variant
// projects one truth view, fog projects the triptych — the fully-revealed truth
// board (primary) plus each seat's fogged view (secondary). This is the fog case
// game-tree.ts was designed for ("the tree branches on TRUTH; the white/black fog
// boards are project(truth)").
//
// In analysis the game is over and truth is fully known, so the tree replays and
// branches on the TRUE move history exactly like an open variant. The kernel used
// is the fog kernel (variants-xiangqi.ts: pseudo-legal move gen, no check filter),
// because the game was played under fog rules and must replay faithfully.
//
// View type is DarkXiangqiWireView — the same shape the live/postgame fog renderer
// consumes — so the interactive board (dark-xiangqi-tree-board.ts) reuses the
// battle-tested fog SVG renderer + click handler. The POV projections REDACT
// shrouded piece identity to color-only, matching the wire redaction (the web-side
// half of the hidden-info guarantee); the truth projection reveals everything.

import {
  applyMove,
  createInitialXiangqiState,
  fsfUciToXiangqiSquares,
  getPlayerView,
  isLegalMove,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPlayerView,
  type XiangqiSquare,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import type { DarkXiangqiWireView } from '../live-dark-xiangqi.js';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

// Every board intersection (9 files a..i × 10 ranks 1..10). The truth board lists
// them ALL as visible so its fog layer produces full cutouts and shows no fog.
const ALL_XIANGQI_SQUARES: XiangqiSquare[] = (() => {
  const files = 'abcdefghi';
  const squares: XiangqiSquare[] = [];
  for (const file of files) {
    for (let rank = 1; rank <= 10; rank++) squares.push(`${file}${rank}` as XiangqiSquare);
  }
  return squares;
})();

/** Redact a kernel player view to the wire shape: a shrouded square drops its
 *  piece identity down to color-only (the hidden-info mask); a visible square keeps
 *  the full piece. Captures are empty (the review surface renders no capture rows,
 *  and the fog board SVG does not read them). */
function povWireView(truth: XiangqiGameState, color: XiangqiColor): DarkXiangqiWireView {
  const view: XiangqiPlayerView = getPlayerView(truth, color);
  const board: DarkXiangqiWireView['board'] = {};
  for (const [square, entry] of Object.entries(view.board)) {
    if (!entry) continue;
    board[square as XiangqiSquare] = entry.shrouded
      ? { color: entry.piece.color, shrouded: true }
      : { piece: entry.piece, shrouded: false };
  }
  return {
    // A distinct id keeps this board's fog mask from colliding with the truth /
    // other-POV boards' masks (the SVG mask id is keyed by id + perspective).
    id: `${view.id}#${color}`,
    perspective: color,
    board,
    visibleSquares: view.visibleSquares,
    legalMoves: view.legalMoves,
    status: view.status,
    moveNumber: view.moveNumber,
    lastMove: view.lastMove,
    captures: { red: [], black: [] },
  };
}

/** The fully-revealed truth board: every occupied square shown with full identity,
 *  every square visible (so the fog layer renders nothing), and the side-to-move's
 *  legal moves so the interactive board plays both sides. */
function godWireView(truth: XiangqiGameState): DarkXiangqiWireView {
  const sideToMove: XiangqiColor = truth.status.type === 'playing' ? truth.status.turn : 'red';
  const legalView = getPlayerView(truth, sideToMove);
  const board: DarkXiangqiWireView['board'] = {};
  for (const [square, piece] of Object.entries(truth.board)) {
    if (piece) board[square as XiangqiSquare] = { piece, shrouded: false };
  }
  return {
    id: `${truth.id}#truth`,
    perspective: sideToMove,
    board,
    visibleSquares: ALL_XIANGQI_SQUARES,
    legalMoves: legalView.legalMoves,
    status: truth.status,
    moveNumber: truth.moveNumber,
    lastMove: truth.lastMove,
    captures: { red: [], black: [] },
  };
}

export const darkXiangqiTreeAdapter: VariantTreeAdapter<
  XiangqiMove,
  XiangqiGameState,
  DarkXiangqiWireView
> = {
  mode: 'fog',
  initialTruth: () => createInitialXiangqiState('analysis'),
  isLegal: (truth, move) => truth.status.type === 'playing' && isLegalMove(truth, move),
  applyMove: (truth, move) => applyMove(truth, move),
  project: (truth): ProjectedView<DarkXiangqiWireView>[] => [
    {
      key: 'truth',
      label: t('watch.truth'),
      shortLabel: t('watch.truth'),
      tier: 'primary',
      view: godWireView(truth),
    },
    {
      key: 'red',
      label: t('replay.redsView'),
      shortLabel: t('setup.red'),
      tier: 'secondary',
      view: povWireView(truth, 'red'),
    },
    {
      key: 'black',
      label: t('replay.blacksView'),
      shortLabel: t('setup.black'),
      tier: 'secondary',
      view: povWireView(truth, 'black'),
    },
  ],
  moveLabel: (move) => `${move.from}-${move.to}`,
  // FSF xiangqi UCI is 1-indexed = our square notation, so the engine key and the
  // sibling-dedup NodeId are the same canonical string.
  moveKey: (move) => xiangqiMoveToFsfUci(move),
  toEngineUci: (move) => xiangqiMoveToFsfUci(move),
  fromUci: (uci) => fsfUciToXiangqiSquares(uci),
};
