// The live rooms are the surface people actually play on, and jungle + flip
// jungle glided EVERYWHERE ELSE (watch, review, puzzles) while silently not
// gliding here: `animateBoard` is an optional hook, so a tenant that never
// supplies it is not a type error and not a failing test, it is just a room
// where nothing moves. These tests capture each tenant's live-client config at
// import time and drive the hook directly, so "the tenant forgot to opt in"
// fails loudly.
import { describe, expect, it, vi } from 'vitest';
import { renderJungleFlipBoardSvg } from './jungle-flip-render.js';
import { renderJungleBoardSvg } from './jungle-render.js';
import { renderThreeKingdomsBanqiLiveBoardSvg } from './three-kingdoms-banqi-diagrams.js';

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

/** Every element the call animated, keyed square first, else its class. */
function recordAnimations(host: HTMLElement, run: () => void): Array<string | null> {
  const seen: Array<string | null> = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const original = proto.animate;
  proto.animate = function (this: Element) {
    seen.push(this.getAttribute('data-piece-square') ?? this.getAttribute('class'));
    return { cancel: () => {} };
  };
  try {
    run();
  } finally {
    if (original === undefined) delete proto.animate;
    else proto.animate = original;
  }
  void host;
  return seen;
}

// ES modules import once, so each tenant's config is captured on the first
// import and read by gameSpecId thereafter -- never cleared between tests.
async function liveHook(module: string, gameSpecId: string): Promise<AnimateBoard> {
  await import(module);
  const config = captured.configs.find((c) => c.gameSpecId === gameSpecId);
  expect(config, `${gameSpecId} did not build a tenant live client`).toBeDefined();
  const animateBoard = config?.animateBoard as AnimateBoard | undefined;
  expect(animateBoard, `${gameSpecId} supplies no animateBoard hook`).toBeTypeOf('function');
  return animateBoard as AnimateBoard;
}

describe('jungle live room', () => {
  const board = {
    a1: { color: 'red', role: 'rat' },
    b1: { color: 'black', role: 'cat' },
  } as const;

  const hook = () => liveHook('./live-jungle.js', 'jungle');

  function host(): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = renderJungleBoardSvg(board, {
      lastMove: { from: 'a1', to: 'b1' },
      perspective: 'red',
    });
    return el;
  }

  it('glides an opponent move and fades the destination tint in', async () => {
    const animateBoard = await hook();
    const el = host();
    const seen = recordAnimations(el, () => {
      animateBoard(
        { board: el },
        { perspective: 'red', lastMove: { from: 'a1', to: 'b1' } },
        () => ({
          kind: 'live',
          move: { from: 'a1', to: 'b1' },
          color: 'black',
        }),
      );
    });

    expect(seen).toEqual(['b1', 'jungle-last-move-to']);
  });

  it('reverse-glides a back step without fading a mark', async () => {
    const animateBoard = await hook();
    const el = host();
    const seen = recordAnimations(el, () => {
      animateBoard(
        { board: el },
        { perspective: 'red', lastMove: { from: 'a1', to: 'b1' } },
        () => ({
          kind: 'scrub',
          direction: 'back',
          prevView: { lastMove: { from: 'a1', to: 'b1' } },
        }),
      );
    });

    expect(seen).toEqual(['a1']);
  });

  it('animates nothing when the channel is empty', async () => {
    const animateBoard = await hook();
    const el = host();
    const seen = recordAnimations(el, () => {
      animateBoard({ board: el }, { perspective: 'red', lastMove: null }, () => null);
    });

    expect(seen).toEqual([]);
  });
});

describe('flip jungle live room', () => {
  const board = {
    a1: { faceDown: false, color: 'red', role: 'rat' },
    b1: { faceDown: false, color: 'black', role: 'cat' },
  } as const;

  const hook = () => liveHook('./live-jungle-flip.js', 'jungle-flip');

  function host(): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = renderJungleFlipBoardSvg(board, {
      lastMove: { from: 'a1', to: 'b1' },
      lastMoveInk: 'red',
      shadow: false,
    });
    return el;
  }

  it('glides an opponent move and fades the destination tint in', async () => {
    const animateBoard = await hook();
    const el = host();
    const seen = recordAnimations(el, () => {
      animateBoard(
        { board: el },
        { perspective: 'red', lastMove: { from: 'a1', to: 'b1' } },
        () => ({
          kind: 'live',
          move: { from: 'a1', to: 'b1' },
          color: 'black',
        }),
      );
    });

    expect(seen).toEqual(['b1', 'jungle-last-move-to']);
  });

  // A flip used to animate nothing live (Brian, 2026-10-30), own or not.
  it("turns the tile over on a flip, the player's own included", async () => {
    const animateBoard = await hook();
    const el = host();
    const seen = recordAnimations(el, () => {
      animateBoard(
        { board: el },
        { perspective: 'red', lastMove: { from: 'a1', to: 'a1' } },
        () => ({
          kind: 'live',
          move: { from: 'a1', to: 'a1' },
          color: 'red',
        }),
      );
    });

    expect(seen).toContain('piece-flip-back');
  });
});

