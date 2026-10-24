import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  lastBotGame,
  rememberBotRoomRequest,
  rememberedPveEngine,
  rememberPveEngine,
} from './pve-memory.js';

const KEY = 'mistboard:setup:pve';

// happy-dom's window carries no usable localStorage under vitest (Node's own
// experimental global shadows it), so the tests install a minimal in-memory
// Storage the way puzzles/storage.test.ts does.
function installMemoryStorage(): () => void {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  return () => {
    if (original) Object.defineProperty(window, 'localStorage', original);
    else delete (window as { localStorage?: unknown }).localStorage;
  };
}

describe('pve-memory', () => {
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = installMemoryStorage();
  });
  afterEach(() => {
    restore();
  });

  it('remembers nothing on a fresh device', () => {
    expect(rememberedPveEngine('xiangqi')).toBeNull();
  });

  it('remembers the last engine per variant and keeps the dialog record intact', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        gameSpecId: 'xiangqi',
        timePresetId: '10m5',
        engineId: 'pikafish',
        engineIdByGameSpec: { jieqi: 'pikafish' },
      }),
    );
    rememberPveEngine('xiangqi', 'fairy-stockfish-level-8');
    expect(rememberedPveEngine('xiangqi')).toBe('fairy-stockfish-level-8');
    expect(rememberedPveEngine('jieqi')).toBe('pikafish');
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    expect(stored).toMatchObject({
      gameSpecId: 'xiangqi',
      timePresetId: '10m5',
      engineId: 'pikafish',
    });
  });

  it('treats a corrupt record as empty rather than throwing', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(rememberedPveEngine('xiangqi')).toBeNull();
    rememberPveEngine('xiangqi', 'fairy-stockfish-level-2');
    expect(rememberedPveEngine('xiangqi')).toBe('fairy-stockfish-level-2');
  });

  it('reads nothing and writes nothing when storage is unavailable', () => {
    restore();
    restore = () => {};
    expect(rememberedPveEngine('xiangqi')).toBeNull();
    expect(() => rememberPveEngine('xiangqi', 'fairy-stockfish-level-2')).not.toThrow();
  });
  it('remembers the last bot game from any room-create body', () => {
    rememberBotRoomRequest({
      mode: 'pve',
      variant: 'dark-chess',
      engineId: 'misty',
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    });
    expect(lastBotGame()).toEqual({
      gameSpecId: 'dark-chess',
      botId: 'misty',
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    });
    // A friend room or a body naming no bot leaves the last bot game alone.
    rememberBotRoomRequest({ mode: 'pvp', gameSpecId: 'xiangqi', engineId: 'x' });
    rememberBotRoomRequest({ mode: 'pve', gameSpecId: 'xiangqi' });
    expect(lastBotGame()?.botId).toBe('misty');
  });
});
