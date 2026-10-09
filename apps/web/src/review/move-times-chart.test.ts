import { describe, expect, it } from 'vitest';
import { createAdvantageChart } from './advantage-chart.js';
import { clockOverlayGeometry, createMoveTimesChart } from './move-times-chart.js';

// Five plies: red 2s, black 30s, red 75s, black 1s, red 4s.
const times = [2000, 30000, 75000, 1000, 4000];

/** jsdom lays nothing out: give the frame a 500px box, 100px per bar column. */
function withLayout(el: HTMLElement): HTMLElement {
  const frame = el.querySelector('.review-move-times') as HTMLElement;
  frame.getBoundingClientRect = () => ({ left: 0, width: 500, top: 0, height: 140 }) as DOMRect;
  return frame;
}
const move = (frame: HTMLElement, clientX: number): void => {
  frame.dispatchEvent(new PointerEvent('pointermove', { clientX, bubbles: true }));
};
const leave = (frame: HTMLElement): void => {
  frame.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
};
const tip = (el: HTMLElement): HTMLElement => el.querySelector('.review-chart-tip') as HTMLElement;
const cursor = (el: HTMLElement): HTMLElement =>
  el.querySelector('.review-move-times__cursor') as HTMLElement;
const hoveredIndex = (el: HTMLElement): number =>
  [...el.querySelectorAll('.review-move-times__bar')].findIndex((bar) =>
    bar.classList.contains('review-move-times__bar--hovered'),
  );
const ys = (points: string[]): number[] => points.map((point) => Number(point.split(',')[1]));

describe('move times hover', () => {
  it('snaps the pointer to the bar column under it, at any height', () => {
    const chart = createMoveTimesChart(times, { moveLabel: (ply) => `m${ply}` });
    const frame = withLayout(chart.el);
    // x = 430 is in the fifth column (400-500); the bar there is short (4s of 75s),
    // so the pointer is far above it, and it still lands on ply 5.
    move(frame, 430);
    expect(hoveredIndex(chart.el)).toBe(4);
    expect(tip(chart.el).textContent).toBe('m54s');
    move(frame, 0);
    expect(hoveredIndex(chart.el)).toBe(0);
    move(frame, 500); // the right edge belongs to the last ply, not past it
    expect(hoveredIndex(chart.el)).toBe(4);
  });

  it('draws the cursor at the hovered column and dims the other bars', () => {
    const chart = createMoveTimesChart(times);
    const frame = withLayout(chart.el);
    expect(cursor(chart.el).hidden).toBe(true);
    move(frame, 250); // third column
    expect(cursor(chart.el).hidden).toBe(false);
    expect(cursor(chart.el).style.left).toBe('50.000%');
    expect(frame.classList).toContain('review-move-times--hovering');
    expect(tip(chart.el).hidden).toBe(false);
    // No move text from the host: the move number alone, then the think time.
    expect(tip(chart.el).textContent).toBe('2.1:15');
  });

  it('clears on the way out and hands the cursor back to the board ply', () => {
    const chart = createMoveTimesChart(times);
    const frame = withLayout(chart.el);
    chart.setPly(2);
    expect(cursor(chart.el).style.left).toBe('30.000%');
    move(frame, 450);
    expect(cursor(chart.el).style.left).toBe('90.000%');
    leave(frame);
    expect(tip(chart.el).hidden).toBe(true);
    expect(hoveredIndex(chart.el)).toBe(-1);
    expect(frame.classList).not.toContain('review-move-times--hovering');
    expect(cursor(chart.el).style.left).toBe('30.000%');
    chart.setPly(0); // the start position has no bar
    expect(cursor(chart.el).hidden).toBe(true);
  });

  it('jumps the board to the clicked ply', () => {
    const jumps: number[] = [];
    const chart = createMoveTimesChart(times, { onJump: (ply) => jumps.push(ply) });
    const frame = withLayout(chart.el);
    frame.dispatchEvent(new MouseEvent('click', { clientX: 150, bubbles: true }));
    expect(jumps).toEqual([2]);
  });

  it('adds both remaining clocks to the readout when the game had a clock', () => {
    const clocks = [
      { first: 180000, second: 180000 },
      { first: 182000, second: 180000 },
      { first: 182000, second: 152000 },
      { first: 109000, second: 152000 },
      { first: 109000, second: 153000 },
      { first: 107000, second: 153000 },
    ];
    const chart = createMoveTimesChart(times, { clocks, moveLabel: (ply) => `m${ply}` });
    const frame = withLayout(chart.el);
    move(frame, 250);
    expect(tip(chart.el).textContent).toBe('m31:15Red 1:49 · Black 2:32');
  });

  it('shares the advantage chart readout', () => {
    const times_ = createMoveTimesChart(times);
    const advantage = createAdvantageChart(
      [
        { ply: 0, cp: 0, mate: null, best: null },
        { ply: 1, cp: 30, mate: null, best: null },
      ],
      { onJump: () => {} },
    );
    expect(tip(times_.el)).not.toBeNull();
    expect(tip(advantage.el)).not.toBeNull();
  });
});

