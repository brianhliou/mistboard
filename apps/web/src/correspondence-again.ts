// "Play again by correspondence" (#606, #531): after a finished game between two
// signed-in accounts, one click sends the opponent a private correspondence
// challenge, same variant, sides swapped, casual, and lands the sender on the
// challenge page the server returns. Shared by both room stacks' postgame
// actions (postgame-panel.ts) and the review pages (review/game-review-meta.ts).
//
// The terms are fixed rather than asked: the game they just played says the
// variant and the opponent, the swap says the side, and the pace is the finished
// game's own days per move (one day after a live game). A player who wants other
// terms still has "Challenge a friend" and the profile challenge dialog.
//
// Funnel (PostHog): correspondence_again_shown once per game per page, then
// correspondence_seek_posted with surface 'postgame' or 'review', then the
// sender's game_started with entry_source 'postgame-correspondence' or
// 'review-correspondence' when the opponent accepts.
import { GOMOKU_SPEC_ID } from '@mistboard/game';
import { loadCachedCurrentUser } from './account-nav.js';
import { trackCorrespondenceAgainShown, trackCorrespondenceSeekPosted } from './analytics.js';
import {
  type CorrespondenceAgainInput,
  type CorrespondenceAgainOffer,
  correspondenceAgainOffer,
  correspondenceAgainRequestBody,
  type FinishedGameSeat,
  finishedGameDaysPerMove,
  finishedGameViewerSeat,
} from './challenge-model.js';
import { correspondenceEnabled } from './feature-flags.js';
import { rememberCorrespondenceStartSource } from './game-start-source.js';
import { t } from './i18n/catalog.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { webVariantOfferedInMenu } from './variant-tenant/registry.js';

export type CorrespondenceAgainSurface = 'postgame' | 'review';

/** The offer for a finished game the viewer sat in, or null when none applies
 *  (a guest on either side, a bot, a variant without correspondence, the
 *  feature switched off, or a side that cannot be swapped). */
export function finishedGameCorrespondenceOffer(
  input: Omit<CorrespondenceAgainInput, 'correspondenceEnabled' | 'finished'>,
): CorrespondenceAgainOffer | null {
  return correspondenceAgainOffer(
    { ...input, correspondenceEnabled: correspondenceEnabled(), finished: true },
    webVariantOfferedInMenu,
  );
}

// Offers already reported in this page, so a room re-rendering its postgame row
// on every snapshot counts one offer per game.
const shownOffers = new Set<string>();

/** For tests: forget which offers this page has reported. */
export function resetCorrespondenceAgainShown(): void {
  shownOffers.clear();
}

export function correspondenceAgainButton(
  offer: CorrespondenceAgainOffer,
  context: { surface: CorrespondenceAgainSurface; roomId: string },
): HTMLButtonElement {
  const shownKey = `${context.surface}:${context.roomId}`;
  if (!shownOffers.has(shownKey)) {
    shownOffers.add(shownKey);
    trackCorrespondenceAgainShown({ gameSpecId: offer.gameSpecId, surface: context.surface });
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'correspondence-again';
  button.dataset.correspondenceAgain = '';
  button.textContent = t('live.correspondenceAgain');
  let sending = false;
  button.addEventListener('click', () => {
    if (sending) return;
    const body = correspondenceAgainRequestBody(offer, webVariantOfferedInMenu);
    if (!body) {
      button.textContent = t('challenge.errorGeneric');
      return;
    }
    sending = true;
    button.disabled = true;
    button.textContent = t('live.correspondenceAgainSending');
    const fail = (text: string) => {
      sending = false;
      button.disabled = false;
      button.textContent = text;
    };
    void fetch('/api/correspondence/seeks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          challengeUrl?: string | null;
          error?: string;
        } | null;
        if (res.ok && json?.challengeUrl) {
          rememberCorrespondenceStartSource(
            context.surface === 'review' ? 'review-correspondence' : 'postgame-correspondence',
            offer.gameSpecId,
          );
          trackCorrespondenceSeekPosted({
            gameSpecId: offer.gameSpecId,
            daysPerMove: offer.daysPerMove,
            kind: 'direct',
            surface: context.surface,
          });
          window.location.assign(json.challengeUrl);
          return;
        }
        fail(correspondenceAgainErrorText(res.status, json?.error, offer.opponentHandle));
      })
      .catch(() => fail(t('challenge.errorGeneric')));
  });
  return button;
}

/** The review page's offer: the viewer must be one of the game's two accounts,
 *  read from the signed-in account's handle. */
export function reviewCorrespondenceOffer(
  config: {
    gameSpecId: string;
    game: {
      mode?: string;
      players?: readonly FinishedGameSeat[];
      initialMs?: number | null;
      incrementMs?: number | null;
      timeControl?: Record<string, unknown> | null;
    };
    firstMoverColor?: string;
  },
  viewerHandle: string | null | undefined,
): CorrespondenceAgainOffer | null {
  // Gomoku's first mover follows its opening, so only a page that names it
  // can swap sides.
  if (config.gameSpecId === GOMOKU_SPEC_ID && !config.firstMoverColor) return null;
  const seats = finishedGameViewerSeat(config.game.players, viewerHandle, config.firstMoverColor);
  if (!seats) return null;
  return finishedGameCorrespondenceOffer({
    seated: true,
    mode: config.game.mode ?? 'pvp',
    gameSpecId: config.gameSpecId,
    viewerHandle: seats.viewer.handle,
    opponent: {
      handle: seats.opponent.handle ?? undefined,
      botId: seats.opponent.botId ?? undefined,
    },
    viewerMovedFirst: seats.viewerMovedFirst,
    daysPerMove: finishedGameDaysPerMove(config.game),
  });
}

/** A review-page slot that stays empty until the signed-in account resolves,
 *  then holds the button when the viewer played this game. */
export function reviewCorrespondenceAgainSlot(
  config: Parameters<typeof reviewCorrespondenceOffer>[0] & { roomId: string },
): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'review-actions review-correspondence-again';
  slot.hidden = true;
  // Cheap gates first: no account request for a signed-out reader or a game
  // that could never qualify. The page's account nav reads the same cached
  // account, so a signed-in reader costs no extra request.
  const players = config.game.players ?? [];
  if (
    !isLikelySignedIn() ||
    players.length !== 2 ||
    players.some((player) => player.botId || !player.handle)
  ) {
    return slot;
  }
  void loadCachedCurrentUser()
    .then((user) => {
      const offer = reviewCorrespondenceOffer(config, user?.handle);
      if (!offer) return;
      const button = correspondenceAgainButton(offer, { surface: 'review', roomId: config.roomId });
      button.classList.add('review-action-link');
      slot.append(button);
      slot.hidden = false;
    })
    .catch(() => {
      // No account read, no offer: the review itself is unaffected.
    });
  return slot;
}

function correspondenceAgainErrorText(
  status: number,
  code: string | undefined,
  name: string,
): string {
  if (status === 401) return t('challenge.errorSignIn');
  if (code === 'seek_limit_reached') return t('challenge.errorLimit');
  if (code === 'challenge_blocked') return t('challenge.errorBlocked', { name });
  return t('challenge.errorGeneric');
}
