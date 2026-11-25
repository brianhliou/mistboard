// "Play again by correspondence" (#606, #531): after a finished live game between
// two signed-in accounts, one click sends the opponent a private correspondence
// challenge, same variant, sides swapped, casual, and lands the sender on the
// challenge page the server returns. Shared by both room stacks' postgame
// actions (postgame-panel.ts). The review pages carried it in their game card
// until 2026-11-25; the room's post-game actions are now its only home. A
// finished correspondence game offers it nowhere since 2026-11-25.
//
// The terms are fixed rather than asked: the game they just played says the
// variant and the opponent, the swap says the side, and the pace is one day per
// move. A player who wants other terms still has "Challenge a friend" and the
// profile challenge dialog.
//
// Funnel (PostHog): correspondence_again_shown once per game per page, then
// correspondence_seek_posted with surface 'postgame' ('review' until 2026-11-25), then the
// sender's game_started with entry_source 'postgame-correspondence' or
// 'review-correspondence' when the opponent accepts.
import { trackCorrespondenceAgainShown, trackCorrespondenceSeekPosted } from './analytics.js';
import {
  type CorrespondenceAgainInput,
  type CorrespondenceAgainOffer,
  correspondenceAgainOffer,
  correspondenceAgainRequestBody,
} from './challenge-model.js';
import { type FirstMoveOwedFailure, renderFirstMoveOwed } from './correspondence-first-move.js';
import { correspondenceEnabled } from './feature-flags.js';
import { rememberCorrespondenceStartSource } from './game-start-source.js';
import { t } from './i18n/catalog.js';
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
  const owedStatus = document.createElement('span');
  owedStatus.setAttribute('role', 'status');
  button.addEventListener('click', () => {
    if (sending) return;
    const body = correspondenceAgainRequestBody(offer, webVariantOfferedInMenu);
    if (!body) {
      button.textContent = t('challenge.errorGeneric');
      return;
    }
    sending = true;
    owedStatus.hidden = true;
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
        const json = (await res.json().catch(() => null)) as
          | ({
              challengeUrl?: string | null;
              error?: string;
            } & FirstMoveOwedFailure)
          | null;
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
        if (renderFirstMoveOwed(owedStatus, json)) {
          button.insertAdjacentElement('afterend', owedStatus);
          fail(t('live.correspondenceAgain'));
          return;
        }
        fail(correspondenceAgainErrorText(res.status, json?.error, offer.opponentHandle));
      })
      .catch(() => fail(t('challenge.errorGeneric')));
  });
  return button;
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
