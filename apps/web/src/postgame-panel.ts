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
