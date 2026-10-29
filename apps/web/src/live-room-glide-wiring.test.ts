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

  it('animates nothing for a flip, which travels nowhere', async () => {
    const animateBoard = await hook();
    const el = host();
    const seen = recordAnimations(el, () => {
      animateBoard(
        { board: el },
        { perspective: 'red', lastMove: { from: 'a1', to: 'a1' } },
        () => ({
          kind: 'live',
          move: { from: 'a1', to: 'a1' },
          color: 'black',
        }),
      );
    });

    expect(seen).toEqual([]);
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
        animateBoard({ board: el }, { lastMove: { from: 'a1', to: 'b1' } }, () => ({
          kind: 'live',
          move: { from: 'a1', to: 'b1' },
          color,
        }));
      });

      expect(seen).toEqual(['b1', 'xq-live-lastmove-ring']);
    },
  );

  it('reverse-glides a back step without fading a mark', async () => {
    const animateBoard = await hook();
    const el = host({ from: 'a1', to: 'b1' });
    const seen = recordAnimations(el, () => {
      animateBoard({ board: el }, { lastMove: null }, () => ({
        kind: 'scrub',
        direction: 'back',
        prevView: { lastMove: { from: 'b1', to: 'a1' } },
      }));
    });

    expect(seen).toEqual(['b1']);
  });

  // A flip travels nowhere, so it turns the tile over instead of gliding (#709).
  it('turns the tile over on a live flip instead of gliding', async () => {
    const animateBoard = await hook();
    const el = host({ from: 'a1', to: 'a1' });
    const seen = recordAnimations(el, () => {
      animateBoard({ board: el }, { board, lastMove: { from: 'a1', to: 'a1' } }, () => ({
        kind: 'live',
        move: { from: 'a1', to: 'a1' },
        color: 'black',
      }));
    });

    expect(seen).toEqual(['banqi-piece', 'piece-flip-back', 'a1']);
  });

  it('turns nothing when a replay step lands on a flip', async () => {
    const animateBoard = await hook();
    const el = host({ from: 'a1', to: 'a1' });
    const seen = recordAnimations(el, () => {
      animateBoard({ board: el }, { board, lastMove: { from: 'a1', to: 'a1' } }, () => ({
        kind: 'scrub',
        direction: 'forward',
        prevView: { lastMove: null },
      }));
    });

    expect(seen).not.toContain('piece-flip-back');
  });
});
