import {
  banqiStateToDealtFen,
  createInitialBanqiState,
  createInitialJungleFlipState,
  jungleFlipStateToDealtFen,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { createEmbedScoreChart, type EmbedScoreSeries } from './embed-score-chart.js';
import { studyScoreSeatColors } from './embed-score-seat-colors.js';

const data: EmbedScoreSeries = {
  side: 'red',
  series: [{ name: 'Engine A', color: 'a', values: [0.5, 0.8, 0.2] }],
};

function paintsBefore(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('study score chart seat advantage', () => {
  it('clips one series to each seat half and paints the axis and cursor above the fills', () => {
    const { el } = createEmbedScoreChart(data, { variant: 'xiangqi', onJump: () => {} });
    const areas = [...el.querySelectorAll('polygon.advantage-chart__area')];
    expect(areas).toHaveLength(2);
    expect(areas[0]?.classList).toContain('advantage-chart__area--red');
    expect(areas[1]?.classList).toContain('advantage-chart__area--black');
    expect(areas.map((area) => area.getAttribute('points'))).toEqual([
      '0,50 0.0,50.0 500.0,20.0 1000.0,80.0 1000,50',
      '0,50 0.0,50.0 500.0,20.0 1000.0,80.0 1000,50',
    ]);
    for (const [i, area] of areas.entries()) {
      const clipId = area.getAttribute('clip-path')!.slice(5, -1);
      const rect = el.querySelector(`clipPath[id="${clipId}"] rect`);
      expect(rect?.getAttribute('y')).toBe(i === 0 ? '0' : '50');
      expect(rect?.getAttribute('height')).toBe('50');
      expect(paintsBefore(area, el.querySelector('.embed-score-chart__mid')!)).toBe(true);
      expect(paintsBefore(area, el.querySelector('.embed-score-chart__cursor')!)).toBe(true);
      expect(paintsBefore(area, el.querySelector('.embed-score-chart__mid-label')!)).toBe(true);
    }
    expect(el.querySelector('.embed-score-chart__line')?.getAttribute('stroke')).toBe(
      'var(--site-brand-accent)',
    );
  });

  it('fills the upper half for the series side when it is the second seat', () => {
    const { el } = createEmbedScoreChart(
      { ...data, side: 'black' },
      {
        variant: 'xiangqi',
        onJump: () => {},
      },
    );
    expect([...el.querySelectorAll('.advantage-chart__area')].map((a) => a.classList[1])).toEqual([
      'advantage-chart__area--black',
      'advantage-chart__area--red',
    ]);
  });

  it('draws two or more lines in engine inks with no shading at all', () => {
    const { el } = createEmbedScoreChart(
      {
        ...data,
        series: [...data.series, { name: 'Engine B', color: 'b', values: [0.5, 0.3, 0.7] }],
      },
      { variant: 'xiangqi', onJump: () => {} },
    );
    expect(el.querySelectorAll('.advantage-chart__area')).toHaveLength(0);
    expect(el.querySelectorAll('.embed-score-chart__zone')).toHaveLength(0);
    expect(el.querySelectorAll('linearGradient')).toHaveLength(0);
    const lines = [...el.querySelectorAll('.embed-score-chart__line')];
    expect(lines.map((line) => line.getAttribute('stroke'))).toEqual([
      'var(--eval-compare-a, #1f7a8c)',
      'var(--eval-compare-b, #d9822b)',
    ]);
    expect(el.textContent).toContain('Win chance for Red');
  });

  it('resolves chess to White/Black and preserves that pairing for a Black perspective', () => {
    const { el } = createEmbedScoreChart(
      { ...data, side: 'black' },
      {
        variant: 'chess',
        onJump: () => {},
      },
    );
    expect(el.dataset.seatInkFamily).toBe('chess');
    expect(el.classList).toContain('advantage-chart--white-black');
    expect(el.querySelectorAll('.advantage-chart__area--white')).toHaveLength(1);
    expect(el.querySelectorAll('.advantage-chart__area--red')).toHaveLength(0);
    expect(el.textContent).toContain('Win chance for Black');
  });

  it('stamps the Jungle family on the chart host so its second ink resolves to Blue', () => {
    const { el } = createEmbedScoreChart(
      { ...data, side: 'black' },
      {
        variant: 'jungle',
        onJump: () => {},
      },
    );
    expect(el.dataset.seatInkFamily).toBe('jungle');
    expect(el.textContent).toContain('Win chance for Blue');
    expect(el.querySelector('.advantage-chart__area')?.classList).toContain(
      'advantage-chart__area--black',
    );
  });

  it('uses bound flip inks without reversing the series values', () => {
    const { el } = createEmbedScoreChart(data, {
      variant: 'jungle-flip',
      seatColors: { red: 'black', black: 'red' },
      onJump: () => {},
    });
    expect(el.querySelector('.advantage-chart__area')?.classList).toContain(
      'advantage-chart__area--black',
    );
    expect(el.querySelector('.embed-score-chart__line')?.getAttribute('points')).toBe(
      '0.0,50.0 500.0,20.0 1000.0,80.0',
    );
    expect(el.textContent).toContain('Win chance for Blue');
  });

  it.each(['banqi', 'jungle-flip'])(
    'keeps unbound %s seats neutral without guessing a fill',
    (variant) => {
      const { el } = createEmbedScoreChart(data, { variant, onJump: () => {} });
      expect(el.querySelectorAll('.advantage-chart__area')).toHaveLength(0);
      expect(el.querySelectorAll('.advantage-chart__zone--neutral')).toHaveLength(2);
      expect(el.textContent).toContain('Win chance for First seat');
    },
  );

  it('gives separate mounted charts unique gradient and clip references', () => {
    const a = createEmbedScoreChart(data, { variant: 'xiangqi', onJump: () => {} });
    const b = createEmbedScoreChart(data, { variant: 'xiangqi', onJump: () => {} });
    const ids = [...a.el.querySelectorAll('[id]'), ...b.el.querySelectorAll('[id]')].map(
      (el) => el.id,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('study score chart flip bindings', () => {
  const banqi = createInitialBanqiState('score-chart');
  const jungleFlip = createInitialJungleFlipState('score-chart');
  const fixtures = [
    {
      variant: 'banqi',
      rootFen: banqiStateToDealtFen(banqi),
      square: Object.entries(banqi.board).find(([, piece]) => piece?.color === 'black')![0],
    },
    {
      variant: 'jungle-flip',
      rootFen: jungleFlipStateToDealtFen(jungleFlip),
      square: Object.entries(jungleFlip.board).find(([, piece]) => piece?.color === 'black')![0],
    },
  ];

  it.each(fixtures)(
    'reads a legal opening flip for $variant instead of guessing the first ink',
    ({ variant, rootFen, square }) => {
      const colors = studyScoreSeatColors(variant, {
        rootFen,
        root: { children: [{ uci: `${square}${square}` }] },
      });
      expect(colors).toEqual({ red: 'black', black: 'red' });
      const { el } = createEmbedScoreChart(data, { variant, seatColors: colors, onJump: () => {} });
      expect(el.querySelector('.advantage-chart__area')?.classList).toContain(
        'advantage-chart__area--black',
      );
    },
  );

  it.each(fixtures)(
    'leaves $variant neutral when the opening is unknown or invalid',
    ({ variant, rootFen, square }) => {
      expect(studyScoreSeatColors(variant, { rootFen })).toBeNull();
      expect(
        studyScoreSeatColors(variant, {
          rootFen,
          root: { children: [{ uci: 'z9z9' }] },
        }),
      ).toBeNull();
      // Without a dealt field the parser samples identities. Those are not evidence.
      expect(
        studyScoreSeatColors(variant, {
          rootFen: rootFen.split(' ').slice(0, 5).join(' '),
          root: { children: [{ uci: `${square}${square}` }] },
        }),
      ).toBeNull();
    },
  );

  it('resolves a bound composition root without needing an opening flip', () => {
    const colors = studyScoreSeatColors('banqi', {
      rootFen: '8/8/8/R1s5 r - 0 1',
      root: { children: [{ uci: 'a1b1' }] },
    });
    expect(colors).toEqual({ red: 'red', black: 'black' });
  });

  it('rejects an unknown variant rather than claiming xiangqi inks', () => {
    expect(() => createEmbedScoreChart(data, { variant: 'unknown', onJump: () => {} })).toThrow();
  });
});
