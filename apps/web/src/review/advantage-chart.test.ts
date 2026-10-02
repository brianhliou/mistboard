import { describe, expect, it } from 'vitest';
import { createAdvantageChart } from './advantage-chart.js';
import type { PlyEval } from './game-analysis.js';

const evals: PlyEval[] = [
  { ply: 0, cp: 0, mate: null, best: null },
  { ply: 1, cp: 100, mate: null, best: null },
  { ply: 2, cp: -50, mate: null, best: null },
  { ply: 3, cp: 200, mate: null, best: null },
];

function ghost(el: HTMLElement): SVGPolylineElement {
  return el.querySelector('.advantage-chart__ghost') as SVGPolylineElement;
}
function band(el: HTMLElement): SVGPolygonElement {
  return el.querySelector('.advantage-chart__luck-band') as SVGPolygonElement;
}
function legend(el: HTMLElement): HTMLElement {
  return el.querySelector('.advantage-chart__legend') as HTMLElement;
}

describe('advantage chart luck overlay', () => {
  it('uses bound ink colors without changing the first-seat eval direction', () => {
    const chart = createAdvantageChart(evals, {
      onJump: () => {},
      seatColors: { red: 'black', black: 'red' },
    });
    const zones = chart.el.querySelectorAll('.advantage-chart__zone');
    expect(zones[0]?.classList).toContain('advantage-chart__zone--black');
    expect(zones[1]?.classList).toContain('advantage-chart__zone--red');
  });

  it('has no ghost/band and a hidden legend until the overlay is set', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {} });
    expect(ghost(chart.el).getAttribute('points')).toBe('');
    expect(band(chart.el).getAttribute('points')).toBe('');
    expect(legend(chart.el).hidden).toBe(true);
  });

  it('draws the ghost line + band + legend when reveals moved the needle', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {} });
    // Red reveal at ply 1 (+20 for red), black-flavoured luck already mapped to red-POV at ply 3.
    chart.setLuckOverlay(
      new Map([
        [1, 20],
        [3, -30],
      ]),
    );
    expect(ghost(chart.el).getAttribute('points')).not.toBe('');
    expect(band(chart.el).getAttribute('points')).not.toBe('');
    expect(legend(chart.el).hidden).toBe(false);
  });

  it('ghost diverges from the realized line by the cumulative luck', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {} });
    chart.setLuckOverlay(new Map([[1, 20]]));
    const real = (chart.el.querySelector('.advantage-chart__line') as SVGPolylineElement)
      .getAttribute('points')!
      .split(' ');
    const g = ghost(chart.el).getAttribute('points')!.split(' ');
    // Ply 0 (before any reveal) coincides; ply 1 onward the ghost sits at a different y.
    expect(g[0]).toBe(real[0]);
    expect(g[1]).not.toBe(real[1]);
  });

  it('skips the overlay when no reveal actually moved the win%', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {} });
    chart.setLuckOverlay(
      new Map([
        [1, 0],
        [3, 0],
      ]),
    );
    expect(ghost(chart.el).getAttribute('points')).toBe('');
    expect(legend(chart.el).hidden).toBe(true);
  });
});

function cursorX(el: HTMLElement): string {
  return (el.querySelector('.advantage-chart__cursor') as SVGLineElement).getAttribute('x1')!;
}
function tip(el: HTMLElement): HTMLElement {
  return el.querySelector('.advantage-chart__tip') as HTMLElement;
}
/** jsdom lays nothing out, so the chart cannot read its own width. Give the frame
 *  a 300px box so client-x maps to a ply the way it does in a browser. */
function withLayout(el: HTMLElement): SVGSVGElement {
  const svg = el.querySelector('.advantage-chart__svg') as SVGSVGElement;
  svg.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 100 }) as DOMRect;
  return svg;
}
function pointerAt(svg: SVGSVGElement, clientX: number): void {
  svg.dispatchEvent(new PointerEvent('pointermove', { clientX, bubbles: true }));
}

describe('advantage chart win curve', () => {
  it('plots the same cp higher on a steeper engine curve', () => {
    const series: PlyEval[] = [
      { ply: 0, cp: 0, mate: null, best: null },
      { ply: 1, cp: 150, mate: null, best: null },
    ];
    const lastY = (winK?: number): number => {
      const chart = createAdvantageChart(series, { onJump: () => {}, winK });
      const points = (chart.el.querySelector('.advantage-chart__line') as SVGPolylineElement)
        .getAttribute('points')!
        .split(' ');
      return Number(points.at(-1)!.split(',')[1]);
    };
    // +150cp is ~63% on lila's curve and ~81% on AB-JChess's (K 0.00985): a smaller y.
    expect(lastY(0.00985)).toBeLessThan(lastY() - 5);
    expect(lastY(undefined)).toBe(lastY(0.00368208));
  });
});

