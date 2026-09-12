import type { PlayerView } from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlayAgainRoomRequestBody } from './live-room-actions.js';
import { liveState } from './live-state.js';

afterEach(() => {
  liveState.roomMode = 'pvp';
  liveState.seat = 'spectator';
  liveState.pveEngineId = null;
  liveState.state = null;
  liveState.variantRequested = null;
  liveState.events = [];
  liveState.timeControl = null;
});

describe('buildPlayAgainRoomRequestBody', () => {
  it('flips the human color when replaying a PvE game as white', () => {
    liveState.roomMode = 'pve';
    liveState.seat = 'white';
    liveState.pveEngineId = 'builtin-random-legal';
    liveState.state = makeView();

    expect(buildPlayAgainRoomRequestBody()).toEqual({
      mode: 'pve',
      variant: 'dark-chess',
      engineId: 'builtin-random-legal',
      preferredColor: 'black',
    });
  });

  it('flips the human color when replaying a PvE game as black', () => {
    liveState.roomMode = 'pve';
    liveState.seat = 'black';
    liveState.state = makeView();

    expect(buildPlayAgainRoomRequestBody()).toEqual({
      mode: 'pve',
      variant: 'dark-chess',
      preferredColor: 'white',
    });
  });

  it('leaves spectator PvE play-again color random', () => {
    liveState.roomMode = 'pve';
    liveState.seat = 'spectator';
    liveState.state = makeView();

    expect(buildPlayAgainRoomRequestBody()).toEqual({
      mode: 'pve',
      variant: 'dark-chess',
    });
  });

  it('carries the current time control into the rematch (1+1 stays 1+1)', () => {
    liveState.roomMode = 'pve';
    liveState.seat = 'white';
    liveState.pveEngineId = 'python-v2-v1.0';
    liveState.state = makeView();
    liveState.timeControl = { initialMs: 60_000, incrementMs: 1_000 };

    expect(buildPlayAgainRoomRequestBody()).toEqual({
      mode: 'pve',
      variant: 'dark-chess',
      engineId: 'python-v2-v1.0',
      preferredColor: 'black',
      timeControl: { initialMs: 60_000, incrementMs: 1_000 },
    });
  });
});

function makeView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    id: 'test-room',
    variant: 'dark-chess',
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: { type: 'finished', winner: 'white', reason: 'king-captured' },
    perspective: 'white',
    moveNumber: 1,
    ...overrides,
  };
}
