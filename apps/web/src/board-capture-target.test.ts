import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureTargetSvg, selectionMarkSvg } from './board-capture-target.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('capture target marks', () => {
  const center = { x: 120, y: 180 };

  it('draws a ring on an intersection board', () => {
    expect(captureTargetSvg('capture', center, 60, 'intersection', 32)).toBe(
      '<circle class="capture" cx="120" cy="180" r="32"/>',
    );
  });

  it('fills the whole cell on a square grid', () => {
    expect(captureTargetSvg('capture', center, 60, 'cell', 32)).toBe(
      '<rect class="capture-fill" x="90" y="150" width="60" height="60" style="fill: var(--board-move-hint, rgba(31, 111, 91, 0.72)); stroke: none; pointer-events: none; opacity: 0.36;"/>',
    );
  });

  it('ignores ?captureTargetStyle=legacy in the URL', async () => {
    const layouts = ['cell', 'intersection'] as const;
    const expected = layouts.map((layout) => captureTargetSvg('capture', center, 60, layout, 32));
    vi.stubGlobal('location', { search: '?captureTargetStyle=legacy' });
    vi.resetModules();
    const { captureTargetSvg: renderCaptureTarget } = await import('./board-capture-target.js');
    expect(layouts.map((layout) => renderCaptureTarget('capture', center, 60, layout, 32))).toEqual(
      expected,
    );
  });

  it('selects the whole cell on a square grid and a disc on intersections', () => {
    expect(selectionMarkSvg('selection', center, 60, 'cell', 30)).toBe(
      '<rect class="selection" x="90" y="150" width="60" height="60"/>',
    );
    expect(selectionMarkSvg('selection', center, 60, 'intersection', 30)).toBe(
      '<circle class="selection" cx="120" cy="180" r="30"/>',
    );
  });
});
