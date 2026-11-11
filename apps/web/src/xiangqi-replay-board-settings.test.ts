import type { XiangqiColor } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { displayPreferenceStorageKey } from './display-preferences.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { writeStoredXiangqiBoardLayout } from './xiangqi-appearance-storage.js';
import { type XiangqiBoardGeometry, xiangqiBoardPoint } from './xiangqi-board-geometry.js';
import {
  mountXiangqiReplay,
  mountXiangqiReplayBoard,
  type XiangqiReplaySpec,
} from './xiangqi-replay.js';

// Article replay boards and the embedded study board (#558) drew their own
// intersection-only board, so three of the reader's board settings never
// reached them: Square grid, Start markers and Coordinates. They now draw the
// shared surface (xiangqi-board-surface.ts) and place every piece, ring, badge
// and glide through one layout-aware geometry.

// h2h9: the red cannon takes the horse on h10, a move that crosses the river,
// so the square grid's river gap shows up in the glide.
const spec: XiangqiReplaySpec = {
  iccs: 'h2h9',
  red: 'Red',
  black: 'Black',
  event: 'Settings',
  resultText: '*',
};

const INTERSECTION: XiangqiBoardGeometry = {
  fileCount: 9,
  rankCount: 10,
  cell: 31,
  margin: 18,
  riverGap: 0,
};
const CELL: XiangqiBoardGeometry = { ...INTERSECTION, riverGap: 6 };

// This happy-dom build ships no window.localStorage; back it with memory (same
// idiom as xiangqi-board.test.ts) so the settings writes reach the readers.
const storageValues = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return storageValues.size;
    },
    clear: () => storageValues.clear(),
    getItem: (key: string) => storageValues.get(key) ?? null,
    key: (index: number) => [...storageValues.keys()][index] ?? null,
    removeItem: (key: string) => void storageValues.delete(key),
    setItem: (key: string, value: string) => void storageValues.set(key, value),
  } satisfies Storage,
});

let el: HTMLElement;
beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.xiangqiStartMarkers;
  el = document.createElement('div');
  document.body.appendChild(el);
});
afterEach(() => {
  el.remove();
  window.localStorage.clear();
  delete document.documentElement.dataset.xiangqiStartMarkers;
  vi.restoreAllMocks();
});

function svgOf(host: HTMLElement): SVGSVGElement {
  const svg = host.querySelector<SVGSVGElement>('svg.xq-article-svg');
  if (!svg) throw new Error('no board');
  return svg;
}

function pieceCentre(host: HTMLElement, square: string): { x: number; y: number } {
  const piece = host.querySelector(`[data-piece-square="${square}"] svg`);
  if (!piece) throw new Error(`no piece on ${square}`);
  const size = Number(piece.getAttribute('width'));
  return {
    x: Number(piece.getAttribute('x')) + size / 2,
    y: Number(piece.getAttribute('y')) + size / 2,
  };
}

function expectPiecesOn(
  host: HTMLElement,
  geo: XiangqiBoardGeometry,
  layout: 'intersection' | 'cell',
  perspective: XiangqiColor = 'red',
) {
  for (const slot of host.querySelectorAll<SVGGElement>('[data-piece-square]')) {
    const sq = slot.dataset.pieceSquare!;
    const file = 'abcdefghi'.indexOf(sq[0]!);
    const want = xiangqiBoardPoint(file, Number(sq.slice(1)), perspective, layout, geo);
    expect([sq, pieceCentre(host, sq)]).toEqual([sq, want]);
  }
}

function setCoordinates(on: boolean): void {
  window.localStorage.setItem(
    displayPreferenceStorageKey,
    JSON.stringify({ boardCoordinates: on }),
  );
}

