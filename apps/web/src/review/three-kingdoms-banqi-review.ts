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
  THREE_KINGDOMS_BANQI_POINTS,
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
import { tkPoints } from '../three-kingdoms-banqi-score.js';
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

// The live room's wording (three-kingdoms-banqi-score.ts), beside the seat's
// captures as the room shows it beside the name: "45 pts". In the seat row,
// not the right rail, so the move list keeps the board's top and height as on
// every other review page.
function seatPoints(points: number): HTMLElement {
  const line = document.createElement('span');
  line.className = 'tk-banqi-scores';
  line.textContent = tkPoints(points);
  return line;
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
  boardMaxPx: 560,
  reserveGaugeTrack: true,
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
  // The pieces this seat took, then its points. `owner` is the ink of the
  // pieces in the row, so the points are the other ink's score.
  seatCaptures: (host, view, _rootView, owner) => {
    if (owner !== 'red' && owner !== 'black') return;
    fillCapturedPoolWith(host, view.captured, owner, banqiPieceGhostSvg);
    const scorer: BanqiColor = owner === 'red' ? 'black' : 'red';
    host.append(seatPoints(threeKingdomsBanqiInkScores(view.captured)[scorer]));
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
