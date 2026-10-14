import { describe, expect, it } from 'vitest';
import {
  type CrosstableResponse,
  crosstableConfig,
  formatPoints,
  renderCrosstable,
} from './crosstable.js';

function record(): Extract<CrosstableResponse, { available: true }> {
  return {
    available: true,
    variant: 'xiangqi',
    players: [
      { name: 'brian', kind: 'account' },
      { name: 'Misty', kind: 'engine' },
    ],
    score: { a: 2, b: 1, draws: 1, total: 4 },
    games: [
      {
        roomId: 'r4',
        reviewUrl: '/xiangqi/game/r4',
        endedAt: '2026-08-27T10:00:00Z',
        aSeat: 'black',
        outcome: 'draw',
      },
      {
        roomId: 'r3',
        reviewUrl: '/xiangqi/game/r3',
        endedAt: '2026-08-26T10:00:00Z',
        aSeat: 'white',
        outcome: 'a',
      },
      {
        roomId: 'r2',
        reviewUrl: '/xiangqi/game/r2',
        endedAt: '2026-08-25T10:00:00Z',
        aSeat: 'black',
        outcome: 'b',
      },
      {
        roomId: 'r1',
        reviewUrl: '/xiangqi/game/r1',
        endedAt: '2026-08-24T10:00:00Z',
        aSeat: 'white',
        outcome: 'a',
      },
    ],
  };
}

describe('crosstable rendering', () => {
  it('tallies points lichess-style, half a point per draw', () => {
    expect(formatPoints(2, 1)).toBe('2½');
    expect(formatPoints(1, 1)).toBe('1½');
    expect(formatPoints(3, 2)).toBe('4');
    expect(formatPoints(0, 0)).toBe('0');
  });

  it('renders one row per player with per-side points per game, oldest first, totals last', () => {
    const el = renderCrosstable(record(), 'r4');
    const rows = [...el.querySelectorAll('tr')];
    expect(rows).toHaveLength(2);
    const cellsA = [...rows[0]!.querySelectorAll<HTMLAnchorElement>('.review-crosstable__cell a')];
    const cellsB = [...rows[1]!.querySelectorAll<HTMLAnchorElement>('.review-crosstable__cell a')];
    expect(rows[0]?.querySelector('.review-crosstable__name')?.textContent).toBe('brian');
    expect(rows[1]?.querySelector('.review-crosstable__name')?.textContent).toBe('Misty');
    expect(cellsA.map((c) => c.textContent)).toEqual(['1', '0', '1', '½']);
    expect(cellsB.map((c) => c.textContent)).toEqual(['0', '1', '0', '½']);
    // Each row links its games from that player's side: flip when they sat second.
    expect(cellsA.map((c) => c.getAttribute('href'))).toEqual([
      '/xiangqi/game/r1',
      '/xiangqi/game/r2?flip=1',
      '/xiangqi/game/r3',
      '/xiangqi/game/r4?flip=1',
    ]);
    expect(cellsB.map((c) => c.getAttribute('href'))).toEqual([
      '/xiangqi/game/r1?flip=1',
      '/xiangqi/game/r2',
      '/xiangqi/game/r3?flip=1',
      '/xiangqi/game/r4',
    ]);
    expect(rows[0]?.querySelector('.review-crosstable__score')?.textContent).toBe('2½');
    expect(rows[1]?.querySelector('.review-crosstable__score')?.textContent).toBe('1½');
    const current = [...el.querySelectorAll('.review-crosstable__cell--current a')];
    expect(current.map((c) => c.getAttribute('href'))).toEqual([
      '/xiangqi/game/r4?flip=1',
      '/xiangqi/game/r4',
    ]);
    expect(cellsA[0]?.closest('td')?.classList.contains('review-crosstable__cell--win')).toBe(true);
    expect(cellsB[0]?.closest('td')?.classList.contains('review-crosstable__cell--loss')).toBe(
      true,
    );
  });

  it('notes a truncated record and says nothing extra on a first meeting', () => {
    const truncated = record();
    truncated.score.total = 30;
    expect(renderCrosstable(truncated, 'r4').textContent).toContain('last 4 of 30');
    const first = record();
    first.score = { a: 0, b: 0, draws: 1, total: 1 };
    first.games = first.games.slice(0, 1);
    const el = renderCrosstable(first, 'r4');
    expect(el.textContent).not.toContain('First game');
    expect(el.querySelector('.review-crosstable__note')).toBeNull();
  });

  it('explains guest and private seats instead of showing a record', () => {
    expect(renderCrosstable({ available: false, reason: 'guest' }, 'r1').textContent).toContain(
      'Guest',
    );
    expect(renderCrosstable({ available: false, reason: 'private' }, 'r1').textContent).toContain(
      'private',
    );
    expect(renderCrosstable(null, 'r1').textContent).toContain('No head-to-head record');
  });
});

describe('crosstableConfig', () => {
  it('hides the tab unless both seats are accounts or engines', () => {
    expect(crosstableConfig('r1', [{ kind: 'account' }, { kind: 'guest' }])).toEqual({
      showCrosstable: false,
    });
    expect(crosstableConfig('r1', undefined)).toEqual({ showCrosstable: false });
    expect(crosstableConfig('r1', [{ kind: 'account' }])).toEqual({ showCrosstable: false });
    const shown = crosstableConfig('r1', [{ kind: 'account' }, { kind: 'engine' }]);
    expect(shown.showCrosstable).toBe(true);
    expect(typeof shown.crosstable?.load).toBe('function');
  });
});
