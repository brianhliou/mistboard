import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type GameStartSoundDeps,
  gameStartSoundStorageKey,
  maybePlayGameStartSound,
  resetGameStartSoundForTests,
} from './live-game-start-sound.js';
import {
  type LiveLifecycleSnapshot,
  lifecycleEffectForTransition,
} from './live-lifecycle-effects.js';

function snapshot(overrides: Partial<LiveLifecycleSnapshot> = {}): LiveLifecycleSnapshot {
  return {
    gameId: 'game-1',
    status: 'playing',
    moveNumber: 1,
    ready: true,
    seated: true,
    isLive: true,
    seat: 'red',
    winner: null,
    ...overrides,
  };
}

function memoryStorage(): Map<string, string> & Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>() as Map<string, string> &
    Pick<Storage, 'getItem' | 'setItem'>;
  values.getItem = (key: string) => values.get(key) ?? null;
  values.setItem = (key: string, value: string) => {
    values.set(key, value);
  };
  return values;
}

// One page load of a room: a fresh lifecycle history, the tab's storage kept.
function loadRoom(frames: LiveLifecycleSnapshot[], deps: GameStartSoundDeps): number {
  let previous: LiveLifecycleSnapshot | null = null;
  let plays = 0;
  for (const frame of frames) {
    const effect = lifecycleEffectForTransition(previous, frame);
    previous = frame;
    if (maybePlayGameStartSound(effect, frame.gameId, deps)) plays += 1;
  }
  return plays;
}

describe('game-start sound decisions', () => {
  let storage: ReturnType<typeof memoryStorage>;
  let play: ReturnType<typeof vi.fn<() => void>>;
  let deps: GameStartSoundDeps;

  beforeEach(() => {
    resetGameStartSoundForTests();
    storage = memoryStorage();
    play = vi.fn<() => void>();
    deps = { play, storage: () => storage };
  });

  it('sounds a PvE game on its first load at the start', () => {
    // PvE rooms are ready from the first frame (engine seat is always there).
    expect(loadRoom([snapshot()], deps)).toBe(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(storage.getItem(gameStartSoundStorageKey('game-1'))).toBe('1');
  });

  it('sounds a PvE game whose engine already made the opening move', () => {
    // The engine moved first: still moveNumber 1, the human to move.
    expect(loadRoom([snapshot({ seat: 'black' })], deps)).toBe(1);
  });

  it('sounds a PvP game once, when the opponent arrives', () => {
    expect(loadRoom([snapshot({ ready: false }), snapshot(), snapshot()], deps)).toBe(1);
  });

  it('stays silent on a mid-game reload', () => {
    expect(loadRoom([snapshot({ moveNumber: 5 })], deps)).toBe(0);
    expect(play).not.toHaveBeenCalled();
  });

  it('stays silent for a spectator', () => {
    expect(loadRoom([snapshot({ seated: false, seat: null })], deps)).toBe(0);
  });

  it('stays silent on a finished game', () => {
    expect(loadRoom([snapshot({ status: 'finished', winner: 'red' })], deps)).toBe(0);
  });

  it('stays silent in correspondence (the lifecycle frame never reads it ready)', () => {
    expect(loadRoom([snapshot({ ready: false })], deps)).toBe(0);
  });

  it('does not sound again when the same room reloads at the start', () => {
    expect(loadRoom([snapshot()], deps)).toBe(1);
    // A real reload: the module Set is gone, only sessionStorage survives.
    resetGameStartSoundForTests();
    expect(loadRoom([snapshot()], deps)).toBe(0);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('sounds a rematch, which is a new game', () => {
    expect(loadRoom([snapshot()], deps)).toBe(1);
    expect(loadRoom([snapshot({ gameId: 'game-2' })], deps)).toBe(1);
  });

  it('still sounds once when storage throws', () => {
    const throwing: GameStartSoundDeps = {
      play,
      storage: () => ({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    };
    expect(loadRoom([snapshot()], throwing)).toBe(1);
    expect(loadRoom([snapshot()], throwing)).toBe(0);
    expect(loadRoom([snapshot()], { play, storage: () => null })).toBe(0);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
