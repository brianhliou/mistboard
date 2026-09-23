// The iconic lichess on-board eval bar: a thin vertical gauge flush against the
// board. The light fill grows from the Red end (bottom by default) in proportion
// to Red's win probability; a midline marks equality. The larger engine-panel
// headline carries the numeric evaluation, so this narrow gauge stays visual.
// Driven by the engine panel's live updates (setEval).
//
// The board is sized by the review-stage's viewport fit and is narrower than its
// slot, so the bar is absolutely positioned inside the board host and aligned to
// the board's measured rect (alignTo), re-run on a ResizeObserver — it can't drift
// when the board rescales.
import '../../seat-disc-ink.css';
import './eval-bar.css';
import { winProbRed } from './eval-format.js';

const BAR_WIDTH_PX = 20;
const BAR_GAP_PX = 8;
export interface EvalBar {
  el: HTMLElement;
  /** Update from a fixed-side score (normally Red; P1 while flip colors are unbound). */
  setEval(cp: number | null, mate: number | null): void;
  /** Use a seat-neutral palette while flip-game colors are still unbound. */
  setNeutral(neutral: boolean): void;
  /** Show a neutral "thinking" state without a number. */
  setLoading(): void;
  /** Back to the empty even state. */
  reset(): void;
  /** Engine off: dim the bar so it reads as inactive rather than "0.0". */
  setIdle(idle: boolean): void;
  /** Match board orientation: when flipped, Red sits at the top. */
  setFlipped(flipped: boolean): void;
  /** Align the bar to `anchorEl` (default the board), matching the board's height,
   *  and keep it aligned as the board rescales. `side` places the bar just outside
   *  that anchor: 'left' (default) or 'right'. Pass the flank host as the anchor when
   *  capture columns sit beside the board, so the bar clears them. */
  observe(boardEl: HTMLElement, anchorEl?: HTMLElement, side?: 'left' | 'right'): void;
}

export function createEvalBar(): EvalBar {
  const el = document.createElement('div');
  el.className = 'review-eval-bar';
  el.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('div');
  fill.className = 'review-eval-bar__fill';
  // The red equality line is the only ruler mark. The fill uses a nonlinear
  // advantage curve, so unlabelled subdivisions cannot honestly represent a
  // fixed number of centipawns (or a calibrated win probability).
  el.append(fill);

  function applyProb(prob: number): void {
    fill.style.height = `${(prob * 100).toFixed(1)}%`;
    el.classList.toggle('review-eval-bar--red-ahead', prob >= 0.5);
  }

  function setEval(cp: number | null, mate: number | null): void {
    el.classList.remove('review-eval-bar--loading');
    applyProb(winProbRed(cp, mate));
  }

  function setNeutral(neutral: boolean): void {
    el.classList.toggle('review-eval-bar--neutral', neutral);
  }

  function setLoading(): void {
    el.classList.add('review-eval-bar--loading');
  }

  function reset(): void {
    el.classList.remove('review-eval-bar--loading');
    applyProb(0.5);
  }

  function setIdle(idle: boolean): void {
    el.classList.toggle('review-eval-bar--idle', idle);
  }

  function setFlipped(flipped: boolean): void {
    el.classList.toggle('review-eval-bar--flipped', flipped);
  }

  function alignTo(boardEl: HTMLElement, anchorEl: HTMLElement, side: 'left' | 'right'): void {
    const host = el.parentElement;
    if (!host) return;
    const board = boardEl.getBoundingClientRect();
    if (board.height === 0) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    // Vertical extent follows the board; horizontally the bar sits just outside the
    // anchor (the board, or the flank host when capture columns are beside it) on the
    // requested side — 'right' hugs the board area toward the move list.
    el.style.top = `${board.top - hostRect.top}px`;
    el.style.height = `${board.height}px`;
    el.style.left =
      side === 'right'
        ? `${anchorRect.right - hostRect.left + BAR_GAP_PX}px`
        : `${anchorRect.left - hostRect.left - BAR_WIDTH_PX - BAR_GAP_PX}px`;
  }

  function observe(
    boardEl: HTMLElement,
    anchorEl: HTMLElement = boardEl,
    side: 'left' | 'right' = 'left',
  ): void {
    const run = () => alignTo(boardEl, anchorEl, side);
    run();
    requestAnimationFrame(run);
    // The review layout sizes the board via a viewport fit at rAF + 60ms + 260ms;
    // re-align just after each so we measure the final board rect (observe() is
    // called before the board is attached, so the first passes read height 0).
    setTimeout(run, 80);
    setTimeout(run, 300);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(run).observe(boardEl);
    }
    window.addEventListener('resize', run);
  }

  reset();
  return { el, setEval, setNeutral, setLoading, reset, setIdle, setFlipped, observe };
}
