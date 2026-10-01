// Flip Jungle (jungle-flip) review surface: the jungle-flip presentation bundle over
// the generic tree-review controller (mountTreeReview). It drives the in-browser
// MistyJungleFlip wasm client engine (positionMode 'fen', per-node redacted FEN), mirroring
// banqi. Like banqi the adapter is DEAL-BOUND (a factory over the reconstructed deal), so
// the presentation is built per-game rather than held as a module constant.

import {
  engineUciToJungleFlipMove,
  type JungleFlipDeal,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipPlayerView,
  type JungleFlipSeat,
  jungleFlipStateToEngineFen,
} from '@mistboard/game';
import { rectangularGridAspect } from '../board-metrics.js';
import { createJungleFlipInteractiveBoard } from '../jungle-flip-board.js';
import {
  animateJungleFlipBoardMove,
  JUNGLE_FLIP_BOARD_VIEW,
  type JungleFlipBoardArrow,
  type JungleFlipBoardMarker,
} from '../jungle-flip-render.js';
import {
  bestMoveArrowWithParser,
  bestMoveMarkerWithParser,
  engineArrowsFromLinesWithParser,
  engineMarkersFromLinesWithParser,
} from './engine/engine-arrows.js';
import type { NodeShape, VariantTreeAdapter } from './game-tree.js';
import { makeJungleFlipTreeAdapter } from './jungle-flip-tree-adapter.js';
import { formatFlipVariantBestMove } from './move-advice.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

/** Config for a jungle-flip review mount. Truth-typed so a caller can root the
 *  tree at a parsed dealt position (`root`) and read the current truth back from
 *  the position hand-off hooks (`analyseFromHere`, `boardEditorHref`). */
export type JungleFlipReviewConfig = TreeReviewConfig<JungleFlipMove, JungleFlipGameState>;

/** Handle returned by mountJungleFlipReview: snapshot the current tree to persist it. */
export type JungleFlipReviewHandle = TreeReviewHandle;

// Engine UCI uses 0-indexed ranks (a0..d3) with a flip as from===to; render it in board
// coords for the MultiPV panel — a bare coord ("b3") for a flip, "b3-c3" for a move.
function formatJungleFlipEngineMove(uci: string): string {
  if (uci.length < 4) return uci;
  const toDisplay = (sq: string): string => {
    const rank = Number(sq[1]);
    return Number.isNaN(rank) ? sq : `${sq[0]}${rank + 1}`;
  };
  const from = toDisplay(uci.slice(0, 2));
  const to = toDisplay(uci.slice(2, 4));
  return from === to ? from : `${from}-${to}`;
}

// No board-overlay layer, so the engine presentation omits that capability and the
// panel hides its arrow setting. The eval gauge + MultiPV panel still light up and
// Arrow/Marker remain unused. Jungle-flip is symmetric-info (both seats see the identical board), so
// `perspective` never changes the render.
function makeJungleFlipPresentation(
  adapter: VariantTreeAdapter<JungleFlipMove, JungleFlipGameState, JungleFlipPlayerView>,
): TreePresentation<
  JungleFlipMove,
  JungleFlipGameState,
  JungleFlipPlayerView,
  JungleFlipSeat,
  JungleFlipBoardArrow,
  JungleFlipBoardMarker
> {
  return {
    adapter,
    // Client engine: the in-browser MistyJungleFlip wasm (single-shot MultiPV), fed the
    // per-node REDACTED FEN (positionMode 'fen') — face-down tiles as X — so the client
    // engine never sees more than the as-played info-state, same boundary as the server.
    engine: {
      panelVariant: 'jungleflip',
      positionMode: 'fen',
      fen: jungleFlipStateToEngineFen,
      canEvaluatePosition: (truth) => truth.status.type === 'playing',
      formatPvMove: formatJungleFlipEngineMove,
      moveFromEngineUci: engineUciToJungleFlipMove,
      engineArrowsFromLines: (lines) =>
        engineArrowsFromLinesWithParser(lines, engineUciToJungleFlipMove),
      engineMarkersFromLines: (lines) =>
        engineMarkersFromLinesWithParser(lines, engineUciToJungleFlipMove),
      bestMoveArrow: (best) => bestMoveArrowWithParser(best, engineUciToJungleFlipMove),
      bestMoveMarker: (best) => bestMoveMarkerWithParser(best, engineUciToJungleFlipMove),
    },
    // The analysis engine's best move is 0-indexed UCI with flips as from===to; render it in
    // board coords ("b3 flip") for the "… was best" advice line, not the raw "B2-B2".
    formatBestMove: formatFlipVariantBestMove,
    boardHostClassName: 'jungle-flip-postgame-board jungle-flip-live-board',
    boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
    defaultBoardAriaLabel: 'Flip Jungle board',
    boardAspect: rectangularGridAspect(JUNGLE_FLIP_BOARD_VIEW),
    // 4×4 board: keep capture tiles compact so the board grows to fill the box.
    boardCols: 8,
    // Cap the width so four cells don't balloon to fill a large square area (the
    // linear layout capped this at 560 too).
    boardMaxPx: 560,
    perspective: (flipped) => (flipped ? 'black' : 'red'),
    seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
    createBoard: (opts) => createJungleFlipInteractiveBoard(opts),
    // No glide animation (a flip has no travel; board re-renders on nav).
    // The board never flips (the deal has no sides), so the glide ignores the
    // review's perspective too.
    animateMove: (host, move, _perspective, opts) => animateJungleFlipBoardMove(host, move, opts),
    shapeToArrow: (s: NodeShape): JungleFlipBoardArrow => ({
      from: s.orig as JungleFlipBoardArrow['from'],
      to: (s.dest ?? s.orig) as JungleFlipBoardArrow['to'],
      className: `xq-arrow--draw xq-shape--${s.brush}`,
    }),
    shapeToMarker: (s: NodeShape): JungleFlipBoardMarker => ({
      square: s.orig as JungleFlipBoardMarker['square'],
      kind: 'circle',
      className: `xq-shape--${s.brush}`,
    }),
    // Judgment badge on the square the move landed on, so the board states the
    // same verdict the move list does (lila pins its glyphs the same way).
    moveGlyphMarker: (move: JungleFlipMove, glyph): JungleFlipBoardMarker => ({
      square: move.to,
      kind: 'glyph',
      text: glyph.text,
      className: `xq-marker--${glyph.tone}`,
    }),
  };
}

/** `deal` is the recovered postgame deal, or null for a surface that roots the
 *  tree at a parsed position (`config.root`, the analysis board): a null deal
 *  with no root throws at mount, never a silently different deal. */
export function mountJungleFlipReview(
  root: HTMLElement,
  gameId: string,
  deal: JungleFlipDeal | null,
  config: JungleFlipReviewConfig,
): JungleFlipReviewHandle {
  const adapter = makeJungleFlipTreeAdapter(gameId, deal);
  return mountTreeReview(root, makeJungleFlipPresentation(adapter), config);
}
