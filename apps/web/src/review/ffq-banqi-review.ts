import {
  type BanqiMove,
  type BanqiSeat,
  FFQ_BANQI_SPEC_ID,
  FFQ_BANQI_START_HP,
  type FFQBanqiPlayerView,
} from '@mistboard/game';
import { createBanqiInteractiveBoard } from '../banqi-board.js';
import { ffqBanqiBoardView } from '../ffq-banqi-board.js';
import { variantDisplayLabel } from '../game-display.js';
import { t } from '../i18n/catalog.js';
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
    boardCols: 10,
    boardMaxPx: 560,
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
    seatCaptures: (host, view, _root, owner) => {
      if (owner !== 'red' && owner !== 'black') return;
      fillCapturedPoolWith(host, view.captured, owner, banqiPieceGhostSvg);
      const seat = owner === 'red' ? 'black' : 'red';
      const hp = document.createElement('span');
      hp.className = 'ffq-banqi-review-hp';
      hp.dataset.side = seat;
      hp.textContent = t('live.ffq.hp', { hp: view.hp[seat], max: FFQ_BANQI_START_HP });
      const damage = snapshots[view.ply]?.damage[seat] ?? 0;
      if (damage) hp.textContent += ` · ${damage} damage`;
      host.append(hp);
    },
  };
  return mountTreeReview(root, presentation, config);
}
