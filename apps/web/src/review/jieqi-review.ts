// Jieqi review surface: the jieqi presentation bundle over the
// generic tree-review controller (mountTreeReview). The client engine is the
// in-browser PikaJieQi wasm build, fed a redacted FEN for each node. Like banqi the
// adapter is DEAL-BOUND (a factory over the reconstructed deal), so the
// presentation is built per-game rather than held as a module constant.

import {
  type JieqiColor,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPieceRole,
  type JieqiPlayerView,
  jieqiStateToPikafishFen,
  pikafishUciToJieqiMove,
} from '@mistboard/game';
import { createJieqiInteractiveBoard } from '../jieqi-board.js';
import type { JieqiBoardArrow, JieqiBoardMarker } from '../live-jieqi-render.js';
import { JIEQI_GEO, jieqiPieceGhostSvg } from '../live-jieqi-render.js';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import { xiangqiBoardAspect } from '../xiangqi-board-aspect.js';
import { xiangqiNotationChangedEvent } from '../xiangqi-notation.js';
import {
  bestMoveArrowWithParser,
  candidateArrowsWithParser,
  engineArrowsFromLinesWithParser,
} from './engine/engine-arrows.js';
import type { NodeShape, VariantTreeAdapter } from './game-tree.js';
import { jieqiRevealOdds } from './jieqi-luck-mark.js';
import { makeJieqiTreeAdapter } from './jieqi-tree-adapter.js';
import { attachLuckMarkCard, type LuckCardDetail } from './luck-mark-card.js';
import { formatJieqiBestMove } from './move-advice.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

/** Config for a jieqi review mount. Truth-typed so a caller can root the tree
 *  at a parsed dealt position (`root`) and read the current truth back from the
 *  position hand-off hooks (`analyseFromHere`, `boardEditorHref`). */
export type JieqiReviewConfig = TreeReviewConfig<JieqiMove, JieqiGameState>;

/** Handle returned by mountJieqiReview: snapshot the current tree to persist it. */
export type JieqiReviewHandle = TreeReviewHandle;

function makeJieqiPresentation(
  adapter: VariantTreeAdapter<JieqiMove, JieqiGameState, JieqiPlayerView>,
): TreePresentation<
  JieqiMove,
  JieqiGameState,
  JieqiPlayerView,
  JieqiColor,
  JieqiBoardArrow,
  unknown
> {
  // The mark drawn now, for the hover card; the card itself checks the mark is on the board.
  let luckDetail: LuckCardDetail | null = null;
  const pieceArt = (role: JieqiPieceRole, color: JieqiColor): string =>
    jieqiPieceGhostSvg({ color, role, faceDown: false });
  return {
    adapter,
    engine: {
      panelVariant: 'jieqi',
      positionMode: 'fen',
      fen: jieqiStateToPikafishFen,
      canEvaluatePosition: (truth) => truth.status.type === 'playing',
      formatPvMove: formatJieqiBestMove,
      moveFromEngineUci: pikafishUciToJieqiMove,
      engineArrowsFromLines: (lines) =>
        engineArrowsFromLinesWithParser(lines, pikafishUciToJieqiMove),
      bestMoveArrow: (best) => bestMoveArrowWithParser(best, pikafishUciToJieqiMove),
      // A reveal's ranked alternatives, weighted: the arrows behind "?? e1-d1 was best."
      candidateArrows: (moves) => candidateArrowsWithParser(moves, pikafishUciToJieqiMove),
    },
    // The analysis engine's best move is Pikafish UCI (0-indexed ranks, no flips); render it in
    // board coords ("e8-a8") for the "… was best" advice line, not the raw "e7a7".
    formatBestMove: formatJieqiBestMove,
    boardHostClassName: 'jieqi-postgame-board jieqi-live-board',
    boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
    defaultBoardAriaLabel: 'Jieqi board',
    // 9×10 board (WIDTH 660 / HEIGHT 732 from live-jieqi-render).
    boardAspect: () => xiangqiBoardAspect(JIEQI_GEO),
    // Both events matter now that coordinates are drawn ON the board: a notation
    // change relabels them, and toggling them changes the board's geometry. Before
    // that, this surface needed neither -- its pieces pick up their set via CSS --
    // which is why /analysis/{variant} ignored every appearance change until 2026-08-27.
    appearanceEvent: xiangqiAppearanceChangedEvent,
    labelsEvent: xiangqiNotationChangedEvent,
    boardCols: 16,
    // Xiangqi pieces pick up their look from the render call; a full re-render
    // happens on every navigation, so no appearance event.
    perspective: (flipped) => (flipped ? 'black' : 'red'),
    // Review plays BOTH sides: the interactive seat is the side to move.
    seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
    createBoard: (opts) => {
      const board = createJieqiInteractiveBoard(opts);
      const detachCard = attachLuckMarkCard(opts.board, () => luckDetail, pieceArt);
      opts.signal?.addEventListener('abort', detachCard, { once: true });
      return board;
    },
    // No glide animation wired for jieqi yet; the board re-renders on nav.
    animateMove: () => {},
    shapeToArrow: (s: NodeShape): JieqiBoardArrow => ({
      from: s.orig as JieqiBoardArrow['from'],
      to: (s.dest ?? s.orig) as JieqiBoardArrow['to'],
      className: `xq-arrow--draw xq-shape--${s.brush}`,
    }),
    shapeToMarker: (s: NodeShape) => s,
    // Judgment badge on the square the move landed on, so the board states the
    // same verdict the move list does (lila pins its glyphs the same way).
    moveGlyphMarker: (move: JieqiMove, glyph): JieqiBoardMarker => ({
      square: move.to,
      kind: 'glyph',
      text: glyph.text,
      className: `xq-marker--${glyph.tone}`,
    }),
    // The reveal's luck as a die on the square the revealed piece landed on.
    moveLuckMarker: (move, info): JieqiBoardMarker | null => {
      const mover = info.before.board[move.from]?.color;
      if (!mover) return null;
      luckDetail = {
        square: move.to,
        color: mover,
        luck: info.luck,
        odds: jieqiRevealOdds(info.before, move),
      };
      return { square: move.to, kind: 'luck', luck: { luck: info.luck } };
    },
  };
}

/** `deal` is the recovered postgame deal, or null for a surface that roots the
 *  tree at a parsed position (`config.root`, the analysis board): a null deal
 *  with no root throws at mount, never a silently different deal. */
export function mountJieqiReview(
  root: HTMLElement,
  gameId: string,
  deal: JieqiDeal | null,
  config: JieqiReviewConfig,
): JieqiReviewHandle {
  // The postgame deal is fully known here, so revealing is a presentation switch,
  // not a data fetch: the flag lives beside the adapter that reads it and the menu
  // item that flips it, and nothing else in the review needs to know about it.
  let revealAll = false;
  const adapter = makeJieqiTreeAdapter(gameId, deal, { revealAll: () => revealAll });
  return mountTreeReview(root, makeJieqiPresentation(adapter), {
    ...config,
    revealHidden: {
      setRevealed: (next) => {
        revealAll = next;
      },
    },
  });
}
