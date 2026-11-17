import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lastPlayedVariant,
  rememberLastPlayedVariant,
  withLastPlayedFirst,
} from './last-played-variant.js';

const KEY = 'mistboard:last-played-variant';

describe('last played variant', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('remembers a known variant across reads', () => {
    rememberLastPlayedVariant('jungle-flip');
    expect(window.localStorage.getItem(KEY)).toBe('jungle-flip');
    expect(lastPlayedVariant()).toBe('jungle-flip');
  });

  it.each([null, '', 'unknown-variant', 'toString', '__proto__'])(
    'fails closed for stored value %s',
    (value) => {
      if (value !== null) window.localStorage.setItem(KEY, value);
      expect(lastPlayedVariant()).toBeNull();
    },
  );

  it('returns null when a storage read throws', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(lastPlayedVariant()).toBeNull();
  });

  it('ignores a storage write failure', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    expect(() => rememberLastPlayedVariant('jungle-flip')).not.toThrow();
  });

  it('handles the storage getter itself throwing', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage unavailable');
      },
    });
    try {
      expect(lastPlayedVariant()).toBeNull();
      expect(() => rememberLastPlayedVariant('jungle-flip')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});

describe('withLastPlayedFirst', () => {
  const specs = [
    { gameSpecId: 'xiangqi', label: 'Xiangqi' },
    { gameSpecId: 'jieqi', label: 'Jieqi' },
    { gameSpecId: 'jungle-flip', label: 'Flip Jungle' },
    { gameSpecId: 'gomoku', label: 'Gomoku' },
  ];

  it('moves the last played entry first, preserves the rest, and leaves the input intact', () => {
    const input = [...specs];
    const result = withLastPlayedFirst(input, 'jungle-flip');
    expect(result).toEqual([specs[2], specs[0], specs[1], specs[3]]);
    expect(result[0]).toBe(specs[2]);
    expect(input).toEqual(specs);
  });

  it.each([null, 'absent', 'xiangqi'])('keeps the input order for %s', (last) => {
    expect(withLastPlayedFirst([...specs], last)).toEqual(specs);
  });

  it('keeps an empty list empty', () => {
    expect(withLastPlayedFirst([], 'jungle-flip')).toEqual([]);
  });
});
