// An open correspondence seek drawn as a game card (/games, /correspondence):
// the same frame as an in-progress card (seat, board, seat, one quiet line) so
// a seek reads as a game waiting for its second player. The board is the
// variant's starting position (start-position-board.ts). The seat still to be
// filled holds the card's controls (Accept, or your own seek's Copy link and
// Cancel, or a challenge's Accept and Decline); with no controls it is a dashed
// slot that says who is missing. Styles live in current-games.css, which both
// pages load.

import { displayLiveName, variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { playerNameEl, profileTargetFor } from './profile-link.js';
import type { SeatSide } from './seat-start-view.js';
import { renderStartPositionSvg } from './start-position-board.js';

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
  // Extra meta parts after the terms (side, expiry).
  details?: readonly string[];
  // The seat the start board is drawn for: your own seek, from the side you
  // asked for; someone else's seek or challenge, from the side you would take
  // when the poster picked theirs (a fog variant then draws that seat's own
  // start view). Omitted when the side is random, so a fog variant keeps its
  // tile (start-position-board.ts) and the board is drawn from the first side.
  side?: SeatSide;
  // The empty seat is the viewer's (a challenge to you, or a seek whose side
  // you would take is known): it goes at the bottom with the poster on top, as
  // every in-progress card puts "You" at the bottom.
  waitingAtBottom?: boolean;
};

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
  if (options.side) board.dataset.perspective = options.side;
  void renderStartPositionSvg(seek.gameSpecId, options.side)
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
  const terms = [...seekMetaParts(seek), ...(options.details ?? [])].join(' · ');
  if (options.action && options.waiting) meta.append(options.waiting, ` · ${terms}`);
  else meta.textContent = terms;
  meta.title = meta.textContent ?? terms;

  if (options.waitingAtBottom) article.append(seat, board, empty, meta);
  else article.append(empty, board, seat, meta);
  if (options.notice) article.append(options.notice);
  if (options.status) article.append(options.status);
  return article;
}
