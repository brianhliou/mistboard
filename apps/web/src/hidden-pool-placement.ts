import type { LiveRefs } from './live-state.js';

// The face-down tally ("still face-down") goes under the board in the centre
// column for the flip variants whose board leaves room below it (banqi's wide
// 8x4 strip, flip jungle's 4x4 square), from the two-column layout up: the
// centre column has the width, and the right rail needs its height for the
// table (2026-10-02 incident: a full rail clipped Resign). A phone stacks the
// seat row right under the board, so there the tally stays at the foot of the
// table. The ref is kept, so the route's material renderer paints the same
// node wherever it is. Styles: live-review.css .hidden-pool--under-board.
export const POOL_UNDER_BOARD_QUERY = '(min-width: 800px)';

export function placeHiddenPoolUnderBoard(
  refs: Pick<LiveRefs, 'board' | 'hiddenPool'>,
  media: Pick<MediaQueryList, 'matches' | 'addEventListener'> = window.matchMedia(
    POOL_UNDER_BOARD_QUERY,
  ),
): void {
  const center = refs.board.closest<HTMLElement>('.review-shell__center');
  const home = refs.hiddenPool.parentElement;
  if (!center || !home) return;
  const homeNext = refs.hiddenPool.nextSibling;
  const place = (underBoard: boolean): void => {
    refs.hiddenPool.classList.toggle('hidden-pool--under-board', underBoard);
    if (underBoard) center.append(refs.hiddenPool);
    else home.insertBefore(refs.hiddenPool, homeNext);
  };
  place(media.matches);
  media.addEventListener('change', (event) => place(event.matches));
}
