// Phone game review (600px and under, #655, #619): the game card, the
// analysis summary, Move times and Share & export leave the page for a Game
// info sheet over the board, and the chat for a Chat sheet, each opened from
// its own ☰ row, as in the live room (live-room-sheet.ts), so the page is one
// screen of board, analysis strip, bar and move strip. Wider screens keep every
// block where it was and never see the rows or the sheets
// (review-info-sheet.css).
//
// The blocks are lent, not copied: opening moves them into the sheet and
// closing puts each back where it was, so the chat keeps its one poller and
// its scroll position (the analysis Tools sheet does the same).

import './review-info-sheet.css';
import { t } from '../i18n/catalog.js';
import { REPLAY_ICON_INFO } from '../replay-icons.js';
import type { ReviewMenuItem } from './review-controls.js';
import { CHAT_LINES_EVENT, type ChatLinesDetail } from './spectator-chat.js';

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
  /** The blocks to lend, in order. Read on each open; a block that is not on
   *  the page is skipped. */
  blocks(): readonly (HTMLElement | null | undefined)[];
  /** The ☰ row and dialog name; defaults to "Game info and chat". */
  label?: string;
  /** The ☰ row's icon; defaults to the speech bubble. */
  icon?: string;
  /** Which sheet this is, on the ☰ row and the sheet (data-review-info), so
   *  a page with two can tell them apart. */
  kind?: string;
  /** After the blocks are lent, and before they go home. */
  onOpen?(): void;
  onClose?(): void;
}): ReviewInfoSheet {
  const label = opts.label ?? t('live.roomInfo');
  const kind = opts.kind ?? '';
  const sheet = document.createElement('div');
  sheet.className = 'review-info-sheet';
  sheet.dataset.reviewInfo = kind;
  sheet.hidden = true;
  const backdrop = document.createElement('div');
  backdrop.className = 'review-info-sheet__backdrop';
  const panel = document.createElement('section');
  panel.className = 'review-info-sheet__panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', label);
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
      // Nothing to lend from a block the page never showed (a review with no
      // underboard tabs, an explorer that lives elsewhere).
      if (!el?.parentNode) continue;
      homes.push({ el, parent: el.parentNode, next: el.nextSibling });
      body.append(el);
    }
    sheet.hidden = false;
    document.body.classList.add('review-info-open');
    opts.onOpen?.();
    closeButton.focus();
  }

  function close(): void {
    if (sheet.hidden) return;
    sheet.hidden = true;
    document.body.classList.remove('review-info-open');
    opts.onClose?.();
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
      label,
      icon: opts.icon ?? REPLAY_ICON_INFO,
      dataset: { reviewInfo: kind },
      onClick: () => open(),
    },
    open,
    close,
    isOpen: () => !sheet.hidden,
  };
}

/** Marks the ☰ button and the Chat row while a chat line someone else wrote
 *  arrives with the Chat sheet closed, on a phone (#619; the live room's
 *  live-room-sheet.ts does the same). The chat's own poller reports new lines
 *  (CHAT_LINES_EVENT), so lines on the page at load and the viewer's own never
 *  count, and nothing here fetches. Opening the sheet calls `clear`. */
export function attachChatUnread(opts: {
  signal: AbortSignal;
  /** The chat panel, or an ancestor its event bubbles through. */
  chat: HTMLElement;
  /** The move-nav bar holding the ☰ button and its menu rows. */
  bar: HTMLElement;
  isOpen(): boolean;
  media?: Pick<MediaQueryList, 'matches'> | null;
}): { clear(): void } {
  const media =
    opts.media !== undefined
      ? opts.media
      : typeof window.matchMedia === 'function'
        ? window.matchMedia(PHONE_QUERY)
        : null;
  const menuButton = opts.bar.querySelector<HTMLElement>('.move-nav-bar__menu-button');
  function set(unread: boolean): void {
    if (unread) opts.bar.dataset.chatUnread = '';
    else delete opts.bar.dataset.chatUnread;
    menuButton?.setAttribute(
      'aria-label',
      t(unread ? 'review.navMenuChatUnread' : 'review.navMenu'),
    );
  }
  opts.chat.addEventListener(
    CHAT_LINES_EVENT,
    (event) => {
      const detail = (event as CustomEvent<ChatLinesDetail | undefined>).detail;
      if (detail && detail.fromOthers < 1) return;
      if (media?.matches && !opts.isOpen()) set(true);
    },
    { signal: opts.signal },
  );
  return { clear: () => set(false) };
}
