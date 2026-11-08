// Flip Jungle's turn-over and its opt-in 3D tiles (#709): the default board is
// byte-for-byte what it was before either existed, a 3D tile and its rim stay
// inside the flat tile's footprint, and a reveal turns the tile over.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPieceFlipStyleCache } from './board-anim.js';
import {
  animateJungleFlipReveal,
  JUNGLE_FLIP_BOARD_VIEW,
  JUNGLE_FLIP_TILE_3D,
  type JungleFlipRenderBoard,
  type JungleFlipRenderOptions,
  jungleFlipTile3dGeometry,
  renderJungleFlipBoardSvg,
} from './jungle-flip-render.js';
import { cancelTileFlipOverlays, wallStrips } from './tile-flip-3d.js';

// Flat pieces unless a test asks for 3D: the board-wide 3D default
// (piece3dEnabled, 2026-10-28) reads the root, which these tests pin off.
beforeEach(() => {
  document.documentElement.dataset.banqiTile3d = 'off';
});
afterEach(() => {
  delete document.documentElement.dataset.banqiTile3d;
});

const MIXED: JungleFlipRenderBoard = {
  a1: { faceDown: true },
  b1: { faceDown: false, color: 'red', role: 'elephant' },
  c2: { faceDown: false, color: 'black', role: 'rat' },
  d4: { faceDown: false, color: 'red', role: 'lion' },
  a4: { faceDown: true },
  b3: { faceDown: false, color: 'black', role: 'cat' },
};

const ALL_DOWN: JungleFlipRenderBoard = Object.fromEntries(
  ['a', 'b', 'c', 'd'].flatMap((f) => [1, 2, 3, 4].map((r) => [`${f}${r}`, { faceDown: true }])),
) as JungleFlipRenderBoard;

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

type Call = {
  target: string | null;
  html: string;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
};

