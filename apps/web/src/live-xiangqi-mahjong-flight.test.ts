import { afterEach, describe, expect, it, vi } from 'vitest';
import { scaledPieceAnimationMs } from './board-anim.js';
import { type DisplayPreferenceValue, writeDisplayPreference } from './display-preferences.js';
import { flyIn } from './live-xiangqi-mahjong.js';

// Same memory-backed storage as board-anim.test.ts: this happy-dom build ships
// no window.localStorage, and writeDisplayPreference needs one to notify.
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

function setPieceAnimation(value: 'none' | 'fast' | 'normal' | 'slow'): void {
  writeDisplayPreference('pieceAnimation', value as DisplayPreferenceValue<'pieceAnimation'>);
}

/** A landed tile whose animate() is recorded instead of run. */
function landedTile(): { tile: HTMLElement; animate: ReturnType<typeof vi.fn> } {
  const tile = document.createElement('div');
  tile.getBoundingClientRect = () => new DOMRect(100, 100, 30, 40);
  const animate = vi.fn();
  tile.animate = animate as unknown as HTMLElement['animate'];
  return { tile, animate };
}

const FROM = new DOMRect(10, 10, 30, 40);

function flightTiming(duration: number, delay = 0): { duration: number; delay: number } | null {
  const { tile, animate } = landedTile();
  flyIn(tile, FROM, duration, delay);
  if (animate.mock.calls.length === 0) return null;
  const options = animate.mock.calls[0]![1] as KeyframeAnimationOptions;
  return { duration: options.duration as number, delay: options.delay as number };
}

afterEach(() => {
  window.localStorage.clear();
  setPieceAnimation('normal');
});

describe('xiangqi mahjong tile flights follow the piece animation pref', () => {
  it('keeps the tuned timings at normal speed', () => {
    setPieceAnimation('normal');
    expect(flightTiming(400)).toEqual({ duration: 400, delay: 0 });
    expect(flightTiming(450, 120)).toEqual({ duration: 450, delay: 120 });
  });

  it('flies longer at slow and shorter at fast', () => {
    setPieceAnimation('slow');
    expect(flightTiming(400)).toEqual({ duration: 800, delay: 0 });
    expect(flightTiming(450, 120)).toEqual({ duration: 900, delay: 240 });
    setPieceAnimation('fast');
    expect(flightTiming(400)).toEqual({ duration: 192, delay: 0 });
    expect(flightTiming(450, 120)).toEqual({ duration: 216, delay: 58 });
  });

  it('places the tile with no flight at all when piece animation is none', () => {
    setPieceAnimation('none');
    expect(flightTiming(400)).toBeNull();
    expect(flightTiming(450, 120)).toBeNull();
    expect(scaledPieceAnimationMs(450)).toBe(0);
  });

  it('places the tile with no flight under reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
    })) as unknown as typeof window.matchMedia;
    try {
      setPieceAnimation('slow');
      expect(flightTiming(400)).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});
