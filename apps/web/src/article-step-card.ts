// The article's step-through board in the study embed's card.
//
// The anti and horde xiangqi articles (and the other raw-svg steppers) used to
// step a column-wide board with a counter and a narrative line under it, which
// read as a widget dropped into the prose. The embed card (embed/embed-card.ts)
// is what a framed study looks like everywhere else: a title line, a bordered
// card with seat rows above and below the board on its mat, and a rail beside
// the board holding the score sheet and the result foot. This builds that card
// inline, from the same classes (embed.css), with the shared compact move bar,
// rather than mounting the embed: mountEmbedCard listens on the
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
// The card moves only on interaction: nothing animates on its own. A one-step
// move glides the piece that moved (board-anim.ts): the caller names the move
// into each position, the painted board keys its pieces in slots that carry
// their centres (board-piece-slot.ts), and the card reads both, so it needs no
// board geometry of its own. A caller on a fog surface names no moves.

import './review/move-list.css';
import './embed/embed.css';
import type { ArticleLang } from './article-i18n.js';
import { glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';
import { findPieceSlot, pieceSlotCentre } from './board-piece-slot.js';
import type { EmbedSeat } from './embed/embed-card.js';
import { createMoveNavBar, moveNavKeyAction } from './move-nav-bar.js';
import { REPLAY_STEPS } from './replay-icons.js';
import { replayStepperCopy } from './replay-stepper-copy.js';
import { createMoveList, type MoveList, type MoveListEntry } from './review/move-list.js';
import { seatDiscEl } from './seat-disc.js';

export type StepCardMove = { label: string; note?: string };

/** The squares a move into a position went from and to, as the painted board
 *  keys its piece slots. A flip in place has from === to. */
export type StepCardMotion = { from: string; to: string };

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
  /** The move into position `index` (index >= 1), for the glide; null for a
   *  step with no single moving piece (a drop, a figure). Without it the card
   *  repaints and nothing glides. */
  motion?: (index: number) => StepCardMotion | null;
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
  const controller = new AbortController();
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

  const nav = createMoveNavBar({
    density: 'compact',
    // First/last are direct controls now; this card has no extra actions.
    menu: false,
    onFirst: () => jump(0),
    onPrev: () => jump(index - 1),
    onNext: () => jump(index + 1),
    onLast: () => jump(max()),
    signal: controller.signal,
  });
  // Article renderers supply their language independently of the UI locale.
  const labels = {
    first: copy.firstMove,
    prev: copy.previousMove,
    next: copy.nextMove,
    latest: copy.lastMove,
  };
  for (const { action } of REPLAY_STEPS) {
    nav.buttons[action].setAttribute('aria-label', labels[action]);
    nav.buttons[action].title = labels[action];
  }
  nav.el.append(status);

  card.addEventListener(
    'keydown',
    (event) => {
      const action = moveNavKeyAction(event);
      if (!action) return;
      // Claim even a bounded step so a page-wide listener never moves another board.
      event.preventDefault();
      nav.buttons[action].click();
    },
    { signal: controller.signal },
  );

  function paint(from: number | null): void {
    const glide = glideFor(from);
    // The origin is read from the board still showing `from`: the piece stands
    // there now, and may not after the repaint.
    const origin = glide ? pieceSlotCentre(findPieceSlot(board, glide.origin)) : null;
    game.paint(board, index, from);
    if (glide && origin) {
      const slot = findPieceSlot(board, glide.settle);
      const rest = pieceSlotCentre(slot);
      if (slot && rest) glideSvgPiece(slot, origin.x - rest.x, origin.y - rest.y, glide.duration);
    }
    // A landscape board (banqi) takes the room a narrower sheet column frees.
    const view = board.querySelector('svg')?.getAttribute('viewBox')?.split(/\s+/).map(Number);
    el.classList.toggle('article-step-card--landscape', !!view && view[2]! / view[3]! > 1.2);
    nav.setBounds({ atStart: index === 0, atEnd: index === max() });
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

  // One step either way glides the mover; a step back runs the move in reverse.
  // A longer jump, a flip in place, or a step with no motion only repaints.
  function glideFor(
    from: number | null,
  ): { origin: string; settle: string; duration: number } | null {
    if (from === null || !game.motion || Math.abs(index - from) !== 1) return null;
    const forward = index > from;
    const move = game.motion(forward ? index : from);
    if (!move || move.from === move.to) return null;
    const duration = pieceAnimationDurationMs();
    if (duration <= 0) return null;
    return forward
      ? { origin: move.from, settle: move.to, duration }
      : { origin: move.to, settle: move.from, duration };
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
    boardCol.append(nav.el);
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
      build();
    },
    repaint() {
      game.paint(board, index, null);
    },
    destroy() {
      controller.abort();
      el.replaceChildren();
    },
  };
}
