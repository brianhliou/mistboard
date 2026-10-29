import { createHash } from 'node:crypto';
import {
  createInitialJieqiState,
  createInitialXiangqiState,
  getJieqiPlayerView,
  getStandardXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateBoardLastMoveArrival } from './board-lastmove.js';
import { XIANGQI_PIECE_OUTLINE_SHARE, xiangqiPieceDrawSize } from './board-metrics.js';
import { JUNGLE_FLIP_TILE_3D, jungleFlipTile3dGeometry } from './jungle-flip-render.js';
import { banqiTile3dBox } from './live-banqi-render.js';
import { animateJieqiReveal, renderJieqiBoardSvg } from './live-jieqi-render.js';
import {
  BANQI_PIECE_3D,
  PIECE_3D_THICK_EDGE,
  piece3dLook,
  XIANGQI_PIECE_3D,
  xiangqiPiece3dBox,
  xiangqiPiece3dDiscCenter,
  xiangqiPiece3dEdge,
} from './piece-3d.js';
import { cancelTileFlipOverlays } from './tile-flip-3d.js';
import { type XiangqiBoardSvgState, xiangqiBoardSvg } from './xiangqi-board.js';

// Flat pieces unless a test asks for 3D: the board-wide 3D default
// (piece3dEnabled, 2026-10-28) reads the root, which these tests pin off.
beforeEach(() => {
  document.documentElement.dataset.banqiTile3d = 'off';
});
afterEach(() => {
  delete document.documentElement.dataset.banqiTile3d;
});

// Xiangqi and jieqi boards draw 3D pieces only when a caller asks (`tile3d`).
// With 3D off, the board must be the board it was, byte for byte: these hashes
// are of the renderers before the option existed (agent/pieces-3d at
// 8a71ea570), re-cut once for the black jieqi back edge (2026-10-28).
const XQ = getStandardXiangqiPlayerView(createInitialXiangqiState('piece-3d'), 'red');
const JQ = getJieqiPlayerView(createInitialJieqiState('piece-3d'), 'red');
const BASE = { interactive: false, selectedSquare: null, draggingFrom: null } as const;

type XqCase = Omit<XiangqiBoardSvgState, 'interactive' | 'selectedSquare' | 'draggingFrom'> &
  Partial<XiangqiBoardSvgState> & { perspective?: 'red' | 'black' };

const XQ_CASES: Record<string, XqCase> = {
  xqInternational: { coordinates: false, pieceSet: 'international' },
  xqWood: { coordinates: true, pieceSet: 'wood', perspective: 'black' },
  xqCell: { layout: 'cell', coordinates: false, pieceSet: 'traditional' },
  xqDrag: {
    interactive: true,
    selectedSquare: 'b1',
    draggingFrom: 'b1',
    coordinates: false,
    pieceSet: 'international',
  },
};

const JQ_CASES: Record<
  string,
  Parameters<typeof renderJieqiBoardSvg>[2] & { perspective?: 'black' }
> = {
  jqInternational: { coordinates: false, pieceSet: 'international' },
  jqWood: { coordinates: true, pieceSet: 'wood', perspective: 'black' },
  jqCell: { layout: 'cell', coordinates: false, pieceSet: 'traditional' },
  jqDrag: {
    interactive: true,
    selectedSquare: 'a1',
    draggingFrom: 'a1',
    coordinates: false,
    pieceSet: 'international',
    legalMoves: JQ.legalMoves.filter((m) => m.from === 'a1'),
  },
};

const GOLDEN: Record<string, string> = {
  xqInternational: '7817aa6951276cba',
  xqWood: 'c500f6b834f5b9b1',
  xqCell: 'b322a7f806f91a53',
  xqDrag: '996fa6332f638a61',
  jqInternational: 'ca874e5065afac0b',
  jqWood: 'e04eae44be343388',
  jqCell: '4523d802c00a08df',
  jqDrag: '8e17f0fb5c8e6bb1',
};

function sha(svg: string): string {
  return createHash('sha256').update(svg).digest('hex').slice(0, 16);
}