describe('move times totals', () => {
  it('splits the total by side, named by each side ink', () => {
    const chart = createMoveTimesChart(times);
    const caption = chart.el.querySelector('.review-move-times__caption') as HTMLElement;
    // Red: 2 + 75 + 4 = 81s; Black: 30 + 1 = 31s.
    expect(caption.textContent).toBe('Red 1:21 · Black 31s');
    expect(caption.textContent).not.toContain('Total');
  });

  it('names chess sides White and Black', () => {
    const chart = createMoveTimesChart(times, { seatColors: { red: 'white', black: 'black' } });
    const caption = chart.el.querySelector('.review-move-times__caption') as HTMLElement;
    expect(caption.textContent).toBe('White 1:21 · Black 31s');
  });
});

describe('move times clock overlay', () => {
  it('puts zero on the centre line, the first seat above it and the second below', () => {
    const geometry = clockOverlayGeometry(
      [
        { first: 60000, second: 60000 },
        { first: 30000, second: 60000 },
        { first: 30000, second: 0 },
      ],
      2,
    )!;
    // Full clock at the edges, half spent halfway to the centre, none on it.
    expect(ys(geometry.first)).toEqual([0, 25, 25]);
    expect(ys(geometry.second)).toEqual([100, 100, 50]);
    // series[p] sits at the end of ply p's column: x = 0, 500, 1000.
    expect(geometry.first.map((point) => Number(point.split(',')[0]))).toEqual([0, 500, 1000]);
  });

  it('scales both sides to the largest value reached, and an increment pushes out', () => {
    const geometry = clockOverlayGeometry(
      [
        { first: 60000, second: 60000 },
        { first: 50000, second: 60000 },
        { first: 50000, second: 80000 }, // banked increment above the initial time
        { first: 55000, second: 80000 }, // first seat's increment: back toward the edge
      ],
      3,
    )!;
    const first = ys(geometry.first);
    expect(ys(geometry.second)[2]).toBe(100); // 80s is the shared full scale
    expect(first[0]).toBeCloseTo(50 - (60 / 80) * 50);
    expect(first[3]).toBeLessThan(first[2]!); // smaller y = further out, toward the top
  });

  it('draws the layer behind the bars only when there is a clock', () => {
    const plain = createMoveTimesChart(times);
    expect(plain.el.querySelector('.review-move-times__clocks')).toBeNull();
    const timed = createMoveTimesChart(times, {
      clocks: times.map(() => ({ first: 1000, second: 1000 })).concat([{ first: 1, second: 1 }]),
    });
    const layer = timed.el.querySelector('.review-move-times__clocks')!;
    const frame = timed.el.querySelector('.review-move-times')!;
    // First child of the frame, so every bar paints over it.
    expect(frame.firstElementChild).toBe(layer);
    expect(layer.querySelectorAll('.review-move-times__clock')).toHaveLength(2);
  });

  it('draws nothing for an empty or zero clock', () => {
    expect(clockOverlayGeometry([{ first: 0, second: 0 }], 1)).toBeNull();
    expect(
      clockOverlayGeometry(
        [
          { first: 0, second: 0 },
          { first: 0, second: 0 },
        ],
        1,
      ),
    ).toBeNull();
  });
});
