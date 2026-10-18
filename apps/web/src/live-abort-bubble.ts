// The pre-first-move abort countdown as a bubble ON the board, on a phone (600px
// and under). In the phone room every px under the board belongs to the seat
// row, the move strip and the action bar; the countdown's own line pushed the
// bar off a 320x568 screen at game start (#576). So there it shows over the
// board, the repo's way of telling a player something transient (CLAUDE.md,
// reference live-banqi-chase-bubble.ts): absolutely positioned in the board
// stage, clamped inside the board, pointer-events none, so it moves nothing and
// never blocks a tap. Desktop and tablet keep the line in the column.
//
// It mirrors the column's [data-abort-countdown] span rather than owning the
// countdown: both room stacks (live-game-controls.ts, variant-tenant
// room-chrome.ts) keep creating, ticking (already localized) and removing that
// span, and this follows it. The span is hidden only while the bubble shows it
// ([data-board-bubble], live-abort-bubble.css). Timing only: it carries no
// board state, so nothing here can leak hidden information.

import './live-abort-bubble.css';
import type { Box } from './live-banqi-chase-bubble.js';

/** The phone room breakpoint (live-review.css `@media (max-width: 600px)`). */
export const PHONE_ROOM_QUERY = '(max-width: 600px)';

// Breathing room between the bubble and the board edge.
const EDGE_PAD = 6;

/**
 * Centre the bubble on the board (the river on a xiangqi-family board, empty at
 * game start), clamped so it never crosses any board edge. Pure geometry in the
 * stage's coordinate space; exported for tests.
 */
export function placeBoardCenterBubble(
  board: Box,
  bubble: { width: number; height: number },
): { left: number; top: number } {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(min, max), Math.max(min, value));
  const left = clamp(
    board.left + (board.width - bubble.width) / 2,
    board.left + EDGE_PAD,
    board.left + board.width - EDGE_PAD - bubble.width,
  );
  const top = clamp(
    board.top + (board.height - bubble.height) / 2,
    board.top + EDGE_PAD,
    board.top + board.height - EDGE_PAD - bubble.height,
  );
  return { left, top };
}

export type AbortCountdownBubble = {
  /** Mirror the column countdown now (the observers call this on their own). */
  sync(): void;
  disconnect(): void;
};

/**
 * `isPhone` overrides the breakpoint check (tests); by default it follows
 * PHONE_ROOM_QUERY and re-syncs when the viewport crosses it.
 */
export function attachAbortCountdownBubble(
  gameControls: HTMLElement,
  stage: HTMLElement,
  options: { isPhone?: () => boolean } = {},
): AbortCountdownBubble {
  let el: HTMLElement | null = null;
  const media =
    !options.isPhone && typeof matchMedia === 'function' ? matchMedia(PHONE_ROOM_QUERY) : null;
  const isPhone = options.isPhone ?? (() => media?.matches === true);
  const resize =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => position());
  const mutations = new MutationObserver(() => sync());
  const onMedia = () => sync();

  function position(): void {
    if (!el) return;
    const surface = stage.querySelector('[data-board] svg') ?? stage.querySelector('[data-board]');
    if (!surface) return;
    const stageRect = stage.getBoundingClientRect();
    const boardRect = surface.getBoundingClientRect();
    // Not laid out (jsdom, a hidden tab): leave it where CSS puts it.
    if (boardRect.width === 0) return;
    el.style.setProperty('--abort-bubble-board-max', `${Math.max(0, boardRect.width - 12)}px`);
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
    if (!el) return;
    resize?.unobserve(stage);
    el.remove();
    el = null;
  }

  function sync(): void {
    const source = gameControls.querySelector<HTMLElement>('[data-abort-countdown]');
    if (!source || !isPhone()) {
      if (source) delete source.dataset.boardBubble;
      removeBubble();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'abort-bubble';
      el.dataset.abortBubble = '';
      resize?.observe(stage);
    }
    if (el.parentElement !== stage) stage.append(el);
    const text = source.textContent ?? '';
    if (el.textContent !== text) el.textContent = text;
    source.dataset.boardBubble = '';
    position();
  }

  mutations.observe(gameControls, { childList: true, subtree: true, characterData: true });
  media?.addEventListener('change', onMedia);
  sync();

  return {
    sync,
    disconnect() {
      mutations.disconnect();
      media?.removeEventListener('change', onMedia);
      resize?.disconnect();
      removeBubble();
    },
  };
}
