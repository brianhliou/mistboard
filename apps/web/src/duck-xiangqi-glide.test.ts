// Stepping through a duck game glides both halves of a turn together: the
// piece, and the duck from where it stood (Brian, 2026-10-29: the rules embed
// and the watch page cut instead). Live turns keep the landing plop and no glide.
import { getDuckXiangqiPlayerView } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pieceAnimationDurationMs } from './board-anim.js';
import { animateDuckXiangqiTurn, duckXiangqiBoardSvg } from './duck-xiangqi-board.js';
import { mountDuckXiangqiReplayBoard, replayDuckXiangqiNotation } from './duck-xiangqi-replay.js';

type Call = { target: string; keyframes: Keyframe[]; options: KeyframeAnimationOptions };

function recordAnimations(run: () => void): Call[] {
  const calls: Call[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const original = proto.animate;
  proto.animate = function (
    this: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    const target = this.getAttribute('data-piece-square')
      ? `piece:${this.getAttribute('data-piece-square')}`
      : this.getAttribute('data-duck-square')
        ? `duck:${this.getAttribute('data-duck-square')}`
        : (this.getAttribute('class') ?? this.tagName);
    calls.push({ target, keyframes, options });
    return { cancel: () => {} };
  };
  try {
    run();
  } finally {
    if (original === undefined) delete proto.animate;
    else proto.animate = original;
  }
  return calls;
}

/** The piece and duck glides, without the last-move ring's own arrival. */
function glides(run: () => void): Call[] {
  return recordAnimations(run).filter((c) => /^(piece|duck):/.test(c.target));
}

function setReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion: reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  window.dispatchEvent(new Event('mistboard:display-preferences-change'));
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => Array.from(items.keys())[index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}

// Red's cannon to the centre with the duck on e6, then Black's cannon to the
// centre with the duck moved on to d6.
const MOVES = 'b3e3@e6 b8e8@d6';
const { states } = replayDuckXiangqiNotation(MOVES);
const viewAt = (ply: number) => getDuckXiangqiPlayerView(states[ply]!, 'red');

function boardAt(ply: number): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = duckXiangqiBoardSvg(getDuckXiangqiPlayerView(states[ply]!, 'red'), 'red', {
    interactive: false,
    phase: { kind: 'piece', selected: null },
    targets: [],
  });
  return host;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  setReducedMotion(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.dispatchEvent(new Event('mistboard:display-preferences-change'));
});

describe('animateDuckXiangqiTurn', () => {
  it('glides the piece and the duck from where it stood, together', () => {
    const host = boardAt(2);
    const calls = glides(() => animateDuckXiangqiTurn(host, viewAt(1), viewAt(2), 'red'));
    const duration = pieceAnimationDurationMs();
    expect(calls.map((c) => c.target)).toEqual(['piece:e8', 'duck:d6']);
    expect(calls[0]!.options.delay ?? 0).toBe(0);
    const duck = calls[1]!;
    expect(duck.options).toMatchObject({ duration, fill: 'backwards' });
    expect(duck.options.delay ?? 0).toBe(0);
    // d6 to e6 is one file to the right from Red's side: the duck starts there.
    expect(String(duck.keyframes[0]!.transform)).toMatch(/^translate\([1-9]\d*(\.\d+)?px, 0px\)$/);
  });

  it('fades the first duck in where it lands', () => {
    const host = boardAt(1);
    const calls = glides(() => animateDuckXiangqiTurn(host, viewAt(0), viewAt(1), 'red'));
    expect(calls.map((c) => c.target)).toEqual(['piece:e3', 'duck:e6']);
    expect(calls[1]!.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(calls[1]!.options.duration).toBe(pieceAnimationDurationMs());
  });

  it('undoes both halves at once on a step back', () => {
    const host = boardAt(1);
    const calls = glides(() =>
      animateDuckXiangqiTurn(host, viewAt(1), viewAt(2), 'red', { reverse: true }),
    );
    expect(calls.map((c) => c.target)).toEqual(['piece:b8', 'duck:e6']);
    expect(calls.every((c) => !c.options.delay)).toBe(true);
  });

  // A glide animates the slot's CSS transform, which replaces a transform
  // attribute on the same element: a positioned slot jumps to the board's
  // corner for the glide and pops back (Brian, 2026-10-29).
  it('keeps each piece slot free of its own transform attribute', () => {
    const slots = [...boardAt(2).querySelectorAll('[data-piece-square]')];
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.filter((s) => s.hasAttribute('transform'))).toEqual([]);
  });

  it('does nothing with piece animation off', () => {
    setReducedMotion(true);
    const host = boardAt(2);
    expect(glides(() => animateDuckXiangqiTurn(host, viewAt(1), viewAt(2), 'red'))).toEqual([]);
  });
});

describe('mountDuckXiangqiReplayBoard', () => {
  const spec = { moves: MOVES, red: 'R', black: 'B', event: 'e', resultText: 'r' };

  it('glides a one-ply step and cuts a jump', () => {
    const host = document.createElement('div');
    const board = mountDuckXiangqiReplayBoard(host, spec);
    expect(glides(() => board.jumpToPly(1)).map((c) => c.target)).toEqual(['piece:e3', 'duck:e6']);
    // Back to the start the duck leaves the board: only the piece glides home.
    expect(glides(() => board.jumpToPly(0))).toHaveLength(1);
    expect(glides(() => board.jumpToPly(2))).toEqual([]);
  });
});