function xq(name: string, extra: Partial<XiangqiBoardSvgState> = {}): string {
  const { perspective = 'red', ...opts } = XQ_CASES[name] ?? {};
  return xiangqiBoardSvg(XQ, perspective, { ...BASE, ...opts, ...extra });
}

function jq(name: string, extra: { tile3d?: boolean } = {}): string {
  const { perspective = 'red', ...opts } = JQ_CASES[name] ?? {};
  return renderJieqiBoardSvg(JQ, perspective, { ...opts, ...extra });
}

function hostOf(svg: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = svg;
  return host;
}

/** A slot's piece: centre and outline width of its disc, and its rim's bottom. */
function pieceGeometry(slot: Element): {
  cx: number;
  cy: number;
  top: number;
  bottom: number;
  width: number;
} {
  const face = slot.querySelector(':scope > svg')!;
  const size = Number(face.getAttribute('width'));
  const cx = Number(face.getAttribute('x')) + size / 2;
  const cy = Number(face.getAttribute('y')) + size / 2;
  const width = size * XIANGQI_PIECE_OUTLINE_SHARE;
  const band = slot.querySelector(':scope > g[class$="-rim"] > path')?.getAttribute('d') ?? '';
  const [, low, radius] = band.match(/V([\d.]+)A([\d.]+)/) ?? [];
  const bottom = band ? Number(low) + Number(radius) : cy + width / 2;
  return { cx, cy, top: cy - width / 2, bottom, width };
}

type AnimateCall = {
  frames: Keyframe[];
  composite?: string;
  cls: string | null;
  html: string;
  delay: number;
};

