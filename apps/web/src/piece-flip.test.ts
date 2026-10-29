// The turn-over a face-down tile plays when it is revealed (#709): when it runs
// (a live reveal only), when it does not (first render, reconnect, scrub,
// replay jump, reduced motion), and that nothing before the reveal carries the
// piece's identity.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PIECE_FLIP_DURATION_MS,
  pieceAnimationDurationMs,
  pieceFlipDurationMs,
  pieceFlipStyle,
  pieceFlipStyleFromSearch,
  resetPieceFlipStyleCache,
} from './board-anim.js';
import { writeDisplayPreference } from './display-preferences.js';
import {
  animateBanqiReveal,
  banqiRevealFlipSquare,
  renderBanqiBoardSvg,
} from './live-banqi-render.js';
import { animateJieqiReveal, jieqiRevealSquare } from './live-jieqi-render.js';
import { writeStoredBanqiTile3d } from './xiangqi-appearance-storage.js';

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

/** A Storage backed by a Map: the test env ships no window storage. */
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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  setReducedMotion(false);
  // These cover the turn itself on flat tiles; 3D tiles (the default since
  // 2026-10-28) are covered in banqi-tile-3d.test.ts.
  document.documentElement.dataset.banqiTile3d = 'off';
});
afterEach(() => {
  delete document.documentElement.dataset.banqiTile3d;
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', window.location.pathname);
  resetPieceFlipStyleCache();
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
    writeStoredBanqiTile3d(false);
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

  it("turns the flipper's inked cell up with the face, never before it", () => {
    writeStoredBanqiTile3d(false);
    const el = banqiHost(revealed);
    expect(el.querySelector('.banqi-lastmove-flip')).not.toBeNull();
    const { calls } = recordAnimations(() => animateBanqiReveal(el, 'a1'));
    const mark = calls.filter((call) => call.target?.includes('banqi-lastmove-flip'));
    // Hidden with the face until the midpoint, then turned in with it.
    expect(mark.map((call) => call.keyframes.map((k) => k.opacity ?? k.transform))).toEqual([
      [0, 0, 1, 1],
      ['scaleX(1)', 'scaleX(0)', 'scaleX(1)'],
    ]);
    expect(mark[1]?.options.composite).toBe('add');
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

  beforeEach(() => {
    writeStoredBanqiTile3d(false);
  });

  // The flip's cell in the flipper's ink (red made ply 1) turns with the tile.
  const FLIP_CELL = 'banqi-lastmove banqi-lastmove-to banqi-lastmove-flip banqi-lastmove--red';

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
      ).toEqual(['a1', FLIP_CELL]);
    },
  );

  // A 3D tile turns as one body (face, back and rim in a wrapper) with its edge.
  it('turns the tile on a live flip with 3D tiles too', async () => {
    document.documentElement.dataset.banqiTile3d = 'on';
    const animateBoard = await hook();
    const el = banqiHost(revealed);
    expect(
      turned(() => animateBoard({ board: el }, revealed, () => ({ ...liveFlip, color: 'red' }))),
    ).toEqual(['piece-flip-turn', 'piece-flip-edge', FLIP_CELL]);
  });

  it('turns nothing on the first render or a reconnect', async () => {
    const animateBoard = await hook();
    const el = banqiHost(revealed);
    expect(turned(() => animateBoard({ board: el }, revealed, () => null))).toEqual([]);
  });

  // Stepping through the moves turns a flip over as it did live (Brian,
  // 2026-10-29); stepping back over one just shows the back.
  it('turns the tile when stepping forward through the replay onto a flip', async () => {
    const animateBoard = await hook();
    const el = banqiHost(revealed);
    const step = { kind: 'scrub', direction: 'forward', prevView: hidden };
    expect(turned(() => animateBoard({ board: el }, revealed, () => step))).toEqual([
      'a1',
      FLIP_CELL,
    ]);
  });

  it('turns nothing when stepping back over a flip', async () => {
    const animateBoard = await hook();
    const el = banqiHost(hidden);
    const step = { kind: 'scrub', direction: 'back', prevView: revealed };
    expect(turned(() => animateBoard({ board: el }, hidden, () => step))).toEqual([]);
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

  it('turns along the glide without cancelling or overriding the slot glide', () => {
    const el = document.createElement('div');
    el.innerHTML = '<svg><g data-piece-square="a3"><g class="jieqi-piece"></g></g></svg>';
    const slot = el.querySelector('[data-piece-square="a3"]') as Element;
    const glide = { cancel: vi.fn() };
    Object.assign(slot, { getAnimations: () => [glide] });
    const { calls, backs } = recordAnimations(() => {
      animateJieqiReveal(el, 'a3', 'red', 'red', { alongGlide: true });
    });
    expect(glide.cancel).not.toHaveBeenCalled();
    // The turn and any lift run on wrappers: the slot's transform stays the glide's.
    expect(calls.filter((call) => call.target === 'a3')).toEqual([]);
    expect(calls.some((call) => call.keyframes.some((frame) => 'transform' in frame))).toBe(true);
    expect(calls.every((call) => !call.options.delay)).toBe(true);
    expect(backs).toHaveLength(1);
  });

  it('finishes the turn three quarters into the glide, before the piece lands', () => {
    // Brian, 2026-10-28: the turn ran past the landing; get it flipped earlier.
    const el = document.createElement('div');
    el.innerHTML = '<svg><g data-piece-square="a3"><g class="jieqi-piece"></g></g></svg>';
    const glide = pieceAnimationDurationMs();
    const { calls } = recordAnimations(() => {
      animateJieqiReveal(el, 'a3', 'red', 'red', { alongGlide: true });
    });
    const durations = calls.map((call) => Number(call.options.duration));
    expect(durations.length).toBeGreaterThan(0);
    expect(Math.max(...durations)).toBe(Math.round(glide * 0.75));
    expect(Math.max(...durations)).toBeLessThan(pieceFlipDurationMs());
  });
});

describe('flip styles (the Tile flip setting, ?flip= override)', () => {
  function useFlag(search: string): void {
    window.sessionStorage.removeItem('mistboard.flipStyle');
    window.history.replaceState(null, '', `${window.location.pathname}${search}`);
    resetPieceFlipStyleCache();
  }

  it('resolves each style from the flag and ignores anything else', () => {
    expect(pieceFlipStyleFromSearch('?flip=flat')).toBe('flat');
    expect(pieceFlipStyleFromSearch('?flip=lift')).toBe('lift');
    expect(pieceFlipStyleFromSearch('?flip=spin')).toBe('spin');
    expect(pieceFlipStyleFromSearch('?flip=wobble')).toBeNull();
    expect(pieceFlipStyleFromSearch('')).toBeNull();
  });

  /** The axis the reveal turned on: what reached flipSvgPiece. */
  function turnAxis(calls: Call[]): string | null {
    for (const call of calls) {
      for (const frame of call.keyframes) {
        const match = /^(scaleX|rotateX|rotateY)\(/.exec(String(frame.transform ?? ''));
        if (match) return match[1] ?? null;
      }
    }
    return null;
  }
  const AXIS_BY_STYLE = { flat: 'scaleX', lift: 'rotateX', spin: 'rotateY' } as const;

  it('defaults to flat with flat pieces and no flag', () => {
    useFlag('');
    expect(pieceFlipStyle()).toBe('flat');
    useFlag('?flip=nope');
    expect(pieceFlipStyle()).toBe('flat');
    useFlag('?flip=spin');
    expect(pieceFlipStyle()).toBe('spin');
  });

  // Brian, 2026-10-29: the flip is "tied to 3d", as the sheet showed it.
  it.each([
    [false, 'flat'],
    [true, 'spin'],
  ] as const)('3D look %s turns the banqi and jieqi reveals %s', (look3d, style) => {
    useFlag('');
    writeStoredBanqiTile3d(look3d);
    expect(pieceFlipStyle()).toBe(style);
    const banqi = recordAnimations(() => {
      expect(animateBanqiReveal(banqiHost(revealed), 'a1')).toBe(true);
    }).calls;
    expect(turnAxis(banqi)).toBe(AXIS_BY_STYLE[style]);
    const el = document.createElement('div');
    el.innerHTML = '<svg><g data-piece-square="a3"><g class="jieqi-piece"></g></g></svg>';
    const jieqi = recordAnimations(() => {
      animateJieqiReveal(el, 'a3', 'red', 'red');
    }).calls;
    expect(turnAxis(jieqi)).toBe(AXIS_BY_STYLE[style]);
  });

  it('a look change applies to the next turn without a reload', () => {
    useFlag('');
    writeStoredBanqiTile3d(true);
    expect(pieceFlipStyle()).toBe('spin');
    writeStoredBanqiTile3d(false);
    expect(pieceFlipStyle()).toBe('flat');
  });

  it('the ?flip= override wins over the look', () => {
    writeStoredBanqiTile3d(true);
    useFlag('?flip=flat');
    expect(pieceFlipStyle()).toBe('flat');
    const { calls } = recordAnimations(() => animateBanqiReveal(banqiHost(revealed), 'a1'));
    expect(turnAxis(calls)).toBe('scaleX');
  });

  it.each([false, true])('reduced motion turns nothing whatever the look (3D %s)', (look3d) => {
    useFlag('');
    writeStoredBanqiTile3d(look3d);
    setReducedMotion(true);
    const el = banqiHost(revealed);
    const { calls } = recordAnimations(() => {
      expect(animateBanqiReveal(el, 'a1')).toBe(false);
    });
    expect(calls).toEqual([]);
    expect(el.querySelector('.piece-flip-back, .piece-flip-turn')).toBeNull();
  });

  it('reads the flag once and keeps it for the tab after the query is gone', () => {
    useFlag('?flip=spin');
    expect(pieceFlipStyle()).toBe('spin');
    window.history.replaceState(null, '', window.location.pathname);
    expect(pieceFlipStyle()).toBe('spin');
    resetPieceFlipStyleCache();
    expect(pieceFlipStyle()).toBe('spin');
    useFlag('?flip=flat');
    expect(pieceFlipStyle()).toBe('flat');
  });

  it.each([
    ['fast', 180],
    ['normal', 280],
    ['slow', 420],
    ['none', 0],
  ] as const)('the %s animation speed turns a tile in %ims', (speed, ms) => {
    writeDisplayPreference('pieceAnimation', speed);
    expect(pieceFlipDurationMs()).toBe(ms);
  });

  it.each(['flat', 'lift', 'spin'])('%s follows the speed setting and is off at none', (flag) => {
    useFlag(`?flip=${flag}`);
    writeDisplayPreference('pieceAnimation', 'slow');
    const slow = recordAnimations(() => animateBanqiReveal(banqiHost(revealed), 'a1')).calls;
    expect(slow.length).toBeGreaterThan(0);
    for (const call of slow) expect(call.options.duration).toBe(420);
    writeDisplayPreference('pieceAnimation', 'none');
    const el = banqiHost(revealed);
    const none = recordAnimations(() => {
      expect(animateBanqiReveal(el, 'a1')).toBe(false);
    }).calls;
    expect(none).toEqual([]);
    expect(el.querySelector('.piece-flip-back, .piece-flip-turn')).toBeNull();
  });

  it.each([
    ['lift', 'rotateX'],
    ['spin', 'rotateY'],
  ])('%s lifts the slot and turns the tile with %s, face swapped edge-on', (flag, axis) => {
    useFlag(`?flip=${flag}`);
    const el = banqiHost(revealed);
    const faceBefore = el.querySelector('[data-piece-square="a1"]')?.innerHTML;
    const { calls, backs } = recordAnimations(() => {
      expect(animateBanqiReveal(el, 'a1')).toBe(true);
    });
    const lift = calls.find((call) => call.target === 'a1');
    expect(lift?.keyframes.map((k) => k.transform)).toEqual([
      'scale(1)',
      'scale(1.12)',
      'scale(1.12)',
      'scale(1)',
    ]);
    expect(lift?.keyframes.every((k) => String(k.filter).startsWith('drop-shadow('))).toBe(true);
    const turn = calls.find((call) => call.target === 'piece-flip-turn');
    const turns = turn?.keyframes.map((k) => String(k.transform)) ?? [];
    // No perspective(): Chrome draws it on SVG as a widening skew.
    expect(turns.every((t) => t.includes(`${axis}(`) && !t.includes('perspective('))).toBe(true);
    const midpoint = turn?.keyframes.filter((k) => k.offset === 0.5).map((k) => k.transform);
    expect(midpoint).toEqual([
      expect.stringContaining(`${axis}(90deg)`),
      expect.stringContaining(`${axis}(-90deg)`),
    ]);
    // The flat turn's squash is not used.
    expect(calls.some((call) => call.keyframes.some((k) => k.transform === 'scaleX(0)'))).toBe(
      false,
    );
    // Same identity-free back; the stub never finishes, so the slot settles at
    // once: back gone, wrapper unwrapped, the rendered face exactly as drawn.
    expect(backs).toHaveLength(1);
    expect(backs[0]?.replace('class="piece-flip-back"', '')).not.toMatch(IDENTITY);
    expect(el.querySelector('[data-piece-square="a1"]')?.innerHTML).toBe(faceBefore);
  });
});
