// The turn-over a face-down tile plays when it is revealed (#709): when it runs
// (a live reveal only), when it does not (first render, reconnect, scrub,
// replay jump, reduced motion), and that nothing before the reveal carries the
// piece's identity.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIECE_FLIP_DURATION_MS, pieceFlipDurationMs } from './board-anim.js';
import {
  animateBanqiReveal,
  banqiRevealFlipSquare,
  renderBanqiBoardSvg,
} from './live-banqi-render.js';
import { animateJieqiReveal, jieqiRevealSquare } from './live-jieqi-render.js';

const captured = vi.hoisted(() => ({ configs: [] as Array<Record<string, unknown>> }));

vi.mock('./variant-tenant/live-client.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createTenantLiveClient: (config: Record<string, unknown>) => {
      captured.configs.push(config);
      return { bootstrap: () => {} };
    },
  };
});

type AnimateBoard = (refs: { board: HTMLElement }, view: unknown, take: () => unknown) => void;

type Call = { target: string | null; keyframes: Keyframe[]; options: KeyframeAnimationOptions };

/** Every animate() call the run made, by square, else class, else tag. */
function recordAnimations(run: () => void): { calls: Call[]; backs: string[] } {
  const calls: Call[] = [];
  const backs: string[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const original = proto.animate;
  proto.animate = function (
    this: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    const target =
      this.getAttribute('data-piece-square') ?? this.getAttribute('class') ?? this.tagName;
    if (target === 'piece-flip-back') backs.push(this.outerHTML);
    calls.push({ target, keyframes, options });
    return { cancel: () => {} };
  };
  try {
    run();
  } finally {
    if (original === undefined) delete proto.animate;
    else proto.animate = original;
  }
  return { calls, backs };
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
  // board-anim caches the duration; its settings event clears the cache.
  window.dispatchEvent(new Event('mistboard:display-preferences-change'));
}

const IDENTITY = /\b(red|black)\b|chariot|horse|cannon|soldier|general|advisor|elephant|aria-label/;

function banqiView(a1: Record<string, unknown>) {
  return {
    id: 'flip',
    perspective: 'red',
    board: { a1, b1: { faceDown: true } },
    legalMoves: [],
    captured: [],
    status: { type: 'playing', turn: 'black' },
    ply: 1,
    firstColor: 'red',
    moveNumber: 1,
    lastMove: { from: 'a1', to: 'a1' },
  };
}
const revealed = banqiView({ color: 'red', role: 'cannon', faceDown: false });
const hidden = banqiView({ faceDown: true });

function banqiHost(view: unknown): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = renderBanqiBoardSvg(view as never, 'red', { interactive: true });
  return el;
}

const liveFlip = { kind: 'live', move: { from: 'a1', to: 'a1' }, color: 'red' } as const;

beforeEach(() => setReducedMotion(false));
afterEach(() => {
  vi.unstubAllGlobals();
  window.dispatchEvent(new Event('mistboard:display-preferences-change'));
});

describe('the turn-over trigger', () => {
  it('turns a tile on a live flip the board now shows face up', () => {
    expect(banqiRevealFlipSquare(liveFlip, revealed.board as never)).toBe('a1');
  });

  it('never turns on a render with no live event (first render, reconnect)', () => {
    expect(banqiRevealFlipSquare(null, revealed.board as never)).toBeNull();
  });

  it('never turns on a scrub or replay step', () => {
    expect(banqiRevealFlipSquare({ kind: 'scrub' }, revealed.board as never)).toBeNull();
  });

  it('never turns a board move, only a flip', () => {
    const move = { kind: 'live', move: { from: 'b1', to: 'a1' } } as const;
    expect(banqiRevealFlipSquare(move, revealed.board as never)).toBeNull();
  });

  it('never turns a tile the shown board still has face down (viewer scrubbed back)', () => {
    expect(banqiRevealFlipSquare(liveFlip, hidden.board as never)).toBeNull();
  });

  it('runs the turn at ~280ms, and not at all under reduced motion', () => {
    expect(pieceFlipDurationMs()).toBe(PIECE_FLIP_DURATION_MS);
    expect(PIECE_FLIP_DURATION_MS).toBeGreaterThanOrEqual(250);
    expect(PIECE_FLIP_DURATION_MS).toBeLessThanOrEqual(300);
    setReducedMotion(true);
    expect(pieceFlipDurationMs()).toBe(0);
  });
});

