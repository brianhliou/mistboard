/**
 * One move-navigation bar for every surface that steps through moves (#523).
 *
 * Five equal columns: first, previous, next, last, and a ☰ menu that holds the
 * page's extras (flip board, the opening book, analyse, and whatever else the
 * surface offers). The look is the live room's band: a flat strip on
 * --site-panel-soft with hairlines above and below, bold filled transport marks,
 * disabled at 35% opacity.
 *
 * - `liveGlow`: on live surfaces only (live room, TV), the Last button lights
 *   in the brand colour while it is enabled, which is exactly "scrubbed back
 *   from the live position". Review never glows: there you are nearly always
 *   stepped back from the end.
 * - The four step buttons keep `data-replay="first|prev|next|latest"`, so the
 *   live replay controllers, TV and the visual-check script that find them by
 *   that attribute keep working.
 * - `density`: 'band' (the full bar) today; 'compact' is reserved for embeds
 *   and article steppers (phase 3), and renders the same five buttons untinted.
 *
 * The keyboard map lives here too (moveNavKeyAction, installMoveNavKeyboard):
 * ←/→ step, ↑/Home first, ↓/End last, ignored in editable targets, and ignored
 * once another listener has handled the key (defaultPrevented), so a page that
 * holds two steppers never double-steps.
 */
import { t } from './i18n/catalog.js';
import './move-nav-bar.css';
import { REPLAY_ICON_MENU, REPLAY_STEPS, type ReplayStepAction } from './replay-icons.js';

export type MoveNavAction = ReplayStepAction;

export type MoveNavMenuItem = {
  /** A function for an item whose wording depends on state it toggles. Re-read
   *  every time the menu opens. */
  label: string | (() => string);
  /** Inline SVG markup. */
  icon: string;
  onClick?: () => void;
  /** Renders the row as a link (Analyse on the live room); '' for a link whose
   *  target is set later. */
  href?: string;
  /** A toggle row (the opening book): shown pressed while this returns true. */
  pressed?: () => boolean;
  /** Extra data attributes for the row, e.g. { replayFlip: '' }. */
  dataset?: Record<string, string>;
  /** Starts hidden; a caller shows it later by clearing the row's `hidden`
   *  and calling syncMoveNavMenu. */
  hidden?: boolean;
};

export type MoveNavBarOptions = {
  density?: 'band' | 'compact';
  /** Live surfaces only: Last glows while it is enabled (scrubbed back). */
  liveGlow?: boolean;
  /** Which way the menu opens so it covers the move list: down when the bar
   *  sits above the list (live room), up when it sits below it (review). */
  menuPlacement?: 'up' | 'down';
  /** Accent header strip over the menu rows. */
  menuTitle?: string;
  menuItems?: MoveNavMenuItem[];
  /** False drops the ☰ column (a surface with no extras at all, e.g. TV): four
   *  columns rather than a menu button that could never open. */
  menu?: boolean;
  /** Step handlers. Omit them when a controller wires the buttons itself (the
   *  live rooms set each button's onclick on every render). */
  onFirst?(): void;
  onPrev?(): void;
  onNext?(): void;
  onLast?(): void;
  /** Removes the page-wide listeners (Escape, outside click) on teardown. */
  signal?: AbortSignal;
  /** Extra classes on the bar root (a surface's own hook, e.g. review-controls). */
  className?: string;
};

export type MoveNavBar = {
  el: HTMLElement;
  buttons: Record<MoveNavAction, HTMLButtonElement>;
  /** Null when the bar was built with `menu: false`. */
  menuButton: HTMLButtonElement | null;
  menu: HTMLElement | null;
  setBounds(state: { atStart: boolean; atEnd: boolean }): void;
  openMenu(): void;
  closeMenu(): void;
  isMenuOpen(): boolean;
  /** Re-reads labels and pressed states, and disables ☰ when no row is visible. */
  refreshMenu(): void;
};

type MenuRow = { el: HTMLElement; label: HTMLElement; item: MoveNavMenuItem };

const BAR_ROWS = new WeakMap<HTMLElement, () => void>();