function recordAnimations(run: () => void): AnimateCall[] {
  const calls: AnimateCall[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const original = proto.animate;
  proto.animate = function (this: Element, frames: Keyframe[], opts?: KeyframeAnimationOptions) {
    calls.push({
      cls: this.getAttribute('class'),
      html: this.outerHTML,
      delay: Number(opts?.delay ?? 0),
      frames,
      ...(opts?.composite ? { composite: opts.composite } : {}),
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

afterEach(() => {
  delete document.documentElement.dataset.xiangqiPieceShadow;
});

describe('xiangqi and jieqi 3D pieces', () => {
  it('draws flat by default and 3D once the 3D pieces switch is on', () => {
    delete document.documentElement.dataset.banqiTile3d;
    const rims = (svg: string) =>
      hostOf(svg).querySelectorAll('.xq-piece-rim, .jieqi-piece-rim').length;
    expect(rims(xq('xqInternational'))).toBe(0);
    expect(rims(jq('jqInternational'))).toBe(0);
    document.documentElement.dataset.banqiTile3d = 'on';
    expect(rims(xq('xqInternational'))).toBe(32);
    expect(rims(jq('jqInternational'))).toBe(32);
    document.documentElement.dataset.banqiTile3d = 'off';
    expect(rims(xq('xqInternational'))).toBe(0);
    expect(rims(jq('jqInternational'))).toBe(0);
  });

  it('leaves both boards byte-identical unless a caller asks for 3D', () => {
    for (const name of Object.keys(XQ_CASES)) {
      expect(sha(xq(name)), name).toBe(GOLDEN[name]);
      expect(sha(xq(name, { tile3d: false })), name).toBe(GOLDEN[name]);
    }
    for (const name of Object.keys(JQ_CASES)) {
      expect(sha(jq(name)), name).toBe(GOLDEN[name]);
      expect(sha(jq(name, { tile3d: false })), name).toBe(GOLDEN[name]);
    }
  });

  it('sizes the piece so disc and rim stay inside a flat piece, the disc within 10% of it', () => {
    expect(xiangqiPiece3dBox(60)).toBe(57);
    expect(xiangqiPiece3dBox(72)).toBe(68.5);
    for (const pitch of [44, 60, 72, 90]) {
      const box = xiangqiPiece3dBox(pitch);
      const flatWidth = xiangqiPieceDrawSize(pitch) * XIANGQI_PIECE_OUTLINE_SHARE;
      const disc = box * XIANGQI_PIECE_OUTLINE_SHARE;
      const span = disc + box * XIANGQI_PIECE_3D.depthShare;
      expect(span, String(pitch)).toBeLessThanOrEqual(pitch * XIANGQI_PIECE_3D.reach + 1e-9);
      expect(span, String(pitch)).toBeLessThanOrEqual(flatWidth + 0.01);
      expect(disc / flatWidth, String(pitch)).toBeGreaterThanOrEqual(0.9);
      expect(disc / flatWidth, String(pitch)).toBeLessThan(1);
      // Disc and rim together sit on the anchor: the disc is raised by half the rim.
      const centre = xiangqiPiece3dDiscCenter({ x: 100, y: 200 }, pitch);
      expect(centre.x).toBe(100);
      expect(centre.y + (box * XIANGQI_PIECE_3D.depthShare) / 2).toBeCloseTo(200, 1);
    }
  });

  it("deepens every board's rim 1.5x on the Thicker edge, at the same footprint", () => {
    const measure = () => ({
      xq: xiangqiPiece3dEdge('traditional', 60).depth,
      xqBox: xiangqiPiece3dBox(60),
      bq: piece3dLook('traditional', banqiTile3dBox(64), BANQI_PIECE_3D).depth,
      bqBox: banqiTile3dBox(64),
      jg: jungleFlipTile3dGeometry(64),
    });
    const standard = measure();
    document.documentElement.dataset.pieceEdge = 'thick';
    try {
      const thick = measure();
      expect(thick.xq / standard.xq).toBeCloseTo(
        PIECE_3D_THICK_EDGE * (thick.xqBox / standard.xqBox),
        1,
      );
      expect(thick.bq / standard.bq).toBeCloseTo(
        PIECE_3D_THICK_EDGE * (thick.bqBox / standard.bqBox),
        1,
      );
      expect(thick.jg.depth / standard.jg.depth).toBeCloseTo(PIECE_3D_THICK_EDGE, 1);
      // The face gives up the depth: smaller box (or token), same span.
      const span = (box: number, share: number) => box * (XIANGQI_PIECE_OUTLINE_SHARE + share);
      expect(thick.xqBox).toBeLessThan(standard.xqBox);
      expect(
        span(thick.xqBox, XIANGQI_PIECE_3D.depthShare * PIECE_3D_THICK_EDGE),
      ).toBeLessThanOrEqual(60 * XIANGQI_PIECE_3D.reach + 1e-9);
      expect(thick.bqBox).toBeLessThan(standard.bqBox);
      expect(
        span(thick.bqBox, BANQI_PIECE_3D.depthShare * PIECE_3D_THICK_EDGE),
      ).toBeLessThanOrEqual(64 * BANQI_PIECE_3D.reach + 1e-9);
      expect(thick.jg.size).toBeLessThan(standard.jg.size);
      expect(2 * thick.jg.half + thick.jg.depth).toBeLessThanOrEqual(
        64 * JUNGLE_FLIP_TILE_3D.reach + 1e-9,
      );
    } finally {
      delete document.documentElement.dataset.pieceEdge;
    }
    expect(measure()).toEqual(standard);
  });

  it('stands every xiangqi piece on its point with one rim, inside the flat footprint', () => {
    for (const shadow of ['off', 'on']) {
      document.documentElement.dataset.xiangqiPieceShadow = shadow;
      const flat = hostOf(xq('xqInternational'));
      const tile = hostOf(xq('xqInternational', { tile3d: true }));
      const slots = tile.querySelectorAll('[data-piece-square]');
      expect(slots.length).toBe(32);
      expect(tile.querySelectorAll('.xq-piece-rim').length).toBe(32);
      for (const slot of slots) {
        const square = slot.getAttribute('data-piece-square');
        const was = pieceGeometry(flat.querySelector(`[data-piece-square="${square}"]`)!);
        const now = pieceGeometry(slot);
        expect(now.cx, `${square} ${shadow}`).toBeCloseTo(was.cx, 1);
        expect((now.top + now.bottom) / 2, `${square} ${shadow}`).toBeCloseTo(was.cy, 0);
        expect(now.top, `${square} ${shadow}`).toBeGreaterThanOrEqual(was.top - 0.01);
        expect(now.bottom, `${square} ${shadow}`).toBeLessThanOrEqual(was.bottom + 0.01);
        expect(now.width / was.width, `${square} ${shadow}`).toBeGreaterThanOrEqual(0.9);
      }
      // One disc shadow per piece when shadows are on, moved under the rim.
      const count = (s: string) => s.match(/class="xq-piece-shadow"/g)?.length ?? 0;
      expect(count(xq('xqInternational', { tile3d: true }))).toBe(count(xq('xqInternational')));
      expect(count(xq('xqInternational', { tile3d: true }))).toBe(shadow === 'on' ? 32 : 0);
    }
  });

  it('keeps the dragged piece and its rim dim together', () => {
    const host = hostOf(xq('xqDrag', { tile3d: true }));
    const slot = host.querySelector('[data-piece-square="b1"]')!;
    expect(slot.querySelector(':scope > .xq-piece-rim')?.classList).toContain(
      'xq-piece--drag-source',
    );
    expect(slot.querySelector(':scope > svg')?.classList).toContain('xq-piece--drag-source');
  });

  it('stays flat where the set draws rounded squares, and draws a rim where it draws discs', () => {
    expect(xq('xqCell', { tile3d: true })).toBe(xq('xqCell'));
    expect(jq('jqCell', { tile3d: true })).toBe(jq('jqCell'));
    // An asset set has no square: its discs on the cell grid get rims.
    expect(xq('xqCell', { tile3d: true, pieceSet: 'wood' })).toContain('xq-piece-rim');
  });

  it('gives jieqi face-down backs and revealed faces the same rim', () => {
    const host = hostOf(jq('jqInternational', { tile3d: true }));
    expect(host.querySelectorAll('[data-piece-square]').length).toBe(32);
    expect(host.querySelectorAll('.jieqi-piece-rim').length).toBe(32);
    const rim = (square: string) =>
      host.querySelector(`[data-piece-square="${square}"] > .jieqi-piece-rim`)?.outerHTML ?? '';
    const shape = (markup: string) => markup.replace(/-?\d+(\.\d+)?/g, '#');
    // a1 is a face-down chariot's home; e1 is the face-up general.
    expect(host.querySelector('[data-piece-square="a1"]')?.innerHTML).toContain('hidden piece');
    expect(shape(rim('a1'))).toBe(shape(rim('e1')));
    expect(rim('a1').match(/fill="[^"]+"/g)).toEqual(rim('e1').match(/fill="[^"]+"/g));
    // No identity rides on the rim of a hidden piece.
    expect(rim('a1')).not.toMatch(/chariot|horse|cannon|aria-label/);
    const disc = pieceGeometry(host.querySelector('[data-piece-square="a1"]')!);
    const flat = pieceGeometry(
      hostOf(jq('jqInternational')).querySelector('[data-piece-square="a1"]')!,
    );
    expect((disc.top + disc.bottom) / 2).toBeCloseTo(flat.cy, 0);
    expect(disc.bottom).toBeLessThanOrEqual(flat.bottom + 0.01);
  });

  it('outlines a 3D jieqi piece face down at the width of its face ring, and leaves the rim bare', () => {
    // Brian, 2026-10-29: face down should not read thicker than face up (the
    // back drew 3 in its 100 box against the ring's 2.8); a rim outline made
    // the whole piece "too heavy".
    const host = hostOf(jq('jqInternational', { tile3d: true }));
    const backCircle = host.querySelector('[data-piece-square="a1"] > svg circle[stroke-width]');
    expect(Number(backCircle?.getAttribute('stroke-width'))).toBe(2.8);
    for (const square of ['a1', 'e1']) {
      expect(
        host.querySelector(`[data-piece-square="${square}"] > .jieqi-piece-rim [stroke]`),
        square,
      ).toBeNull();
    }
    const flat = hostOf(jq('jqInternational'));
    expect(
      flat
        .querySelector('[data-piece-square="a1"] > svg circle[stroke-width]')
        ?.getAttribute('stroke-width'),
    ).toBe('3');
  });

  it('turns a jieqi reveal with its rim, showing the edge, after the glide', () => {
    const host = hostOf(jq('jqInternational', { tile3d: true }));
    const calls = recordAnimations(() => {
      expect(
        animateJieqiReveal(host, 'e1', 'red', 'red', {
          delayMs: 180,
          tile3d: true,
          pieceSet: 'international',
        }),
      ).toBe(true);
    });
    const back = calls.find((c) => c.cls === 'piece-flip-back');
    expect(back?.html).toContain('jieqi-piece-rim');
    expect(back?.html).toContain('hidden piece');
    expect(calls.find((c) => c.cls === 'piece-flip-turn')?.html).toContain('jieqi-piece-rim');
    const edge = calls.find((c) => c.cls === 'piece-flip-edge');
    expect(edge).toBeDefined();
    expect(edge?.delay).toBe(180);
    expect(xiangqiPiece3dEdge('international', 72).fills).toEqual(['#efe7d2', '#efe7d2']);
  });

  it('draws no edge and no rim for a jieqi reveal without 3D', () => {
    const host = hostOf(jq('jqInternational'));
    const calls = recordAnimations(() => {
      animateJieqiReveal(host, 'e1', 'red', 'red', { pieceSet: 'international' });
    });
    expect(calls.some((c) => c.cls === 'piece-flip-edge')).toBe(false);
    expect(calls.find((c) => c.cls === 'piece-flip-back')?.html).not.toContain('rim');
  });

  it('turns the gold edge with a revealing piece, on top of its glide', () => {
    // Brian, 2026-10-29: the gold edge and the disc must not separate.
    const moved = { ...JQ, lastMove: { from: 'e2', to: 'e1' } } as typeof JQ;
    const host = hostOf(
      renderJieqiBoardSvg(moved, 'red', { pieceSet: 'international', tile3d: true }),
    );
    expect(host.querySelector('.xq-live-lastmove-edge')).not.toBeNull();
    const calls = recordAnimations(() => {
      animateJieqiReveal(host, 'e1', 'red', 'red', {
        alongGlide: true,
        tile3d: true,
        pieceSet: 'international',
      });
    });
    const turn = calls.find((c) => c.cls === 'piece-flip-turn');
    const edge = calls.filter((c) => c.cls?.includes('xq-live-lastmove-edge'));
    expect(edge.length).toBeGreaterThan(0);
    // Added onto the glide, never replacing it, with the piece's own turn.
    expect(edge.every((c) => c.composite === 'add')).toBe(true);
    expect(edge[0].frames).toEqual(turn?.frames);
  });

  it('turns a jieqi reveal as a 3D coin that rides the glide, gold edge landing with the face', () => {
    // Brian, 2026-10-29: the SVG turn squashed the piece "into a thin line" mid-flip.
    const proto = SVGSVGElement.prototype as unknown as { getScreenCTM?: unknown };
    const original = proto.getScreenCTM;
    proto.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    const moved = { ...JQ, lastMove: { from: 'e2', to: 'e1' } } as typeof JQ;
    const host = hostOf(
      renderJieqiBoardSvg(moved, 'red', { pieceSet: 'international', tile3d: true }),
    );
    document.body.append(host);
    try {
      const slot = host.querySelector<SVGGElement>('[data-piece-square="e1"]')!;
      const reveal = () =>
        recordAnimations(() => {
          expect(
            animateJieqiReveal(host, 'e1', 'red', 'red', {
              alongGlide: true,
              tile3d: true,
              pieceSet: 'international',
              style: 'spin',
            }),
          ).toBe(true);
        });
      const coinTop = () =>
        Number.parseFloat(document.querySelector<HTMLElement>('.tile-flip-3d')?.style.top ?? '');
      reveal();
      const restingTop = coinTop();
      cancelTileFlipOverlays();
      // Midway through the glide the slot sits 30 units short of its point.
      const computed = window.getComputedStyle;
      window.getComputedStyle = ((el: Element) =>
        el === slot
          ? ({ transform: 'matrix(1, 0, 0, 1, 0, 30)' } as CSSStyleDeclaration)
          : computed(el)) as typeof window.getComputedStyle;
      let calls: AnimateCall[] = [];
      try {
        calls = reveal();
      } finally {
        window.getComputedStyle = computed;
      }
      const coin = document.querySelector<HTMLElement>('.tile-flip-3d');
      expect(coin).not.toBeNull();
      expect(coinTop() - restingTop).toBeCloseTo(30, 1);
      expect(coin!.querySelectorAll('.tile-flip-3d-wall').length).toBe(40);
      expect(slot.style.getPropertyValue('visibility')).toBe('hidden');
      expect(calls.some((c) => c.cls === 'piece-flip-turn')).toBe(false);
      const back = Array.from(coin!.querySelectorAll('.tile-flip-3d-back'))
        .map((layer) => layer.outerHTML)
        .join('');
      expect(back).toContain('jieqi-piece-rim');
      expect(back).toContain('hidden piece');
      // The gold edge waits for the face it rings.
      const edge = calls.find((c) => c.cls?.includes('xq-live-lastmove-edge'));
      expect(edge?.frames.map((k) => k.opacity)).toEqual([0, 0, 1, 1]);
      cancelTileFlipOverlays();
      expect(slot.style.getPropertyValue('visibility')).toBe('');
    } finally {
      host.remove();
      if (original === undefined) delete proto.getScreenCTM;
      else proto.getScreenCTM = original;
    }
  });

  it('marks a 3D piece by its gold edge, which glides with the piece', () => {
    const moved = { ...XQ, lastMove: { from: 'b3', to: 'e3' } } as typeof XQ;
    const markOf = (tile3d: boolean) =>
      hostOf(xiangqiBoardSvg(moved, 'red', { ...BASE, pieceSet: 'international', tile3d }));
    const flat = markOf(false).querySelector('.xq-live-lastmove-ring') as SVGCircleElement;
    const host = markOf(true);
    const ring = host.querySelector('.xq-live-lastmove-edge') as SVGPathElement;
    // No band on the rim any more (Brian, 2026-10-29: it "sits a little bit on
    // the edge of the disk"), and the edge stands on the flat piece's point.
    expect(host.querySelectorAll('.xq-live-lastmove-ring')).toHaveLength(1);
    const anchor = { x: Number(flat.getAttribute('cx')), y: Number(flat.getAttribute('cy')) };
    expect(Number(ring.getAttribute('data-cx'))).toBe(anchor.x);
    expect(Number(ring.getAttribute('data-cy'))).toBe(anchor.y);
    // The wall below the face: from the face's centre line down to the base,
    // at the disc's own radius.
    const disc = xiangqiPiece3dDiscCenter(anchor, 60);
    const [left, top, base] = (ring.getAttribute('d') ?? '').match(/-?[\d.]+/g)!.map(Number);
    const radius = xiangqiPiece3dBox(60) * 0.474;
    expect(left).toBeCloseTo(anchor.x - radius, 1);
    expect(top).toBeCloseTo(disc.y, 1);
    expect(base).toBeCloseTo(anchor.y + (anchor.y - disc.y), 1);
    // Over the pieces, so the rim never covers it; a flat band stays under them.
    expect(ring.closest('.xq-live-lastmove-over')).not.toBeNull();
    expect(flat.closest('.xq-live-lastmove-over')).toBeNull();

    const animate = vi.fn();
    Object.assign(ring, { animate, getAnimations: () => [] });
    const from = { x: anchor.x - 180, y: anchor.y };
    animateBoardLastMoveArrival(host, from, anchor, 200);
    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.calls[0][0][0].transform).toBe('translate(-180px, 0px)');
  });
});
