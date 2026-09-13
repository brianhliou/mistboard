import type { Color, GameEndReason, PlayerView } from '@mistboard/game';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { type I18nKey, t } from './i18n/catalog.js';
import type { ConnectionNoticeTier, InfoTone, PlayableSeat, Seat } from './live-state.js';
import { liveState } from './live-state.js';
import { isColor } from './web-utils.js';

// Staged visibility for a connection problem. A mid-game socket drop usually
// recovers in well under a second, so 'disconnected'/'reconnecting' only earn the
// full notice once the live-socket timers have escalated them; until then the
// player's own presence dot carries the signal (or, in the grace window, nothing
// shows at all). Terminal/pre-board states ('connecting' on first load,
// 'displaced', 'rejected') always warrant the full notice.
export function connectionNoticeMode(): ConnectionNoticeTier {
  const state = liveState.connectionState;
  if (state === 'connected') return 'none';
  if (state === 'displaced' || state === 'rejected' || state === 'connecting') return 'banner';
  return liveState.connectionNoticeTier;
}

// A correspondence room is awaiting its opponent until the second seat is
// claimed. Tenant dark-chess rooms are status 'playing' from creation (the
// tenant state has no pregame), so the seat claim is the signal: correspondence
// seats require accounts, so a claimed seat always carries a display name.
export function correspondenceAwaitingOpponent(): boolean {
  if (liveState.roomMode !== 'correspondence') return false;
  if (!isColor(liveState.seat)) return false;
  const theirSeat: Color = liveState.seat === 'white' ? 'black' : 'white';
  return !liveState.seatDisplayNames[theirSeat];
}

export function actionTone(view: PlayerView | null): InfoTone {
  if (connectionNoticeMode() === 'banner') {
    return liveState.connectionState === 'connecting' ||
      liveState.connectionState === 'reconnecting'
      ? 'pending'
      : 'danger';
  }
  if (!view) return 'pending';
  if (view.status.type === 'finished') {
    const seat = liveState.seat;
    if (seat === 'white' || seat === 'black') {
      if (view.status.winner === null) return 'default';
      return view.status.winner === seat ? 'success' : 'danger';
    }
    return 'default';
  }
  if (liveState.seat === 'spectator') return 'default';
  if (view.status.type === 'playing' && view.status.turn === pveEngineSeat()) return 'pending';
  if (view.status.type === 'playing' && view.status.turn === liveState.seat) return 'success';
  return 'default';
}

export function actionTitle(view: PlayerView | null): string {
  if (connectionNoticeMode() === 'banner') {
    if (liveState.connectionState === 'rejected') return t('live.statusAccessRejected');
    if (liveState.connectionState === 'displaced') return t('live.statusSessionMoved');
    if (liveState.connectionState === 'connecting') return t('live.statusConnecting');
    return t('live.statusReconnecting');
  }
  if (!view) return t('live.statusConnecting');
  if (view.status.type === 'finished') return finishedTitle(view.status.winner);
  if (view.status.type === 'aborted') return t('live.statusGameAborted');
  if (liveState.seat === 'spectator') return t('live.statusWatching');
  if (view.status.type === 'playing' && view.status.turn === pveEngineSeat())
    return t('live.statusEngineThinking');
  if (view.status.type === 'playing' && view.status.turn === liveState.seat)
    return t('live.statusYourMove');
  if (view.status.type === 'playing' && correspondenceAwaitingOpponent())
    return t('live.statusWaitingForOpponent');
  return t('live.statusOpponentMove');
}

export function actionBody(view: PlayerView | null): string {
  if (connectionNoticeMode() === 'banner') {
    if (liveState.connectionState === 'rejected') return rejectedBody();
    if (liveState.connectionState === 'displaced') return t('live.bodyDisplaced');
    if (liveState.connectionState === 'disconnected') return t('live.bodyDisconnected');
    if (liveState.connectionState === 'reconnecting') return t('live.bodyReconnecting');
    return t('live.bodyOpeningRoom');
  }
  if (!view) return t('live.bodyOpeningRoom');
  if (view.status.type === 'finished') {
    return finishedBody(view.status.winner, view.status.reason);
  }
  if (view.status.type === 'aborted') {
    return t('live.bodyAborted');
  }
  if (liveState.seat === 'spectator') return spectatorBody(view);
  if (view.status.type === 'playing' && view.status.turn === pveEngineSeat()) {
    return t('live.bodyEngineClock');
  }
  if (view.status.type === 'playing' && correspondenceAwaitingOpponent()) {
    return view.status.turn === liveState.seat
      ? t('live.bodyShareInviteThenMove')
      : t('live.bodyShareInvite');
  }
  if (view.status.type === 'playing' && view.status.turn === liveState.seat) {
    return t('live.bodyMoveVisiblePiece');
  }
  return t('live.bodyColorOnMove', { color: colorLabel(view.status.turn) });
}

export function boardStatusLabel(): string {
  if (liveState.connectionState === 'rejected') return t('live.statusAccessRejected');
  if (liveState.connectionState === 'displaced') return t('live.statusSessionMoved');
  if (liveState.connectionState === 'disconnected' || liveState.connectionState === 'reconnecting')
    return t('live.statusReconnecting');
  return liveState.clientId ? t('live.statusWaitingForBoard') : t('live.statusConnecting');
}

