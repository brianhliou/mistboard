import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createMoveTimesChart } from './move-times-chart.js';

afterEach(() => {
  for (const el of document.querySelectorAll('[data-gomoku-times-test]')) el.remove();
  delete document.documentElement.dataset.effectiveTheme;
});

describe('Gomoku move times contrast (#915)', () => {
  it.each(['light', 'dark'])('uses readable muted ink for Black in %s mode', (theme) => {
    document.documentElement.dataset.effectiveTheme = theme;
    const style = document.createElement('style');
    style.dataset.gomokuTimesTest = '';
    style.textContent = `
      :root { --site-muted: #68615b; }
      :root[data-effective-theme="dark"] { --site-muted: #b8b1a5; }
      ${readFileSync('src/seat-disc-ink.css', 'utf8')}
      ${readFileSync('src/review/review-shell.css', 'utf8')}
    `;
    document.head.append(style);
    const root = document.createElement('div');
    root.dataset.gomokuTimesTest = '';
    root.dataset.seatInkFamily = 'gomoku';
    const chart = createMoveTimesChart([1000, 2000], {
      seatColors: { red: 'black', black: 'white' },
      clocks: [
        { first: 60000, second: 60000 },
        { first: 59000, second: 60000 },
        { first: 59000, second: 58000 },
      ],
    });
    root.append(chart.el);
    document.body.append(root);

    const black = chart.el.querySelector<HTMLElement>('.review-move-times__bar--black')!;
    const caption = chart.el.querySelector<HTMLElement>('.review-move-times__caption')!;
    const blackClock = chart.el.querySelector<SVGElement>('.review-move-times__clock--black')!;
    expect(getComputedStyle(blackClock).color).toBe(getComputedStyle(caption).color);
    expect(getComputedStyle(black).boxShadow).toContain('1px');
    const totals = [...chart.el.querySelectorAll<HTMLElement>('.review-move-times__total')];
    expect(totals.map((total) => getComputedStyle(total).color)).toEqual([
      getComputedStyle(caption).color,
      getComputedStyle(caption).color,
    ]);
  });
});