export function createMoveNavBar(opts: MoveNavBarOptions = {}): MoveNavBar {
  const el = document.createElement('div');
  el.className = `move-nav-bar move-nav-bar--${opts.density ?? 'band'}`;
  if (opts.className) el.classList.add(...opts.className.split(/\s+/).filter(Boolean));
  el.dataset.moveNav = '';
  if (opts.liveGlow) el.dataset.liveGlow = '';

  const handlers: Record<MoveNavAction, (() => void) | undefined> = {
    first: opts.onFirst,
    prev: opts.onPrev,
    next: opts.onNext,
    latest: opts.onLast,
  };
  const buttons = {} as Record<MoveNavAction, HTMLButtonElement>;
  for (const step of REPLAY_STEPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'move-nav-bar__button';
    button.dataset.replay = step.action;
    const label = t(step.labelKey);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = step.icon;
    const handler = handlers[step.action];
    if (handler) button.addEventListener('click', handler);
    buttons[step.action] = button;
    el.append(button);
  }

  if (opts.menu === false) {
    el.classList.add('move-nav-bar--no-menu');
    return {
      el,
      buttons,
      menuButton: null,
      menu: null,
      setBounds: (state) => setStepBounds(buttons, state),
      openMenu: () => {},
      closeMenu: () => {},
      isMenuOpen: () => false,
      refreshMenu: () => {},
    };
  }

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'move-nav-bar__button move-nav-bar__menu-button';
  menuButton.dataset.moveNavMenu = '';
  menuButton.title = t('review.navMenu');
  menuButton.setAttribute('aria-label', t('review.navMenu'));
  menuButton.setAttribute('aria-haspopup', 'true');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.innerHTML = REPLAY_ICON_MENU;
  el.append(menuButton);

  const menu = document.createElement('div');
  menu.className = `move-nav-menu move-nav-menu--${opts.menuPlacement ?? 'down'}`;
  menu.hidden = true;
  if (opts.menuTitle) {
    const header = document.createElement('div');
    header.className = 'move-nav-menu__header';
    header.textContent = opts.menuTitle;
    menu.append(header);
  }
  const grid = document.createElement('div');
  grid.className = 'move-nav-menu__grid';
  menu.append(grid);
  el.append(menu);

  const rows: MenuRow[] = [];
  for (const item of opts.menuItems ?? []) {
    const row = buildMenuRow(item, () => closeMenu());
    rows.push(row);
    grid.append(row.el);
  }

  function refreshMenu(): void {
    for (const row of rows) {
      row.label.textContent = labelOf(row.item);
      if (row.item.pressed) {
        const on = row.item.pressed();
        row.el.setAttribute('aria-pressed', String(on));
        row.el.classList.toggle('move-nav-menu__item--on', on);
      }
    }
    const anyVisible = [...grid.children].some((child) => !(child as HTMLElement).hidden);
    menuButton.disabled = !anyVisible;
    if (!anyVisible) closeMenu();
  }

  function openMenu(): void {
    refreshMenu();
    if (menuButton.disabled) return;
    menu.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
  }
  function closeMenu(): void {
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  }
  menuButton.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
  const listen = opts.signal ? { signal: opts.signal } : undefined;
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !menu.hidden) closeMenu();
    },
    listen,
  );
  // A click anywhere outside the bar closes the menu, as any popup does.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!menu.hidden && event.target instanceof Node && !el.contains(event.target)) closeMenu();
    },
    listen,
  );

  BAR_ROWS.set(el, refreshMenu);
  refreshMenu();

  return {
    el,
    buttons,
    menuButton,
    menu,
    setBounds: (state) => setStepBounds(buttons, state),
    openMenu,
    closeMenu,
    isMenuOpen: () => !menu.hidden,
    refreshMenu,
  };
}

function setStepBounds(
  buttons: Record<MoveNavAction, HTMLButtonElement>,
  { atStart, atEnd }: { atStart: boolean; atEnd: boolean },
): void {
  buttons.first.disabled = atStart;
  buttons.prev.disabled = atStart;
  buttons.next.disabled = atEnd;
  buttons.latest.disabled = atEnd;
}

/** Re-sync a bar's ☰ after a caller showed or hid one of its rows directly
 *  (the live room reveals Analyse when the game ends). `node` is the bar or any
 *  element inside it. */
export function syncMoveNavMenu(node: Element | null): void {
  const bar = node?.closest<HTMLElement>('[data-move-nav]');
  if (bar) BAR_ROWS.get(bar)?.();
}

