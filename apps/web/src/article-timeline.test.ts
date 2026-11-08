import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBlock } from './articles.js';

// The timeline block formats ISO days, marks a passed day as done, and shows
// an undated entry ("Later") as written and still open.

const BLOCK = {
  kind: 'timeline' as const,
  items: [
    { date: '2026-11-17', title: 'This announcement', text: 'Badges go [live](/rules/fog-chess).' },
    { date: '2026-12-15', title: 'Bots go offline' },
    { date: 'Later', title: 'The games themselves', text: 'Added here with its date.' },
  ],
};

describe('timeline block', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks only the days that have passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T18:00:00Z'));
    const list = renderBlock(BLOCK);
    const items = [...list.querySelectorAll('li')];
    expect(list.tagName).toBe('OL');
    expect(items.map((li) => li.className)).toEqual([
      'article-timeline-item is-past',
      'article-timeline-item',
      'article-timeline-item is-open',
    ]);
  });

  it('formats ISO days, keeps other dates as written and renders rich text', () => {
    const list = renderBlock(BLOCK);
    const dates = [...list.querySelectorAll('.article-timeline-date')].map((d) => d.textContent);
    expect(dates).toEqual(['November 17, 2026', 'December 15, 2026', 'Later']);
    expect(list.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-17');
    expect(list.querySelector('.article-timeline-text a')?.getAttribute('href')).toBe(
      '/rules/fog-chess',
    );
    expect(list.querySelectorAll('.article-timeline-text')).toHaveLength(2);
  });
});
