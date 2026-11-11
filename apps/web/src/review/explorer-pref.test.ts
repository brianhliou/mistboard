import { beforeEach, describe, expect, it } from 'vitest';
import { explorerOpenPreferred, setExplorerOpenPreferred } from './explorer-pref.js';

const KEY = 'mistboard:review:explorer';

// This happy-dom build ships no window.localStorage; back it with memory (same
// idiom as engine-arrow-pref.test.ts).
const storageValues = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return storageValues.size;
    },
    clear: () => storageValues.clear(),
    getItem: (key: string) => storageValues.get(key) ?? null,
    key: (index: number) => [...storageValues.keys()][index] ?? null,
    removeItem: (key: string) => void storageValues.delete(key),
    setItem: (key: string, value: string) => void storageValues.set(key, value),
  } satisfies Storage,
});

describe('opening explorer preference (#534)', () => {
  beforeEach(() => {
    storageValues.clear();
  });

  it('starts closed for a first-time reader', () => {
    expect(explorerOpenPreferred()).toBe(false);
  });

  it('round-trips both states', () => {
    setExplorerOpenPreferred(true);
    expect(window.localStorage.getItem(KEY)).toBe('true');
    expect(explorerOpenPreferred()).toBe(true);
    setExplorerOpenPreferred(false);
    expect(explorerOpenPreferred()).toBe(false);
  });

  it('reads an unrecognised stored value as closed', () => {
    window.localStorage.setItem(KEY, 'yes-please');
    expect(explorerOpenPreferred()).toBe(false);
  });

  it('opens for a link that asks (?explorer=open) without writing the preference', () => {
    window.history.replaceState(null, '', '/study/s?explorer=open');
    try {
      expect(explorerOpenPreferred()).toBe(true);
      expect(storageValues.has(KEY)).toBe(false);
      window.history.replaceState(null, '', '/study/s?explorer=closed');
      expect(explorerOpenPreferred()).toBe(false);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('falls back to closed when storage is unavailable (Safari private mode throws)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(explorerOpenPreferred()).toBe(false);
    expect(() => setExplorerOpenPreferred(true)).not.toThrow();
    if (original) Object.defineProperty(window, 'localStorage', original);
  });
});
