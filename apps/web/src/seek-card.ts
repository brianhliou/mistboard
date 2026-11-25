// An open correspondence seek drawn as a game card (/games, /correspondence):
// the same frame as an in-progress card (seat, board, seat, one quiet line) so
// a seek reads as a game waiting for its second player. The poster's seat is
// above the board, which is the variant's starting position
// (start-position-board.ts), and the seat still to be filled is below it: it
// holds the card's controls (Accept, or your own seek's Copy link and Cancel,
// or a challenge's Accept and Decline), or with no controls a dashed slot that
// says who is missing. Each seat carries the disc of the colour it plays, so
// the side is on the card rather than in the meta line; random colours put a
// disc split between both inks on both seats. Styles live in
// current-games.css, which both pages load.

import { seatInkForVariant, variantSeatsHaveInk } from './flip-seat-ink.js';
import {
  displayLiveName,
  type FeaturedGame,
  firstMoverColorName,
  matchupSeats,
  secondMoverColorName,
  variantDisplayLabel,
} from './game-display.js';
import { t } from './i18n/catalog.js';
import { playerNameEl, profileTargetFor } from './profile-link.js';
import { seatDiscEl } from './seat-disc.js';
import type { SeatSide } from './seat-start-view.js';
import { renderStartPositionSvg } from './start-position-board.js';
import { seatInkFamily } from './variant-seat-label.js';

export type SeekCardSeek = {
  id: string;
  gameSpecId: string;
  daysPerMove: number;
  creatorName: string | null;
  // Profile handle, sent only for an open, non-private account; absent/null
  // means the name renders as plain text (profile-link.ts, fail-closed).
  creatorHandle?: string | null;
  rated?: boolean;
};

export type SeekCardOptions = {
  // Where the whole card leads; null when an action button is the only way in.
  href: string | null;
  // The card's controls (Accept or a sign-in link, from seek-accept.ts; your
  // own seek's Copy link and Cancel; a challenge's Accept and Decline). They
  // take the empty seat's row, so the card has no button row of its own.
  action?: HTMLElement | null;
  // A line under the meta (an accept error); hidden until it has text.
  status?: HTMLElement | null;
  // A sentence under the meta line (a challenge's move-deadline warning).
  notice?: HTMLElement | null;
  // Who the seek is waiting for (your own seek: "Open seek", "Link challenge",
  // or a directed challenge's recipient). With controls it leads the meta
  // line; without, the dashed empty seat says it ("Waiting for an opponent"
  // by default).
  waiting?: Node | null;
  ariaLabel?: string;
  // Extra meta parts after the terms (an expiry).
  details?: readonly string[];
  // The side the poster asked for ('first', 'second' or 'random'). A picked
  // side turns the board so the seat still to be filled, the one under it, has
  // its colour at the bottom (a fog variant then draws that seat's own start
  // view); random keeps the default orientation and fog tile. Anything else
  // (absent, unknown) draws no disc.
  color?: string | null;
  // The side in words ("You play Black", "random colors"), said in the meta
  // line only for a variant whose seats have no colour to draw (Xiangqi
  // Mahjong's winds), where the discs cannot say it.
  colorLabel?: string | null;
};

type SeekColor = 'first' | 'second' | 'random';

function seekColor(color: string | null | undefined): SeekColor | null {
  return color === 'first' || color === 'second' || color === 'random' ? color : null;
}

function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

// The disc for one seat of a seek: the ink of the side it plays (a flip
// variant's dashed ring, its ink still unbound), or for random colours a disc
// split between both inks. Unlike a game card's disc it is not aria-hidden: the
// meta line no longer says the side, so the disc's label does.
function seekSeatDisc(gameSpecId: string, side: SeatSide | 'random'): HTMLElement {
  const seats = matchupSeats({ variant: gameSpecId } as FeaturedGame);
  if (side === 'random') {
    const split = document.createElement('span');
    split.className = 'current-game-seat-disc current-game-seek-random-disc';
    // A flip variant's seats bind their inks at the flip; the split shows the
    // two inks one of them will get.
    split.append(seatDiscEl(seats[0]), seatDiscEl(seats[1]));
    const label = capitalized(t('challenge.randomColors'));
    split.title = label;
    split.setAttribute('role', 'img');
    split.setAttribute('aria-label', label);
    return split;
  }
  const seat = side === 'first' ? seats[0] : seats[1];
  const disc = seatDiscEl(seatInkForVariant(gameSpecId, seat, null), 'current-game-seat-disc');
  const label =
    side === 'first' ? firstMoverColorName(gameSpecId) : secondMoverColorName(gameSpecId);
  disc.removeAttribute('aria-hidden');
  disc.title = label;
  disc.setAttribute('role', 'img');
  disc.setAttribute('aria-label', label);
  return disc;
}

