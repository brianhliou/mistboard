import { describe, expect, it } from 'vitest';
import type { RevealOdds } from './jieqi-luck-mark.js';
import { luckCardHtml, luckCardTone } from './luck-mark-card.js';

const stubPiece = (role: string, color: string): string =>
  `<svg data-piece="${color}-${role}"></svg>`;

const ODDS: RevealOdds = {
  role: 'soldier',
  count: 2,
  total: 5,
  pool: [
    { role: 'chariot', count: 2 },
    { role: 'soldier', count: 2 },
    { role: 'elephant', count: 1 },
  ],
};

describe('luckCardHtml', () => {
  const text = (html: string): string =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  it('says an unlucky reveal in words: odds, cost, size, the bag', () => {
    const html = luckCardHtml({ square: 'd3', color: 'red', luck: -35, odds: ODDS }, stubPiece);
    const words = text(html);
    expect(words).toContain('Unlucky reveal: Soldier (2 in 5)');
    expect(words).toContain('Cost Red 35 points of win chance vs. an average reveal');
    expect(words).toContain('Decisive swing');
    expect(words).toContain('It could have been');
    expect(html).toContain('luck-card__swing--unlucky');
    // The size line carries the board's die: six pips, red.
    expect(html).toContain('class="luck-mark luck-mark--unlucky"');
    expect(html.match(/class="luck-mark__pip"/g)).toHaveLength(6);
    // No signed percentages, no "draw" wording, no em dashes.
    expect(words).not.toMatch(/[−+]\d|%|draw|\u2014/);
  });

  it('says a lucky reveal for the side that made it', () => {
    const html = luckCardHtml(
      { square: 'e9', color: 'black', luck: 13.6, odds: { ...ODDS, role: 'chariot' } },
      stubPiece,
    );
    const words = text(html);
    expect(words).toContain('Lucky reveal: Chariot (2 in 5)');
    expect(words).toContain("Raised Black's win chance by 14 points vs. an average reveal");
    expect(words).toContain('Big swing');
    expect(html.match(/class="luck-mark__pip"/g)).toHaveLength(4);
  });

  it('calls a tiny swing an average reveal, with no number', () => {
    const detail = { square: 'a2', color: 'red' as const, luck: 1.2, odds: ODDS };
    const words = text(luckCardHtml(detail, stubPiece));
    expect(words).toContain('Average reveal: Soldier (2 in 5)');
    expect(words).toContain('About as good for Red as an average reveal');
    expect(words).toContain('Tiny swing');
    expect(words).not.toMatch(/\d+ points?/);
    // Grey like the one-pip die, though the rounded number is +1.
    expect(luckCardTone(detail)).toBe('even');
  });

  it('drops the odds and the bag when the deal is unknown', () => {
    const words = text(
      luckCardHtml({ square: 'a2', color: 'red', luck: -7, odds: null }, stubPiece),
    );
    expect(words).toContain('Unlucky reveal');
    expect(words).toContain('Cost Red 7 points of win chance vs. an average reveal');
    expect(words).toContain('Moderate swing');
    expect(words).not.toContain('could have been');
  });
});
