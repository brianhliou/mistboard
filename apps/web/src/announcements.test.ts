import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type Announcement,
  allAnnouncements,
  announcementIsLive,
  announcements,
} from './announcements.js';
import { articleGoesLiveAt } from './articles/publish-time.js';
import { buildLandingAnnouncements } from './landing-announcements.js';
import { buildNewsPage } from './news-page.js';

// An announcement dated D goes live at the article publish moment of D, so an
// entry that announces a scheduled post appears with the post rather than a
// day early with a dead link (2026-08-27).
describe('announcement scheduling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const entry: Announcement = { date: '2026-09-25', kind: 'update', headline: 'Later.' };
  const liveAt = articleGoesLiveAt('2026-09-25');

  it('goes live at the publish moment of its date, not at midnight', () => {
    expect(announcementIsLive(entry, Date.parse('2026-09-25T00:00:00Z'))).toBe(false);
    expect(announcementIsLive(entry, liveAt - 1)).toBe(false);
    expect(announcementIsLive(entry, liveAt)).toBe(true);
  });

  it('treats a malformed date as live rather than hiding the entry on a typo', () => {
    expect(announcementIsLive({ ...entry, date: 'soon' }, 0)).toBe(true);
  });

  it('production hides a scheduled entry from the rail and /feed until its moment', () => {
    vi.stubEnv('DEV', false);
    const future = allAnnouncements().filter((e) => !announcementIsLive(e));
    const scheduled = announcements();
    for (const e of future) expect(scheduled).not.toContain(e);
    expect(announcements(Number.MAX_SAFE_INTEGER)).toHaveLength(allAnnouncements().length);

    // The rail and the archive render only what announcements() returns.
    const railHrefs = [...buildLandingAnnouncements().querySelectorAll('a.landing-news-link')].map(
      (a) => a.getAttribute('href'),
    );
    const feedText = buildNewsPage().textContent ?? '';
    for (const e of future) {
      expect(railHrefs.some((h) => h?.includes(e.date))).toBe(false);
      expect(feedText).not.toContain(e.headline);
    }
  });

  it('dev shows a scheduled entry for review', () => {
    vi.stubEnv('DEV', true);
    expect(announcements(0)).toHaveLength(allAnnouncements().length);
  });
});
