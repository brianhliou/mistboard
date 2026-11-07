// The finished-game end of the room's right column, shared by BOTH room stacks
// (the chess/fog shell: live-render.ts + live-room-actions.ts; the tenant shell:
// variant-tenant/room-chrome.ts) so the two cannot drift apart.
//
// Lichess round anatomy: the result (score + how it ended) sits at the END of
// the move list and scrolls with the moves, while the actions stay pinned below
// the list, full width, the rematch first and largest.
//
//   Rematch        seated players only: the same opponent again (a PvP rematch
//                  offer, or a fresh game against the same bot, sides swapped)
//   New opponent   seated players only: the play dialog, same variant, as
//   / New game     Find opponent after a PvP game ("New opponent") or as the
//                  bot picker after a bot game ("New game": the dialog offers
//                  the same bot and settings, so "opponent" read oddly; lichess
//                  labels its post-AI-game button the same way)
//   Review game    everyone
//   Challenge a friend
//                  after a BOT game only, a row like the two above it: it is
//                  the one post-game action that brings a new human onto the
//                  site (postgame-invite.ts), and the only one a PvP game does
//                  not need
//
// Every action reports a `postgame_action` event, so which of these earns its
// place is a PostHog read rather than a guess.
import { track } from './analytics.js';
import { t } from './i18n/catalog.js';
import { localizedHref } from './i18n/locale.js';
import { landingPlayDeepLinkAccepts } from './landing-play.js';
import { PHONE_ROOM_QUERY } from './live-room-sheet.js';
import { postGameInviteButton } from './postgame-invite.js';

export type GameResultLines = {
  /** '1-0' / '0-1' / '½-½' for two-seat games; null where a score means nothing. */
  score: string | null;
  summary: string;
};

/** Two-seat score, first seat first (white or red), the way both games write it. */
export function resultScore(winnerSeatIndex: number | null): string {
  if (winnerSeatIndex === null) return '½-½';
  return winnerSeatIndex === 0 ? '1-0' : '0-1';
}

/**
 * Fills (or clears) the result block at the end of the move list. `anchor` is
 * any element inside the game console. The first time a result appears the
 * move list scrolls to it, so a game that just ended shows how.
 */
export function renderGameResult(anchor: HTMLElement, result: GameResultLines | null): void {
  const el = anchor.closest('.game-console')?.querySelector<HTMLElement>('[data-game-result]');
  if (!el) return;
  if (!result) {
    if (!el.hidden) {
      el.hidden = true;
      el.replaceChildren();
      delete el.dataset.result;
    }
    return;
  }
  const key = `${result.score ?? ''}|${result.summary}`;
  if (!el.hidden && el.dataset.result === key) return;
  const wasHidden = el.hidden;
  el.dataset.result = key;
  const parts: HTMLElement[] = [];
  if (result.score) {
    const score = document.createElement('strong');
    score.className = 'game-result__score';
    score.textContent = result.score;
    parts.push(score);
  }
  const summary = document.createElement('span');
  summary.className = 'game-result__summary';
  summary.textContent = result.summary;
  parts.push(summary);
  el.replaceChildren(...parts);
  el.hidden = false;
  syncSheetResult(anchor);
  const scroller = el.parentElement;
  if (wasHidden && scroller && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  }
}

export type PostGameActionsInput = {
  variant: string | undefined;
  mode: string;
  seated: boolean;
  /** The caller's rematch control (PvP offer widget or PvE new-game button), seated only. */
  rematch: HTMLElement | null;
  reviewHref: string | null;
};

type PostGameSheet = {
  update(actions: HTMLElement): void;
  dispose(): void;
};
const sheets = new WeakMap<HTMLElement, PostGameSheet>();

/** Move the same controls into a phone dialog. Keep its dismissal across the
 * room's snapshots, rematch offers, and retry renders. Desktop keeps the
 * original direct-child action grid and its handlers. */
export function renderPostGameActions(host: HTMLElement, input: PostGameActionsInput): void {
  const actions = postGameActions(input);
  if (!input.seated || !actions.childElementCount) {
    clearPostGameSheet(host);
    host.replaceChildren(actions);
    return;
  }
  actions.classList.remove('postgame-actions--solo');
  let sheet = sheets.get(host);
  if (!sheet) {
    sheet = createPostGameSheet(host);
    sheets.set(host, sheet);
  }
  sheet.update(actions);
}

export function clearPostGameSheet(host: HTMLElement): void {
  sheets.get(host)?.dispose();
  sheets.delete(host);
  delete host.dataset.postgameSheet;
}

function syncSheetResult(anchor: HTMLElement): void {
  const console = anchor.closest('.game-console');
  const source = console?.querySelector<HTMLElement>('[data-game-result]');
  const target = console?.querySelector<HTMLElement>('.postgame-sheet__result');
  if (!source || !target) return;
  target.replaceChildren(...[...source.childNodes].map((node) => node.cloneNode(true)));
  target.hidden = source.hidden;
}

