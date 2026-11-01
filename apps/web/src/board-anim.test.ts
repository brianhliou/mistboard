import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  afterBoardSettles,
  BOARD_SETTLE_MAX_WAIT_MS,
  boardSettled,
  chessgroundAnimation,
  glideSvgPiece,
  holdBoardSettle,
  PIECE_GLIDE_EASING,
  pieceAnimationDurationMs,
  resetBoardSettleForTests,
  trackPieceAnimation,
} from './board-anim.js';
import { type DisplayPreferenceValue, writeDisplayPreference } from './display-preferences.js';

// The write API types select values as the pref's DEFAULT literal; the settings
// UI casts the option through DisplayPreferenceValue (see account.ts), so the
// tests do the same.
function setPieceAnimation(value: 'none' | 'fast' | 'normal' | 'slow'): void {
  writeDisplayPreference('pieceAnimation', value as DisplayPreferenceValue<'pieceAnimation'>);
}

// This happy-dom build ships no window.localStorage; back it with memory (same
// idiom as puzzles.test.ts) so writeDisplayPreference can persist + notify.
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

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  // Restore the default and let the change event flush board-anim's cache.
  setPieceAnimation('normal');
});

describe('pieceAnimationDurationMs', () => {
  it('maps the pieceAnimation preference to durations and re-reads on change', () => {
    setPieceAnimation('normal');
    expect(pieceAnimationDurationMs()).toBe(250);
    setPieceAnimation('fast');
    expect(pieceAnimationDurationMs()).toBe(120);
    setPieceAnimation('slow');
    expect(pieceAnimationDurationMs()).toBe(500);
    setPieceAnimation('none');
    expect(pieceAnimationDurationMs()).toBe(0);
  });

  it('returns 0 when the OS asks for reduced motion, regardless of the preference', () => {
    const original = window.matchMedia;
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    try {
      setPieceAnimation('slow');
      expect(pieceAnimationDurationMs()).toBe(0);
      expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('chessgroundAnimation', () => {
  it('disables chessground animation at duration 0 and enables it otherwise', () => {
    setPieceAnimation('none');
    expect(chessgroundAnimation()).toEqual({ enabled: false, duration: 0 });
    setPieceAnimation('normal');
    expect(chessgroundAnimation()).toEqual({ enabled: true, duration: 250 });
  });
});

describe('glideSvgPiece', () => {
  it('no-ops without throwing when the element has no WAAPI (test DOM)', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    // happy-dom may or may not ship el.animate; force the feature-missing path.
    (el as unknown as { animate?: unknown }).animate = undefined;
    expect(() => glideSvgPiece(el, -60, 0, 250)).not.toThrow();
  });

  it('cancels in-flight animations and glides from the offset back to rest', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const cancel = vi.fn();
    const animate = vi.fn();
    Object.assign(el, {
      animate,
      getAnimations: () => [{ cancel }] as unknown as Animation[],
    });
    glideSvgPiece(el, -180, 60, 250);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: 'translate(-180px, 60px)' }, { transform: 'none' }],
      { duration: 250, easing: PIECE_GLIDE_EASING },
    );
  });

  it('does not animate zero-length glides or zero durations', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const animate = vi.fn();
    Object.assign(el, { animate });
    glideSvgPiece(el, 0, 0, 250);
    glideSvgPiece(el, -60, 0, 0);
    expect(animate).not.toHaveBeenCalled();
  });
});

// #825: the game-over sound waits for the final move to land, chained on the
// animation's own finish event rather than a guessed delay.
describe('afterBoardSettles', () => {
  function fakeAnimation(): EventTarget & { finish(): void; cancel(): void } {
    const target = new EventTarget();
    return Object.assign(target, {
      finish: () => target.dispatchEvent(new Event('finish')),
      cancel: () => target.dispatchEvent(new Event('cancel')),
    });
  }
  const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  afterEach(() => resetBoardSettleForTests());

  it('runs at once when nothing is moving', () => {
    const run = vi.fn();
    afterBoardSettles(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits for a tracked glide to finish', async () => {
    const glide = fakeAnimation();
    trackPieceAnimation(glide);
    const run = vi.fn();
    afterBoardSettles(run);
    await flush();
    expect(run).not.toHaveBeenCalled();
    glide.finish();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(boardSettled()).toBe(true);
  });

  it('a cancelled glide settles too (a re-render replaced it)', async () => {
    const glide = fakeAnimation();
    trackPieceAnimation(glide);
    const run = vi.fn();
    afterBoardSettles(run);
    glide.cancel();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a hold released by the render that starts the glide waits for that glide', async () => {
    const release = holdBoardSettle();
    const run = vi.fn();
    afterBoardSettles(run);
    // The render: release, then start the final move's glide in the same task.
    release();
    const glide = fakeAnimation();
    trackPieceAnimation(glide);
    await flush();
    expect(run).not.toHaveBeenCalled();
    glide.finish();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a hold released with nothing to animate runs on the next microtask', async () => {
    const release = holdBoardSettle();
    const run = vi.fn();
    afterBoardSettles(run);
    release();
    release(); // idempotent
    expect(run).not.toHaveBeenCalled();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never drops the call: a hold that is never released gives way after the cap', () => {
    vi.useFakeTimers();
    try {
      holdBoardSettle();
      const run = vi.fn();
      afterBoardSettles(run);
      vi.advanceTimersByTime(BOARD_SETTLE_MAX_WAIT_MS - 1);
      expect(run).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('glideSvgPiece registers the glide it starts', async () => {
    const glide = fakeAnimation();
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    Object.assign(el, { animate: () => glide, getAnimations: () => [] });
    glideSvgPiece(el, -60, 0, 250);
    expect(boardSettled()).toBe(false);
    glide.finish();
    expect(boardSettled()).toBe(true);
  });
});
