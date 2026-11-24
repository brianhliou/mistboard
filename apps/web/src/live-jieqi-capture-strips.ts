import type { JieqiPieceRole } from '@mistboard/game';
import type { RevealOddsSide } from './jieqi-reveal-odds.js';
import { renderPoolRow } from './live-jieqi-reveal-odds.js';
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
    strip.append(stripSizer());
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

/** The fullest line a side's odds can hold: every role a face-down piece can
 * be, two-digit counts and percentages. Never game data, so it says nothing
 * about the deal. */
const SIZER_SIDE: RevealOddsSide = {
  color: 'red',
  entries: (['chariot', 'horse', 'elephant', 'advisor', 'cannon', 'soldier'] as const).map(
    (role: JieqiPieceRole) => ({ role, count: 2, probability: 0.88 }),
  ),
  unseen: 15,
  takenUnseen: 15,
  faceDown: 15,
};

/** An invisible copy of the fullest odds line, laid in the same grid cell as
 * the real row (live-jieqi-capture-strips.css). The strip's height is the
 * taller of the two, so it depends on the strip's width only: the line keeps
 * its height whether that side has six roles face-down, one, or none, and the
 * board, the game card and the right column never move as the pool empties.
 * Measuring the real row instead shrank the strip at the last flip (38px to
 * the 30px floor on a wide board), and the board grew into the space. */
function stripSizer(): HTMLElement {
  const sizer = document.createElement('div');
  renderPoolRow(sizer, SIZER_SIDE, () => '');
  sizer.className = 'jieqi-capture-strip__sizer';
  sizer.removeAttribute('aria-label');
  delete sizer.dataset.ink;
  sizer.setAttribute('aria-hidden', 'true');
  for (const chip of sizer.querySelectorAll('[role="img"]')) {
    chip.removeAttribute('role');
    chip.removeAttribute('aria-label');
  }
  return sizer;
}

/** Publish a strip's height to the room (--jieqi-strip-top-h or
 * --jieqi-strip-bottom-h), so the board reserves a second row only where the
 * fullest odds line wraps onto one at this width. Off the page (the phone
 * layout) it is cleared and the CSS default of one row applies. */
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