export function boardStatusTone(): 'pending' | 'danger' {
  if (liveState.connectionState === 'rejected') return 'danger';
  if (liveState.connectionState === 'displaced') return 'danger';
  if (liveState.connectionState === 'disconnected') return 'danger';
  return 'pending';
}

export function modeLabel(): string {
  if (liveState.solo) return t('live.modeSoloDev');
  if (liveState.roomMode === 'pve') return t('live.modePlayEngine');
  if (liveState.roomMode === 'pvp') return t('live.modeFriendChallenge');
  if (liveState.roomMode === 'eve') return t('live.modeEngineGame');
  return capitalize(liveState.roomMode);
}

export function seatLabel(value: Seat): string {
  if (liveState.solo) return t('live.modeSoloDev');
  if (value === 'spectator') return t('live.seatSpectator');
  return colorLabel(value);
}

// Colour names come from the shared setup.* keys so the board, the pregame
// picker, and the outcome sentences cannot drift apart per locale. Typed on
// PlayableSeat, not Color: xiangqi seats are red/black, and a total map is what
// keeps a raw seat from reaching a chess-only colour render.
const SEAT_COLOR_KEYS: Record<PlayableSeat, I18nKey> = {
  black: 'setup.black',
  red: 'setup.red',
  white: 'setup.white',
};

function colorLabel(value: PlayableSeat): string {
  return t(SEAT_COLOR_KEYS[value]);
}

function pveEngineSeat(): Color | null {
  if (liveState.roomMode !== 'pve') return null;
  if (!isColor(liveState.seat)) return null;
  return liveState.seat === 'white' ? 'black' : 'white';
}

function spectatorBody(view: PlayerView): string {
  if (view.status.type === 'finished') return t('live.spectatorOpenReview');
  if (liveState.clientCount < 3 && liveState.roomMode === 'pvp')
    return t('live.spectatorWaitingSeats');
  return t('live.spectatorFogView');
}

function resultTitle(winner: Color | null): string {
  if (winner === 'white') return t('result.whiteWins');
  if (winner === 'black') return t('result.blackWins');
  return t('result.draw');
}

function finishedTitle(winner: Color | null): string {
  const seat = liveState.seat;
  if (seat === 'white' || seat === 'black') {
    if (winner === null) return t('result.draw');
    return winner === seat ? t('result.youWon') : t('result.youLost');
  }
  return resultTitle(winner);
}

function finishedBody(winner: Color | null, reason: GameEndReason): string {
  const reasonPhrase = reasonPhraseLabel(reason);
  const seat = liveState.seat;
  if (seat === 'white' || seat === 'black') {
    if (winner === null) return t('result.reasonOnly', { reason: capitalize(reasonPhrase) });
    const youWon = winner === seat;
    if (reason === 'resignation')
      return youWon ? t('result.opponentResigned') : t('result.youResigned');
    if (reason === 'timeout') return youWon ? t('result.opponentTimeout') : t('result.youTimeout');
    if (reason === 'abandonment' && liveState.roomMode === 'pve') {
      return youWon ? t('result.engineForfeited') : t('result.youForfeited');
    }
    return youWon
      ? t('result.youWonBy', { reason: reasonPhrase })
      : t('result.opponentWonBy', { reason: reasonPhrase });
  }
  if (winner === null) return t('result.reasonOnly', { reason: capitalize(reasonPhrase) });
  return t('result.colorWinsBy', { color: colorLabel(winner), reason: reasonPhrase });
}

const REASON_PHRASE_KEYS: Record<GameEndReason, I18nKey> = {
  abandonment: 'result.abandonment',
  checkmate: 'result.checkmate',
  draw: 'result.drawPhrase',
  'king-captured': 'result.kingCapture',
  resignation: 'result.resignation',
  timeout: 'result.timeout',
};

// Total map, not a fallthrough to the raw enum: an unmapped reason used to
// render its own wire value ('king-captured') straight into the sentence.
// Exported so the meta card in live-render renders the same phrase this does.
export function reasonPhraseLabel(reason: GameEndReason): string {
  return t(REASON_PHRASE_KEYS[reason]);
}

function rejectedBody(): string {
  if (liveState.closeReason === 'play disabled') return t('live.rejectedPlayDisabled');
  if (liveState.closeReason === 'private room') return t('live.rejectedPrivateRoom');
  if (liveState.closeReason === 'rated requires account') return t('live.rejectedRatedAccount');
  if (liveState.closeReason === 'correspondence requires account')
    return t('live.rejectedCorrespondenceAccount');
  if (liveState.closeReason === 'origin not allowed') return t('live.rejectedOrigin');
  if (liveState.closeReason === 'rate limit') return t('live.rejectedRateLimit');
  return t('live.rejectedDefault');
}

// The rejection banner's sign-in CTA. Only the account-gated rejections earn
// one. The login href carries the invite URL as the auth referrer, so after
// sign-in the account page bounces the player straight back to the invite
// (account.ts consumes requestedAuthReferrer() on auth success) and the
// reconnect seats them.
export function rejectedSignInHref(): string | null {
  if (
    liveState.closeReason !== 'rated requires account' &&
    liveState.closeReason !== 'correspondence requires account'
  ) {
    return null;
  }
  return loginHrefForCurrentPage();
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
