import { describe, expect, it } from 'vitest';
import { CXA_POINTS } from './cxa-points.js';
import { CXA_RATINGS } from './cxa-ratings.js';
import {
  drawRatingHistory,
  niceTicks,
  pointsSeries,
  ratingHistoryFigure,
  ratingSeries,
} from './rating-history-chart.js';

describe('rating history chart', () => {
  it('ticks cover the range on round steps', () => {
    expect(niceTicks(2682, 2802)).toEqual([2650, 2700, 2750, 2800, 2850]);
    expect(niceTicks(0, 3105)).toEqual([0, 1000, 2000, 3000, 4000]);
    const flat = niceTicks(2500, 2500);
    expect(flat.length).toBeGreaterThanOrEqual(2);
    expect(flat[0]).toBeLessThanOrEqual(2500);
  });

  it('dates each list the series comes from', () => {
    const ratings = ratingSeries(CXA_RATINGS['王天一'] ?? []);
    expect(ratings).toHaveLength(14);
    expect(ratings[0]).toMatchObject({ date: '2019-01-01', value: 2724, rank: 1 });
    const points = pointsSeries(CXA_POINTS['曹岩磊'] ?? []);
    expect(points).toEqual([{ date: '2025-12-28', value: 2765, label: '2025-12-28', rank: 3 }]);
  });

  it('draws two panels on their own scales, with a break between them', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    drawRatingHistory(
      svg,
      ratingSeries(CXA_RATINGS['曹岩磊'] ?? []),
      pointsSeries(CXA_POINTS['曹岩磊'] ?? []),
      720,
    );
    expect(svg.querySelectorAll('.xqp-chart-dot-rating').length).toBe(
      (CXA_RATINGS['曹岩磊'] ?? []).length,
    );
    expect(svg.querySelectorAll('.xqp-chart-dot-points').length).toBe(1);
    expect(svg.querySelectorAll('.xqp-chart-break').length).toBe(1);
    // No path joins a rating to a points total.
    expect(svg.querySelectorAll('.xqp-chart-line-points').length).toBe(0);
    expect(svg.getAttribute('viewBox')).toBe('0 0 720 210');
  });

  it('says a rated player is not on the points list rather than drawing nothing', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    drawRatingHistory(svg, ratingSeries(CXA_RATINGS['王天一'] ?? []), [], 480);
    expect(svg.querySelector('.xqp-chart-note')?.textContent).toBe('Not listed');
  });

  it('is left out for a player with no 等级分 history', () => {
    expect(ratingHistoryFigure([], CXA_POINTS['孟辰'] ?? [])).toBe(null);
    const figure = ratingHistoryFigure(CXA_RATINGS['王天一'] ?? [], []);
    expect(figure?.querySelector('figcaption')?.textContent).toContain('January 2026');
  });
});
