import type { GameEvent, PlayerView } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureFogView,
  handleReplayButtonClick,
  replayMetaLabel,
  resetReplayState,
} from './live-replay.js';
import { playSound } from './live-sound.js';
import { liveState } from './live-state.js';
import { currentView } from './live-view.js';

vi.mock('./live-sound.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./live-sound.js')>();
  return { ...actual, playSound: vi.fn() };
});

const roomId = 'fog-terminal-forfeit';

const roomCreated: GameEvent = {
  type: 'room-created',
  at: 1,
  roomId,
  variant: 'dark-chess',
};

const whiteFirstMove: GameEvent = {
  type: 'move-played',
  at: 2,
  roomId,
  color: 'white',
  move: { from: 'e2', to: 'e4' },
};

const whiteSecondMove: GameEvent = {
  type: 'move-played',
  at: 4,
  roomId,
  color: 'white',
  move: { from: 'e4', to: 'd5' },
  capturedRole: 'pawn',
};

const blackForfeit: GameEvent = {
  type: 'seat-forfeited',
  at: 5,
  roomId,
  color: 'black',
};

const whiteKingCapture: GameEvent = {
  type: 'move-played',
  at: 6,
  roomId,
  color: 'white',
  move: { from: 'e6', to: 'e7' },
  capturedRole: 'king',
};

afterEach(() => {
  vi.clearAllMocks();
  resetReplayState();
  liveState.events = [];
  liveState.roomMode = 'pvp';
  liveState.seat = 'spectator';
  liveState.state = null;
});

describe('live fog replay', () => {
  it('does not count terminal non-move snapshots as plies', () => {
    resetReplayState();
    liveState.roomMode = 'pve';
    liveState.seat = 'white';

    capture(makeView(), [roomCreated]);
    capture(
      makeView({
        board: {
          e1: { color: 'white', role: 'king' },
          e4: { color: 'white', role: 'pawn' },
        },
        lastMove: { from: 'e2', to: 'e4' },
        status: { type: 'playing', turn: 'black' },
        visibleSquares: ['e1', 'e4'],
      }),
      [roomCreated, whiteFirstMove],
    );
    capture(
      makeView({
        board: {
          d5: { color: 'black', role: 'pawn' },
          e1: { color: 'white', role: 'king' },
          e4: { color: 'white', role: 'pawn' },
        },
        moveNumber: 2,
        status: { type: 'playing', turn: 'white' },
        visibleSquares: ['d5', 'e1', 'e4'],
      }),
      [roomCreated, whiteFirstMove],
    );
    const afterLastMove = makeView({
      board: {
        d5: { color: 'white', role: 'pawn' },
        e1: { color: 'white', role: 'king' },
      },
      lastMove: { from: 'e4', to: 'd5' },
      moveNumber: 2,
      status: { type: 'playing', turn: 'black' },
      visibleSquares: ['d5', 'e1'],
    });
    capture(afterLastMove, [roomCreated, whiteFirstMove, whiteSecondMove]);
    capture(
      {
        ...afterLastMove,
        status: { type: 'finished', winner: 'white', reason: 'abandonment' },
      },
      [roomCreated, whiteFirstMove, whiteSecondMove, blackForfeit],
    );

    expect(replayMetaLabel()).toBe('Live · ply 3 of 3');

    handleReplayButtonClick('prev');

    expect(replayMetaLabel()).toBe('Replay · ply 2 of 3');
  });

  it('uses the seat-scoped server live view after a finished fog game', () => {
    resetReplayState();
    liveState.roomMode = 'pve';
    liveState.seat = 'white';
    liveState.events = [roomCreated, whiteFirstMove, whiteSecondMove, blackForfeit];
    liveState.state = makeView({
      board: {
        d5: { color: 'white', role: 'pawn' },
        e1: { color: 'white', role: 'king' },
      },
      lastMove: { from: 'e4', to: 'd5' },
      moveNumber: 2,
      status: { type: 'finished', winner: 'white', reason: 'abandonment' },
      visibleSquares: ['d5', 'e1'],
    });

    const view = currentView();

    expect(view).toBe(liveState.state);
    expect(view?.board.d5).toEqual({ color: 'white', role: 'pawn' });
    expect(view?.board.e4).toBeUndefined();
    expect(view?.board.h8).toBeUndefined();
  });

  it('replays the king-capture sound for a visible winning capture', () => {
    resetReplayState();
    liveState.roomMode = 'pvp';
    liveState.seat = 'white';

    capture(
      makeView({
        board: {
          e1: { color: 'white', role: 'king' },
          e6: { color: 'white', role: 'queen' },
          e7: { color: 'black', role: 'king' },
        },
        visibleSquares: ['e1', 'e6', 'e7'],
      }),
      [roomCreated],
    );
    capture(
      makeView({
        board: {
          e1: { color: 'white', role: 'king' },
          e7: { color: 'white', role: 'queen' },
        },
        lastMove: whiteKingCapture.move,
        status: { type: 'finished', winner: 'white', reason: 'king-captured' },
        visibleSquares: ['e1', 'e7'],
      }),
      [roomCreated, whiteKingCapture],
    );

    handleReplayButtonClick('first');
    vi.mocked(playSound).mockClear();
    handleReplayButtonClick('next');

    expect(playSound).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenCalledWith('king-capture');
  });
});

function capture(view: PlayerView, events: GameEvent[]): void {
  liveState.state = view;
  liveState.events = events;
  captureFogView();
}

function makeView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    id: roomId,
    variant: 'dark-chess',
    board: {
      e1: { color: 'white', role: 'king' },
      e2: { color: 'white', role: 'pawn' },
    },
    visibleSquares: ['e1', 'e2'],
    legalMoves: [],
    status: { type: 'playing', turn: 'white' },
    perspective: 'white',
    moveNumber: 1,
    ...overrides,
  };
}