function createPostGameSheet(host: HTMLElement): PostGameSheet {
  const media = window.matchMedia(PHONE_ROOM_QUERY);
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'postgame-sheet-toggle';
  trigger.textContent = t('engine.gameOver');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  const dialog = document.createElement('dialog');
  dialog.className = 'postgame-sheet';
  dialog.setAttribute('aria-label', t('engine.gameOver'));
  const header = document.createElement('div');
  header.className = 'postgame-sheet__header';
  const handle = document.createElement('span');
  handle.className = 'postgame-sheet__handle';
  handle.setAttribute('aria-hidden', 'true');
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'postgame-sheet__close';
  closeButton.textContent = t('live.roomInfoClose');
  header.append(handle, closeButton);
  const result = document.createElement('div');
  result.className = 'game-result postgame-sheet__result';
  dialog.append(header, result);
  host.replaceChildren(trigger, dialog);
  let actions: HTMLElement | null = null;
  let presented = false;
  let disposed = false;

  function open(): void {
    if (disposed || !media.matches || !host.isConnected || dialog.open) return;
    dialog.showModal();
    presented = true;
    trigger.setAttribute('aria-expanded', 'true');
  }
  function close(): void {
    dialog.close();
    trigger.setAttribute('aria-expanded', 'false');
  }
  function sync(): void {
    if (!actions) return;
    trigger.hidden = !media.matches;
    dialog.hidden = !media.matches;
    if (media.matches) {
      host.dataset.postgameSheet = '';
      dialog.append(actions);
      if (!presented) {
        open();
        // The first room render can run just before its table is mounted.
        if (!host.isConnected) queueMicrotask(open);
      }
    } else {
      close();
      delete host.dataset.postgameSheet;
      host.append(actions);
    }
  }
  trigger.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', () =>
    trigger.setAttribute('aria-expanded', String(dialog.open)),
  );
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      close();
  });
  let swipe: { id: number; x: number; y: number } | null = null;
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener('pointerup', (event) => {
    if (!swipe || swipe.id !== event.pointerId) return;
    const dy = event.clientY - swipe.y;
    if (dy > 60 && dy > Math.abs(event.clientX - swipe.x)) close();
    swipe = null;
  });
  header.addEventListener('pointercancel', () => {
    swipe = null;
  });
  media.addEventListener('change', sync);
  return {
    update(next) {
      actions?.remove();
      actions = next;
      syncSheetResult(host);
      sync();
    },
    dispose() {
      disposed = true;
      close();
      media.removeEventListener('change', sync);
    },
  };
}

export function postGameActions(input: PostGameActionsInput): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'postgame-actions';
  const report = (action: string) => () =>
    track('postgame_action', { action, variant: input.variant ?? null, mode: input.mode });

  if (input.seated && input.rematch) {
    input.rematch.classList.add('postgame-actions__rematch');
    input.rematch.addEventListener('click', report('rematch'));
    box.append(input.rematch);
  }

  const opponentHref = input.seated ? newOpponentHref(input.variant, input.mode) : null;
  if (opponentHref) {
    const label = input.mode === 'pve' ? t('live.newGame') : t('live.newOpponent');
    box.append(actionLink(label, opponentHref, report('new_opponent')));
  }

  if (input.reviewHref) {
    box.append(actionLink(t('live.reviewGame'), input.reviewHref, report('review')));
  }

  if (input.seated && input.mode === 'pve') {
    const invite = postGameInviteButton(input.variant);
    if (invite) {
      invite.classList.add('postgame-actions__invite');
      invite.addEventListener('click', report('challenge_friend'));
      box.append(invite);
    }
  }
  // One action and nothing else (a spectator's or signed-out viewer's Review
  // game): the phone room puts it in the bottom bar beside the move arrows,
  // where Resign/Abort sat during play, and the board takes the band it would
  // have needed (live-review.css, #618).
  // A lone rematch offer block (note plus buttons) keeps the band.
  const only = box.childElementCount === 1 ? box.firstElementChild : null;
  if (only?.matches('a, button')) box.classList.add('postgame-actions--solo');
  return box;
}

function newOpponentHref(variant: string | undefined, mode: string): string | null {
  if (!variant || !landingPlayDeepLinkAccepts(variant)) return null;
  const play = mode === 'pve' ? 'computer' : mode === 'pvp' ? 'lobby' : null;
  if (!play) return null;
  return localizedHref(`/?play=${play}&variant=${encodeURIComponent(variant)}`);
}

function actionLink(label: string, href: string, onClick: () => void): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'postgame-actions__link';
  link.href = href;
  link.textContent = label;
  link.addEventListener('click', onClick);
  return link;
}