function recordAnimations(run: () => void): Call[] {
  const calls: Call[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const original = proto.animate;
  proto.animate = function (
    this: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    calls.push({
      target: this.getAttribute('data-piece-square') ?? this.getAttribute('class') ?? this.tagName,
      html: this.innerHTML,
      keyframes,
      options,
    });
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

beforeEach(() => setReducedMotion(false));
afterEach(() => {
  vi.unstubAllGlobals();
  resetPieceFlipStyleCache();
  window.dispatchEvent(new Event('mistboard:display-preferences-change'));
});

describe('Flip Jungle board markup without tile3d', () => {
  // Hashes taken before tile3d and the turn-over existed: the site's default
  // board must not change by a byte.
  const cases: Array<[string, JungleFlipRenderBoard, JungleFlipRenderOptions, string]> = [
    [
      'start, illustrated animals',
      ALL_DOWN,
      { boardSkin: 'illustrated', pieceSkin: 'animals' },
      '704689fc2e0d28b2',
    ],
    [
      'mixed, bare characters, last move and targets',
      MIXED,
      {
        boardSkin: 'bare',
        pieceSkin: 'characters',
        lastMove: { from: 'c1', to: 'c2' },
        lastMoveInk: 'black',
        selected: 'b1',
        targets: ['b2', 'c1'],
        idSuffix: 'g',
      },
      'c39442fa4bc798ed',
    ],
    [
      'mixed, animals, a flip',
      MIXED,
      {
        boardSkin: 'illustrated',
        pieceSkin: 'animals',
        lastMove: { from: 'a1', to: 'a1' },
        lastMoveInk: 'red',
      },
      'e314f369c4314b3f',
    ],
  ];
  it.each(cases)('%s', (_name, board, options, golden) => {
    const flat = renderJungleFlipBoardSvg(board, options);
    expect(sha(flat)).toBe(golden);
    expect(renderJungleFlipBoardSvg(board, { ...options, tile3d: false })).toBe(flat);
  });
});

/** Every rect and path extent drawn in one slot, in viewBox units. */
function slotExtents(slot: Element): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const rect of Array.from(slot.querySelectorAll('rect'))) {
    const x = Number(rect.getAttribute('x'));
    const y = Number(rect.getAttribute('y'));
    const sw = Number(rect.getAttribute('stroke-width') ?? 0);
    xs.push(x - sw / 2, x + Number(rect.getAttribute('width')) + sw / 2);
    ys.push(y - sw / 2, y + Number(rect.getAttribute('height')) + sw / 2);
  }
  for (const path of Array.from(slot.querySelectorAll('path'))) {
    // The rim paths use only absolute M, V, H and A commands.
    const d = path.getAttribute('d') ?? '';
    let x = 0;
    for (const [, cmd, args] of d.matchAll(/([MVHAZ])([^MVHAZ]*)/g)) {
      const n = (args ?? '')
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (cmd === 'M') {
        x = n[0]!;
        ys.push(n[1]!);
      } else if (cmd === 'V') {
        ys.push(n[0]!);
      } else if (cmd === 'H') {
        x = n[0]!;
      } else if (cmd === 'A') {
        x = n[5]!;
        ys.push(n[6]!);
      }
      xs.push(x);
    }
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe('Flip Jungle 3D tiles', () => {
  const cell = JUNGLE_FLIP_BOARD_VIEW.cell;

  it.each(['animals', 'characters'] as const)(
    'keeps every tile and its rim inside the flat footprint (%s)',
    (pieceSkin) => {
      const host = document.createElement('div');
      host.innerHTML = renderJungleFlipBoardSvg(MIXED, { tile3d: true, pieceSkin });
      const tile = jungleFlipTile3dGeometry(cell);
      // The rim keeps its share of the tile as the tile shrinks (80% from 2026-10-28).
      expect(tile.depth).toBeCloseTo(
        cell * JUNGLE_FLIP_TILE_3D.reach * JUNGLE_FLIP_TILE_3D.depthShare,
        1,
      );
      expect(2 * tile.half + tile.depth).toBeLessThanOrEqual(cell * JUNGLE_FLIP_TILE_3D.reach);
      for (const square of Object.keys(MIXED)) {
        const slot = host.querySelector(`[data-piece-square="${square}"]`)!;
        expect(slot.querySelector('.jgf-rim')).not.toBeNull();
        const file = 'abcd'.indexOf(square[0]!);
        const rank = Number(square[1]);
        // The board is never flipped: rank 4 is the top row.
        const x0 = file * cell;
        const y0 = (4 - rank) * cell;
        const e = slotExtents(slot);
        expect(e.minX).toBeGreaterThanOrEqual(x0 - 1e-6);
        expect(e.maxX).toBeLessThanOrEqual(x0 + cell + 1e-6);
        expect(e.minY).toBeGreaterThanOrEqual(y0 - 1e-6);
        expect(e.maxY).toBeLessThanOrEqual(y0 + cell + 1e-6);
        // Centred: the rim's bottom and the face's top sit the same distance in.
        expect(Math.abs(e.minY - y0 - (y0 + cell - e.maxY))).toBeLessThan(0.6);
      }
    },
  );

  it('leaves the rim without an outline, face up and face down', () => {
    // Brian, 2026-10-29: an outlined rim made the whole piece "too heavy".
    const host = document.createElement('div');
    host.innerHTML = renderJungleFlipBoardSvg(MIXED, { tile3d: true });
    for (const square of ['a1', 'b1']) {
      expect(
        host.querySelector(`[data-piece-square="${square}"] .jgf-rim [stroke]`),
        square,
      ).toBeNull();
    }
  });

  it('draws one ivory body face up and face down', () => {
    const html = renderJungleFlipBoardSvg(MIXED, { tile3d: true });
    const host = document.createElement('div');
    host.innerHTML = html;
    const fills = (sq: string) =>
      Array.from(host.querySelectorAll(`[data-piece-square="${sq}"] .jgf-rim path`)).map((p) =>
        p.getAttribute('fill'),
      );
    expect(fills('a1')).toEqual(fills('b1'));
  });
});

describe('Flip Jungle turn-over', () => {
  const IDENTITY = /\b(red|black)\b|elephant|lion|rat|cat|<image|<text/;

  function host(tile3d: boolean): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = renderJungleFlipBoardSvg(MIXED, { tile3d, lastMove: { from: 'b1', to: 'b1' } });
    return el;
  }

  it.each([false, true])('turns a revealed tile over from its back (tile3d %s)', (tile3d) => {
    const el = host(tile3d);
    let turned = false;
    const calls = recordAnimations(() => {
      turned = animateJungleFlipReveal(el, 'b1', { tile3d });
    });
    expect(turned).toBe(true);
    // The stub never finishes, so the turn settles at once; read the back as
    // it was animated.
    const back = calls.find((c) => c.target === 'piece-flip-back');
    expect(back).toBeDefined();
    expect(back!.html).not.toMatch(IDENTITY);
    expect(back!.html).toContain(JUNGLE_FLIP_FACE_DOWN_FILL);
    // The face itself hides until the midpoint.
    expect(calls.some((c) => c.html.includes('elephant') || c.html.includes('<image'))).toBe(true);
    expect(el.querySelector('.piece-flip-back')).toBeNull();
    // Only the 3D tile shows its thickness edge-on.
    expect(calls.some((c) => c.target === 'piece-flip-edge')).toBe(tile3d);
  });

  // A thick tile turned in the SVG squashes flat; it turns as a true 3D body.
  it('turns a lifted or spun 3D tile as a rounded-square coin over the board', () => {
    const proto = SVGSVGElement.prototype as unknown as { getScreenCTM?: unknown };
    const original = proto.getScreenCTM;
    proto.getScreenCTM = () => ({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 });
    try {
      for (const style of ['lift', 'spin'] as const) {
        const el = host(true);
        document.body.append(el);
        const slot = el.querySelector<SVGGElement>('[data-piece-square="b1"]')!;
        const calls = recordAnimations(() => {
          expect(animateJungleFlipReveal(el, 'b1', { tile3d: true, style })).toBe(true);
        });
        const coin = document.querySelector('.tile-flip-3d');
        expect(coin).not.toBeNull();
        expect(slot.style.getPropertyValue('visibility')).toBe('hidden');
        // Four straight sides and a fan of six strips per corner, not a disc's 40.
        expect(coin!.querySelectorAll('.tile-flip-3d-wall').length).toBe(4 + 4 * 6);
        const back = Array.from(coin!.querySelectorAll('.tile-flip-3d-back'))
          .map((layer) => layer.outerHTML)
          .join('');
        expect(back).toContain('jgf-rim');
        expect(back).toContain(JUNGLE_FLIP_FACE_DOWN_FILL);
        expect(back).not.toMatch(IDENTITY);
        expect(calls.some((c) => c.target === 'piece-flip-turn')).toBe(false);
        // The flipper's inked cell waits for the coin to land.
        const mark = calls.find((c) => c.target?.includes('jungle-last-move-flip'));
        expect(mark?.keyframes.map((k) => k.opacity)).toEqual([0, 0, 1, 1]);
        cancelTileFlipOverlays();
        expect(slot.style.getPropertyValue('visibility')).toBe('');
        el.remove();
      }
    } finally {
      if (original === undefined) delete proto.getScreenCTM;
      else proto.getScreenCTM = original;
    }
  });

  it('turns nothing under reduced motion', () => {
    setReducedMotion(true);
    const el = host(true);
    const calls = recordAnimations(() => {
      expect(animateJungleFlipReveal(el, 'b1', { tile3d: true })).toBe(false);
    });
    expect(calls).toEqual([]);
  });
});

const JUNGLE_FLIP_FACE_DOWN_FILL = '#2f8f6b';

describe('the coin wall', () => {
  it('puts every strip of a rounded square on its outline, facing out', () => {
    const r = 30;
    const corner = 8;
    const strips = wallStrips(r, corner);
    expect(strips).toHaveLength(4 + 4 * 6);
    for (const { x, y, turn } of strips) {
      // Distance from the inner square (half side r - corner) is the corner radius.
      const dx = Math.max(Math.abs(x) - (r - corner), 0);
      const dy = Math.max(Math.abs(y) - (r - corner), 0);
      expect(Math.hypot(dx, dy)).toBeCloseTo(corner, 6);
      // Facing out: the strip's normal points away from the centre.
      const a = (turn * Math.PI) / 180;
      expect(-Math.sin(a) * x + Math.cos(a) * y).toBeGreaterThan(0);
    }
  });

  it('keeps a disc at 40 strips on its circle', () => {
    const strips = wallStrips(30, null);
    expect(strips).toHaveLength(40);
    for (const { x, y } of strips) expect(Math.hypot(x, y)).toBeCloseTo(30, 6);
  });
});
