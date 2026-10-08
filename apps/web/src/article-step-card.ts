// The article's step-through board in the study embed's card.
//
// The anti and horde xiangqi articles (and the other raw-svg steppers) used to
// step a column-wide board with a counter and a narrative line under it, which
// read as a widget dropped into the prose. The embed card (embed/embed-card.ts)
// is what a framed study looks like everywhere else: a title line, a bordered
// card with seat rows above and below the board on its mat, a three-button bar
// (back, a menu, forward), and a rail beside the board holding the score sheet
// and the result foot. This builds that card inline, from the same classes
// (embed.css), rather than mounting the embed: mountEmbedCard listens on the
// document for arrow keys, fits itself to an iframe's box and posts its height
// to the parent, none of which is right for a board sitting in an article
// beside other boards. Keys here are scoped to the card, and its height comes
// from the column width.
//
// A step is whatever the caller paints into the board host: a pre-rendered
// diagram or a kernel-replayed position. With moves the rail is the score
// sheet and a move's note sits under its row, as in a study; without them
// (a figure stepped through frames, not a game) the rail is the step's text
// and a step count.
//
// The card moves only on interaction: nothing animates on its own.

import './review/move-list.css';
import './embed/embed.css';
import type { ArticleLang } from './article-i18n.js';
import type { EmbedSeat } from './embed/embed-card.js';
import { replayStepperCopy } from './replay-stepper-copy.js';
import { createMoveList, type MoveList, type MoveListEntry } from './review/move-list.js';
import { seatDiscEl } from './seat-disc.js';

export type StepCardMove = { label: string; note?: string };

export type StepCardGame = {
  /** Positions 0..count-1; with moves, position i is the one after i moves. */
  count: number;
  /** Draw position `index` into the board host. `from` is the position shown
   *  before (null on the first paint), for a renderer that glides a piece. */
  paint: (board: HTMLElement, index: number, from: number | null) => void;
  /** moves[i] leads to position i+1. With moves the rail is a score sheet. */
  moves?: readonly StepCardMove[];
  /** Above the sheet: what the start position is. */
  intro?: string;
  /** Without moves: the text for each position, shown in the rail. */
  narratives?: ReadonlyArray<string | undefined>;
  /** Seat rows above (second) and below (first) the board. Optional: a stepped
   *  figure has no players. */
  seats?: { first: EmbedSeat; second: EmbedSeat };
  /** The result foot ("Red wins"); without one the foot counts the steps. */
  result?: string;
  /** Open on this position; default 0. */
  start?: number;
  /** The second seat moved first: the sheet opens in its column. */
  firstMover?: 'a' | 'b';
};

export type StepCardOptions = {
  lang?: ArticleLang;
  /** The title line above the card; a second line is the event. */
  title?: string;
  subtitle?: string;
  /** A control in the title line (the game picker). */
  picker?: HTMLElement;
  /** A board wider than tall (several boards side by side): the board takes the
   *  card's width and the rail goes under it. */
  wide?: boolean;
};

export type StepCard = {
  el: HTMLElement;
  /** Swap the game in place (the picker), back on its start position. */
  setGame: (game: StepCardGame) => void;
  /** Repaint the current position (piece set or board layout changed). */
  repaint: () => void;
  destroy: () => void;
};

// Drawn, not typed, as in embed-card.ts: the media glyphs and the arrows
// resolve from different fallback fonts and never match in weight.
const ICON = {
  prev: '<path d="M11 4.3v7.4L4.9 8z"/>',
  next: '<path d="M5 4.3v7.4L11.1 8z"/>',
  menu: '<circle cx="8" cy="3.2" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="12.8" r="1.5"/>',
} as const;

function control(icon: keyof typeof ICON, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'embed-card-control';
  button.setAttribute('aria-label', label);
  button.innerHTML =
    '<svg class="embed-card-control-icon" viewBox="0 0 16 16" width="16" height="16" ' +
    `aria-hidden="true" focusable="false" fill="currentColor">${ICON[icon]}</svg>`;
  button.addEventListener('click', onClick);
  return button;
}

function seatRow(seat: EmbedSeat, side: 'first' | 'second'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'embed-card-seat';
  el.dataset.seat = side;
  const name = document.createElement('span');
  name.className = 'embed-card-seat-name';
  name.textContent = seat.name;
  el.append(seatDiscEl(seat.ink, 'embed-seat-disc'), name);
  return el;
}

