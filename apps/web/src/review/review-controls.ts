// Lichess-style playback control bar that sits BELOW the move-list box (not inside
// it): the four ply-nav buttons in the middle, and a hamburger that opens a menu
// overlay over the move list. Replaces the plain in-box scrubber on the xiangqi
// review surface; the shared linear scrubber (review-layout.ts) is untouched for
// the other variants.
//
// Every control here is live. Placeholder affordances were removed 2026-07-23
// (two disabled toolbar buttons + four muted menu rows); the bar advertises only
// what it can do, and a new entry arrives together with its implementation.

import { BookOpenText, createElement } from 'lucide';
import { t } from '../i18n/catalog.js';
import './review-controls.css';

export type ReviewMenuItem = {
  /** A function for an item whose wording depends on state it toggles (Reveal /
   *  Hide). Re-read every time the menu opens, which is enough: clicking an item
   *  closes the overlay, so a stale label is never left on screen. */
  label: string | (() => string);
  icon: string; // inline SVG markup
  onClick?: () => void;
};

export type ReviewControlsOptions = {
  /** Removes the page-wide Escape listener when the review is destroyed. */
  signal?: AbortSignal;
  onFirst(): void;
  onPrevious(): void;
  onNext(): void;
  onLast(): void;
  /** Menu overlay rows (2-col grid). Flip lives here on the review surface. */
  menuItems: ReviewMenuItem[];
  /** Opening-explorer toggle in the left tools cluster. Omitted on surfaces with
   *  no corpus behind them, which is why the button is not a permanent fixture. */
  onToggleExplorer?(open: boolean): void;
};

export type ReviewControls = {
  el: HTMLElement;
  setBounds(state: { atStart: boolean; atEnd: boolean }): void;
};

// Minimal inline icons (currentColor). Kept tiny; the CSS sizes them.
const ICONS = {
  first:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 5h2v14H6zM19 5v14l-9-7z"/></svg>',
  previous:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15 5v14l-9-7z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 5v14l9-7z"/></svg>',
  last: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 5h2v14h-2zM5 5v14l9-7z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
} as const;

// A control-bar button carrying a Lucide glyph (designer-drawn, MIT), for tools
// that deserve a real icon rather than an inline path. Same shell as iconButton.
function lucideButton(
  icon: Parameters<typeof createElement>[0],
  label: string,
  className: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.title = label;
  const svg = createElement(icon);
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  button.append(svg);
  return button;
}

function iconButton(icon: string, label: string, className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}

export function createReviewControls(opts: ReviewControlsOptions): ReviewControls {
  const el = document.createElement('div');
  el.className = 'review-controls';

  // The left cluster held two permanently-disabled placeholders (opening
  // explorer, practice with computer). Cut 2026-07-23 with the menu's muted
  // entries: neither had a surface behind it, and a control bar of dead buttons
  // costs trust on every visit. The explorer is restored below WITH its
  // implementation, and only on surfaces that pass a handler; practice with
  // computer stays cut until it has one too.

  // Center cluster: ply navigation.
  const first = iconButton(ICONS.first, 'First move', 'review-controls__nav');
  const previous = iconButton(ICONS.previous, 'Previous move', 'review-controls__nav');
  const next = iconButton(ICONS.next, 'Next move', 'review-controls__nav');
  const last = iconButton(ICONS.last, 'Last move', 'review-controls__nav');
  first.addEventListener('click', opts.onFirst);
  previous.addEventListener('click', opts.onPrevious);
  next.addEventListener('click', opts.onNext);
  last.addEventListener('click', opts.onLast);

  // Right: hamburger toggles the menu overlay.
  const menuButton = iconButton(ICONS.menu, 'Menu', 'review-controls__menu-button');
  menuButton.setAttribute('aria-expanded', 'false');

  // Left: tools. Empty when a surface offers none, which still centres the nav
  // cluster against the menu button on the right.
  const left = document.createElement('div');
  left.className = 'review-controls__group review-controls__group--tools';
  if (opts.onToggleExplorer) {
    const explorerButton = lucideButton(BookOpenText, 'Opening explorer', 'review-controls__tool');
    explorerButton.setAttribute('aria-pressed', 'false');
    explorerButton.addEventListener('click', () => {
      const open = explorerButton.getAttribute('aria-pressed') !== 'true';
      explorerButton.setAttribute('aria-pressed', String(open));
      explorerButton.classList.toggle('review-controls__tool--on', open);
      opts.onToggleExplorer?.(open);
    });
    left.append(explorerButton);
  }
  const center = document.createElement('div');
  center.className = 'review-controls__group review-controls__group--nav';
  center.append(first, previous, next, last);
  const rightGroup = document.createElement('div');
  rightGroup.className = 'review-controls__group review-controls__group--menu';
  rightGroup.append(menuButton);

  const menu = buildMenuOverlay(opts.menuItems, () => closeMenu());
  const overlay = menu.el;
  el.append(left, center, rightGroup, overlay);

  function openMenu(): void {
    menu.refreshLabels();
    overlay.hidden = false;
    menuButton.classList.add('review-controls__menu-button--open');
    menuButton.setAttribute('aria-expanded', 'true');
  }
  function closeMenu(): void {
    overlay.hidden = true;
    menuButton.classList.remove('review-controls__menu-button--open');
    menuButton.setAttribute('aria-expanded', 'false');
  }
  menuButton.addEventListener('click', () => (overlay.hidden ? openMenu() : closeMenu()));
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !overlay.hidden) closeMenu();
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  return {
    el,
    setBounds({ atStart, atEnd }) {
      first.disabled = atStart;
      previous.disabled = atStart;
      next.disabled = atEnd;
      last.disabled = atEnd;
    },
  };
}

function buildMenuOverlay(
  items: ReviewMenuItem[],
  onAction: () => void,
): { el: HTMLElement; refreshLabels(): void } {
  const overlay = document.createElement('div');
  overlay.className = 'review-menu';
  overlay.hidden = true;

  const header = document.createElement('div');
  header.className = 'review-menu__header';
  header.textContent = t('review.analysisBoard');

  const grid = document.createElement('div');
  grid.className = 'review-menu__grid';
  const labels: Array<{ el: HTMLElement; item: ReviewMenuItem }> = [];
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-menu__item';
    const icon = document.createElement('span');
    icon.className = 'review-menu__item-icon';
    icon.innerHTML = item.icon;
    const label = document.createElement('span');
    label.className = 'review-menu__item-label';
    label.textContent = menuItemLabel(item);
    labels.push({ el: label, item });
    button.append(icon, label);
    if (item.onClick) {
      button.addEventListener('click', () => {
        item.onClick?.();
        onAction();
      });
    }
    grid.append(button);
  }

  overlay.append(header, grid);
  return {
    el: overlay,
    refreshLabels() {
      for (const entry of labels) entry.el.textContent = menuItemLabel(entry.item);
    },
  };
}

function menuItemLabel(item: ReviewMenuItem): string {
  return typeof item.label === 'function' ? item.label() : item.label;
}

/** Icon set for the menu items, so callers don't hand-write SVG. One entry per
 *  item that EXISTS — the editor/learn/continue/settings icons were dropped with
 *  their placeholder menu entries on 2026-07-23. */
export const REVIEW_MENU_ICONS = {
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
