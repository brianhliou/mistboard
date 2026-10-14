import { describe, expect, it } from 'vitest';
import { type BroadcastCalendarEvent, calendarEventRow } from './xiangqi-broadcast-pages.js';

function event(overrides: Partial<BroadcastCalendarEvent> = {}): BroadcastCalendarEvent {
  return {
    name: '2026 Luofucha Liaocheng Xiangqi Division A League Open',
    location: 'Liaocheng',
    startsOn: '2026-07-18',
    endsOn: '2026-12-31',
    status: 'live',
    tourSlug: null,
    sourceUrl: 'https://example.com/upstream-event',
    ...overrides,
  };
}

describe('calendarEventRow', () => {
  it('links a relayed event to its Watch page', () => {
    const row = calendarEventRow(event({ tourSlug: 'luofucha-2026' }));
    const links = [...row.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/broadcast/xiangqi/luofucha-2026']);
  });

  it('shows no Source link for an event we do not relay (#539)', () => {
    const row = calendarEventRow(event());
    expect(row.querySelectorAll('a')).toHaveLength(0);
    expect(row.innerHTML).not.toContain('example.com');
  });
});