// The terms in a game card's order (cardMetaText in current-games.ts): the
// variant, the days per move, and "Rated" only when it is; casual goes unsaid.
export function seekMetaParts(
  seek: Pick<SeekCardSeek, 'gameSpecId' | 'daysPerMove' | 'rated'>,
): string[] {
  const parts = [
    variantDisplayLabel(seek.gameSpecId),
    seek.daysPerMove === 1
      ? t('games.oneDayPerMove')
      : t('games.daysPerMove', { count: seek.daysPerMove }),
  ];
  if (seek.rated) parts.push(t('games.rated'));
  return parts;
}

export function buildSeekCard(seek: SeekCardSeek, options: SeekCardOptions): HTMLElement {
  const article = document.createElement('article');
  article.className = 'current-game-card is-seek';
  article.dataset.kind = 'seek';
  article.dataset.seekId = seek.id;
  const variant = variantDisplayLabel(seek.gameSpecId);
  const creator = displayLiveName(seek.creatorName, t('games.anonymous'));
  const color = seekColor(options.color);
  const discs = color !== null && variantSeatsHaveInk(seek.gameSpecId);
  // The seat the accepter takes, and the side the board is drawn from.
  const accepter: SeatSide | null =
    color === 'first' ? 'second' : color === 'second' ? 'first' : null;
  const poster: SeatSide | null =
    accepter === null ? null : accepter === 'first' ? 'second' : 'first';
  const family = seatInkFamily(seek.gameSpecId);
  if (discs && family) article.dataset.seatInkFamily = family;

  if (options.href) {
    const open = document.createElement('a');
    open.className = 'current-game-open';
    open.href = options.href;
    open.setAttribute(
      'aria-label',
      options.ariaLabel ?? t('games.seekOpen', { name: creator, variant }),
    );
    article.append(open);
  }

  // The seat still to be filled: the controls when the card has any (the
  // place you would take is where you act), else a dashed slot naming it.
  const empty = document.createElement('div');
  if (discs) empty.append(seekSeatDisc(seek.gameSpecId, accepter ?? 'random'));
  if (options.action) {
    empty.className = 'current-game-seat current-game-seek-slot';
    options.action.classList.add('current-game-seek-action');
    empty.append(options.action);
  } else {
    empty.className = 'current-game-seat is-empty-seat';
    const waitingText = document.createElement('span');
    waitingText.className = 'current-game-seat-who current-game-seat-waiting';
    if (options.waiting) waitingText.append(options.waiting);
    else waitingText.textContent = t('games.seekWaiting');
    empty.append(waitingText);
  }

  const board = document.createElement('div');
  board.className = 'current-game-board is-start';
  const placeholder = document.createElement('div');
  placeholder.className = 'current-game-hidden';
  const label = document.createElement('span');
  label.className = 'current-game-hidden-label';
  label.textContent = variant;
  placeholder.append(label);
  board.append(placeholder);
  if (accepter) board.dataset.perspective = accepter;
  void renderStartPositionSvg(seek.gameSpecId, accepter ?? undefined)
    .then((svg) => {
      if (!svg || !board.isConnected) return;
      const frame = document.createElement('div');
      frame.className = 'current-game-start-board notranslate';
      frame.setAttribute('translate', 'no');
      frame.setAttribute('aria-hidden', 'true');
      frame.innerHTML = svg;
      frame.querySelector('svg')?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      board.replaceChildren(frame);
    })
    .catch((err) => console.warn('[seek-card] start board failed', err));

  const seat = document.createElement('div');
  seat.className = 'current-game-seat';
  const who = document.createElement('span');
  who.className = 'current-game-seat-who';
  if (discs) who.append(seekSeatDisc(seek.gameSpecId, poster ?? 'random'));
  // The creator's profile link sits above the card-wide .current-game-open
  // overlay (current-games.css), a sibling rather than a child of it, so the two
  // anchors never nest.
  who.append(
    playerNameEl(
      creator,
      profileTargetFor({ handle: seek.creatorHandle }),
      'current-game-seat-name',
    ),
  );
  seat.append(who);

  // One quiet line, as on a game card. Your own seek's "who it waits for"
  // leads it once the controls have taken the empty seat.
  const meta = document.createElement('p');
  meta.className = 'current-game-meta current-game-line';
  const side = !discs && color !== null && options.colorLabel ? [options.colorLabel] : [];
  const terms = [...seekMetaParts(seek), ...side, ...(options.details ?? [])].join(' · ');
  if (options.action && options.waiting) meta.append(options.waiting, ` · ${terms}`);
  else meta.textContent = terms;
  meta.title = meta.textContent ?? terms;

  article.append(seat, board, empty, meta);
  if (options.notice) article.append(options.notice);
  if (options.status) article.append(options.status);
  return article;
}
