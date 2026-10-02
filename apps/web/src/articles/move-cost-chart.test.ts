import { describe, expect, it } from 'vitest';
import { moveCostChartSvg } from './move-cost-chart.js';

const spec = {
  id: 't',
  ariaLabel: 'Test chart',
  heading: 'Winning chances given away',
  lastMove: 5,
  moves: [
    { moveNo: 1, loss: 0, mark: null },
    { moveNo: 2, loss: 0.02, mark: null },
    { moveNo: 3, loss: 0.06, mark: '?!' },
    { moveNo: 4, loss: 0.12, mark: '?' },
    { moveNo: 5, loss: 0.51, mark: '??' },
  ],
  callout: { moveNo: 5, label: 'Reveal on d10' },
} as const;

describe('moveCostChartSvg', () => {
  const svg = moveCostChartSvg(spec);

  it('marks every move: a dot for a free move, a bar otherwise', () => {
    expect(svg.match(/<circle /g)).toHaveLength(1);
    expect(svg.match(/<path d="M[^"]+Z" fill=/g)).toHaveLength(4);
  });

  it("colours marked bars with the review's judgment colours", () => {
    expect(svg).toContain('fill="var(--judgment-blunder');
    expect(svg).toContain('fill="var(--judgment-mistake');
    expect(svg).toContain('fill="var(--judgment-inaccuracy');
  });

  it('scales the axis to the next 20% step over the worst move', () => {
    expect(svg).toContain('>60%<');
    expect(svg).not.toContain('>80%<');
  });

  it('keeps glyphs and hover readouts out of translation', () => {
    for (const m of svg.matchAll(/<(text|title)([^>]*)>(\?\?|\?!|\?|\d+ · [^<]*)<\/\1>/g)) {
      expect(m[2]).toContain('translate="no"');
    }
  });

  it('rejects a callout on a move it does not chart', () => {
    expect(() => moveCostChartSvg({ ...spec, callout: { moveNo: 9, label: 'x' } })).toThrow(
      /not charted/,
    );
  });
});
