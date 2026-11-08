import type { LiveRefs } from './live-state.js';
import './review/seat-labels.css';
import './live-jieqi-capture-strips.css';

/** Reuse review's absolute seat strips and the existing material/odds nodes.
 * Moving the nodes back at the phone breakpoint preserves the player bars,
 * their render refs, and the compact phone odds layout. */
export function mountJieqiCaptureStrips(
  refs: Pick<LiveRefs, 'board' | 'capturesTop' | 'capturesBottom'>,
  media = window.matchMedia('(min-width: 800px)'),
): void {
  const stage = refs.board.closest<HTMLElement>('.board-stage');
  const console = refs.capturesTop.parentElement;
  if (!stage || !console) return;
  const strips = (['top', 'bottom'] as const).map((position) => {
    const captures = position === 'top' ? refs.capturesTop : refs.capturesBottom;
    const odds = console.querySelector<HTMLElement>(`[data-reveal-odds="${position}"]`);
    const strip = document.createElement('div');
    strip.className = `review-seat review-seat--${position} jieqi-capture-strip`;
    const nodes = [captures, ...(odds ? [odds] : [])].map((node) => {
      const home = document.createComment(`jieqi ${position} strip`);
      node.before(home);
      return { node, home };
    });
    return { strip, captures, nodes };
  });
  const reserve = strips.map(({ strip }) => reserveStripHeight(stage, strip));
  const place = (desktop: boolean): void => {
    stage.classList.toggle('jieqi-capture-stage', desktop);
    for (const { strip, captures, nodes } of strips) {
      captures.classList.toggle('review-seat__material', desktop);
      if (desktop) {
        stage.append(strip);
        strip.append(...nodes.map(({ node }) => node));
      } else {
        for (const { node, home } of nodes) home.after(node);
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
