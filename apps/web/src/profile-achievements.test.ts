import { ACHIEVEMENTS, type AchievementDefinition } from '@mistboard/game';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hasAppTranslation, type I18nKey, loadAppI18nDomains, t } from './i18n/catalog.js';
import { SUPPORTED_LOCALES } from './i18n/locale.js';
import { buildProfileIdentity } from './profile.js';
import {
  achievementsLookFromSearch,
  buildProfileAchievementsPage,
  buildProfileAchievementsSummary,
  mountProfileAchievements,
  PREVIEW_ACHIEVEMENTS,
} from './profile-achievements.js';

// No definition is badge tier yet, so the tests add stand-ins: ids starting
// `test-badge-` resolve to a badge-tier copy of first-game.
vi.mock('@mistboard/game', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mistboard/game')>();
  return {
    ...actual,
    getAchievementDefinition: (id: string): AchievementDefinition | null => {
      if (id.startsWith('test-badge-')) {
        const base = actual.getAchievementDefinition('first-game')!;
        return { ...base, id, tier: 'badge' };
      }
      return actual.getAchievementDefinition(id);
    },
  };
});

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

const AUG = (day: number) => `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`;

beforeAll(async () => {
  await loadAppI18nDomains();
});

describe('achievements on the profile', () => {
  it('shows nothing when the account holds none, or the payload predates the field', () => {
    for (const achievements of [undefined, [], [{ id: 'arena:future:1', awardedAt: AUG(1) }]]) {
      const identity = buildProfileIdentity(profile({ achievements }), 'en');
      expect(identity.querySelector('.profile-achievements')).toBe(null);
    }
  });

  it('standard achievements are a count link to the page, not pills', () => {
    const identity = buildProfileIdentity(
      profile({
        achievements: [
          { id: 'first-game', awardedAt: AUG(1) },
          { id: 'first-pvp', awardedAt: AUG(2) },
          { id: 'first-rated', awardedAt: AUG(3) },
        ],
      }),
      'en',
    );
    const link = identity.querySelector<HTMLAnchorElement>('.profile-achievements-link');
    expect(link?.textContent).toBe('3 achievements');
    expect(link?.getAttribute('href')).toBe('/@/river_horse/achievements');
    expect(identity.querySelector('.profile-achievement-badges')).toBe(null);
  });

  it('counts one in the singular and localizes', () => {
    const one = [{ id: 'first-game', awardedAt: AUG(1) }];
    expect(buildProfileAchievementsSummary('h', one, 'en')?.textContent).toBe('1 achievement');
    expect(buildProfileAchievementsSummary('h', one, 'zh-Hant')?.textContent).toBe('1 項成就');
  });

  it('shows badge-tier achievements, newest three only, beside the link', () => {
    const line = buildProfileAchievementsSummary(
      'h',
      [
        { id: 'first-game', awardedAt: AUG(1) },
        { id: 'test-badge-a', awardedAt: AUG(2) },
        { id: 'test-badge-b', awardedAt: AUG(5) },
        { id: 'test-badge-c', awardedAt: AUG(3) },
        { id: 'test-badge-d', awardedAt: AUG(4) },
      ],
      'en',
    );
    const badges = [...(line?.querySelectorAll<HTMLElement>('.profile-achievement-badge') ?? [])];
    expect(badges.map((badge) => badge.dataset.achievementId)).toEqual([
      'test-badge-b',
      'test-badge-d',
      'test-badge-c',
    ]);
    expect(line?.querySelector('.profile-achievements-link')?.textContent).toBe('5 achievements');
  });
});

