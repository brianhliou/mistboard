import { afterEach, describe, expect, it, vi } from 'vitest';
import { localizeAnnouncement } from './announcement-i18n.js';
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

it('publishes the actual Gomoku launch once at the November 10 boundary with a play CTA and Chinese translations', () => {
  vi.stubEnv('DEV', false);
  try {
    const launches = allAnnouncements().filter(
      (entry) => entry.date === '2026-11-10' && entry.href?.includes('gameSpecId=gomoku'),
    );
    expect(launches).toHaveLength(1);
    const entry = launches[0]!;
    expect(entry.kind).toBe('release');
    expect(entry.headline).toBe('Gomoku is open to everyone.');
    for (const phrase of ['15x15', 'freestyle', 'dealt openings', 'Rapfi', 'browser', 'rated'])
      expect(entry.body).toContain(phrase);
    const url = new URL(entry.href!, 'https://mistboard.com');
    expect(url.pathname).toBe('/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      play: 'computer',
      gameSpecId: 'gomoku',
    });
    const boundary = articleGoesLiveAt('2026-11-10');
    expect(announcements(boundary - 1)).not.toContainEqual(entry);
    expect(announcements(boundary)).toContainEqual(entry);
    expect(announcementIsLive(entry, boundary - 1)).toBe(false);
    expect(announcementIsLive(entry, boundary)).toBe(true);
    for (const locale of ['zh-Hans', 'zh-Hant'] as const) {
      const translated = localizeAnnouncement(entry, locale);
      for (const key of ['headline', 'body', 'cta'] as const) {
        expect(translated[key]).toBeTruthy();
        expect(translated[key]).not.toBe(entry[key]);
        expect(translated[key]).not.toContain('—');
      }
      expect(translated.href).toBe(entry.href);
    }
    expect(`${entry.headline} ${entry.body} ${entry.cta}`).not.toContain('—');
  } finally {
    vi.unstubAllEnvs();
  }
});
