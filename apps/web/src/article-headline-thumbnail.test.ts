import { describe, expect, it } from 'vitest';
import { generalBlunderChallengeArticle } from './articles/content/general-blunder-challenge.js';
import {
  withXiangqiBoardLayout,
  xqHalfBoardThumbnailSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';

const state = (board: Parameters<typeof xqVisionDemoState>[1]) =>
  xqVisionDemoState('headline-test', board);
const general = { color: 'red', role: 'general' } as const;
const chariot = { color: 'black', role: 'chariot' } as const;

// The headline template: words on plain board colour over the river rank, four
// ranks of board under them.
describe('half-board headline thumbnail', () => {
  it('draws the headline on a band over the near bank', () => {
    const svg = xqHalfBoardThumbnailSvg({
      state: state({ e1: general, c4: chariot }),
      half: 'bottom',
      perspective: 'red',
      headline: 'Can you lose?',
      ariaLabel: 'test',
    });
    expect(svg).toContain('>Can you lose?</text>');
    expect(svg.match(/<rect class="xq-diagram-bg"/g)).toHaveLength(2);
  });

  // Planted failure: a piece on the near bank would sit under the band.
  it('refuses a piece the band would hide', () => {
    expect(() =>
      xqHalfBoardThumbnailSvg({
        state: state({ e1: general, c5: chariot }),
        half: 'bottom',
        perspective: 'red',
        headline: 'Hidden',
        ariaLabel: 'test',
      }),
    ).toThrow(/covers c5/);
  });

  it('refuses the top half', () => {
    expect(() =>
      xqHalfBoardThumbnailSvg({
        state: state({ e10: { color: 'black', role: 'general' } }),
        half: 'top',
        perspective: 'red',
        headline: 'Top',
        ariaLabel: 'test',
      }),
    ).toThrow(/bottom half/);
  });

  it('is the General Blunder card', () => {
    const thumb = generalBlunderChallengeArticle.thumbnail;
    expect(thumb?.kind).toBe('svg');
    const svg = thumb && 'svg' in thumb ? thumb.svg : '';
    expect(typeof svg === 'function' ? svg('en') : svg).toContain('>Can you lose?</text>');
  });

  // The card renders under the reader's board settings, so it must be a
  // function, not a string frozen at import with the defaults.
  it('follows the reader board layout', () => {
    const svg = generalBlunderChallengeArticle.thumbnail;
    expect(svg?.kind).toBe('svg');
    const render = svg?.kind === 'svg' ? svg.svg : null;
    expect(typeof render).toBe('function');
    const cell = withXiangqiBoardLayout('cell', () => (render as (locale: 'en') => string)('en'));
    expect(cell).toContain('xq-diagram-cell--light');
    expect(cell).toContain('>Can you lose?</text>');
  });
});
