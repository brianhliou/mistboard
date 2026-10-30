// Three Kingdoms banqi (#628) review surface: the study board. The variant's
// presentation bundle over the generic tree-review controller, on banqi's
// model (banqi-review.ts) with no client engine: there is no Three Kingdoms
// engine in the browser, so the eval gauge and engine panel are omitted.
//
// The tree is always rooted at a parsed dealt position (config.root), which a
// study chapter stores. The board shows the masked view, so a face-down tile
// stays face down until a flip in the line being read turns it up.

import {
  type BanqiColor,
  type BanqiSeat,
  THREE_KINGDOMS_BANQI_NO_PROGRESS_LIMIT,
  THREE_KINGDOMS_BANQI_POINTS,
  THREE_KINGDOMS_BANQI_SCORE_TARGET,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiPlayerView,
  type ThreeKingdomsBanqiState,
  threeKingdomsBanqiStateToDealtFen,
} from '@mistboard/game';
import { banqiPieceGhostSvg } from '../live-banqi-render.js';
import { createThreeKingdomsBanqiInteractiveBoard } from '../three-kingdoms-banqi-board.js';
import {
  animateThreeKingdomsBanqiBoardMove,
  animateThreeKingdomsBanqiReveal,
  TK_LIVE_BOARD_VIEW,
  type TkBoardArrow,
  type TkBoardMarker,
} from '../three-kingdoms-banqi-diagrams.js';
import { fillCapturedPoolWith } from './captured-pool.js';
import type { NodeShape } from './game-tree.js';
import { makeThreeKingdomsBanqiTreeAdapter } from './three-kingdoms-banqi-tree-adapter.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

export type ThreeKingdomsBanqiReviewConfig = TreeReviewConfig<
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiState,
  TkBoardArrow
>;

/** The FEN a reader may copy: the dealt FEN without its sixth field, so the
 *  Share box never spells out the deal under the face-down tiles. Pasted back,
 *  it samples a fresh deal from the pool (a five-field FEN). */
export function threeKingdomsBanqiShareFen(truth: ThreeKingdomsBanqiState): string {
  return threeKingdomsBanqiStateToDealtFen(truth).split(' ').slice(0, 5).join(' ');
}

/** Each ink's score: the points of the other ink's pieces it has taken. Read
 *  by ink, not seat, so it agrees with the board whoever moved first. */
export function threeKingdomsBanqiInkScores(
  captured: ThreeKingdomsBanqiPlayerView['captured'],
): Record<BanqiColor, number> {
  const scores: Record<BanqiColor, number> = { red: 0, black: 0 };
  for (const capture of captured) {
    scores[capture.owner === 'red' ? 'black' : 'red'] += THREE_KINGDOMS_BANQI_POINTS[capture.role];
  }
  return scores;
}

function scoreRow(host: HTMLElement, points: number, quiet: number | null): void {
  const line = document.createElement('span');
  line.className = 'tk-banqi-scores';
  line.textContent =
    quiet === null
      ? `${points} of ${THREE_KINGDOMS_BANQI_SCORE_TARGET} points`
      : `${points} of ${THREE_KINGDOMS_BANQI_SCORE_TARGET} points. Quiet moves: ${quiet}/${THREE_KINGDOMS_BANQI_NO_PROGRESS_LIMIT}.`;
  host.replaceChildren(line);
}

const adapter = makeThreeKingdomsBanqiTreeAdapter();

const presentation: TreePresentation<
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiState,
  ThreeKingdomsBanqiPlayerView,
  BanqiSeat,
  TkBoardArrow,
  TkBoardMarker
> = {
  adapter,
  engine: null,
  fen: threeKingdomsBanqiShareFen,
  boardHostClassName: 'banqi-postgame-board tk-banqi-live-board',
  boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
  defaultBoardAriaLabel: 'Three Kingdoms banqi board',
  boardAspect: TK_LIVE_BOARD_VIEW.width / TK_LIVE_BOARD_VIEW.height,
  boardCols: 10,
  boardMaxPx: 620,
  // The board is the same for both seats, so the Flip control only swaps the
  // seat rows, as on banqi.
  perspective: (flipped) => (flipped ? 'black' : 'red'),
  seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
  createBoard: (opts) => createThreeKingdomsBanqiInteractiveBoard(opts),
  animateMove: (boardEl, move, _perspective, opts) => {
    if (move.from !== move.to) animateThreeKingdomsBanqiBoardMove(boardEl, move, opts);
    else if (!opts?.reverse) animateThreeKingdomsBanqiReveal(boardEl, move.to);
  },
  shapeToArrow: (s: NodeShape): TkBoardArrow => ({
    from: s.orig as TkBoardArrow['from'],
    to: (s.dest ?? s.orig) as TkBoardArrow['to'],
    className: `xq-arrow--draw xq-shape--${s.brush}`,
  }),
  shapeToMarker: (s: NodeShape): TkBoardMarker => ({
    square: s.orig as TkBoardMarker['square'],
    kind: 'circle',
    className: `xq-shape--${s.brush}`,
  }),
  seatCaptures: (host, view, _rootView, owner) => {
    if (owner !== 'red' && owner !== 'black') return;
    fillCapturedPoolWith(host, view.captured, owner, banqiPieceGhostSvg);
  },
  // The race to 100, one row per ink: the bottom row is the ink the board
  // puts at the bottom, and it also carries the shared no-progress count.
  material: (hosts) => (truth, _rootTruth, flipped) => {
    const scores = threeKingdomsBanqiInkScores(truth.captures);
    const bottom: BanqiColor = flipped ? 'black' : 'red';
    const top: BanqiColor = bottom === 'red' ? 'black' : 'red';
    scoreRow(hosts.top, scores[top], null);
    scoreRow(hosts.bottom, scores[bottom], truth.noProgressClock);
  },
  moveGlyphMarker: (move: ThreeKingdomsBanqiMove, glyph): TkBoardMarker => ({
    square: move.to,
    kind: 'glyph',
    text: glyph.text,
    className: `xq-marker--${glyph.tone}`,
  }),
};

export function mountThreeKingdomsBanqiReview(
  root: HTMLElement,
  config: ThreeKingdomsBanqiReviewConfig,
): TreeReviewHandle {
  if (!config.root) throw new Error('three kingdoms banqi review needs a dealt root position');
  return mountTreeReview(root, presentation, config);
}
