// The review pages' playback bar: the shared move-nav bar (move-nav-bar.ts,
// #523) under the move list, its ☰ menu opening UPWARD over the list
// (lichess). Every per-variant review, study, analysis board and finished
// broadcast board draws this one bar; only the menu rows differ.
//
// Every control here is live. Placeholder affordances were removed 2026-07-23
// (two disabled toolbar buttons + four muted menu rows); the bar advertises only
// what it can do, and a new entry arrives together with its implementation.

import { BookOpenText, createElement } from 'lucide';
import { t } from '../i18n/catalog.js';
import { createMoveNavBar, type MoveNavMenuItem } from '../move-nav-bar.js';

export type ReviewMenuItem = MoveNavMenuItem;

export type ReviewControlsOptions = {
  /** Removes the page-wide listeners (Escape, outside click) on teardown. */
  signal?: AbortSignal;
  onFirst(): void;
  onPrevious(): void;
  onNext(): void;
  onLast(): void;
  /** Menu rows (2-col grid). Flip leads; the opening book follows it. */
  menuItems: ReviewMenuItem[];
  /** The opening book, a toggle row in the menu. Omitted on surfaces with no
   *  corpus behind them. The book starts OPEN (#523: a reader should see what
   *  was played here without hunting for it), so this is called with true while
   *  the bar is built. */
  onToggleExplorer?(open: boolean): void;
};

export type ReviewControls = {
  el: HTMLElement;
  setBounds(state: { atStart: boolean; atEnd: boolean }): void;
};

export function createReviewControls(opts: ReviewControlsOptions): ReviewControls {
  const menuItems = [...opts.menuItems];
  const onToggleExplorer = opts.onToggleExplorer;
  if (onToggleExplorer) {
    let explorerOpen = true;
    // Right after Flip: the two things a reader reaches for most.
    menuItems.splice(Math.min(1, menuItems.length), 0, {
      label: t('underboard.explorer'),
      icon: REVIEW_MENU_ICONS.book,
      dataset: { reviewExplorer: '' },
      pressed: () => explorerOpen,
      onClick: () => {
        explorerOpen = !explorerOpen;
        onToggleExplorer(explorerOpen);
      },
    });
    onToggleExplorer(true);
  }
  const bar = createMoveNavBar({
    className: 'review-controls',
    menuPlacement: 'up',
    menuTitle: t('review.analysisBoard'),
    menuItems,
    onFirst: opts.onFirst,
    onPrev: opts.onPrevious,
    onNext: opts.onNext,
    onLast: opts.onLast,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  return { el: bar.el, setBounds: bar.setBounds };
}

function lucideMarkup(icon: Parameters<typeof createElement>[0]): string {
  if (typeof document === 'undefined') return '';
  const svg = createElement(icon);
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  return svg.outerHTML;
}

/** Icon set for the menu items, so callers don't hand-write SVG. One entry per
 *  item that EXISTS — the editor/learn/continue/settings icons were dropped with
 *  their placeholder menu entries on 2026-07-23. */
export const REVIEW_MENU_ICONS = {
  // The opening book (Lucide BookOpenText, designer-drawn, MIT).
  get book(): string {
    return lucideMarkup(BookOpenText);
  },
  flip: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>',
  study:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
  clear:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6"/></svg>',
  // An eye: what the board is showing you, as against what was on it.
  reveal:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  // A magnifier: take this position somewhere it can be studied further.
  analyse:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  // A pencil: edit the position itself, not the moves.
  editor:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  // Crossed arrows: shuffle the hidden tiles into a new deal.
  newDeal:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/></svg>',
  // A pin: this facing stays put, as against the arrows of a one-off flip.
  pinView:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8V4h6v6.8l2 3.2H7Z"/></svg>',
} as const;
