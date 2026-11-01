import {
  type GomokuColor,
  type GomokuMove,
  type GomokuPlayerView,
  parseGomokuMove,
} from '@mistboard/game';
import { type GomokuBoardMarker, gomokuBoardSvg } from '../gomoku-board.js';
import type { NodeShape } from './game-tree.js';
import type { TreeBoardFactoryOptions, TreeBoardHandle } from './tree-review.js';

/** Placement input uses the displayed projection; orientation never determines
 * who may play. SVG overlays are pointer-transparent and never alter that view. */
export function createGomokuReviewBoard(
  opts: TreeBoardFactoryOptions<GomokuMove, GomokuPlayerView, GomokuColor>,
): TreeBoardHandle<GomokuPlayerView, GomokuColor, NodeShape, GomokuBoardMarker> {
  let view: GomokuPlayerView | null = null;
  let markers: readonly GomokuBoardMarker[] = [];
  const paint = () => {
    opts.board.innerHTML = view ? gomokuBoardSvg(view, opts.enabled(), markers) : '';
  };
  const place = (event: Event) => {
    const current = opts.getInteractionView();
    if (!opts.enabled() || !current || !opts.seatFor(current)) return;
    if (!(event.target instanceof Element) || !opts.board.contains(event.target)) return;
    const square = event.target.closest('[data-square]')?.getAttribute('data-square');
    const move = square ? parseGomokuMove(square) : null;
    if (move && current.legalMoves.some((legal) => legal.to === move.to))
      opts.onMove(move, current);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    place(event);
  };
  opts.board.addEventListener('click', place, { signal: opts.signal });
  opts.board.addEventListener('keydown', keydown, { signal: opts.signal });
  return {
    render(next) {
      view = next;
      paint();
    },
    // Gomoku moves have no origin/travel, so this renderer has point markers.
    setArrows() {},
    setMarkers(next) {
      markers = next;
      paint();
    },
  };
}
