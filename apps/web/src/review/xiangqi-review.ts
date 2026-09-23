// Standard-xiangqi review surface: the xiangqi presentation bundle over the
// generic tree-review controller (mountTreeReview, tree-review.ts). All the
// board/engine/tree/analysis machinery lives in the controller; this file only
// supplies the xiangqi-specific presentation seam. Both callers ride it:
//   - xiangqi-analysis.ts  — bare move list / empty start position (client views,
//     client ceval sweep). The lichess.org/analysis surface.
//   - xiangqi-postgame.ts  — a specific played/ingested game with a meta card
//     (server views, server Pikafish analysis). The lichess.org/{gameId} surface.
// The two callers differ only in ingress + metadata. The board is INTERACTIVE
// (play a move → it branches the tree, promote/delete variations).

import {
  classifyXiangqiMove,
  fsfUciToXiangqiSquares,
  type StandardXiangqiPlayerView,
  standardXiangqiEngineFen,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import {
  animateXiangqiBoardMove,
  createXiangqiInteractiveBoard,
  LIVE_BOARD_GEO,
  type XiangqiBoardArrow,
  type XiangqiBoardMarker,
} from '../xiangqi-board.js';
import { xiangqiBoardAspect } from '../xiangqi-board-aspect.js';
import { xiangqiNotationChangedEvent } from '../xiangqi-notation.js';
import { bestMoveArrow, engineArrowsFromLines } from './engine/engine-arrows.js';
import type { NodeShape } from './game-tree.js';
import { createOpeningExplorer } from './opening-explorer.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';
import { xiangqiGamePhases } from './xiangqi-phases.js';
import { xiangqiRecordTreeAdapter, xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

/** Whole-game analysis source (variant-neutral; re-exported for the callers). */
export type { AnalysisSource as XiangqiAnalysisSource } from './tree-review.js';

/** Config for a standard-xiangqi review mount. */
export type XiangqiReviewConfig = TreeReviewConfig<
  XiangqiMove,
  XiangqiGameState,
  XiangqiBoardArrow
> & {
  /** Attach the opening-explorer underboard tab. Defaults to true. */
  openingExplorer?: boolean;
  /** The moves are a played record (a broadcast or archive game): replay past
   *  the draws an arbiter decides instead of stopping at the kernel's call. */
  record?: boolean;
};

/** Handle returned by mountXiangqiReview: snapshot the current tree to persist it. */
export type XiangqiReviewHandle = TreeReviewHandle;

const xiangqiPresentation: TreePresentation<
  XiangqiMove,
  XiangqiGameState,
  StandardXiangqiPlayerView,
  XiangqiColor,
  XiangqiBoardArrow,
  XiangqiBoardMarker
> = {
  adapter: xiangqiTreeAdapter,
  engine: {
    panelVariant: 'xiangqi',
    fen: standardXiangqiEngineFen,
    formatPvMove: formatXiangqiEngineMove,
    engineArrowsFromLines,
    bestMoveArrow,
    // `!!` / `!` by the shared xiangqi rules. The server hands the whole-game PV
    // in our own square notation (same dialect as `best`), decoded to the first
    // token the rules engine cannot read.
    praiseMove: ({
      before,
      move,
      winBefore,
      winAfter,
      playedBest,
      pv,
      secondBestWin,
      winTwoPliesAgo,
      pvAfterCapture,
    }) => {
      if (before.status.type !== 'playing') return null;
      // An unreadable token TRUNCATES a line: every move after it would land on
      // the wrong position.
      const decodeLine = (line: readonly string[]): XiangqiMove[] => {
        const out: XiangqiMove[] = [];
        for (const uci of line) {
          const decoded = fsfUciToXiangqiSquares(uci);
          if (!decoded) break;
          out.push(decoded);
        }
        return out;
      };
      return classifyXiangqiMove({
        before,
        move,
        winBefore,
        winAfter,
        playedBest,
        pvAfter: decodeLine(pv),
        secondBestWin,
        winTwoPliesAgo,
        pvAfterCapture: pvAfterCapture.length ? decodeLine(pvAfterCapture) : null,
      }).glyph;
    },
  },
  boardHostClassName: 'dxq-postgame__board xiangqi-live-board',
  boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
  defaultBoardAriaLabel: 'Xiangqi board',
  boardAspect: () => xiangqiBoardAspect(LIVE_BOARD_GEO),
  boardCols: 9,
  // The xiangqi board renders pieces as inline SVG, so a piece-set change needs a
  // re-render (the chess board picks up its set via CSS and does not).
  appearanceEvent: xiangqiAppearanceChangedEvent,
  // Notation display-mode changes relabel the whole tree (labels cache at node
  // creation; see xiangqi-tree-adapter.moveLabel).
  labelsEvent: xiangqiNotationChangedEvent,
  perspective: (flipped) => (flipped ? 'black' : 'red'),
  // Review plays BOTH sides: the interactive seat is the side to move.
  seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
  // Learn from your mistakes: the played mistake draws as a from→to arrow.
  retro: { moveSquares: (move) => ({ orig: move.from, dest: move.to }) },
  createBoard: (opts) => createXiangqiInteractiveBoard(opts),
  animateMove: animateXiangqiBoardMove,
  shapeToArrow: (s: NodeShape): XiangqiBoardArrow => ({
    from: s.orig as XiangqiSquare,
    to: (s.dest ?? s.orig) as XiangqiSquare,
    className: `xq-arrow--draw xq-shape--${s.brush}`,
  }),
  shapeToMarker: (s: NodeShape): XiangqiBoardMarker => ({
    square: s.orig as XiangqiSquare,
    kind: 'circle',
    className: `xq-shape--${s.brush}`,
  }),
  // The badge rides the square the piece landed on, so it reads as a verdict on
  // the move just played rather than on the point it came from.
  moveGlyphMarker: (move: XiangqiMove, glyph): XiangqiBoardMarker => ({
    square: move.to,
    kind: 'glyph',
    text: glyph.text,
    className: `xq-marker--${glyph.tone}`,
  }),
  // Opening/Middlegame/Endgame segmentation for the chart dividers + per-phase
  // accuracy (heuristic; see xiangqi-phases.ts).
  gamePhases: xiangqiGamePhases,
  // No right-rail material rows for now: the reserved mat-top/mat-bot bands
  // offset the rail against the board and eval bar. The imbalance renderer
  // (net pieces won + point lead) lived here until 2026-07-23 and returns with
  // a layout that keeps the three columns aligned (#166).
};

export function mountXiangqiReview(
  root: HTMLElement,
  config: XiangqiReviewConfig,
): XiangqiReviewHandle {
  // Standard-xiangqi review surfaces get the opening explorer by default: the
  // corpus is keyed by position, so it is as useful on a played game as on the
  // analysis board. Default-on rather than opt-in so a NEW surface inherits it
  // instead of quietly missing it. Set `openingExplorer: false` to decline; no
  // surface does today (the study board did until 2026-08-26). The panel is
  // closed until the reader opens it from the book tool, so this costs nothing
  // on a surface where nobody looks.
  const explorer =
    config.openingExplorer === false ? undefined : (config.explorer ?? xiangqiOpeningExplorer());
  const presentation = config.record
    ? { ...xiangqiPresentation, adapter: xiangqiRecordTreeAdapter }
    : xiangqiPresentation;
  return mountTreeReview(root, presentation, { ...config, explorer });
}

/** The shared explorer panel, typed to the xiangqi kernel state. */
function xiangqiOpeningExplorer(): NonNullable<XiangqiReviewConfig['explorer']> {
  const explorer = createOpeningExplorer();
  return {
    el: explorer.el,
    setTruth: (truth) => explorer.setState(truth),
    setActive: (isActive) => explorer.setActive(isActive),
    onPlayMove: (handler) => explorer.onPlayMove(handler),
    // Hover hint in a distinct ink (teal, dashed) so it never reads as an engine
    // suggestion — it is "the move under your cursor", not "the best move".
    onHoverMove: (handler) =>
      explorer.onHoverMove((move) =>
        handler(
          move
            ? {
                from: move.from,
                to: move.to,
                className: 'xq-arrow--explorer',
                color: '#8a63d2',
                dashed: true,
                opacity: 0.85,
              }
            : null,
        ),
      ),
  };
}

// Fairy-Stockfish xiangqi UCI back to our `from-to` notation for readable PV
// lines. FSF is 1-indexed like us, so this is a plain square split. Shared with
// the live broadcast engine panel, whose server lines use the same dialect.
export function formatXiangqiEngineMove(uci: string): string {
  const squares = fsfUciToXiangqiSquares(uci);
  return squares ? `${squares.from}-${squares.to}` : uci;
}
