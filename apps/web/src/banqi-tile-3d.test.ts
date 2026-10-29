import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pieceFlipEdgeKeyframes, pieceFlipEdgeMarkup } from './board-anim.js';
import {
  animateBanqiReveal,
  banqiTile3dBox,
  banqiTile3dEnabled,
  banqiTileEdge,
  renderBanqiBoardSvg,
} from './live-banqi-render.js';
import { TK_SETUP, TK_THUMBNAIL } from './three-kingdoms-banqi-diagrams.js';
import { activeTileFlipOverlays, cancelTileFlipOverlays } from './tile-flip-3d.js';

// Banqi draws its tiles with a visible rim unless the reader switches 3D tiles
// off. Switched off, the board must be the board it was, byte for byte: these
// hashes are of the renderer before 3D tiles (agent/flip-setting at 86b6d6599).
const VIEW = {
  id: 'banqi-tile-3d',
  perspective: 'red',
  board: {
    a1: { color: 'red', role: 'chariot', faceDown: false },
    b1: { faceDown: true },
    c1: { color: 'black', role: 'horse', faceDown: false },
    d2: { faceDown: true },
    h4: { color: 'red', role: 'general', faceDown: false },
  },
  legalMoves: [{ from: 'a1', to: 'b1' }],
  captured: [],
  status: { type: 'playing', turn: 'red' },
  ply: 3,
  firstColor: 'red',
  moveNumber: 2,
  lastMove: { from: 'd2', to: 'd2' },
};

const CASES = {
  international: { pieceSet: 'international' },
  wood: { pieceSet: 'wood' },
  interactive: {
    pieceSet: 'international',
    interactive: true,
    selectedSquare: 'a1',
    legalMoves: VIEW.legalMoves,
    draggingFrom: 'b1',
    coordinates: true,
  },
} as const;

const GOLDEN: Record<keyof typeof CASES, string> = {
  international: 'cd606ef0cae43c08',
  wood: '8a819263f381eb46',
  interactive: 'b1ec98573e6fd173',
};

const NAMES = Object.keys(CASES) as (keyof typeof CASES)[];
const IDENTITY = /\b(red|black)\b|chariot|horse|general|aria-label="/;

function sha(svg: string): string {
  return createHash('sha256').update(svg).digest('hex').slice(0, 16);
}

function render(name: keyof typeof CASES, extra: Record<string, unknown> = {}): string {
  return renderBanqiBoardSvg(VIEW as never, 'red', { ...CASES[name], ...extra } as never);
}

function hostOf(svg: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = svg;
  return host;
}

function rimOf(host: HTMLElement, square: string): string {
  return host.querySelector(`[data-piece-square="${square}"] > .banqi-rim`)?.outerHTML ?? '';
}

function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

function setTile3d(on: boolean | undefined): void {
  if (on === undefined) delete document.documentElement.dataset.banqiTile3d;
  else document.documentElement.dataset.banqiTile3d = on ? 'on' : 'off';
}

type AnimateCall = { cls: string | null; html: string; frames: Keyframe[] };

