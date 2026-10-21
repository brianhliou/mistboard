// "Your opponent offers a draw" as a bubble ON the board (#530), the repo's way
// of telling a player something transient (CLAUDE.md, reference
// live-banqi-chase-bubble.ts): absolutely positioned in the board stage,
// centred and clamped inside the board, pointer-events none, up for a reading
// time scaled to the text (noticeReadMs) or until the next tap on the board,
// whichever comes first. An offer arrives while the player is looking at the
// board, and a line in the side column is easy to miss.
//
// The answer stays in the column: Accept draw and Decline are buttons beside
// Resign (room-chrome.ts drawControls), not on the board. Accepting ends the
// game and cannot be taken back, so it does not sit where a player taps to
// move, and a bubble that takes taps would break the pointer-events-none rule
// every board notice keeps.
//
// Like the abort bubble (live-abort-bubble.ts) it mirrors a column element
// rather than owning state: room-chrome renders the [data-draw-offer-note]
// line while an offer from the opponent is pending, and this follows it. The
// column line stays visible, since it labels the two buttons. Each offer shows
// once: the bubble comes back only after the line has gone (the offer was
// answered or lapsed) and a new one appears. The text names no square and no
// piece, so nothing here can leak hidden information.

import { placeBoardCenterBubble } from './live-abort-bubble.js';
import { noticeReadMs } from './live-banqi-chase-bubble.js';
import './live-draw-offer-bubble.css';

export type DrawOfferBubble = {
  /** Mirror the column line now (the observer calls this on its own). */
  sync(): void;
  disconnect(): void;
};

export type DrawOfferBubbleTimers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const defaultTimers: DrawOfferBubbleTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `timers` overrides the reading-time timer (tests). */
export function attachDrawOfferBubble(
  gameControls: HTMLElement,
  stage: HTMLElement,
  options: { timers?: DrawOfferBubbleTimers } = {},
): DrawOfferBubble {
  const timers = options.timers ?? defaultTimers;
  let el: HTMLElement | null = null;
  let timer: unknown = null;
  // This offer has had its bubble (shown, timed out or tapped away).
  let shownForOffer = false;
  const mutations = new MutationObserver(() => sync());
  const onTap = () => removeBubble();

  function position(): void {
    if (!el) return;
    const surface = stage.querySelector('[data-board] svg') ?? stage.querySelector('[data-board]');
    if (!surface) return;
    const stageRect = stage.getBoundingClientRect();
    const boardRect = surface.getBoundingClientRect();
    // Not laid out (a test DOM, a hidden tab): leave it where CSS puts it.
    if (boardRect.width === 0) return;
    el.style.setProperty('--draw-bubble-board-max', `${Math.max(0, boardRect.width - 12)}px`);
    const placed = placeBoardCenterBubble(
      {
        left: boardRect.left - stageRect.left,
        top: boardRect.top - stageRect.top,
        width: boardRect.width,
        height: boardRect.height,
      },
      { width: el.offsetWidth, height: el.offsetHeight },
    );
    el.style.left = `${placed.left}px`;
    el.style.top = `${placed.top}px`;
    el.style.translate = 'none';
  }

  function removeBubble(): void {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    if (!el) return;
    stage.removeEventListener('pointerdown', onTap);
    el.remove();
    el = null;
  }

  function sync(): void {
    const source = gameControls.querySelector<HTMLElement>('[data-draw-offer-note]');
    if (!source) {
      shownForOffer = false;
      removeBubble();
      return;
    }
    const text = source.textContent ?? '';
    if (el) {
      if (el.textContent !== text) el.textContent = text;
      return;
    }
    if (shownForOffer) return;
    shownForOffer = true;
    el = document.createElement('div');
    el.className = 'draw-offer-bubble';
    el.dataset.drawOfferBubble = '';
    el.setAttribute('role', 'status');
    el.textContent = text;
    stage.append(el);
    stage.addEventListener('pointerdown', onTap);
    timer = timers.setTimeout(() => removeBubble(), noticeReadMs(text));
    position();
  }

  mutations.observe(gameControls, { childList: true, subtree: true, characterData: true });
  sync();

  return {
    sync,
    disconnect() {
      mutations.disconnect();
      removeBubble();
    },
  };
}
