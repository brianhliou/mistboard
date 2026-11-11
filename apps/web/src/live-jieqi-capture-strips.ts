import type { LiveRefs } from './live-state.js';
import './review/seat-labels.css';
import './live-jieqi-capture-strips.css';

/** Desktop: each side's face-down odds row moves into an absolute strip above
 * or below the board (review's seat strips); the captured pieces stay in the
 * right column like every other variant. Moving the nodes back at the phone
 * breakpoint preserves the player bars, their render refs, and the compact
 * phone odds layout. */
export function mountJieqiCaptureStrips(
  refs: Pick<LiveRefs, 'board' | 'capturesTop' | 'capturesBottom'>,
  media = window.matchMedia('(min-width: 800px)'),
): void {
  const stage = refs.board.closest<HTMLElement>('.board-stage');
  const console = refs.capturesTop.parentElement;
  if (!stage || !console) return;
  const strips = (['top', 'bottom'] as const).flatMap((position) => {
    const odds = console.querySelector<HTMLElement>(`[data-reveal-odds="${position}"]`);
    if (!odds) return [];
    const strip = document.createElement('div');
    strip.className = `review-seat review-seat--${position} jieqi-capture-strip`;
    const home = document.createComment(`jieqi ${position} odds`);
    odds.before(home);
    return [{ strip, odds, home }];
  });
  const reserve = strips.map(({ strip }) => reserveStripHeight(stage, strip));
  const place = (desktop: boolean): void => {
    stage.classList.toggle('jieqi-capture-stage', desktop);
    for (const { strip, odds, home } of strips) {
      if (desktop) {
        stage.append(strip);
        strip.append(odds);
      } else {
        home.after(odds);
        strip.remove();
      }
    }
    for (const update of reserve) update();
  };
  place(media.matches);
  media.addEventListener('change', (event) => place(event.matches));
}

/** Publish a strip's height to the room (--jieqi-strip-top-h or
 * --jieqi-strip-bottom-h), so the board reserves a second row only while the
 * odds have wrapped onto one. Off the page (the phone layout) it is cleared and
 * the CSS default of one row applies. */
function reserveStripHeight(stage: HTMLElement, strip: HTMLElement): () => void {
  const name = strip.classList.contains('review-seat--top')
    ? '--jieqi-strip-top-h'
    : '--jieqi-strip-bottom-h';
  let last = '';
  const update = (): void => {
    const room = stage.closest<HTMLElement>('.live-route--jieqi') ?? document.documentElement;
    const height = strip.isConnected ? Math.ceil(strip.getBoundingClientRect().height) : 0;
    const value = height > 0 ? `${height}px` : '';
    if (value === last) return;
    last = value;
    if (value) room.style.setProperty(name, value);
    else room.style.removeProperty(name);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(strip);
  return update;
}
