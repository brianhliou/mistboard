import { createClock, type PlayerView } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderClocks } from './live-clocks.js';
import { liveState } from './live-state.js';

type Refs = {
  clockTop: HTMLDivElement;
  clockBottom: HTMLDivElement;
  clockNote: HTMLDivElement;
  playerTop: HTMLDivElement;
  playerBottom: HTMLDivElement;
};

function makeRefs(): Refs {
  return {
    clockTop: document.createElement('div'),
    clockBottom: document.createElement('div'),
    clockNote: document.createElement('div'),
    playerTop: document.createElement('div'),
    playerBottom: document.createElement('div'),
  };
}

function playingView(): PlayerView {
  return {
    id: 'r',
    variant: 'dark-chess',
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: { type: 'playing', turn: 'white' },
    perspective: 'white',
    moveNumber: 1,
    clock: createClock(0),
  };
}

// perspective 'white' → the top slots render black's row, the bottom slots white's.
// Player lines (and their presence dots) render into playerTop/playerBottom.
function dot(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector('.presence-dot');
}

beforeEach(() => {
  liveState.connectionState = 'connected';
  liveState.connectionNoticeTier = 'none';
  liveState.connectedSeats = { white: true, black: true };
});

afterEach(() => {
  liveState.connectionState = 'connecting';
  liveState.connectionNoticeTier = 'none';
  liveState.seat = 'spectator';
  liveState.roomMode = 'pvp';
  liveState.connectedSeats = { white: false, black: false };
});

describe('presence dots — PvP', () => {
  it('shows both players green when connected', () => {
    liveState.roomMode = 'pvp';
    liveState.seat = 'white';
    const refs = makeRefs();
    renderClocks(refs, playingView());
    expect(dot(refs.playerBottom)?.classList.contains('is-online')).toBe(true); // you
    expect(dot(refs.playerTop)?.classList.contains('is-online')).toBe(true); // opponent
  });

  it('greys the opponent from server presence, your own from local socket', () => {
    liveState.roomMode = 'pvp';
    liveState.seat = 'white';
    liveState.connectedSeats = { white: true, black: false }; // opponent dropped server-side
    const refs = makeRefs();
    renderClocks(refs, playingView());
    expect(dot(refs.playerTop)?.classList.contains('is-offline')).toBe(true); // opponent grey
    expect(dot(refs.playerBottom)?.classList.contains('is-online')).toBe(true); // you still green
  });

  it('greys your own dot while reconnecting, independent of stale connectedSeats', () => {
    liveState.roomMode = 'pvp';
    liveState.seat = 'white';
    liveState.connectedSeats = { white: true, black: true }; // stale: server thinks you're up
    liveState.connectionState = 'reconnecting';
    liveState.connectionNoticeTier = 'dot';
    const refs = makeRefs();
    renderClocks(refs, playingView());
    const own = dot(refs.playerBottom);
    expect(own?.classList.contains('is-offline')).toBe(true);
    expect(own?.title).toBe('Reconnecting');
  });
});

describe('presence dots — PvE', () => {
  it('shows your own dot green but never gives the engine one', () => {
    liveState.roomMode = 'pve';
    liveState.seat = 'white';
    const refs = makeRefs();
    renderClocks(refs, playingView());
    expect(dot(refs.playerBottom)?.classList.contains('is-online')).toBe(true); // you
    expect(dot(refs.playerTop)).toBeNull(); // engine: no socket, no dot
  });

  it('greys your own dot on reconnect; engine stays dot-less', () => {
    liveState.roomMode = 'pve';
    liveState.seat = 'white';
    liveState.connectionState = 'reconnecting';
    liveState.connectionNoticeTier = 'banner';
    const refs = makeRefs();
    renderClocks(refs, playingView());
    expect(dot(refs.playerBottom)?.classList.contains('is-offline')).toBe(true); // you
    expect(dot(refs.playerTop)).toBeNull(); // engine still dot-less
  });
});

describe('presence dots — EvE (spectating)', () => {
  it('renders no dots for either engine', () => {
    liveState.roomMode = 'eve';
    liveState.seat = 'spectator';
    const refs = makeRefs();
    renderClocks(refs, playingView());
    expect(dot(refs.playerTop)).toBeNull();
    expect(dot(refs.playerBottom)).toBeNull();
  });
});

describe('day-scale clocks (correspondence)', () => {
  // These tests set runningSince to "now" and assert the exact rendered remaining,
  // which a live clock counts down from. Freeze the clock so the elapsed between
  // setup and render is deterministically zero — otherwise '3d 0h' flakes to
  // '2d 23h' (and '3:00' to '2:59') on slower CI runners.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    liveState.timeControl = null;
    liveState.roomMode = 'pvp';
  });

  it('renders day-scale times and the per-move allowance note', () => {
    liveState.roomMode = 'correspondence';
    liveState.seat = 'white';
    liveState.timeControl = { initialMs: 3 * 24 * 3_600_000, incrementMs: 0, daysPerMove: 3 };
    const refs = makeRefs();
    const view = playingView();
    view.clock = {
      ...createClock(3 * 24 * 3_600_000),
      activeColor: 'white',
      remainingMs: { white: 3 * 24 * 3_600_000, black: 3 * 24 * 3_600_000 },
      runningSince: Date.now(),
    };
    renderClocks(refs, view);
    expect(refs.clockBottom.querySelector('strong')?.textContent).toBe('3d 0h');
    expect(refs.clockNote.hidden).toBe(false);
    expect(refs.clockNote.textContent).toBe('3 days per move');
  });

  it('keeps live formatting when no daysPerMove is present', () => {
    liveState.seat = 'white';
    liveState.timeControl = { initialMs: 180_000, incrementMs: 2_000 };
    const refs = makeRefs();
    const view = playingView();
    view.clock = {
      ...createClock(180_000),
      activeColor: 'white',
      remainingMs: { white: 180_000, black: 180_000 },
      runningSince: Date.now(),
    };
    renderClocks(refs, view);
    // Lichess face: zero-padded minutes (clock-emphasis.ts setClockFace).
    expect(refs.clockBottom.querySelector('strong')?.textContent).toBe('03:00');
    expect(refs.clockNote.hidden).toBe(true);
  });
});