function buildMenuRow(item: MoveNavMenuItem, onAction: () => void): MenuRow {
  // A link row even before its href is known (the live room's Analyse waits for
  // the game to end), so callers can point it later.
  const row =
    item.href !== undefined ? document.createElement('a') : document.createElement('button');
  if (row instanceof HTMLAnchorElement && item.href) row.href = item.href;
  else row.type = 'button';
  row.className = 'move-nav-menu__item';
  row.hidden = item.hidden === true;
  for (const [key, value] of Object.entries(item.dataset ?? {})) row.dataset[key] = value;
  const icon = document.createElement('span');
  icon.className = 'move-nav-menu__item-icon';
  icon.innerHTML = item.icon;
  const label = document.createElement('span');
  label.className = 'move-nav-menu__item-label';
  label.textContent = labelOf(item);
  row.append(icon, label);
  // Handlers set later through `row.onclick` (the live room's flip) also close
  // the menu: this listener runs after them in the same click.
  row.addEventListener('click', () => {
    item.onClick?.();
    onAction();
  });
  return { el: row, label, item };
}

function labelOf(item: MoveNavMenuItem): string {
  return typeof item.label === 'function' ? item.label() : item.label;
}

// ── Keyboard ────────────────────────────────────────────────────────────────

/** The one step map: ←/→ step, ↑/Home first, ↓/End last. */
export function moveNavActionForKey(key: string): MoveNavAction | null {
  if (key === 'ArrowLeft') return 'prev';
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowUp' || key === 'Home') return 'first';
  if (key === 'ArrowDown' || key === 'End') return 'latest';
  return null;
}

/** Typing targets keep their keys: inputs, text areas, selects, editables. */
export function isMoveNavEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * The step a keydown asks for, or null when the event is not ours: a modifier
 * is held, the focus is typing, or another listener already handled the key
 * (defaultPrevented), which is the double-step guard. Shift is left alone so
 * Shift+arrow keeps selecting text.
 */
export function moveNavKeyAction(event: KeyboardEvent): MoveNavAction | null {
  if (event.defaultPrevented) return null;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (isMoveNavEditableTarget(event.target)) return null;
  return moveNavActionForKey(event.key);
}

export type MoveNavKeyboardHandlers = {
  stepBack(): void;
  stepForward(): void;
  toStart(): void;
  toEnd(): void;
  /** Optional: `f` flips the board. Surfaces without a flip omit it. */
  flip?(): void;
  /** Optional: when this returns false the listener stands down for that key,
   *  so arrows keep scrolling a page with nothing to step through (TV's
   *  live-follow board owns no ply). */
  enabled?(): boolean;
  /** Optional: dismiss a transient chooser (the review's variation picker). */
  escape?(): void;
  /** Optional: `a` toggles the engine's on-board arrows (lichess parity). */
  toggleArrows?(): void;
  /** Optional: Space plays the local engine's top move; false keeps Space's
   *  normal behaviour. */
  playBestMove?(): boolean;
};

/** Page-wide playback keys for a surface with one stepper (review, TV). */
export function installMoveNavKeyboard(
  handlers: MoveNavKeyboardHandlers,
  signal?: AbortSignal,
): void {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (handlers.enabled && !handlers.enabled()) return;
      const target = event.target as HTMLElement | null;
      if (isMoveNavEditableTarget(target)) return;
      const action = event.shiftKey ? null : moveNavActionForKey(event.key);
      if (action) {
        event.preventDefault();
        if (action === 'prev') handlers.stepBack();
        else if (action === 'next') handlers.stepForward();
        else if (action === 'first') handlers.toStart();
        else handlers.toEnd();
      } else if ((event.key === 'f' || event.key === 'F') && handlers.flip) {
        event.preventDefault();
        handlers.flip();
      } else if ((event.key === 'a' || event.key === 'A') && handlers.toggleArrows) {
        event.preventDefault();
        handlers.toggleArrows();
      } else if (
        (event.key === ' ' || event.code === 'Space') &&
        !event.repeat &&
        handlers.playBestMove &&
        // Focused controls keep native Space activation.
        !target?.closest('button, a, [role="button"]') &&
        handlers.playBestMove()
      ) {
        event.preventDefault();
      } else if (event.key === 'Escape' && handlers.escape) {
        event.preventDefault();
        handlers.escape();
      }
    },
    signal ? { signal } : undefined,
  );
}
