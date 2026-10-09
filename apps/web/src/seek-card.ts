// An open correspondence seek drawn as a game card (/games, /correspondence):
// the same frame as an in-progress card (seat, board, seat, meta) so a seek
// reads as a game waiting for its second player. The board is the variant's
// starting position (start-position-board.ts); the empty seat says who is
// missing. Styles live in current-games.css, which both pages load.

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
  // The bottom-right control (Accept, a sign-in link); omitted on /games.
  action?: HTMLElement | null;
  // A line under the meta (an accept error); hidden until it has text.
  status?: HTMLElement | null;
  // Your own seek (/correspondence "Waiting for an opponent"): what the empty
  // seat says (a directed challenge names its recipient), the overlay link's
  // label, extra meta parts (side, expiry), and no "Open seek" tag, since a
  // link or directed challenge is not on the open board.
  waiting?: Node | null;
  ariaLabel?: string;
  details?: readonly string[];
  badge?: boolean;
  // The seat the start board is drawn for: your own seek, from the side you
  // asked for. Omitted for someone else's seek, so a fog variant keeps its tile
  // (start-position-board.ts) and an open one is drawn from the first side.
  side?: SeatSide;
};

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

  const waiting = document.createElement('div');
  waiting.className = 'current-game-seat is-empty-seat';
  const waitingText = document.createElement('span');
  waitingText.className = 'current-game-seat-who current-game-seat-waiting';
  if (options.waiting) waitingText.append(options.waiting);
  else waitingText.textContent = t('games.seekWaiting');
  waiting.append(waitingText);

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
  if (options.action) {
    options.action.classList.add('current-game-seek-action');
    seat.append(options.action);
  }

  const meta = document.createElement('div');
  meta.className = 'current-game-meta';
  const chip = document.createElement('span');
  chip.className = 'current-game-chip';
  chip.textContent = variant;
  const text = document.createElement('span');
  const cadence =
    seek.daysPerMove === 1
      ? t('games.oneDayPerMove')
      : t('games.daysPerMove', { count: seek.daysPerMove });
  text.textContent = [
    cadence,
    seek.rated ? t('games.rated') : t('games.casual'),
    ...(options.details ?? []),
  ].join(' · ');
  if (options.badge !== false) meta.append(buildKindBadge('seek'));
  meta.append(chip, text);

  article.append(waiting, board, seat, meta);
  if (options.status) article.append(options.status);
  return article;
}

export type CardKind = 'live' | 'correspondence' | 'seek';

const KIND_LABEL = {
  correspondence: 'games.kindCorrespondence',
  live: 'games.kindLive',
  seek: 'games.kindSeek',
} as const;

// The small coloured tag that names what a card is; its colour is the card's
// top edge (current-games.css [data-kind]).
export function buildKindBadge(kind: CardKind): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'current-game-kind';
  badge.textContent = t(KIND_LABEL[kind]);
  return badge;
}