describe('the achievements page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('shows earned cards with their date and locked cards with how to earn them', () => {
    const page = buildProfileAchievementsPage(
      'river_horse',
      [
        { id: 'first-rated', awardedAt: AUG(3) },
        { id: 'arena:future:1', awardedAt: AUG(4) },
      ],
      'en',
    );
    expect(page.querySelector('.achievements-page-summary')?.textContent).toBe(
      `1 of ${ACHIEVEMENTS.length} earned`,
    );
    expect(page.querySelectorAll('.achievement-card')).toHaveLength(ACHIEVEMENTS.length);

    const rated = page.querySelector<HTMLElement>('[data-achievement-id="first-rated"]');
    expect(rated?.dataset.state).toBe('earned');
    expect(rated?.querySelector('.achievement-card-text')?.textContent).toBe(
      t('profile.achievementFirstRatedDesc' as I18nKey, {}, 'en'),
    );
    expect(rated?.querySelector('.achievement-card-status')?.textContent).toBe(
      'Earned Aug 3, 2026',
    );

    const puzzle = page.querySelector<HTMLElement>('[data-achievement-id="first-puzzle"]');
    expect(puzzle?.dataset.state).toBe('locked');
    expect(puzzle?.classList.contains('achievement-card-locked')).toBe(true);
    expect(puzzle?.querySelector('.achievement-card-text')?.textContent).toBe(
      'Solve a puzzle on your first try.',
    );
    expect(puzzle?.querySelector('.achievement-card-status')?.textContent).toBe('Not earned yet');
  });

  it('groups by category, earned first within a group', () => {
    const page = buildProfileAchievementsPage(
      'h',
      [{ id: 'first-rated', awardedAt: AUG(3) }],
      'en',
    );
    const groups = [...page.querySelectorAll<HTMLElement>('.achievements-group')];
    expect(groups.map((group) => group.dataset.category)).toEqual(['play', 'puzzles', 'community']);
    expect(groups.map((group) => group.querySelector('h2')?.textContent)).toEqual([
      'Play',
      'Puzzles',
      'Community',
    ]);
    const play = [...groups[0]!.querySelectorAll<HTMLElement>('.achievement-card')];
    expect(play.map((card) => card.dataset.achievementId)).toEqual([
      'first-rated',
      'first-game',
      'first-pvp',
    ]);
  });

  it('says whose page it is, linking back to the profile', () => {
    const page = buildProfileAchievementsPage('river_horse', [], 'en');
    const owner = page.querySelector<HTMLAnchorElement>('.achievements-owner');
    expect(owner?.getAttribute('href')).toBe('/@/river_horse');
    expect(owner?.textContent).toBe('R');
    expect(page.querySelector('.achievements-page-handle')?.textContent).toBe('@river_horse');
  });

  it('picks the look from ?look=, default a; only the trophy list has a progress bar', () => {
    expect(achievementsLookFromSearch('')).toBe('a');
    expect(achievementsLookFromSearch('?look=b')).toBe('b');
    expect(achievementsLookFromSearch('?look=c&preview=1')).toBe('c');
    expect(achievementsLookFromSearch('?look=zz')).toBe('a');
    const earned = [{ id: 'first-game', awardedAt: AUG(1) }];
    const a = buildProfileAchievementsPage('h', earned, 'en');
    expect(a.dataset.look).toBe('a');
    expect(a.querySelector('.achievements-progress')).toBe(null);
    const b = buildProfileAchievementsPage('h', earned, 'en', { look: 'b' });
    expect(b.querySelector('.achievements-progress-percent')?.textContent).toBe(
      `${Math.round(100 / ACHIEVEMENTS.length)}%`,
    );
  });

  it('preview definitions appear only on request, locked, and leave the count alone', () => {
    const plain = buildProfileAchievementsPage('h', [], 'en');
    expect(plain.querySelector('[data-preview]')).toBe(null);
    const page = buildProfileAchievementsPage(
      'h',
      [{ id: 'preview-wins', awardedAt: AUG(1) }],
      'en',
      {
        preview: true,
      },
    );
    const previews = [...page.querySelectorAll<HTMLElement>('[data-preview="true"]')];
    expect(previews.length).toBeGreaterThan(0);
    expect(previews.every((card) => card.dataset.state === 'locked')).toBe(true);
    expect(page.querySelector('.achievements-page-summary')?.textContent).toBe(
      `0 of ${ACHIEVEMENTS.length} earned`,
    );
  });

  it('a private profile (404 from the API) shows the not-found notice and no cards', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"not found"}', { status: 404 })),
    );
    const root = document.createElement('div');
    document.body.append(root);
    await mountProfileAchievements(root, 'hidden_player');
    expect(root.querySelector('.achievement-card')).toBe(null);
    expect(root.textContent).toContain(t('profile.notFoundTitle', {}, 'en'));
  });

  it('mounts the cards from the API for a visible profile', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/api/users/river_horse/achievements')
        ? new Response(JSON.stringify({ achievements: [{ id: 'first-game', awardedAt: AUG(1) }] }))
        : new Response('{}', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const root = document.createElement('div');
    document.body.append(root);
    await mountProfileAchievements(root, 'river_horse');
    expect(root.querySelectorAll('.achievement-card-earned')).toHaveLength(1);
    expect(root.querySelectorAll('.achievement-card-locked')).toHaveLength(ACHIEVEMENTS.length - 1);
  });

  it('every definition has its title, description and hint in all three locales, no em dashes', () => {
    for (const definition of [...ACHIEVEMENTS, ...PREVIEW_ACHIEVEMENTS]) {
      for (const locale of SUPPORTED_LOCALES) {
        const keys = [definition.titleKey, definition.descriptionKey, definition.hintKey];
        for (const key of keys as I18nKey[]) {
          expect(hasAppTranslation(locale, key), `${locale} ${key}`).toBe(true);
          expect(t(key, {}, locale), `${locale} ${key}`).not.toContain('—');
        }
      }
    }
  });
});
