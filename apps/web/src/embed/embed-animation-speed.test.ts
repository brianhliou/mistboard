import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayPreferenceStorageKey, writeDisplayPreference } from '../display-preferences.js';
import { mountJieqiReplayBoard, replayJieqiLine } from '../jieqi-replay-board.js';

// An embed is its own document. The speed is set somewhere else (the gear on
// the article around it, the account page in another tab), so the embed only
// sees the stored value change and a `storage` event, never the settings
// change event the writing page fires on itself.

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

/** Another document wrote the speed: the value changes and only `storage` fires here. */
function speedSetElsewhere(speed: 'none' | 'fast' | 'normal' | 'slow'): void {
  storageValues.set(displayPreferenceStorageKey, JSON.stringify({ pieceAnimation: speed }));
  const event = new Event('storage') as Event & { key: string | null };
  Object.defineProperty(event, 'key', { value: displayPreferenceStorageKey });
  window.dispatchEvent(event);
}

type Glide = { square: string | null; duration: number | undefined };
let glides: Glide[] = [];
const originalAnimate = Element.prototype.animate;

beforeEach(() => {
  glides = [];
  Element.prototype.animate = vi.fn(function (
    this: Element,
    _frames: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const duration = typeof options === 'number' ? options : Number(options?.duration);
    glides.push({ square: this.getAttribute('data-piece-square'), duration });
    return { addEventListener: () => {}, cancel: () => {} } as unknown as Animation;
  }) as typeof Element.prototype.animate;
});

afterEach(() => {
  Element.prototype.animate = originalAnimate;
  storageValues.clear();
  // Leave board-anim's cache at the default for the next test.
  writeDisplayPreference('pieceAnimation', 'normal');
});

describe('study embed piece animation speed', () => {
  it('follows a speed changed in another document without a reload', () => {
    // no face-down piece: i10-f10, g8-f8, e9xf8
    const line = replayJieqiLine(
      '8C/3kA4/6r2/B2N5/9/P4p2P/1A2Pn3/9/3K5/9 w R0A0C0P0N0B0r0a0c0p0n0b0 15 62 -',
      ['i10f10', 'g8f8', 'e9f8'],
    );
    if (!line) throw new Error('line did not replay');
    const host = document.createElement('div');
    document.body.append(host);
    const board = mountJieqiReplayBoard(host, line);
    const pieceGlide = (): number | undefined =>
      glides.filter((glide) => glide.square !== null).at(-1)?.duration;

    speedSetElsewhere('normal');
    board.jumpToPly(1);
    expect(pieceGlide()).toBe(250);

    speedSetElsewhere('slow');
    board.jumpToPly(2);
    expect(pieceGlide()).toBe(500);

    speedSetElsewhere('fast');
    board.jumpToPly(3);
    expect(pieceGlide()).toBe(120);

    glides = [];
    speedSetElsewhere('none');
    board.jumpToPly(2);
    expect(pieceGlide()).toBeUndefined();

    board.destroy();
    host.remove();
  });
});