describe('article replay board', () => {
  test('draws the intersection board by default, with start markers and no coordinates', () => {
    const c = mountXiangqiReplay(el, spec);
    const svg = svgOf(el);
    expect(svg.getAttribute('data-xiangqi-layout')).toBe('intersection');
    // The board box the static diagrams beside it use, unchanged.
    expect(svg.getAttribute('viewBox')).toBe('0 0 284 315');
    expect(svg.querySelectorAll('.xq-live-cell')).toHaveLength(0);
    expect(svg.querySelectorAll('.xq-live-start-mark')).toHaveLength(14);
    expect(svg.querySelectorAll('.xq-live-coord')).toHaveLength(0);
    expectPiecesOn(el, INTERSECTION, 'intersection');
    c.destroy();
  });

  test('follows Square grid: checkered cells, palace bands, river band, pieces in cells', () => {
    writeStoredXiangqiBoardLayout('cell');
    const c = mountXiangqiReplay(el, spec);
    const svg = svgOf(el);
    expect(svg.getAttribute('data-xiangqi-layout')).toBe('cell');
    expect(svg.classList.contains('xq-surface--cell')).toBe(true);
    expect(svg.querySelectorAll('.xq-live-cell')).toHaveLength(90);
    expect(svg.querySelectorAll('.xq-live-palace-band')).toHaveLength(2);
    expect(svg.querySelectorAll('.xq-live-cell-river')).toHaveLength(1);
    // The square grid has no intersections to bracket.
    expect(svg.querySelectorAll('.xq-live-start-mark')).toHaveLength(0);
    expectPiecesOn(el, CELL, 'cell');
    c.destroy();
  });

  test('the square grid marks the last move the grid way: amber origin cell, ring on the piece', () => {
    writeStoredXiangqiBoardLayout('cell');
    const c = mountXiangqiReplay(el, { ...spec, startPly: 1 });
    const svg = svgOf(el);
    const origin = svg.querySelector('.xq-live-lastmove-origin');
    expect(origin?.tagName.toLowerCase()).toBe('rect');
    expect(origin?.getAttribute('fill-opacity')).toBe('0.65');
    expect(svg.querySelectorAll('.xq-live-lastmove-piece-ring')).toHaveLength(1);
    // The pieces are the grid's rounded squares, not discs.
    expect(svg.querySelector('[data-piece-square="h10"] rect')).not.toBeNull();
    c.destroy();
  });

  test('the intersection board keeps the wash and halo', () => {
    const c = mountXiangqiReplay(el, { ...spec, startPly: 1 });
    const svg = svgOf(el);
    expect(svg.querySelectorAll('.xq-live-lastmove-piece-ring')).toHaveLength(0);
    expect(svg.querySelector('.xq-live-lastmove-origin')?.tagName.toLowerCase()).not.toBe('rect');
    c.destroy();
  });

  test('the square grid keeps room for an edge badge and ring', () => {
    writeStoredXiangqiBoardLayout('cell');
    const c = mountXiangqiReplay(el, spec);
    const [minX, minY, w, h] = svgOf(el).getAttribute('viewBox')!.split(' ').map(Number);
    // Same width as the intersection board, taller by the river gap: the outer
    // cells stop 2.5 units inside the edge, so nothing drawn round an edge
    // piece (badge reach 17.6 from its centre) is cropped.
    expect([minX, minY, w, h]).toEqual([0, 0, 284, 321]);
    c.destroy();
  });

  test('follows Start markers off', () => {
    document.documentElement.dataset.xiangqiStartMarkers = 'off';
    const c = mountXiangqiReplay(el, spec);
    expect(svgOf(el).querySelectorAll('.xq-live-start-mark')).toHaveLength(0);
    c.destroy();
  });

  test('follows Coordinates on: labels in a reserved gutter, pieces where they were', () => {
    setCoordinates(true);
    const c = mountXiangqiReplay(el, spec);
    const svg = svgOf(el);
    expect(svg.getAttribute('viewBox')).toBe('-6 -6 296 327');
    // Algebraic by default: a-i along both edges, 1-10 down both sides.
    expect(svg.querySelectorAll('.xq-live-coord').length).toBe(9 * 2 + 10 * 2);
    expectPiecesOn(el, INTERSECTION, 'intersection');
    c.destroy();
  });

  test('re-renders on an appearance change', () => {
    const c = mountXiangqiReplay(el, spec);
    expect(svgOf(el).getAttribute('data-xiangqi-layout')).toBe('intersection');
    writeStoredXiangqiBoardLayout('cell');
    window.dispatchEvent(new Event(xiangqiAppearanceChangedEvent));
    expect(svgOf(el).getAttribute('data-xiangqi-layout')).toBe('cell');
    c.destroy();
  });

  test.each([
    ['intersection', INTERSECTION],
    ['cell', CELL],
  ] as const)('the glide lands on the right point on the %s board', (layout, geo) => {
    writeStoredXiangqiBoardLayout(layout);
    const calls: Array<{ target: Element; frames: Keyframe[] }> = [];
    const proto = Element.prototype as unknown as {
      animate?: (frames: Keyframe[]) => unknown;
    };
    const original = proto.animate;
    proto.animate = function (this: Element, frames: Keyframe[]) {
      calls.push({ target: this, frames });
      return { cancel() {} };
    };
    try {
      const c = mountXiangqiReplay(el, spec);
      el.querySelector<HTMLButtonElement>('.stepper-button-next')!.click();
      const slot = el.querySelector('[data-piece-square="h10"]');
      expect(slot).not.toBeNull();
      const glide = calls.find((call) => call.target === slot);
      expect(glide).toBeDefined();
      const from = xiangqiBoardPoint(7, 3, 'red', layout, geo);
      const to = xiangqiBoardPoint(7, 10, 'red', layout, geo);
      expect(glide!.frames[0]!.transform).toBe(`translate(${from.x - to.x}px, ${from.y - to.y}px)`);
      expect(pieceCentre(el, 'h10')).toEqual(to);
      c.destroy();
    } finally {
      if (original) proto.animate = original;
      else delete proto.animate;
    }
  });
});

describe('embedded study board', () => {
  test('follows Square grid and Start markers too', () => {
    writeStoredXiangqiBoardLayout('cell');
    const cell = mountXiangqiReplayBoard(el, spec);
    expect(svgOf(el).querySelectorAll('.xq-live-cell')).toHaveLength(90);
    expectPiecesOn(el, CELL, 'cell');
    cell.destroy();

    writeStoredXiangqiBoardLayout('intersection');
    const lined = mountXiangqiReplayBoard(el, spec);
    expect(svgOf(el).querySelectorAll('.xq-live-start-mark')).toHaveLength(14);
    lined.destroy();
  });
});