/** Every animate() call a run made, by class, with the element's markup then. */
function recordAnimations(run: () => void): AnimateCall[] {
  const calls: AnimateCall[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const original = proto.animate;
  proto.animate = function (this: Element, frames: Keyframe[]) {
    calls.push({ cls: this.getAttribute('class'), html: this.outerHTML, frames });
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

/** Map the board's viewBox to the screen at 2x, as a laid-out page would. */
function stubScreenMapping(ctm: unknown = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 }): () => void {
  const proto = SVGSVGElement.prototype as unknown as { getScreenCTM?: unknown };
  const original = proto.getScreenCTM;
  proto.getScreenCTM = () => ctm;
  return () => {
    if (original === undefined) delete proto.getScreenCTM;
    else proto.getScreenCTM = original;
  };
}

/** The vertical span of a 3D tile in a slot: disc top to rim bottom. */
function tileSpan(slot: Element): { top: number; bottom: number; halfWidth: number } {
  const disc = slot.querySelector('.banqi-back > circle');
  const cy = Number(disc?.getAttribute('cy'));
  // A 3D back's stroke is its tile's line (style), else .banqi-back's 2 units.
  const line = Number(/stroke-width:([\d.]+)/.exec(disc?.getAttribute('style') ?? '')?.[1] ?? 2);
  const top = cy - (Number(disc?.getAttribute('r')) + line / 2);
  // The rim's outer band: down its sides to V, then round the bottom at radius A.
  const band = slot.querySelector('.banqi-rim > path')?.getAttribute('d') ?? '';
  const [, low, radius] = band.match(/V([\d.]+)A([\d.]+)/) ?? [];
  return { top, bottom: Number(low) + Number(radius), halfWidth: Number(radius) };
}

beforeEach(() => {
  setTile3d(undefined);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.dispatchEvent(new Event('mistboard:display-preferences-change'));
});

afterEach(() => {
  cancelTileFlipOverlays();
  document.body.innerHTML = '';
  delete document.documentElement.dataset.xiangqiPieceShadow;
  setSearch('');
  setTile3d(undefined);
  vi.unstubAllGlobals();
});

describe('banqi 3D tiles', () => {
  it('leaves the board byte-identical with 3D tiles switched off', () => {
    setTile3d(false);
    expect(banqiTile3dEnabled()).toBe(false);
    for (const name of NAMES) {
      expect(sha(render(name)), name).toBe(GOLDEN[name]);
      expect(render(name, { tile3d: false }), name).toBe(render(name));
    }
  });

  it('draws flat tiles by default and one rim under every tile once switched on', () => {
    setTile3d(undefined);
    expect(banqiTile3dEnabled()).toBe(false);
    for (const name of NAMES) expect(render(name)).toBe(render(name, { tile3d: false }));
    for (const on of [true]) {
      setTile3d(on);
      expect(banqiTile3dEnabled()).toBe(true);
      for (const name of NAMES) {
        const drawn = render(name);
        expect(drawn, name).not.toBe(render(name, { tile3d: false }));
        expect(drawn, name).toBe(render(name, { tile3d: true }));
        expect(drawn.match(/class="banqi-rim/g)?.length, name).toBe(5);
      }
    }
  });

  it('gives every tile one rim, face down or face up, whatever its colour', () => {
    const host = hostOf(render('international', { tile3d: true }));
    const shape = (markup: string) => markup.replace(/-?\d+(\.\d+)?/g, '#');
    expect(rimOf(host, 'b1')).not.toBe('');
    expect(shape(rimOf(host, 'b1'))).toBe(shape(rimOf(host, 'd2')));
    expect(shape(rimOf(host, 'a1'))).toBe(shape(rimOf(host, 'c1')));
    expect(rimOf(host, 'b1')).not.toMatch(IDENTITY);
    expect(rimOf(host, 'a1')).not.toMatch(IDENTITY);
    // A tile is one object: the rim under a face (a1) and under a back (b1)
    // is the same colour, ivory on Mistboard's sets, so a flip never changes it.
    const fills = (markup: string) => markup.match(/fill="[^"]+"/g) ?? [];
    expect(fills(rimOf(host, 'b1')).length).toBeGreaterThan(0);
    expect(fills(rimOf(host, 'a1'))).toEqual(fills(rimOf(host, 'b1')));
    expect(rimOf(host, 'a1')).toContain('#efe7d2');
    expect(rimOf(host, 'a1')).not.toContain('#2f8a70');
    // An asset set's tile is one block of its material, both ways up.
    const wood = hostOf(render('wood', { tile3d: true }));
    expect(shape(rimOf(wood, 'a1'))).toBe(shape(rimOf(wood, 'b1')));
    expect(fills(rimOf(wood, 'a1'))).toEqual(fills(rimOf(wood, 'b1')));
  });

  it('outlines a 3D tile face down at the width of its face ring, and leaves the rim bare', () => {
    // Brian, 2026-10-29: the unflipped tiles "look a little thicker" (the back
    // drew 2 units against the face ring's 1.65), and a rim outline made the
    // whole piece "too heavy".
    const host = hostOf(render('international', { tile3d: true }));
    const ring = (banqiTile3dBox(64) * 2.8) / 100;
    for (const square of ['a1', 'b1']) {
      expect(
        host.querySelector(`[data-piece-square="${square}"] .banqi-rim [stroke]`),
        square,
      ).toBeNull();
    }
    const back = host.querySelector('[data-piece-square="b1"] .banqi-back > circle');
    const backWidth = Number(/stroke-width:([\d.]+)/.exec(back?.getAttribute('style') ?? '')?.[1]);
    expect(backWidth).toBeCloseTo(ring, 1);
    // The flat board keeps .banqi-back's own 2 units.
    const flat = hostOf(render('international', { tile3d: false }));
    expect(flat.querySelector('.banqi-back > circle')?.getAttribute('style')).toBeNull();
  });

  it('keeps one disc shadow per tile, moved under the rim', () => {
    const count = (s: string) => s.match(/class="xq-piece-shadow"/g)?.length ?? 0;
    for (const name of NAMES) {
      expect(count(render(name, { tile3d: true })), name).toBe(count(render(name)));
    }
  });

  it('fits disc and rim inside its cell, centred on the cell, whether or not the shadow is on', () => {
    expect(banqiTile3dBox(64)).toBe(58.75);
    for (const shadow of ['off', 'on']) {
      document.documentElement.dataset.xiangqiPieceShadow = shadow;
      const host = hostOf(render('international', { tile3d: true }));
      // b1's cell: x 92..156, y 220..284, centre (124, 252).
      const span = tileSpan(host.querySelector('[data-piece-square="b1"]')!);
      expect(span.bottom - span.top, shadow).toBeLessThanOrEqual(64 * 0.95 + 0.01);
      expect(span.bottom - span.top, shadow).toBeGreaterThan(64 * 0.94);
      expect((span.top + span.bottom) / 2, shadow).toBeCloseTo(252, 0);
      expect(span.halfWidth, shadow).toBeLessThan(32);
      expect(span.top, shadow).toBeGreaterThan(220);
      expect(span.bottom, shadow).toBeLessThan(284);
    }
  });

  it('draws a 3D disc no more than a twentieth narrower than a flat one', () => {
    const r3d = (markup: string, square: string) =>
      Number(
        hostOf(markup)
          .querySelector(`[data-piece-square="${square}"] .banqi-back > circle`)
          ?.getAttribute('r'),
      );
    const flat = r3d(render('international', { tile3d: false }), 'b1');
    const tile = r3d(render('international', { tile3d: true }), 'b1');
    expect(tile / flat).toBeGreaterThan(0.94);
    expect(tile / flat).toBeLessThan(1);
  });

  it('stands Three Kingdoms tiles on the points, with the same 3D body', () => {
    setTile3d(false);
    const flat = TK_SETUP();
    expect(flat).not.toContain('banqi-rim');
    setTile3d(true);
    document.documentElement.dataset.xiangqiPieceShadow = 'on';
    const host = hostOf(TK_SETUP());
    const tiles = Array.from(host.querySelectorAll('.banqi-back'));
    expect(tiles.length).toBe(32);
    expect(host.querySelectorAll('.banqi-rim').length).toBe(32);
    // Points sit on a 64 grid from the frame's margin (37); each tile's whole
    // body, disc top to rim bottom, is centred on its point.
    for (const tile of tiles) {
      const span = tileSpan(tile.parentElement!);
      const cx = Number(tile.querySelector('circle')?.getAttribute('cx'));
      const mid = (span.top + span.bottom) / 2;
      expect((cx - 37) % 64).toBe(0);
      const offset = (((mid - 37) % 64) + 64) % 64;
      expect(Math.min(offset, 64 - offset)).toBeLessThan(0.5);
      expect(span.bottom - span.top).toBeLessThanOrEqual(64 * 0.95 + 0.01);
    }
    // A turned-up tile wears the same ivory rim as a face-down one.
    expect(TK_THUMBNAIL()).toContain('#efe7d2');
    expect(TK_THUMBNAIL()).not.toContain('#2f8a70');
  });

  it('turns a lifted tile as a perspective coin over the board, then puts the tile back', () => {
    const restore = stubScreenMapping();
    try {
      const host = hostOf(render('international', { tile3d: true }));
      document.body.append(host);
      const slot = host.querySelector<SVGGElement>('[data-piece-square="a1"]')!;
      const calls = recordAnimations(() => {
        expect(animateBanqiReveal(host, 'a1', { tile3d: true, style: 'lift' })).toBe(true);
      });
      const coin = document.querySelector('.tile-flip-3d');
      expect(coin).not.toBeNull();
      expect(activeTileFlipOverlays()).toBe(1);
      expect(slot.style.getPropertyValue('visibility')).toBe('hidden');
      // A real perspective, on HTML (Chrome flattens 3D on SVG content).
      const eye = coin!.firstElementChild as HTMLElement;
      expect(eye.style.perspective).toMatch(/px$/);
      expect(coin!.querySelectorAll('.tile-flip-3d-wall').length).toBe(40);
      // The wall is the rim's ivory on both halves: no colour change mid-turn.
      const wall = (coin!.querySelector('.tile-flip-3d-wall') as HTMLElement).style.background;
      expect(wall.toLowerCase()).not.toMatch(/2f8a70|rgb\(47, 138, 112\)/);
      expect(wall.toLowerCase()).toMatch(/efe7d2|rgb\(239, 231, 210\)/);
      // The back is the identity-free back the board drew; the face is the
      // markup the render already carried.
      const back = Array.from(coin!.querySelectorAll('.tile-flip-3d-back'))
        .map((el) => el.outerHTML)
        .join('');
      expect(back).toContain('banqi-rim');
      expect(back).toContain('banqi-back');
      expect(back).not.toMatch(IDENTITY);
      const front = Array.from(coin!.querySelectorAll('.tile-flip-3d-front'))
        .map((el) => el.outerHTML)
        .join('');
      expect(front).toContain('banqi-piece');
      expect(front).toContain('banqi-rim');
      // End over end for Lift, face down to face up.
      const turn = calls.find((c) => c.frames.some((f) => String(f.transform).includes('rotate')));
      expect(String(turn?.frames[0]?.transform)).toMatch(/rotateX\(180deg\)/);
      expect(String(turn?.frames.at(-1)?.transform)).toMatch(/rotateX\(0deg\)/);
      // Nothing of the SVG turn is left in the slot.
      expect(slot.querySelector('.piece-flip-back, .piece-flip-turn, .piece-flip-edge')).toBeNull();
      cancelTileFlipOverlays();
      expect(document.querySelector('.tile-flip-3d')).toBeNull();
      expect(slot.style.getPropertyValue('visibility')).toBe('');
    } finally {
      restore();
    }
  });

  it('spins a Spin tile side to side', () => {
    const restore = stubScreenMapping();
    try {
      const host = hostOf(render('international', { tile3d: true }));
      document.body.append(host);
      const calls = recordAnimations(() => {
        expect(animateBanqiReveal(host, 'a1', { tile3d: true, style: 'spin' })).toBe(true);
      });
      const turn = calls.find((c) => c.frames.some((f) => String(f.transform).includes('rotate')));
      expect(String(turn?.frames[0]?.transform)).toMatch(/rotateY\(180deg\)/);
    } finally {
      restore();
    }
  });

  it('turns a Flat tile, or one with no screen mapping, in the SVG with its rim and edge', () => {
    for (const [style, ctm] of [
      ['flat', undefined],
      ['lift', null],
    ] as const) {
      const restore = stubScreenMapping(ctm);
      try {
        const host = hostOf(render('international', { tile3d: true }));
        document.body.append(host);
        const calls = recordAnimations(() => {
          expect(animateBanqiReveal(host, 'a1', { tile3d: true, style }), style).toBe(true);
        });
        expect(document.querySelector('.tile-flip-3d'), style).toBeNull();
        expect(
          calls.some((c) => c.cls === 'piece-flip-edge'),
          style,
        ).toBe(true);
        expect(calls.find((c) => c.cls === 'piece-flip-back')?.html, style).toContain('banqi-rim');
      } finally {
        restore();
      }
    }
  });

  it('turns the rim with the face and shows the edge mid-turn', () => {
    const host = hostOf(render('international', { tile3d: true }));
    const calls = recordAnimations(() => {
      expect(animateBanqiReveal(host, 'a1', { tile3d: true, style: 'flat' })).toBe(true);
    });
    const back = calls.find((c) => c.cls === 'piece-flip-back');
    expect(back?.html).toContain('banqi-rim');
    expect(back?.html).not.toMatch(IDENTITY);
    expect(calls.find((c) => c.cls === 'piece-flip-turn')?.html).toContain('banqi-rim');
    expect(calls.some((c) => c.cls === 'piece-flip-edge')).toBe(true);
    // The settled slot keeps no flip scaffolding.
    const slot = host.querySelector('[data-piece-square="a1"]');
    expect(slot?.querySelector('.piece-flip-edge, .piece-flip-back, .piece-flip-turn')).toBeNull();
    expect(slot?.querySelector(':scope > .banqi-rim')).not.toBeNull();
  });

  it('draws no edge and no rim for a reveal with 3D tiles switched off', () => {
    setTile3d(false);
    const host = hostOf(render('international'));
    const calls = recordAnimations(() => {
      animateBanqiReveal(host, 'a1');
    });
    expect(calls.some((c) => c.cls === 'piece-flip-edge')).toBe(false);
    expect(calls.find((c) => c.cls === 'piece-flip-back')?.html).not.toContain('banqi-rim');
  });

  it('lays the edge across the turn: lying for Lift, upright for Spin and Flat', () => {
    const edge = banqiTileEdge('international');
    // The edge shows the one body colour on both bands.
    expect(edge.fills).toEqual(['#efe7d2', '#efe7d2']);
    const c = { x: 100, y: 100 };
    const width = (m: string) => Number(m.match(/width="([\d.]+)"/)?.[1]);
    expect(width(pieceFlipEdgeMarkup(c, edge, 'lift'))).toBeCloseTo(2 * edge.halfWidth);
    expect(width(pieceFlipEdgeMarkup(c, edge, 'spin'))).toBeLessThan(edge.depth);
    expect(width(pieceFlipEdgeMarkup(c, edge, 'flat'))).toBeLessThan(edge.depth);
    for (const style of ['flat', 'lift', 'spin'] as const) {
      const frames = pieceFlipEdgeKeyframes(style);
      expect(frames[0]?.transform).toMatch(/\(0\)$/);
      expect(frames.at(-1)?.transform).toMatch(/\(0\)$/);
      expect(frames.find((f) => f.offset === 0.5)?.transform).toMatch(/\(1\)$/);
    }
  });
});
