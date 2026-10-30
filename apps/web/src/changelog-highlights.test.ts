import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Announcement, allAnnouncements, announcements } from './announcements.js';
import { articleGoesLiveAt } from './articles/publish-time.js';
import { changelogHighlights } from './changelog-highlights.js';
import { rulesHrefPublicSurfaceEnabled } from './variant-public-surfaces.js';

vi.mock('./announcements.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./announcements.js')>();
  return { ...actual, announcements: vi.fn(actual.announcements) };
});

const actual = await vi.importActual<typeof import('./announcements.js')>('./announcements.js');
const entry = (date: string, headline = date): Announcement => ({
  date,
  kind: 'release',
  headline,
  href: '/study',
});

beforeEach(() => {
  vi.stubEnv('DEV', false);
  vi.mocked(announcements).mockReset().mockImplementation(actual.announcements);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('monthly announcement highlights', () => {
  it('includes both ends of a month, excluding the adjacent months', () => {
    vi.mocked(announcements).mockReturnValue([
      entry('2026-09-30'),
      entry('2026-10-01'),
      entry('2026-10-15'),
      entry('2026-10-31'),
      entry('2026-11-01'),
      entry('2025-10-31'),
    ]);

    expect(changelogHighlights('2026-10').map((item) => item.date)).toEqual([
      '2026-10-31',
      '2026-10-15',
      '2026-10-01',
    ]);
  });

  it('keeps December and January in their own years', () => {
    vi.mocked(announcements).mockReturnValue([
      entry('2025-12-31'),
      entry('2026-01-01'),
      entry('2026-12-31'),
      entry('2027-01-01'),
    ]);

    expect(changelogHighlights('2026-12').map((item) => item.date)).toEqual(['2026-12-31']);
    expect(changelogHighlights('2027-01').map((item) => item.date)).toEqual(['2027-01-01']);
  });

  it('includes leap day without rolling an invalid date into another month', () => {
    vi.mocked(announcements).mockReturnValue([
      entry('2024-02-28'),
      entry('2024-02-29'),
      entry('2024-02-30'),
      entry('2024-03-01'),
      entry('2026-02-29'),
    ]);

    expect(changelogHighlights('2024-02').map((item) => item.date)).toEqual([
      '2024-02-29',
      '2024-02-28',
    ]);
    expect(changelogHighlights('2026-02')).toEqual([]);
  });

  it.each(['2026-1', '2026-00', '2026-13', '2026', '2026-10-01', 'soon', ''])(
    'returns no highlights for an invalid month %j',
    (month) => {
      vi.mocked(announcements).mockReturnValue([entry('2026-10-01')]);
      expect(changelogHighlights(month)).toEqual([]);
    },
  );

  it('excludes malformed dates even when they start with the requested month', () => {
    vi.mocked(announcements).mockReturnValue([
      entry('2026-10-1'),
      entry('2026-10-00'),
      entry('2026-10-32'),
      entry('2026-10-01T00:00:00Z'),
      entry('2026-10-soon'),
    ]);

    expect(changelogHighlights('2026-10')).toEqual([]);
  });

  it('returns an empty list for a month with no announcements', () => {
    vi.mocked(announcements).mockReturnValue([entry('2026-10-01')]);
    expect(changelogHighlights('2026-09')).toEqual([]);
  });

  it('preserves every kind, the source fields and same-day order without changing the source', () => {
    const entries: Announcement[] = [
      { ...entry('2026-10-01'), kind: 'article', body: 'Read it.', cta: 'Read' },
      { ...entry('2026-10-02', 'First on the day'), kind: 'status' },
      { ...entry('2026-10-02', 'Second on the day'), kind: 'update', href: undefined },
      { ...entry('2026-10-02', 'Third on the day'), kind: 'release' },
    ];
    const original = entries.map((item) => ({ ...item }));
    Object.freeze(entries);
    for (const item of entries) Object.freeze(item);
    vi.mocked(announcements).mockReturnValue(entries);

    expect(changelogHighlights('2026-10')).toEqual([
      original[1],
      original[2],
      original[3],
      original[0],
    ]);
    expect(entries).toEqual(original);
  });

  it('uses the feed public-surface gate for unlisted and retired rules pages', () => {
    const visible = entry('2026-10-01');
    vi.mocked(announcements).mockReturnValue([
      entry('2026-10-01'),
      { ...entry('2026-10-02'), href: '/rules/shogi4' },
      { ...entry('2026-10-03'), href: '/rules/atomic-xiangqi' },
    ]);

    expect(changelogHighlights('2026-10')).toEqual([visible]);
  });

  it('uses the source publication clock at the exact live moment', () => {
    const announcement = allAnnouncements().find((item) =>
      rulesHrefPublicSurfaceEnabled(item.href),
    )!;
    const month = announcement.date.slice(0, 7);
    const liveAt = articleGoesLiveAt(announcement.date);

    expect(changelogHighlights(month, liveAt - 1)).not.toContain(announcement);
    expect(changelogHighlights(month, liveAt)).toContain(announcement);
    expect(announcements).toHaveBeenLastCalledWith(liveAt);
  });

  it('uses the current clock by default and keeps the existing dev preview', () => {
    const announcement = allAnnouncements().find((item) =>
      rulesHrefPublicSurfaceEnabled(item.href),
    )!;
    const month = announcement.date.slice(0, 7);
    const before = articleGoesLiveAt(announcement.date) - 1;
    vi.useFakeTimers();
    vi.setSystemTime(before);

    expect(changelogHighlights(month)).not.toContain(announcement);
    expect(announcements).toHaveBeenLastCalledWith(before);
    vi.stubEnv('DEV', true);
    expect(changelogHighlights(month)).toContain(announcement);
  });
});