describe('Three Kingdoms banqi live room', () => {
  const board = {
    a1: { faceDown: false, color: 'red', role: 'chariot' },
    b1: { faceDown: false, color: 'black', role: 'horse' },
  } as const;

  const hook = () => liveHook('./live-three-kingdoms-banqi.js', 'three-kingdoms-banqi');

  function host(lastMove: { from: 'a1' | 'b1'; to: 'a1' | 'b1' }): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = renderThreeKingdomsBanqiLiveBoardSvg(board, {
      selected: null,
      targets: [],
      draggingFrom: null,
      lastMove,
    });
    return el;
  }

  // Own moves glide too: the room draws nothing before the server's echo.
  it.each(['red', 'black'])(
    'glides a %s move with the gold band riding the piece',
    async (color) => {
      const animateBoard = await hook();
      const el = host({ from: 'a1', to: 'b1' });
      const seen = recordAnimations(el, () => {
        animateBoard(
          { board: el },
          { status: { type: 'playing', turn: 'red' }, lastMove: { from: 'a1', to: 'b1' } },
          () => ({
            kind: 'live',
            move: { from: 'a1', to: 'b1' },
            color,
          }),
        );
      });

      expect(seen).toEqual(['b1', 'xq-live-lastmove-ring']);
    },
  );

  // The prior move's mark is drawn before the piece glides back to it, so it
  // fades in as the glide lands rather than sitting there waiting (Brian,
  // 2026-10-30).
  it('reverse-glides a back step and fades the prior mark in', async () => {
    const animateBoard = await hook();
    const el = host({ from: 'a1', to: 'b1' });
    const seen = recordAnimations(el, () => {
      animateBoard(
        { board: el },
        { status: { type: 'playing', turn: 'red' }, lastMove: null },
        () => ({
          kind: 'scrub',
          direction: 'back',
          prevView: { lastMove: { from: 'b1', to: 'a1' } },
        }),
      );
    });

    expect(seen).toEqual(['b1', 'xq-live-lastmove-ring']);
  });

  // A flip travels nowhere, so it turns the tile over instead of gliding (#709).
  it('turns the tile over on a live flip instead of gliding', async () => {
    const animateBoard = await hook();
    const el = host({ from: 'a1', to: 'a1' });
    const seen = recordAnimations(el, () => {
      animateBoard(
        { board: el },
        { board, status: { type: 'playing', turn: 'red' }, lastMove: { from: 'a1', to: 'a1' } },
        () => ({
          kind: 'live',
          move: { from: 'a1', to: 'a1' },
          color: 'black',
        }),
      );
    });

    // The flip's ring is hidden with the face until the midpoint, then turns in
    // with it (flipSvgPiece's faceMark), so it never shows before the face.
    expect(seen).toEqual([
      'banqi-piece',
      'piece-flip-back',
      'a1',
      'xq-live-lastmove-ring',
      'xq-live-lastmove-ring',
    ]);
  });

  // 3D tiles: the mark is the tile's edge, drawn over the pieces, in the
  // mover's ink on a plain move and the flipper's on a flip.
  it.each([
    [{ from: 'a1', to: 'b1' }, 'red'],
    [{ from: 'a1', to: 'a1' }, 'black'],
  ] as const)('inks a 3D tile edge for %o', (lastMove, ink) => {
    const el = document.createElement('div');
    el.innerHTML = renderThreeKingdomsBanqiLiveBoardSvg(board, {
      selected: null,
      targets: [],
      draggingFrom: null,
      lastMove,
      lastMoveInk: ink,
      tile3d: true,
    });
    const edge = el.querySelector('.xq-live-lastmove-over .xq-live-lastmove-edge');
    expect(edge?.getAttribute('class')).toContain(`tk-flip-ring--${ink}`);
    expect(el.querySelectorAll('.banqi-rim').length).toBe(2);
  });

  // A replay step onto a flip turns the tile over, as it did live.
  it('turns the tile over when a replay step lands on a flip', async () => {
    const animateBoard = await hook();
    const el = host({ from: 'a1', to: 'a1' });
    const seen = recordAnimations(el, () => {
      animateBoard(
        { board: el },
        { board, status: { type: 'playing', turn: 'red' }, lastMove: { from: 'a1', to: 'a1' } },
        () => ({
          kind: 'scrub',
          direction: 'forward',
          prevView: { status: { type: 'playing', turn: 'red' }, lastMove: null },
        }),
      );
    });

    expect(seen).toContain('piece-flip-back');
  });
});

