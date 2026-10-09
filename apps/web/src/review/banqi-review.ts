// Banqi review surface: the banqi presentation bundle over the
// generic tree-review controller (mountTreeReview). The client engine is the in-browser
// MistyBanqi wasm build (a Misty ceval backend, fed the per-node redacted FEN), so the
// eval gauge + MultiPV panel light up alongside the interactive branching board (flip +
// move), move tree, control bar, and replay. Unlike jungle/xiangqi the adapter is
// DEAL-BOUND (a factory over the reconstructed deal), so the presentation is built
// per-game rather than held as a module constant.

import {
  type BanqiGameState,
  type BanqiMove,
  type BanqiPlayerView,
  type BanqiSeat,
  banqiStateToEngineFen,
  engineUciToBanqiMove,
} from '@mistboard/game';
import { createBanqiInteractiveBoard } from '../banqi-board.js';
import type { BanqiBoardArrow, BanqiBoardMarker } from '../live-banqi-render.js';
import { animateBanqiBoardMove } from '../live-banqi-render.js';
import { type BanqiReviewStart, makeBanqiTreeAdapter } from './banqi-tree-adapter.js';
import {
  bestMoveArrowWithParser,
  bestMoveMarkerWithParser,
  engineArrowsFromLinesWithParser,
  engineMarkersFromLinesWithParser,
} from './engine/engine-arrows.js';
import type { NodeShape, VariantTreeAdapter } from './game-tree.js';
import { formatFlipVariantBestMove } from './move-advice.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

/** Config for a banqi review mount. Truth-typed so a caller can root the tree
 *  at a parsed dealt position (`root`) and read the current truth back from the
 *  position hand-off hooks (`analyseFromHere`, `boardEditorHref`). */
export type BanqiReviewConfig = TreeReviewConfig<BanqiMove, BanqiGameState>;

/** Handle returned by mountBanqiReview: snapshot the current tree to persist it. */
export type BanqiReviewHandle = TreeReviewHandle;

/** Engine PV move (redacted engine UCI, e.g. "a0b0" or a flip "e0e0") -> display coords.
 *  A flip renders as a bare coordinate ("e1"), matching the move-list notation; a move as
 *  "from-to" ("a1-b1"). Ranks are 0-indexed in engine UCI, 1-indexed on the board. */
function formatBanqiEngineMove(uci: string): string {
  if (uci.length < 4) return uci;
  const toDisplay = (sq: string): string => {
    const rank = Number(sq[1]);
    return Number.isNaN(rank) ? sq : `${sq[0]}${rank + 1}`;
  };
  const from = toDisplay(uci.slice(0, 2));
  const to = toDisplay(uci.slice(2, 4));
  return from === to ? from : `${from}-${to}`;
}

// The banqi renderer has no board-overlay layer, so the engine presentation omits
// that capability and the panel hides its arrow setting. The eval gauge + MultiPV
// panel still light up. The shapeTo* hooks pass shapes through opaquely. Banqi is
// symmetric-info — the same board shows to both seats — so
// `perspective` never changes the render (the Flip control is a visual no-op here).
function makeBanqiPresentation(
  adapter: VariantTreeAdapter<BanqiMove, BanqiGameState, BanqiPlayerView>,
): TreePresentation<
  BanqiMove,
  BanqiGameState,
  BanqiPlayerView,
  BanqiSeat,
  BanqiBoardArrow,
  BanqiBoardMarker
> {
  return {
    adapter,
    // Client engine: the in-browser MistyBanqi wasm (single-shot MultiPV). It is fed the
    // per-node REDACTED FEN (positionMode 'fen') — face-down tiles as X — so the client
    // engine never sees more than the as-played info-state, same boundary as the server.
    engine: {
      panelVariant: 'banqi',
      positionMode: 'fen',
      fen: banqiStateToEngineFen,
      canEvaluatePosition: (truth) => truth.status.type === 'playing',
      formatPvMove: formatBanqiEngineMove,
      moveFromEngineUci: engineUciToBanqiMove,
      engineArrowsFromLines: (lines) =>
        engineArrowsFromLinesWithParser(lines, engineUciToBanqiMove),
      engineMarkersFromLines: (lines) =>
        engineMarkersFromLinesWithParser(lines, engineUciToBanqiMove),
      bestMoveArrow: (best) => bestMoveArrowWithParser(best, engineUciToBanqiMove),
      bestMoveMarker: (best) => bestMoveMarkerWithParser(best, engineUciToBanqiMove),
    },
    // The analysis engine's best move is 0-indexed UCI with flips as from===to; render it in
    // board coords ("b3 flip") for the "… was best" advice line, not the raw "B2-B2".
    formatBestMove: formatFlipVariantBestMove,
    boardHostClassName: 'banqi-postgame-board banqi-live-board',
    boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
    defaultBoardAriaLabel: 'Banqi board',
    // 8×4 board (WIDTH 568 / HEIGHT 312 from live-banqi-render).
    boardAspect: 568 / 312,
    // Discs sit inset within their cell, so capture tiles size a touch under one
    // cell (board width / 10), matching the linear postgame.
    boardCols: 10,
    // Cap the width: an 8×4 board (aspect ~1.82) otherwise stretches to the full
    // column, rendering as a long, short strip. ~its native SVG width keeps it sane.
    boardMaxPx: 560,
    perspective: (flipped) => (flipped ? 'black' : 'red'),
    // Review plays BOTH sides: the interactive seat is the side to move.
    seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
    createBoard: (opts) => createBanqiInteractiveBoard(opts),
    // Banqi is symmetric, so there is no perspective to pass; the presentation
    // contract takes one anyway for the fog variants, and it is dropped here.
    // A flip needs no special case: it is a self-move, and the glide no-ops.
    animateMove: (boardEl, move, _perspective, opts) => animateBanqiBoardMove(boardEl, move, opts),
    shapeToArrow: (s: NodeShape): BanqiBoardArrow => ({
      from: s.orig as BanqiBoardArrow['from'],
      to: (s.dest ?? s.orig) as BanqiBoardArrow['to'],
      className: `xq-arrow--draw xq-shape--${s.brush}`,
    }),
    shapeToMarker: (s: NodeShape): BanqiBoardMarker => ({
      square: s.orig as BanqiBoardMarker['square'],
      kind: 'circle',
      className: `xq-shape--${s.brush}`,
    }),
    // Judgment badge on the square the move landed on, so the board states the
    // same verdict the move list does (lila pins its glyphs the same way).
    moveGlyphMarker: (move: BanqiMove, glyph): BanqiBoardMarker => ({
      square: move.to,
      kind: 'glyph',
      text: glyph.text,
      className: `xq-marker--${glyph.tone}`,
    }),
  };
}

/** `start` is the recovered postgame deal plus the rules the game was played under,
 *  or null for a surface that roots the tree at a parsed position (`config.root`,
 *  the analysis board): a null start with no root throws at mount, never a
 *  silently different deal. */
export function mountBanqiReview(
  root: HTMLElement,
  gameId: string,
  start: BanqiReviewStart | null,
  config: BanqiReviewConfig,
): BanqiReviewHandle {
  const adapter = makeBanqiTreeAdapter(gameId, start);
  return mountTreeReview(root, makeBanqiPresentation(adapter), config);
}
