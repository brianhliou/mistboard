import type { PlayerView } from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import { liveState } from './live-state.js';
import {
  actionBody,
  actionTitle,
  actionTone,
  connectionNoticeMode,
  correspondenceAwaitingOpponent,
  rejectedSignInHref,
} from './live-status.js';

function playingView(): PlayerView {
  return {
    id: 'test-room',
    variant: 'dark-chess',
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: { type: 'playing', turn: 'white' },
    perspective: 'white',
    moveNumber: 1,
  };
}

afterEach(() => {
  liveState.connectionState = 'connecting';
  liveState.connectionNoticeTier = 'none';
  liveState.seat = 'spectator';
});

describe('connectionNoticeMode — staged reconnect', () => {
  it('is silent (none) when connected', () => {
    liveState.connectionState = 'connected';
    liveState.connectionNoticeTier = 'none';
    expect(connectionNoticeMode()).toBe('none');
  });

  it('stays silent during the grace window of a reconnect', () => {
    // Socket just dropped: state flips to reconnecting but the tier timers have
    // not fired yet. A sub-second blip must surface nothing.
    liveState.connectionState = 'reconnecting';
    liveState.connectionNoticeTier = 'none';
    expect(connectionNoticeMode()).toBe('none');
  });

  it('shows the dot tier once the grace window passes', () => {
    liveState.connectionState = 'reconnecting';
    liveState.connectionNoticeTier = 'dot';
    expect(connectionNoticeMode()).toBe('dot');
  });

  it('escalates to banner once retries keep failing', () => {
    liveState.connectionState = 'reconnecting';
    liveState.connectionNoticeTier = 'banner';
    expect(connectionNoticeMode()).toBe('banner');
  });

  it('always banners for terminal/pre-board states regardless of tier', () => {
    liveState.connectionNoticeTier = 'none';
    for (const state of ['connecting', 'displaced', 'rejected'] as const) {
      liveState.connectionState = state;
      expect(connectionNoticeMode()).toBe('banner');
    }
  });
});

describe('action notice text follows the tier, not the raw socket state', () => {
  it('reports the game state (not "Reconnecting") during the grace window', () => {
    liveState.seat = 'white';
    liveState.connectionState = 'reconnecting';
    liveState.connectionNoticeTier = 'none';
    const view = playingView();
    expect(actionTitle(view)).toBe('Your move');
    expect(actionTone(view)).not.toBe('danger');
  });

  it('still reports the game state at the dot tier', () => {
    liveState.seat = 'white';
    liveState.connectionState = 'reconnecting';
    liveState.connectionNoticeTier = 'dot';
    expect(actionTitle(playingView())).toBe('Your move');
  });

  it('switches to the reconnect notice only at the banner tier', () => {
    liveState.seat = 'white';
    liveState.connectionState = 'reconnecting';
    liveState.connectionNoticeTier = 'banner';
    const view = playingView();
    expect(actionTitle(view)).toBe('Reconnecting');
    expect(actionTone(view)).toBe('pending');
    expect(actionBody(view)).toBe('Trying to restore your room state and seat.');
  });

  it('uses the danger tone for a disconnected banner', () => {
    liveState.seat = 'white';
    liveState.connectionState = 'disconnected';
    liveState.connectionNoticeTier = 'banner';
    expect(actionTone(playingView())).toBe('danger');
  });
});

describe('correspondence waiting-for-opponent states', () => {
  afterEach(() => {
    liveState.roomMode = 'pvp';
    liveState.seatDisplayNames = {};
    liveState.closeReason = '';
  });

  it('is not awaiting when the room is not correspondence or the viewer is unseated', () => {
    liveState.roomMode = 'pvp';
    liveState.seat = 'white';
    expect(correspondenceAwaitingOpponent()).toBe(false);
    liveState.roomMode = 'correspondence';
    liveState.seat = 'spectator';
    expect(correspondenceAwaitingOpponent()).toBe(false);
  });

  it('keys off the opponent seat claim (display name), not connection presence', () => {
    liveState.connectionState = 'connected';
    liveState.roomMode = 'correspondence';
    liveState.seat = 'white';
    liveState.seatDisplayNames = { white: 'Creator' };
    expect(correspondenceAwaitingOpponent()).toBe(true);
    // Once black has claimed (account-backed name on the wire), the invite
    // window is over even while black is offline between moves.
    liveState.seatDisplayNames = { white: 'Creator', black: 'Joiner' };
    expect(correspondenceAwaitingOpponent()).toBe(false);
  });

  it('surfaces share-the-link copy until the opponent claims a seat', () => {
    liveState.connectionState = 'connected';
    liveState.roomMode = 'correspondence';
    liveState.seat = 'black'; // creator took black: white (opponent) is on move
    liveState.seatDisplayNames = { black: 'Creator' };
    const view = playingView(); // turn: white
    expect(actionTitle(view)).toBe('Waiting for opponent');
    expect(actionBody(view)).toBe('Share the invite link below to invite your opponent.');
  });

  it('keeps Your move when the creator can move first, with invite-forward body', () => {
    liveState.connectionState = 'connected';
    liveState.roomMode = 'correspondence';
    liveState.seat = 'white'; // creator took white and is on move
    liveState.seatDisplayNames = { white: 'Creator' };
    const view = playingView();
    expect(actionTitle(view)).toBe('Your move');
    expect(actionBody(view)).toBe(
      'Share the invite link below, then make your first move whenever you like.',
    );
  });

  it('explains the account requirement when a signed-out invitee is rejected', () => {
    liveState.connectionState = 'rejected';
    liveState.closeReason = 'correspondence requires account';
    expect(actionTitle(null)).toBe('Access rejected');
    expect(actionBody(null)).toContain('Both players need an account');
  });
});

describe('rejected sign-in CTA (return-to-invite, issue #22)', () => {
  afterEach(() => {
    liveState.closeReason = '';
    window.history.replaceState(null, '', '/');
  });

  it('carries the invite URL as the auth referrer for account-gated rejections', () => {
    window.history.replaceState(null, '', '/room/abc123?join=1');
    liveState.connectionState = 'rejected';
    for (const reason of ['rated requires account', 'correspondence requires account']) {
      liveState.closeReason = reason;
      expect(rejectedSignInHref()).toBe('/account?tab=login&referrer=%2Froom%2Fabc123%3Fjoin%3D1');
    }
  });

  it('offers no sign-in CTA for rejections an account cannot fix', () => {
    liveState.connectionState = 'rejected';
    for (const reason of ['private room', 'origin not allowed', 'rate limit', '']) {
      liveState.closeReason = reason;
      expect(rejectedSignInHref()).toBeNull();
    }
  });
});