describe('banqi turn-over', () => {
  it('turns the slot, hides the face until the midpoint, shows the back until then', () => {
    const el = banqiHost(revealed);
    const { calls } = recordAnimations(() => {
      expect(animateBanqiReveal(el, 'a1')).toBe(true);
    });
    const turn = calls.find((call) => call.target === 'a1');
    expect(turn?.options.duration).toBe(PIECE_FLIP_DURATION_MS);
    expect(turn?.keyframes.map((k) => k.transform)).toEqual([
      'scaleX(1)',
      'scaleX(0)',
      'scaleX(1)',
    ]);
    const back = calls.find((call) => call.target === 'piece-flip-back');
    expect(back?.keyframes.map((k) => k.opacity)).toEqual([1, 1, 0, 0]);
    const face = calls.find((call) => call.target?.startsWith('banqi-piece'));
    expect(face?.keyframes.map((k) => k.opacity)).toEqual([0, 0, 1, 1]);
    // The animation stub never finishes, so the back is taken down at once.
    expect(el.querySelector('.piece-flip-back')).toBeNull();
  });

  it('swaps instantly under reduced motion', () => {
    setReducedMotion(true);
    const el = banqiHost(revealed);
    const { calls } = recordAnimations(() => {
      expect(animateBanqiReveal(el, 'a1')).toBe(false);
    });
    expect(calls).toEqual([]);
    expect(el.querySelector('.piece-flip-back')).toBeNull();
  });

  it('draws no identity before the reveal: the face-down slot and the turn-over back', () => {
    const before = banqiHost(hidden).querySelector('[data-piece-square="a1"]');
    expect(before?.innerHTML).toMatch(/banqi-back/);
    expect(before?.innerHTML).not.toMatch(IDENTITY);
    // The planted case: the same check catches the face once it is revealed.
    expect(banqiHost(revealed).querySelector('[data-piece-square="a1"]')?.innerHTML).toMatch(
      IDENTITY,
    );
    const { backs } = recordAnimations(() => animateBanqiReveal(banqiHost(revealed), 'a1'));
    expect(backs).toHaveLength(1);
    expect(backs[0]?.replace('class="piece-flip-back"', '')).not.toMatch(IDENTITY);
  });

  it('the live flip event names only the square and the mover, never the piece', () => {
    expect(Object.keys(liveFlip).sort()).toEqual(['color', 'kind', 'move']);
    expect(Object.keys(liveFlip.move).sort()).toEqual(['from', 'to']);
  });
});

describe('banqi live room wiring', () => {
  async function hook(): Promise<AnimateBoard> {
    await import('./live-banqi.js');
    const config = captured.configs.find((c) => c.gameSpecId === 'banqi');
    return config?.animateBoard as AnimateBoard;
  }

  function turned(run: () => void): string[] {
    return recordAnimations(run)
      .calls.filter((call) => call.keyframes.some((k) => k.transform === 'scaleX(0)'))
      .map((call) => call.target ?? '');
  }

  it.each(['red', 'black'])(
    'turns the tile on a live flip by %s (own, bot, spectator)',
    async (color) => {
      const animateBoard = await hook();
      const el = banqiHost(revealed);
      expect(
        turned(() => animateBoard({ board: el }, revealed, () => ({ ...liveFlip, color }))),
      ).toEqual(['a1']);
    },
  );

  it('turns nothing on the first render or a reconnect', async () => {
    const animateBoard = await hook();
    const el = banqiHost(revealed);
    expect(turned(() => animateBoard({ board: el }, revealed, () => null))).toEqual([]);
  });

  it('turns nothing when stepping through the replay onto a flip', async () => {
    const animateBoard = await hook();
    const el = banqiHost(revealed);
    const step = { kind: 'scrub', direction: 'forward', prevView: hidden };
    expect(turned(() => animateBoard({ board: el }, revealed, () => step))).toEqual([]);
  });
});

describe('jieqi turn-over (prototype)', () => {
  const before = { a1: { faceDown: true }, b1: { faceDown: false } };

  it('turns a piece whose move revealed it', () => {
    const after = { a3: { faceDown: false }, b1: { faceDown: false } };
    expect(jieqiRevealSquare({ from: 'a1', to: 'a3' }, before, after)).toBe('a3');
  });

  it('turns nothing for an already revealed piece or with no live board before', () => {
    const after = { a1: { faceDown: true }, b2: { faceDown: false } };
    expect(jieqiRevealSquare({ from: 'b1', to: 'b2' }, before, after)).toBeNull();
    expect(
      jieqiRevealSquare({ from: 'a1', to: 'a3' }, null, { a3: { faceDown: false } }),
    ).toBeNull();
  });

  it('holds the turn until the glide lands', () => {
    const el = document.createElement('div');
    el.innerHTML = '<svg><g data-piece-square="a3"><g class="jieqi-piece"></g></g></svg>';
    const { calls, backs } = recordAnimations(() => {
      animateJieqiReveal(el, 'a3', 'red', 'red', { delayMs: 250 });
    });
    expect(calls.find((call) => call.target === 'a3')?.options.delay).toBe(250);
    expect(backs).toHaveLength(1);
  });
});
