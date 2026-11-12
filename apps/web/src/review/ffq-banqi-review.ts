import {
  type BanqiColor,
  type BanqiMove,
  type BanqiSeat,
  FFQ_BANQI_SPEC_ID,
  type FFQBanqiPlayerView,
} from '@mistboard/game';
import { createBanqiInteractiveBoard } from '../banqi-board.js';
import { DISPLAY_PREFERENCES_CHANGE_EVENT } from '../display-preferences.js';
import { ffqBanqiBoardView } from '../ffq-banqi-board.js';
import { createFFQBanqiHpMeter } from '../ffq-banqi-hp.js';
import { variantDisplayLabel } from '../game-display.js';
import {
  animateBanqiBoardMove,
  animateBanqiReveal,
  type BanqiBoardArrow,
  type BanqiBoardMarker,
  banqiPieceGhostSvg,
} from '../live-banqi-render.js';
import { fillCapturedPoolWith } from './captured-pool.js';
import { type FFQBanqiReviewSnapshot, makeFFQBanqiTreeAdapter } from './ffq-banqi-tree-adapter.js';
import { mountTreeReview, type TreePresentation, type TreeReviewConfig } from './tree-review.js';

export function mountFFQBanqiReview(
  root: HTMLElement,
  snapshots: readonly FFQBanqiReviewSnapshot[],
  config: TreeReviewConfig<BanqiMove, FFQBanqiReviewSnapshot, BanqiBoardArrow>,
) {
  const presentation: TreePresentation<
    BanqiMove,
    FFQBanqiReviewSnapshot,
    FFQBanqiPlayerView,
    BanqiSeat,
    BanqiBoardArrow,
    BanqiBoardMarker
  > = {
    adapter: makeFFQBanqiTreeAdapter(snapshots, config.moves),
    engine: null,
    fen: (frame) => frame.fen,
    boardHostClassName: 'banqi-postgame-board',
    boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
    defaultBoardAriaLabel: variantDisplayLabel(FFQ_BANQI_SPEC_ID),
    boardAspect: 568 / 312,
    // Coordinates are drawn inside the board, so a toggle only needs a re-render.
    appearanceEvent: DISPLAY_PREFERENCES_CHANGE_EVENT,
    boardCols: 10,
    boardMaxPx: 560,
    // No client engine: keep the gauge's track so the columns land where
    // banqi's and Three Kingdoms' review pages put them.
    phoneForkPicker: true,
    reserveGaugeTrack: true,
    perspective: (flipped) => (flipped ? 'black' : 'red'),
    seatFor: () => null,
    createBoard: (opts) => {
      const board = createBanqiInteractiveBoard({
        ...opts,
        getInteractionView: () => null,
        seatFor: () => null,
        enabled: () => false,
        onMove: () => {},
      });
      return {
        ...board,
        render: (view, perspective) =>
          board.render(view ? ffqBanqiBoardView(view) : null, perspective),
      };
    },
    animateMove: (host, move, _pov, opts) => {
      if (move.from !== move.to) animateBanqiBoardMove(host, move, opts);
      else if (!opts?.reverse) animateBanqiReveal(host, move.to);
    },
    shapeToArrow: (shape) => ({
      from: shape.orig as BanqiBoardArrow['from'],
      to: (shape.dest ?? shape.orig) as BanqiBoardArrow['to'],
      className: `xq-shape--${shape.brush}`,
    }),
    shapeToMarker: (shape) => ({
      square: shape.orig as BanqiBoardMarker['square'],
      kind: 'circle',
      className: `xq-shape--${shape.brush}`,
    }),
    // The pieces this seat took, then its HP, as Three Kingdoms shows its
    // points. `owner` is the ink of the other seat's pieces in the row, so the
    // row and its HP belong to the other ink. Every Fanfanqi capture is public,
    // a covered one included.
    seatCaptures: (host, view, _root, owner) => {
      if (owner !== 'red' && owner !== 'black') return;
      const seat: BanqiColor = owner === 'red' ? 'black' : 'red';
      const taken = view.captured
        .filter((capture) => capture.capturedBy === seat)
        .map((capture) => ({ ...capture, takenFaceDown: capture.wasFaceDown }));
      // A cannon can take a covered piece of its own ink: it shows after the
      // other ink's, in the seat that took it.
      for (const ink of [owner, seat] as const)
        fillCapturedPoolWith(host, taken, ink, banqiPieceGhostSvg);
      host.append(createFFQBanqiHpMeter(view, seat));
    },
  };
  return mountTreeReview(root, presentation, config);
}
