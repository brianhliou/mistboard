import type { PlayerView } from '@mistboard/game';
import { readAccountPreferences } from './account-preferences.js';
import { openConfirmDialog } from './confirm-dialog.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { type LiveRefs, liveState } from './live-state.js';
import { currentView } from './live-view.js';
import { isColor } from './web-utils.js';

type GameControlRefs = Pick<LiveRefs, 'gameControlsSection' | 'gameControls'>;
type SendSocket = (payload: unknown) => boolean;

export function renderGameControls(
  refs: GameControlRefs,
  view: PlayerView | null,
  sendSocket: SendSocket,
  locale: Locale = currentLocale(),
): void {
  const isPlayableRoom =
    (liveState.roomMode === 'pvp' ||
      liveState.roomMode === 'pve' ||
      liveState.roomMode === 'correspondence') &&
    isColor(liveState.seat) &&
    view?.status.type === 'playing' &&
    !liveState.solo;
  if (!isPlayableRoom || !view || view.status.type !== 'playing') {
    refs.gameControlsSection.hidden = true;
    refs.gameControls.replaceChildren();
    return;
  }

  // Before both players have completed their first move, the game can only be
  // aborted by the side to move. From move 2 on, either player resigns.
  const preMove = view.moveNumber < 2;
  const isSideToMove = view.status.turn === liveState.seat;
  // Correspondence (day-scale) rooms enforce the abort/forfeit deadlines on the
  // server sweeper, not a live second-counter, and the day clock already shows
  // the deadline — so keep the Abort/Resign buttons but drop the seconds-scale
  // countdown spans (a "172800s" countdown is noise at days cadence).
  const dayScale =
    typeof liveState.timeControl?.daysPerMove === 'number' && liveState.timeControl.daysPerMove > 0;

  const children: HTMLElement[] = [];
  // Show the abort countdown to both players so the waiting side understands
  // the pause. Timing info only; it leaks no board state.
  if (preMove && !dayScale && liveState.abortDeadline !== null) {
    const countdown = document.createElement('span');
    countdown.className = 'abort-countdown';
    countdown.dataset.abortCountdown = '';
    countdown.textContent = abortCountdownText(isSideToMove, locale);
    children.push(countdown);
  }
  // Post-move-1: only a present winning player receives forfeitDeadline, so
  // this banner always reads from the beneficiary's point of view.
  if (!preMove && !dayScale && liveState.forfeitDeadline !== null) {
    const banner = document.createElement('span');
    banner.className = 'forfeit-countdown';
    banner.dataset.forfeitCountdown = '';
    banner.textContent = forfeitCountdownText(locale);
    children.push(banner);
  }
  if (preMove) {
    if (isSideToMove)
      children.push(
        makeControlButton(t('live.abort', {}, locale), () => requestAbort(sendSocket, locale)),
      );
  } else {
    children.push(
      makeControlButton(t('live.resign', {}, locale), () => requestResign(sendSocket, locale)),
    );
  }

  refs.gameControlsSection.hidden = children.length === 0;
  refs.gameControls.replaceChildren(...children);
}

// Driven by the 100ms tick loop so countdowns advance without a full re-render.
// Only touch existing elements' text; renderGameControls owns creation/teardown.
export function updateAbortCountdown(refs: GameControlRefs): void {
  const locale = currentLocale();
  const view = currentView();
  const abortEl = refs.gameControls.querySelector<HTMLElement>('[data-abort-countdown]');
  if (abortEl && view && view.status.type === 'playing' && view.moveNumber < 2) {
    abortEl.textContent = abortCountdownText(view.status.turn === liveState.seat, locale);
  }
  const forfeitEl = refs.gameControls.querySelector<HTMLElement>('[data-forfeit-countdown]');
  if (forfeitEl && liveState.forfeitDeadline !== null) {
    forfeitEl.textContent = forfeitCountdownText(locale);
  }
}

function abortRemainingMs(): number | null {
  if (liveState.abortDeadline === null) return null;
  return Math.max(0, liveState.abortDeadline - Date.now());
}

function abortCountdownText(isSideToMove: boolean, locale: Locale): string {
  const remaining = abortRemainingMs();
  const seconds = remaining === null ? 0 : Math.ceil(remaining / 1000);
  return isSideToMove
    ? t('live.makeFirstMoveAbortingIn', { seconds }, locale)
    : t('live.waitingFirstMoveAbortingIn', { seconds }, locale);
}

function forfeitRemainingSeconds(): number {
  if (liveState.forfeitDeadline === null) return 0;
  return Math.ceil(Math.max(0, liveState.forfeitDeadline - Date.now()) / 1000);
}

function forfeitCountdownText(locale: Locale): string {
  return t('live.opponentLeftWinIn', { seconds: forfeitRemainingSeconds() }, locale);
}

function makeControlButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'danger';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function requestResign(sendSocket: SendSocket, locale: Locale = currentLocale()): void {
  if (!readAccountPreferences().confirmGameActions) {
    sendSocket({ type: 'resign' });
    return;
  }
  openConfirmDialog({
    title: t('live.resignTitle', {}, locale),
    body: t('live.resignBody', {}, locale),
    confirmLabel: t('live.resign', {}, locale),
    cancelLabel: t('setup.cancel', {}, locale),
    confirmTone: 'danger',
    onConfirm: () => {
      sendSocket({ type: 'resign' });
    },
  });
}

function requestAbort(sendSocket: SendSocket, locale: Locale = currentLocale()): void {
  if (!readAccountPreferences().confirmGameActions) {
    sendSocket({ type: 'abort' });
    return;
  }
  openConfirmDialog({
    title: t('live.abortTitle', {}, locale),
    body: t('live.abortBody', {}, locale),
    confirmLabel: t('live.abort', {}, locale),
    cancelLabel: t('setup.cancel', {}, locale),
    confirmTone: 'danger',
    onConfirm: () => {
      sendSocket({ type: 'abort' });
    },
  });
}