describe('advantage chart frame', () => {
  it('keeps a forced mate off the frame edge', () => {
    const chart = createAdvantageChart(
      [
        { ply: 0, cp: 0, mate: null, best: null },
        { ply: 1, cp: null, mate: 1, best: null },
      ],
      { onJump: () => {} },
    );
    const ys = (chart.el.querySelector('.advantage-chart__line') as SVGPolylineElement)
      .getAttribute('points')!
      .split(' ')
      .map((point) => Number(point.split(',')[1]));
    // A forced mate is the top of the win% scale, and without the reserved margin
    // it plots within a rounding error of y=0 and loses half its stroke to the
    // frame edge. The margin is 4 view units out of 100; anything that leaves
    // less than a stroke's worth of room has lost it.
    expect(Math.min(...ys)).toBeGreaterThan(2);
    expect(Math.max(...ys)).toBeLessThan(98);
  });

  it('keeps the cursor inside the frame at ply 0', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {} });
    chart.setPly(0);
    expect(Number(cursorX(chart.el))).toBeGreaterThan(0);
  });
});

describe('advantage chart hover readout', () => {
  it('names the hovered move and its eval, and hides on the way out', () => {
    const chart = createAdvantageChart(evals, {
      onJump: () => {},
      moveLabel: (ply) => `${ply}. move`,
    });
    const svg = withLayout(chart.el);
    expect(tip(chart.el).hidden).toBe(true);

    pointerAt(svg, 300); // the last ply
    expect(tip(chart.el).hidden).toBe(false);
    expect(tip(chart.el).textContent).toBe('3. move+2.0');

    svg.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(tip(chart.el).hidden).toBe(true);
  });

  it('returns the cursor to the selected ply when the pointer leaves', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {} });
    const svg = withLayout(chart.el);
    chart.setPly(1);
    const selected = cursorX(chart.el);

    pointerAt(svg, 300);
    expect(cursorX(chart.el)).not.toBe(selected);

    svg.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    // Hovering must not redefine where the board is: the cursor comes back.
    expect(cursorX(chart.el)).toBe(selected);
  });

  it('shows the eval alone when the caller supplies no move labels', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {} });
    pointerAt(withLayout(chart.el), 150);
    expect(tip(chart.el).textContent).toBe('-0.5');
  });
});

describe('advantage chart draw order', () => {
  it('draws the axis, dividers and luck band above the advantage fills', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {}, phases: { middle: 1, end: 2 } });
    chart.setLuckOverlay(new Map([[1, 20]]));
    // The fills are OPAQUE, so anything painted under them does not exist. Nothing
    // here fails visibly in a unit test and nothing fails loudly in a browser
    // either — the zero line, the phase dividers and the jieqi luck band simply
    // stop being on screen. Order is the only thing holding them there.
    const svg = chart.el.querySelector('.advantage-chart__svg') as SVGSVGElement;
    const order = [...svg.children].map((node) => node.getAttribute('class') ?? node.nodeName);
    const at = (cls: string) => order.findIndex((name) => name.includes(cls));

    const lastFill = Math.max(at('advantage-chart__area--'), at('advantage-chart__area'));
    expect(lastFill).toBeGreaterThan(-1);
    for (const above of ['advantage-chart__luck-band', 'advantage-chart__axis']) {
      expect(at(above)).toBeGreaterThan(lastFill);
    }
    // ...and the curve, its cursor and the hover dot stay on top of all of it.
    for (const top of [
      'advantage-chart__line',
      'advantage-chart__cursor',
      'advantage-chart__dot',
    ]) {
      expect(at(top)).toBeGreaterThan(at('advantage-chart__axis'));
    }
    // The phase dividers ride inside the axis layer, not loose behind the fills.
    expect(svg.querySelectorAll('.advantage-chart__axis .advantage-chart__phase').length).toBe(2);
  });
});

describe('advantage chart judgment marks', () => {
  it('rings the asked plies in the judgment tone and clears on an empty list', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {} });
    chart.setMarks([
      { ply: 1, tone: 'blunder' },
      { ply: 3, tone: 'inaccuracy' },
      { ply: 9, tone: 'mistake' }, // off the end: ignored, not drawn
    ]);
    const rings = [...chart.el.querySelectorAll('.advantage-chart__mark')];
    expect(rings.map((r) => r.getAttribute('class'))).toEqual([
      'advantage-chart__mark advantage-chart__mark--blunder',
      'advantage-chart__mark advantage-chart__mark--inaccuracy',
    ]);
    // Each ring sits ON the curve: same x as the ply's point.
    const line = chart.el.querySelector('.advantage-chart__line')!.getAttribute('points')!;
    const pointX = line.split(' ')[1]!.split(',')[0];
    expect(Number(rings[0]!.getAttribute('cx'))).toBeCloseTo(Number(pointX), 0);
    expect(chart.el.classList.contains('advantage-chart--marked')).toBe(true);

    chart.setMarks([]);
    expect(chart.el.querySelectorAll('.advantage-chart__mark').length).toBe(0);
    expect(chart.el.classList.contains('advantage-chart--marked')).toBe(false);
  });
});