// The end of a game (Brian, 2026-10-30): a finished room shows every tile face
// up, which arrived as one jolt. The last move lands first, then the tiles that
// were still face down turn over one by one, then the generals get badges.
describe('Three Kingdoms banqi game end', () => {
  const playing = {
    a1: { faceDown: false, color: 'red', role: 'chariot' },
    b1: { faceDown: false, color: 'black', role: 'general' },
    c1: { faceDown: true },
    d1: { faceDown: true },
  } as const;
  const over = {
    b1: { faceDown: false, color: 'red', role: 'chariot' },
    c1: { faceDown: false, color: 'red', role: 'general' },
    d1: { faceDown: false, color: 'black', role: 'soldier' },
  } as const;
  const finished = {
    id: 'tkb_end',
    board: over,
    // Seat red flipped first and drew red, so seat red is the red ink.
    firstColor: 'red',
    status: { type: 'finished', winner: 'red', reason: 'score' },
    lastMove: { from: 'a1', to: 'b1' },
  };

  function config(): Record<string, unknown> {
    const found = captured.configs.find((c) => c.gameSpecId === 'three-kingdoms-banqi');
    if (!found) throw new Error('three-kingdoms-banqi did not build a tenant live client');
    return found;
  }

  it('lands the last move, then turns the hidden tiles over in turn', async () => {
    const animateBoard = await liveHook('./live-three-kingdoms-banqi.js', 'three-kingdoms-banqi');
    vi.useFakeTimers();
    try {
      // Attached: a turn whose slot a later render replaced does nothing.
      const el = document.body.appendChild(document.createElement('div'));
      el.innerHTML = renderThreeKingdomsBanqiLiveBoardSvg(playing, {
        selected: null,
        targets: [],
        draggingFrom: null,
        lastMove: null,
      });
      animateBoard(
        { board: el },
        { board: playing, status: { type: 'playing', turn: 'red' } },
        () => null,
      );

      el.innerHTML = renderThreeKingdomsBanqiLiveBoardSvg(over, {
        selected: null,
        targets: [],
        draggingFrom: null,
        lastMove: { from: 'a1', to: 'b1' },
      });
      const atOnce = recordAnimations(el, () => {
        animateBoard({ board: el }, finished, () => ({
          kind: 'live',
          move: { from: 'a1', to: 'b1' },
          color: 'black',
        }));
      });
      // The move glides now; the two hidden tiles wait face down for it.
      expect(atOnce).toContain('b1');
      expect(atOnce).not.toContain('c1');
      const faceDown = (square: string) =>
        el.querySelector(`[data-piece-square="${square}"] .banqi-back`) !== null;
      expect(faceDown('c1') && faceDown('d1')).toBe(true);

      // One tile at a time, c1 before d1.
      const first = recordAnimations(el, () => {
        while (faceDown('c1') && vi.getTimerCount()) {
          vi.advanceTimersToNextTimer();
        }
      });
      expect(first.filter((s) => s === 'piece-flip-back')).toHaveLength(1);
      expect(faceDown('c1')).toBe(false);
      expect(faceDown('d1')).toBe(true);
      const rest = recordAnimations(el, () => {
        vi.runAllTimers();
      });
      expect(rest.filter((s) => s === 'piece-flip-back')).toHaveLength(1);
      expect(faceDown('d1')).toBe(false);

      // The badges wait until the last tile has turned.
      expect(config().finishBadgeDelayMs as number).toBeGreaterThan(0);
      el.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it('badges each seat by the ink it bound, labelled in the shared words', async () => {
    await liveHook('./live-three-kingdoms-banqi.js', 'three-kingdoms-banqi');
    const finishBadges = config().finishBadges as (view: unknown) => Array<Record<string, unknown>>;
    // Seat black flipped first and drew red, so seat red plays black.
    const board = {
      c1: { faceDown: false, color: 'red', role: 'general' },
      d1: { faceDown: false, color: 'black', role: 'general' },
    };
    const badges = finishBadges({
      ...finished,
      board,
      firstColor: 'black',
      status: { type: 'finished', winner: 'red', reason: 'score' },
    });
    expect(badges).toEqual([
      expect.objectContaining({ square: 'd1', kind: 'winner' }),
      expect.objectContaining({ square: 'c1', kind: 'loser', label: 'On points' }),
    ]);
    // A general taken earlier has no badge.
    expect(finishBadges(finished)).toEqual([
      expect.objectContaining({ square: 'c1', kind: 'winner' }),
    ]);
  });
});
