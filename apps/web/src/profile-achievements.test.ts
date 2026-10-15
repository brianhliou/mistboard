import { ACHIEVEMENTS } from '@mistboard/game';
import { beforeAll, describe, expect, it } from 'vitest';
import { hasAppTranslation, type I18nKey, loadAppI18nDomains, t } from './i18n/catalog.js';
import { SUPPORTED_LOCALES } from './i18n/locale.js';
import { buildProfileAchievements, buildProfileIdentity } from './profile.js';

// The Achievements row under the profile identity block: one pill per earned
// achievement, nothing at all until there is one, unknown ids skipped.

type Profile = Parameters<typeof buildProfileIdentity>[0];

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    isViewer: false,
    user: {
      handle: 'river_horse',
      displayName: 'River Horse',
      profileVisibility: 'public',
      accountRole: 'player',
      createdAt: '2026-05-01T00:00:00.000Z',
    },
    ratings: [],
    puzzleRatings: [],
    games: [],
    gamesTotal: 0,
    ...overrides,
  };
}

describe('profile achievements row', () => {
  // Registers the lazy zh chunks, so t() below sees the full catalogs.
  beforeAll(async () => {
    await loadAppI18nDomains();
  });

  it('renders nothing for a profile with no achievements, or an older payload', () => {
    expect(buildProfileIdentity(profile(), 'en').querySelector('.profile-achievements')).toBe(null);
    expect(
      buildProfileIdentity(profile({ achievements: [] }), 'en').querySelector(
        '.profile-achievements',
      ),
    ).toBe(null);
  });

  it('shows each earned achievement in order, with its description and date on hover', () => {
    const identity = buildProfileIdentity(
      profile({
        achievements: [
          { id: 'first-game', awardedAt: '2026-08-01T10:00:00.000Z' },
          { id: 'first-rated', awardedAt: '2026-08-03T10:00:00.000Z' },
        ],
      }),
      'en',
    );
    const row = identity.querySelector('.profile-achievements');
    expect(row?.getAttribute('aria-label')).toBe('Achievements');
    const pills = [...identity.querySelectorAll<HTMLElement>('.profile-achievement')];
    expect(pills.map((pill) => pill.dataset.achievementId)).toEqual(['first-game', 'first-rated']);
    expect(pills.map((pill) => pill.textContent)).toEqual(['First game', 'First rated game']);
    expect(pills[1]?.title).toBe('Finished a rated game. Earned Aug 3, 2026');
    expect(pills[0]?.querySelector('svg.ui-icon-achievement-first-game')).not.toBe(null);
  });

  it('skips ids this client does not define instead of showing them raw', () => {
    const row = buildProfileAchievements(
      [
        { id: 'arena:future:1', awardedAt: '2026-08-01T10:00:00.000Z' },
        { id: 'first-puzzle', awardedAt: 'not a date' },
      ],
      'en',
    );
    const pills = [...(row?.querySelectorAll<HTMLElement>('.profile-achievement') ?? [])];
    expect(pills.map((pill) => pill.dataset.achievementId)).toEqual(['first-puzzle']);
    expect(pills[0]?.title).toBe('Solved a puzzle on the first try.');
    expect(buildProfileAchievements([{ id: 'nope', awardedAt: '' }], 'en')).toBe(null);
  });

  it('localizes the row', () => {
    const row = buildProfileAchievements(
      [{ id: 'first-forum-post', awardedAt: '2026-08-01T10:00:00.000Z' }],
      'zh-Hant',
    );
    expect(row?.textContent).toBe('第一篇貼文');
  });

  it('every definition has its title and description in all three locales, no em dashes', () => {
    for (const definition of ACHIEVEMENTS) {
      for (const locale of SUPPORTED_LOCALES) {
        for (const key of [definition.titleKey, definition.descriptionKey] as I18nKey[]) {
          expect(hasAppTranslation(locale, key), `${locale} ${key}`).toBe(true);
          expect(t(key, {}, locale), `${locale} ${key}`).not.toContain('\u2014');
        }
      }
    }
  });
});
