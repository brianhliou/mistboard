import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pieceFlipEdgeKeyframes, pieceFlipEdgeMarkup } from './board-anim.js';
import {
  animateBanqiReveal,
  banqiTile3dFlag,
  banqiTileEdge,
  renderBanqiBoardSvg,
  resetBanqiTile3dFlag,
} from './live-banqi-render.js';

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

/** Every animate() call a run made, by class, with the element's markup then. */
function recordAnimations(run: () => void): { cls: string | null; html: string }[] {
  const calls: { cls: string | null; html: string }[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const original = proto.animate;
  proto.animate = function (this: Element) {
    calls.push({ cls: this.getAttribute('class'), html: this.outerHTML });
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

  it('gives every face-down tile the same rim, and face-up tiles one rim whatever their colour', () => {
    const host = hostOf(render('international', { tile3d: true }));
    const shape = (markup: string) => markup.replace(/-?\d+(\.\d+)?/g, '#');
    expect(rimOf(host, 'b1')).not.toBe('');
    expect(shape(rimOf(host, 'b1'))).toBe(shape(rimOf(host, 'd2')));
    expect(shape(rimOf(host, 'a1'))).toBe(shape(rimOf(host, 'c1')));
    expect(rimOf(host, 'b1')).not.toMatch(IDENTITY);
    expect(rimOf(host, 'a1')).not.toMatch(IDENTITY);
    // Mistboard's tile: ivory under a back, jade under a face.
    expect(rimOf(host, 'b1')).toContain('#efe7d2');
    expect(rimOf(host, 'a1')).toContain('#2f8a70');
    // An asset set's tile is one block of its material, both ways up.
    const wood = hostOf(render('wood', { tile3d: true }));
    expect(shape(rimOf(wood, 'a1'))).toBe(shape(rimOf(wood, 'b1')));
  });

  it('keeps one disc shadow per tile, moved under the rim', () => {
    const count = (s: string) => s.match(/class="xq-piece-shadow"/g)?.length ?? 0;
    for (const name of NAMES) {
      expect(count(render(name, { tile3d: true })), name).toBe(count(render(name)));
    }
  });

  it('turns the rim with the face and shows the edge mid-turn', () => {
    const host = hostOf(render('international', { tile3d: true }));
    const calls = recordAnimations(() => {
      expect(animateBanqiReveal(host, 'a1', { tile3d: true })).toBe(true);
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
