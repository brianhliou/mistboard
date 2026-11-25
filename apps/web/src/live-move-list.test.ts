// The chess-shell move list (Fog Chess rooms) marks the ply the board shows.
// 2026-11-24: a finished room marked every ply it was stepped back to but not
// the last one, because on live the replay index is null and the cell compared
// the ply with null.

import type { GameEvent, PlayerView } from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import { renderReplay, resetMoveListState } from './live-move-list.js';
import { liveState } from './live-state.js';

const ROOM = 'move-list-room';

function roomCreated(): GameEvent {
  return {
    type: 'room-created',
    at: 0,
    roomId: ROOM,
    variant: 'dark-chess',
    offer: [],
    timeControl: { initialMs: 60_000, incrementMs: 0 },
  } as Extract<GameEvent, { type: 'room-created' }>;
}

function move(color: 'white' | 'black', from: string, to: string): GameEvent {
  return {
    type: 'move-played',
    at: 1,
    roomId: ROOM,
    color,
    move: { from: from as never, to: to as never },
  };
}

function view(overrides: Partial<PlayerView>): PlayerView {
  return {
    id: ROOM,
    variant: 'dark-chess',
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: { type: 'playing', turn: 'white' },
    perspective: 'white',
    moveNumber: 1,
    ...overrides,
  };
}

function refs() {
  return {
    moveList: document.createElement('ol'),
    replayControls: document.createElement('div').querySelectorAll<HTMLButtonElement>('button'),
    replayMeta: document.createElement('p'),
  };
}

afterEach(() => {
  liveState.seat = 'spectator';
  liveState.state = null;
  liveState.events = [];
  resetMoveListState();
});

describe('chess-shell move list highlight', () => {
  it('marks the last ply of a finished game when the board is on it', () => {
    liveState.seat = 'spectator';
    liveState.events = [
      roomCreated(),
      move('white', 'e2', 'e4'),
      move('black', 'e7', 'e5'),
      move('white', 'g1', 'f3'),
    ];
    liveState.state = view({
      status: { type: 'finished', winner: 'white', reason: 'resignation' } as never,
      moveNumber: 2,
    });
    const r = refs();
    renderReplay(r);
    const active = [...r.moveList.querySelectorAll('.active')];
    expect(active).toHaveLength(1);
    expect(active[0]?.classList.contains('white-ply')).toBe(true);
    // The third ply is the second row's white cell.
    expect(r.moveList.querySelectorAll('li')[1]?.querySelector('.white-ply')).toBe(active[0]);
  });

  it('marks nothing before the first move', () => {
    liveState.events = [roomCreated()];
    liveState.state = view({});
    const r = refs();
    renderReplay(r);
    expect(r.moveList.querySelector('.active')).toBeNull();
  });
});
