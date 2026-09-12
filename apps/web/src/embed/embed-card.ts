// The one card every framed board sits in.
//
// A game and a study framed side by side in a forum thread should be one
// object with two boards, not two products that happen to rhyme. Before this
// the game embed built a card of its own and the study embed used the article
// widget's, and the two were styled to resemble each other, which is a fork
// that drifts on every change. Now the card is here, once: the title line, a
// seat row above and below the board (disc in the seat's ink, the name, the
// clock where the game has one), the board on its mat, the step controls, the
// score sheet, the result foot, and the credit link. The board is the only
// thing the caller supplies, through a mount that returns the replay handle
// shape every renderer already speaks (jump, ply count, move entries, clock at
// ply, which seat is at the bottom).
//
// The renderers that draw their own compact seat rows (the tenant showcase,
// the chess clock rows) keep drawing them; embed.css hides those inside the
// card and the card's rows take over, fed by the handle's clockAtPly. One row
// component, whatever is underneath it.

import '../review/move-list.css';
import type { ReplayHandle } from '../replay.js';
import { createMoveList, type MoveList, type MoveListEntry } from '../review/move-list.js';
import { formatClock } from '../web-utils.js';
import './embed.css';

// Below this frame width the move list drops under the board (mirrors the
// @media rule in embed.css; the two must agree or the board is sized for the
// wrong layout).
export const STACK_BELOW_PX = 480;
// Width of the move sheet beside the board. The study widget's floor for the
// same column (articles.css): a move pair at 15px, number included, fits on one
// line. At 168px the shared list truncated every coordinate move to "g3-…".
const RAIL_WIDTH_PX = 226;
// Duck Xiangqi writes a whole turn in one cell (`h10-f10@e10`), which is three
// characters and a separator wider than the coordinate move this floor was cut
// for, so at 226 the sheet ellipsised most of a duck game. Measured against the
// longest turn the board can produce: two 2-digit ranks in the move and a third
// in the duck half, 94px of text plus the cell's 12px of padding, twice, plus
// the 34px number column and the list's own 26px of padding and border.
const DUCK_RAIL_WIDTH_PX = 276;
// The card's own border, left and right (or top and bottom when stacked).
const CARD_BORDER_PX = 2;
// Two seat rows (39px each) frame the board, and the step-control row sits
// under the bottom row. Reserved out of the box height so the board never
// pushes them off the bottom.
const SEAT_ROWS_PX = 78;
const CONTROLS_PX = 39;
// In the stacked layout the sheet keeps at least this much height: the result
// foot and three rows of moves (embed.css keeps the same number).
const STACKED_MOVES_MIN_PX = 112;
// The sheet's width cap beside the board: the review page's move column. Past
// this the sheet is empty space, so the card stops growing and centres.
const RAIL_MAX_WIDTH_PX = 380;
// Gap between the card and the credit line (.embed-frame in embed.css).
const FRAME_GAP_PX = 6;

/** The sheet's floor for a variant, by the width of the notation it writes.
 *  Same shape as boardAspectForSpec: cosmetic sizing, so an unknown id takes
 *  the default rather than throwing. */
export function embedRailWidthPx(specId: string | null | undefined): number {
  return specId === 'duck-xiangqi' ? DUCK_RAIL_WIDTH_PX : RAIL_WIDTH_PX;
}

export type EmbedSeat = {
  name: string;
  /** The ink on the board for this seat ('red', 'black', 'white', 'blue'), or
   *  null for a flip variant whose opening flip has not bound one. */
  ink: string | null;
};

/** The subset of a replay handle the card drives. Every game renderer returns
 *  a superset; the study board returns exactly this. */
export type EmbedBoardHandle = Pick<
  ReplayHandle,
  'destroy' | 'jumpToPly' | 'plyCount' | 'moveEntries' | 'clockAtPly' | 'bottomSeat'
>;

export type EmbedCardOptions = {
  /** The line above the card: the event, or the variant and the clock. */
  header: string;
  seats: { first: EmbedSeat; second: EmbedSeat };
  /** "Red wins"; empty for a game without a result. */
  result: string;
  credit: { href: string; text: string };
  /** Board width over height, for fitting the board to the frame. */
  aspect: number;
  /** The move sheet's floor beside the board; embedRailWidthPx of the spec. */
  railWidthPx?: number;
  /** Open on this ply; null means the final position. */
  startPly: number | null;
  /** Stamped on the card so seat-disc-ink.css can colour the family's discs. */
  inkFamily?: string | null;
  mountBoard: (
    host: HTMLElement,
    hooks: { onPlyChange: (ply: number, maxPly: number) => void },
  ) => Promise<EmbedBoardHandle>;
};

