import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pieceFlipEdgeKeyframes, pieceFlipEdgeMarkup } from './board-anim.js';
import {
  animateBanqiReveal,
  banqiTile3dBox,
  banqiTile3dFlag,
  banqiTileEdge,
  renderBanqiBoardSvg,
  resetBanqiTile3dFlag,
} from './live-banqi-render.js';
import { TK_SETUP, TK_THUMBNAIL } from './three-kingdoms-banqi-diagrams.js';
import { activeTileFlipOverlays, cancelTileFlipOverlays } from './tile-flip-3d.js';

// The ?tile=3d spike draws banqi tiles with a visible rim. Without the flag the
// board must be the board it was, byte for byte: these hashes are of the
// renderer before the spike (agent/flip-setting at 86b6d6599).
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
  international: '9b77a9f4cbbd9629',
  wood: '6b479bc556c03d05',
  interactive: '1e0ece76b19b7316',
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
  resetBanqiTile3dFlag();
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

/** The vertical span of a 3D tile in a slot: disc top to shadow bottom. */
function tileSpan(slot: Element): { top: number; bottom: number; halfWidth: number } {
  const disc = slot.querySelector('.banqi-back > circle');
  const cy = Number(disc?.getAttribute('cy'));
  const top = cy - (Number(disc?.getAttribute('r')) + 1);
  const shadow = slot.querySelector('.banqi-rim .xq-piece-shadow');
  const ty = Number(shadow?.getAttribute('transform')?.match(/translate\([\d.]+ ([\d.]+)\)/)?.[1]);
  const reach = Math.max(
    ...Array.from(shadow?.querySelectorAll('circle') ?? []).map((c) => Number(c.getAttribute('r'))),
  );
  return { top, bottom: ty + reach, halfWidth: reach };
}

beforeEach(() => {
  resetBanqiTile3dFlag();
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
  window.sessionStorage.clear();
  resetBanqiTile3dFlag();
  vi.unstubAllGlobals();
});

describe('banqi 3D tiles (?tile=3d spike)', () => {
  it('leaves the board byte-identical without the flag', () => {
    expect(banqiTile3dFlag()).toBe(false);
    for (const name of NAMES) {
      expect(sha(render(name)), name).toBe(GOLDEN[name]);
      expect(render(name, { tile3d: false }), name).toBe(render(name));
    }
  });

  it('draws one rim under every tile with the flag', () => {
    setSearch('?tile=3d');
    expect(banqiTile3dFlag()).toBe(true);
    for (const name of NAMES) {
      const flagged = render(name);
      expect(flagged, name).not.toBe(render(name, { tile3d: false }));
      expect(flagged, name).toBe(render(name, { tile3d: true }));
      expect(flagged.match(/class="banqi-rim/g)?.length, name).toBe(5);
    }
  });

  it('keeps the flag for the tab once the query sets it, and drops it on another value', () => {
    setSearch('?tile=3d');
    expect(banqiTile3dFlag()).toBe(true);
    setSearch('');
    expect(banqiTile3dFlag()).toBe(true);
    setSearch('?tile=flat');
    expect(banqiTile3dFlag()).toBe(false);
    setSearch('');
    expect(banqiTile3dFlag()).toBe(false);
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

  it('keeps one disc shadow per tile, moved under the rim', () => {
    const count = (s: string) => s.match(/class="xq-piece-shadow"/g)?.length ?? 0;
    for (const name of NAMES) {
      expect(count(render(name, { tile3d: true })), name).toBe(count(render(name)));
    }
  });

  it('fits the whole tile, rim and shadow, inside its cell, centred on the cell', () => {
    document.documentElement.dataset.xiangqiPieceShadow = 'on';
    expect(banqiTile3dBox(64)).toBe(54);
    const host = hostOf(render('international', { tile3d: true }));
    // b1's cell: x 92..156, y 220..284, centre (124, 252).
    const span = tileSpan(host.querySelector('[data-piece-square="b1"]')!);
    expect(span.bottom - span.top).toBeLessThanOrEqual(64 * 0.92 + 0.01);
    expect(span.bottom - span.top).toBeGreaterThan(64 * 0.9);
    expect((span.top + span.bottom) / 2).toBeCloseTo(252, 0);
    expect(span.halfWidth).toBeLessThan(32);
    expect(span.top).toBeGreaterThan(220);
    expect(span.bottom).toBeLessThan(284);
  });

  it('stands Three Kingdoms tiles on the points, with the same 3D body', () => {
    const flat = TK_SETUP();
    expect(flat).not.toContain('banqi-rim');
    setSearch('?tile=3d');
    document.documentElement.dataset.xiangqiPieceShadow = 'on';
    const host = hostOf(TK_SETUP());
    const tiles = Array.from(host.querySelectorAll('.banqi-back'));
    expect(tiles.length).toBe(32);
    expect(host.querySelectorAll('.banqi-rim').length).toBe(32);
    // Points sit on a 64 grid from the frame's margin (37); each tile's whole
    // body, disc top to shadow bottom, is centred on its point.
    for (const tile of tiles) {
      const span = tileSpan(tile.parentElement!);
      const cx = Number(tile.querySelector('circle')?.getAttribute('cx'));
      const mid = (span.top + span.bottom) / 2;
      expect((cx - 37) % 64).toBe(0);
      expect(Math.abs(((mid - 37) % 64) - 0)).toBeLessThan(0.5);
      expect(span.bottom - span.top).toBeLessThanOrEqual(64 * 0.92 + 0.01);
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

  it('draws no edge and no rim for an unflagged reveal', () => {
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
