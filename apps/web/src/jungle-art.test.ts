import { describe, expect, it } from 'vitest';
import {
  framedTokenSvg,
  JUNGLE_ART,
  JUNGLE_TOKEN_REACH,
  jungleFaceDownDiscSvg,
  jungleTokenSize,
} from './jungle-art.js';

type Rect = { x: number; width: number; strokeWidth: number; stroke: string | null };

function rects(svg: string): Rect[] {
  return [...svg.matchAll(/<rect ([^>]*)\/>/g)].map(([, attrs]) => {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs ?? '')?.[1];
    return {
      x: Number(attr('x')),
      width: Number(attr('width')),
      strokeWidth: Number(attr('stroke-width') ?? 0),
      stroke: attr('stroke') ?? null,
    };
  });
}

// The 2026-10-14 look (docs-private/tools/x-drafts/card-lab/PIECES-2026-10.md):
// Jungle and Flip Jungle tokens are rounded squares whose outer edge spans all of
// the cell, the ring on that edge, and the face-down tile the same size.
describe('jungle tokens', () => {
  const CELL = 64;

  it('are rounded squares whose ring reaches the cell edge', () => {
    const svg = framedTokenSvg({
      cx: 32,
      cy: 32,
      size: jungleTokenSize(CELL),
      ink: 'red',
      role: 'lion',
    });
    expect(svg).not.toContain('<circle');
    const ring = rects(svg).find((rect) => rect.stroke !== null);
    expect(ring).toBeDefined();
    const outer = (ring?.width ?? 0) + (ring?.strokeWidth ?? 0);
    expect(outer / CELL).toBeCloseTo(JUNGLE_TOKEN_REACH, 2);
    // The cream face stops at the ring's centre line, not outside it.
    const face = rects(svg).find((rect) => rect.stroke === null);
    expect(face?.width).toBeCloseTo(ring?.width ?? 0, 3);
  });

  it('ring both sides in the one dark ink, since the art carries the side', () => {
    for (const ink of ['red', 'black'] as const) {
      const svg = framedTokenSvg({ cx: 0, cy: 0, size: 60, ink, role: 'cat' });
      expect(svg, ink).toContain(`stroke="${JUNGLE_ART.animalRing}"`);
    }
  });

  it('draw no shadow unless a filter is passed', () => {
    const svg = framedTokenSvg({ cx: 0, cy: 0, size: 60, ink: 'black', role: 'rat' });
    expect(svg).not.toContain('filter=');
  });

  it('turn face down into a jade square of the same outer size', () => {
    const svg = jungleFaceDownDiscSvg(32, 32, CELL);
    expect(svg).not.toContain('<circle');
    const [tile] = rects(svg);
    expect(((tile?.width ?? 0) + (tile?.strokeWidth ?? 0)) / CELL).toBeCloseTo(
      JUNGLE_TOKEN_REACH,
      3,
    );
  });
});