export type EmbedCard = {
  frame: HTMLElement;
  handle: EmbedBoardHandle;
};

/** Board width that fits the box: the narrower of the room beside the move
 *  sheet and the room under the seat rows and controls, at the variant's aspect
 *  ratio. Exported so the arithmetic is testable without a layout engine. */
export function fitBoardWidth(
  frame: { width: number; height: number },
  aspect: number,
  stacked: boolean,
  railWidthPx: number = RAIL_WIDTH_PX,
): number {
  const availableWidth = frame.width - CARD_BORDER_PX - (stacked ? 0 : railWidthPx);
  const reservedHeight =
    SEAT_ROWS_PX + CONTROLS_PX + CARD_BORDER_PX + (stacked ? STACKED_MOVES_MIN_PX : 0);
  const availableHeight = frame.height - reservedHeight;
  return Math.max(120, Math.floor(Math.min(availableWidth, availableHeight * aspect)));
}

// Drawn, not typed: the media glyphs and the arrows resolve from different
// fallback fonts, never match in weight, and on some platforms the media pair
// renders as colour emoji.
const ICON = {
  first: '<rect x="3.4" y="4" width="1.7" height="8" rx="0.7"/><path d="M12.6 4.3v7.4L6.5 8z"/>',
  prev: '<path d="M11 4.3v7.4L4.9 8z"/>',
  next: '<path d="M5 4.3v7.4L11.1 8z"/>',
  last: '<rect x="10.9" y="4" width="1.7" height="8" rx="0.7"/><path d="M3.4 4.3v7.4L9.5 8z"/>',
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

type SeatRow = { el: HTMLElement; clock: HTMLElement };

function seatRow(seat: EmbedSeat, side: 'first' | 'second'): SeatRow {
  const el = document.createElement('div');
  el.className = 'embed-card-seat';
  el.dataset.seat = side;
  const disc = document.createElement('span');
  disc.className = `embed-seat-disc embed-seat-disc--${seat.ink ?? 'unbound'}`;
  disc.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'embed-card-seat-name';
  name.textContent = seat.name;
  const clock = document.createElement('span');
  clock.className = 'embed-card-seat-clock';
  el.append(disc, name, clock);
  return { el, clock };
}

export async function mountEmbedCard(
  root: HTMLElement,
  options: EmbedCardOptions,
): Promise<EmbedCard> {
  const frame = document.createElement('div');
  frame.className = 'embed-frame';
  const header = document.createElement('div');
  header.className = 'embed-card-header';
  header.textContent = options.header;
  const card = document.createElement('div');
  card.className = 'embed-card';
  if (options.inkFamily) card.dataset.seatInkFamily = options.inkFamily;

  const boardCol = document.createElement('div');
  boardCol.className = 'embed-card-board';
  const seatTop = seatRow(options.seats.second, 'second');
  const seatBottom = seatRow(options.seats.first, 'first');
  const boardHost = document.createElement('div');
  boardHost.className = 'embed-board';
  const controls = document.createElement('div');
  controls.className = 'embed-card-controls';
  const status = document.createElement('span');
  status.className = 'embed-card-status';
  boardCol.append(seatTop.el, boardHost, seatBottom.el, controls);

  const rail = document.createElement('div');
  rail.className = 'embed-card-rail';
  const railInner = document.createElement('div');
  railInner.className = 'embed-card-rail-inner';
  const movesRoot = document.createElement('div');
  movesRoot.className = 'embed-card-moves';
  const resultFoot = document.createElement('div');
  resultFoot.className = 'embed-card-result';
  resultFoot.textContent = options.result;
  railInner.append(movesRoot, resultFoot);
  rail.append(railInner);
  card.append(boardCol, rail);

  const credit = document.createElement('a');
  credit.className = 'embed-credit';
  credit.href = options.credit.href;
  credit.target = '_blank';
  credit.rel = 'noopener';
  credit.textContent = options.credit.text;
  frame.append(header, card, credit);
  root.replaceChildren(frame);

  let handle: EmbedBoardHandle | null = null;
  let moveList: MoveList | null = null;
  let currentPly = 0;
  let maxPly = 0;
  let rowsForBottom: 'first' | 'second' | null = null;
  const clampPly = (ply: number): number => Math.max(0, Math.min(maxPly, ply));
  const jump = (ply: number): void => {
    handle?.jumpToPly?.(clampPly(ply));
  };

  // The rows follow the board: whichever seat the board is drawn for sits
  // under it. Re-ordered only when the answer changes, so a step does not
  // rebuild the column.
  const orientRows = (): void => {
    const bottom = handle?.bottomSeat?.() ?? 'first';
    if (bottom === rowsForBottom) return;
    rowsForBottom = bottom;
    const top = bottom === 'first' ? seatTop : seatBottom;
    const under = bottom === 'first' ? seatBottom : seatTop;
    boardCol.replaceChildren(top.el, boardHost, under.el, controls);
  };
  // A clock is a game's; a study has none and the slot stays empty. Tenths
  // only under ten seconds, the way the live clocks show them.
  const renderClocks = (): void => {
    const clock = handle?.clockAtPly?.() ?? null;
    seatBottom.clock.textContent = clock ? formatClock(clock.first, clock.first < 10_000) : '';
    seatTop.clock.textContent = clock ? formatClock(clock.second, clock.second < 10_000) : '';
  };
  const onPlyChange = (ply: number, max: number): void => {
    currentPly = ply;
    maxPly = max;
    moveList?.update(ply, jump);
    status.textContent = max > 0 ? `${ply} / ${max}` : '';
    orientRows();
    renderClocks();
  };

  // Size the board to the box before the renderer paints, so the first frame
  // is already the right size, and again whenever the host resizes the frame.
  // Measured from the frame, not the card: the card is only as tall as its
  // board column, so its own rect is the answer, not the question.
  const fitBoard = (): void => {
    const rect = frame.getBoundingClientRect();
    const box = {
      width: rect.width,
      height: rect.height - header.offsetHeight - credit.offsetHeight - 2 * FRAME_GAP_PX,
    };
    if (box.width <= 0 || box.height <= 0) return;
    const stacked = box.width < STACK_BELOW_PX;
    const boardWidth = fitBoardWidth(box, options.aspect, stacked, options.railWidthPx);
    boardCol.style.width = `${boardWidth}px`;
    // Beside the board the card asks for the board plus the capped sheet and
    // the stylesheet's max-width: 100% clamps it to the frame (the sheet then
    // gets what is left, never less than the floor the board arithmetic kept
    // for it). Stacked, the sheet is under the board and the card takes the
    // frame. An explicit width, not a max: with auto margins doing the
    // centring the card is content-sized, and the sheet has no content width
    // of its own (its scroller is out of flow).
    card.style.width = stacked ? '' : `${boardWidth + RAIL_MAX_WIDTH_PX + CARD_BORDER_PX}px`;
  };
  fitBoard();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(fitBoard).observe(frame);
  }

  handle = await options.mountBoard(boardHost, { onPlyChange });

  const entries: MoveListEntry[] = handle.moveEntries?.() ?? [];
  maxPly = handle.plyCount?.() ?? entries.length;
  moveList = createMoveList(entries);
  movesRoot.append(moveList.el);

  controls.append(
    control('first', 'First move', () => jump(0)),
    control('prev', 'Previous move', () => jump(currentPly - 1)),
    status,
    control('next', 'Next move', () => jump(currentPly + 1)),
    control('last', 'Last move', () => jump(maxPly)),
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') jump(currentPly - 1);
    else if (event.key === 'ArrowRight') jump(currentPly + 1);
    else if (event.key === 'Home') jump(0);
    else if (event.key === 'End') jump(maxPly);
    else return;
    event.preventDefault();
  });

  // Land on the requested ply, or the final position: a finished game's embed
  // opens on its result, and the reader steps back from there.
  const start = options.startPly === null ? maxPly : options.startPly;
  if (handle.jumpToPly) jump(start);
  onPlyChange(handle.jumpToPly ? currentPly : clampPly(start), maxPly);

  return { frame, handle };
}