export function createStepCard(options: StepCardOptions, initial: StepCardGame): StepCard {
  const copy = replayStepperCopy(options.lang, 'xiangqi');
  const el = document.createElement('div');
  el.className = 'article-step-card';
  if (options.wide) el.classList.add('article-step-card--wide');

  if (options.title || options.picker) {
    const header = document.createElement('div');
    header.className = 'embed-card-header article-step-card-header';
    if (options.title) {
      const title = document.createElement('div');
      title.className = 'article-step-card-title';
      title.textContent = options.title;
      header.append(title);
    }
    if (options.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'article-step-card-subtitle';
      sub.textContent = options.subtitle;
      header.append(sub);
    }
    if (options.picker) header.append(options.picker);
    el.append(header);
  }

  const card = document.createElement('div');
  card.className = 'embed-card';
  card.tabIndex = 0;
  const boardCol = document.createElement('div');
  boardCol.className = 'embed-card-board';
  const board = document.createElement('div');
  board.className = 'embed-board article-step-card-board';
  const controls = document.createElement('div');
  controls.className = 'embed-card-controls';
  const status = document.createElement('span');
  status.className = 'embed-card-status';
  status.setAttribute('aria-live', 'polite');

  const rail = document.createElement('div');
  rail.className = 'embed-card-rail';
  const railInner = document.createElement('div');
  railInner.className = 'embed-card-rail-inner';
  const movesRoot = document.createElement('div');
  movesRoot.className = 'embed-card-moves';
  const foot = document.createElement('div');
  foot.className = 'embed-card-result';
  railInner.append(movesRoot, foot);
  rail.append(railInner);
  card.append(boardCol, rail);
  el.append(card);

  let game = initial;
  let index = 0;
  let moveList: MoveList | null = null;
  let narrative: HTMLElement | null = null;
  const max = (): number => Math.max(0, game.count - 1);

  const menu = document.createElement('div');
  menu.className = 'embed-card-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const closeMenu = (): void => {
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  };
  const menuButton = control('menu', copy.moreActions, () => {
    const open = menu.hidden;
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLElement>('.embed-card-menu-item')?.focus();
  });
  menuButton.setAttribute('aria-haspopup', 'true');
  menuButton.setAttribute('aria-expanded', 'false');
  const menuItem = (label: string, onSelect: () => void): void => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'embed-card-menu-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    item.addEventListener('click', () => {
      closeMenu();
      onSelect();
    });
    menu.append(item);
  };
  menuItem(copy.backToStart, () => jump(0));
  menuItem(copy.jumpToEnd, () => jump(max()));
  const onDocClick = (event: MouseEvent): void => {
    if (!menu.hidden && !controls.contains(event.target as Node)) closeMenu();
  };
  document.addEventListener('click', onDocClick);
  controls.append(
    control('prev', copy.previousMove, () => jump(index - 1)),
    menuButton,
    control('next', copy.nextMove, () => jump(index + 1)),
    status,
    menu,
  );

  card.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft') jump(index - 1);
    else if (event.key === 'ArrowRight') jump(index + 1);
    else if (event.key === 'Home') jump(0);
    else if (event.key === 'End') jump(max());
    else if (event.key === 'Escape' && !menu.hidden) closeMenu();
    else return;
    event.preventDefault();
  });

  function paint(from: number | null): void {
    game.paint(board, index, from);
    status.textContent = `${index} / ${max()}`;
    if (moveList) {
      // The embed's foot: the game's result, standing, whatever ply is shown.
      moveList.update(index, jump);
      foot.textContent = game.result ?? '';
      foot.hidden = !game.result;
    } else if (narrative) {
      narrative.textContent = game.narratives?.[index] ?? '';
      foot.textContent = `${index + 1} / ${game.count}`;
      foot.hidden = false;
    }
  }

  function jump(target: number): void {
    const next = Math.max(0, Math.min(max(), target));
    if (next === index) return;
    const from = index;
    index = next;
    paint(from);
  }

  function build(): void {
    boardCol.replaceChildren();
    if (game.seats) boardCol.append(seatRow(game.seats.second, 'second'));
    boardCol.append(board);
    if (game.seats) boardCol.append(seatRow(game.seats.first, 'first'));
    boardCol.append(controls);
    card.classList.toggle('article-step-card-seated', Boolean(game.seats));

    moveList = null;
    narrative = null;
    if (game.moves && game.moves.length > 0) {
      const entries: MoveListEntry[] = game.moves.map((m, i) => ({
        ply: i + 1,
        label: m.label,
        ...(m.note ? { note: m.note } : {}),
      }));
      moveList = createMoveList(entries, game.firstMover ? { firstMover: game.firstMover } : {});
      if (game.intro) {
        const intro = document.createElement('li');
        intro.className = 'article-step-card-intro';
        intro.textContent = game.intro;
        moveList.el.querySelector('.review-move-list__rows')?.prepend(intro);
      }
      movesRoot.replaceChildren(moveList.el);
      rail.classList.remove('article-step-card-rail-text');
    } else {
      narrative = document.createElement('p');
      narrative.className = 'article-step-card-narrative';
      movesRoot.replaceChildren(narrative);
      rail.classList.add('article-step-card-rail-text');
    }
    index = Math.max(0, Math.min(max(), game.start ?? 0));
    paint(null);
  }

  build();

  return {
    el,
    setGame(next) {
      game = next;
      closeMenu();
      build();
    },
    repaint() {
      game.paint(board, index, null);
    },
    destroy() {
      document.removeEventListener('click', onDocClick);
      el.replaceChildren();
    },
  };
}
