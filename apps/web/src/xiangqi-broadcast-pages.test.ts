import { describe, expect, it } from 'vitest';
import {
  type BroadcastCalendarEvent,
  calendarEventRow,
  rightsContactNote,
} from './xiangqi-broadcast-pages.js';

// Each page's own ?about= copy of /contact read to Google as a duplicate URL
// (43 in Search Console, 2026-10-19): the link still prefills the form, but
// crawlers are told not to follow it.
describe('rightsContactNote', () => {
  it('links the contact form with the page path and rel="nofollow"', () => {
    const link = rightsContactNote('/players/teams/hubei-xiangqi-association').querySelector('a');
    expect(link?.getAttribute('href')).toBe(
      '/contact?about=%2Fplayers%2Fteams%2Fhubei-xiangqi-association',
    );
    expect(link?.getAttribute('rel')).toBe('nofollow');
  });
});

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
