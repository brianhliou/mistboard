// Phone game review (600px and under, #619 first slice #655): the game card and
// the chat leave the page for a sheet over the board, opened from the bar's ☰
// row "Game info and chat", as in the live room (live-room-sheet.ts). Wider
// screens keep both in the left rail and never see the row or the sheet
// (review-info-sheet.css).
//
// The blocks are lent, not copied: opening moves them into the sheet and
// closing puts each back where it was, so the chat keeps its one poller and
// its scroll position (the analysis Tools sheet does the same).

import './review-info-sheet.css';
import { t } from '../i18n/catalog.js';
import { REPLAY_ICON_INFO } from '../replay-icons.js';
import type { ReviewMenuItem } from './review-controls.js';

/** The phone breakpoint review-info-sheet.css switches on. */
const PHONE_QUERY = '(max-width: 600px)';

export type ReviewInfoSheet = {
  sheet: HTMLElement;
  /** The ☰ row that opens the sheet; CSS shows it below 600px only. */
  menuItem: ReviewMenuItem;
  open(): void;
  close(): void;
  isOpen(): boolean;
};

export function createReviewInfoSheet(opts: {
  signal: AbortSignal;
  /** The blocks to lend, in order (game card, then chat). Read on each open. */
  blocks(): readonly (HTMLElement | null | undefined)[];
}): ReviewInfoSheet {
  const sheet = document.createElement('div');
  sheet.className = 'review-info-sheet';
  sheet.hidden = true;
  const backdrop = document.createElement('div');
  backdrop.className = 'review-info-sheet__backdrop';
  const panel = document.createElement('section');
  panel.className = 'review-info-sheet__panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('live.roomInfo'));
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'review-info-sheet__close';
  closeButton.textContent = t('live.roomInfoClose');
  const body = document.createElement('div');
  body.className = 'review-info-sheet__body';
  panel.append(closeButton, body);
  sheet.append(backdrop, panel);

  // Where each lent block came from, to put it back on close.
  let homes: { el: HTMLElement; parent: ParentNode; next: Node | null }[] = [];

  function open(): void {
    if (!sheet.hidden) return;
    homes = [];
    for (const el of opts.blocks()) {
      if (!el) continue;
      if (el.parentNode) homes.push({ el, parent: el.parentNode, next: el.nextSibling });
      body.append(el);
    }
    sheet.hidden = false;
    document.body.classList.add('review-info-open');
    closeButton.focus();
  }

  function close(): void {
    if (sheet.hidden) return;
    sheet.hidden = true;
    document.body.classList.remove('review-info-open');
    // Last lent goes back first, so a sibling it was placed before is home.
    for (const { el, parent, next } of homes.reverse()) parent.insertBefore(el, next);
    homes = [];
  }

  closeButton.addEventListener('click', () => close(), { signal: opts.signal });
  backdrop.addEventListener('click', () => close(), { signal: opts.signal });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !sheet.hidden) close();
    },
    { signal: opts.signal },
  );
  // Turning a phone to a wide screen while the sheet is open would leave the
  // blocks in a sheet the CSS no longer shows; send them home.
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null;
  media?.addEventListener(
    'change',
    () => {
      if (!media.matches) close();
    },
    { signal: opts.signal },
  );
  opts.signal.addEventListener('abort', () => document.body.classList.remove('review-info-open'), {
    once: true,
  });

  return {
    sheet,
    menuItem: {
      label: t('live.roomInfo'),
      icon: REPLAY_ICON_INFO,
      dataset: { reviewInfo: '' },
      onClick: () => open(),
    },
    open,
    close,
    isOpen: () => !sheet.hidden,
  };
}
