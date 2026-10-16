import {
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENTS,
  type AchievementDefinition,
  getAchievementFamily,
} from '@mistboard/game';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hasAppTranslation, type I18nKey, loadAppI18nDomains, t } from './i18n/catalog.js';
import { SUPPORTED_LOCALES } from './i18n/locale.js';
import { buildProfileIdentity } from './profile.js';
import {
  ACHIEVEMENT_CARD_TOTAL,
  buildAchievementFamilyCard,
  buildProfileAchievementsPage,
  buildProfileAchievementsSummary,
  mountProfileAchievements,
  PREVIEW_FAMILY_STATES,
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

  it('a family counts once, from its first tier, however many tiers are held', () => {
    const line = buildProfileAchievementsSummary(
      'h',
      [
        { id: 'first-game', awardedAt: AUG(1) },
        { id: 'wins:10', awardedAt: AUG(2) },
        { id: 'wins:50', awardedAt: AUG(9) },
      ],
      'en',
    );
    expect(line?.querySelector('.profile-achievements-link')?.textContent).toBe('2 achievements');
  });
});

const WINS = getAchievementFamily('wins')!;

describe('the wins card', () => {
  const card = (level: number, count: number, nextThreshold: number | null, awardedAt?: string) =>
    buildAchievementFamilyCard(WINS, { id: 'wins', level, count, nextThreshold }, 'en', {
      awardedAt: awardedAt ?? null,
    });
  const pips = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.achievement-card-pip')]
      .map((pip) => (pip.dataset.filled === 'true' ? '●' : '○'))
      .join('');

  it('locked: the first tier as its title, no metal, and the count toward it', () => {
    const el = card(0, 3, 10);
    expect(el.dataset.state).toBe('locked');
    expect(el.dataset.metal).toBe('none');
    expect(el.querySelector('.achievement-card-title')?.textContent).toBe('10 wins');
    expect(pips(el)).toBe('○○○○');
    expect(el.querySelector('.achievement-card-pips')?.getAttribute('aria-label')).toBe(
      'Tier 0 of 4',
    );
    expect(el.querySelector('.achievement-card-text')?.textContent).toBe(
      'Win 10 games against people or bots.',
    );
    expect(el.querySelector('.achievement-card-count')?.textContent).toBe('3 / 10');
    expect(el.querySelector<HTMLElement>('.achievement-card-bar-fill')?.style.width).toBe('30%');
    expect(el.querySelector('.achievement-card-status')?.textContent).toBe('Not earned yet');
  });

  it('tiered: the highest tier held names the card and lends its metal', () => {
    const el = card(3, 143, 500, AUG(20));
    expect(el.dataset.state).toBe('earned');
    expect(el.dataset.level).toBe('3');
    expect(el.dataset.metal).toBe('gold');
    expect(el.querySelector('.achievement-card-title')?.textContent).toBe('100 wins');
    expect(pips(el)).toBe('●●●○');
    expect(el.querySelector('.achievement-card-text')?.textContent).toBe('Won 100 games.');
    expect(el.querySelector('.achievement-card-count')?.textContent).toBe('143 / 500');
    expect(el.querySelector('.achievement-card-bar')?.getAttribute('aria-valuenow')).toBe('143');
    expect(el.querySelector('.achievement-card-max')).toBe(null);
    expect(el.querySelector('.achievement-card-status')?.textContent).toBe('Earned Aug 20, 2026');
    expect(card(1, 23, 50).dataset.metal).toBe('bronze');
    expect(card(2, 78, 100).dataset.metal).toBe('silver');
  });

  it('max tier: platinum, every pip filled, "Max tier" and no bar', () => {
    const el = card(4, 612, null, AUG(30));
    expect(el.dataset.metal).toBe('platinum');
    expect(el.querySelector('.achievement-card-title')?.textContent).toBe('500 wins');
    expect(pips(el)).toBe('●●●●');
    expect(el.querySelector('.achievement-card-bar')).toBe(null);
    expect(el.querySelector('.achievement-card-count')).toBe(null);
    expect(el.querySelector('.achievement-card-max')?.textContent).toBe('Max tier');
  });

  it('localizes the title, tier label and max line', () => {
    const el = buildAchievementFamilyCard(
      WINS,
      { id: 'wins', level: 4, count: 612, nextThreshold: null },
      'zh-Hans',
    );
    expect(el.querySelector('.achievement-card-title')?.textContent).toBe('500 胜');
    expect(el.querySelector('.achievement-card-max')?.textContent).toBe('已达最高级');
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
      `1 of ${ACHIEVEMENT_CARD_TOTAL} earned`,
    );
    expect(page.querySelectorAll('.achievement-card')).toHaveLength(ACHIEVEMENT_CARD_TOTAL);
    expect(ACHIEVEMENT_CARD_TOTAL).toBe(ACHIEVEMENTS.length + ACHIEVEMENT_FAMILIES.length);

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
      'wins',
    ]);
  });

  it('a family is one card at its highest tier, with the API progress and that tier date', () => {
    const page = buildProfileAchievementsPage(
      'h',
      [
        { id: 'wins:10', awardedAt: AUG(2) },
        { id: 'wins:50', awardedAt: AUG(9) },
      ],
      'en',
      { families: [{ id: 'wins', level: 2, count: 55, nextThreshold: 100 }] },
    );
    const wins = page.querySelectorAll<HTMLElement>('[data-achievement-id="wins"]');
    expect(wins).toHaveLength(1);
    expect(wins[0]?.dataset.metal).toBe('silver');
    expect(wins[0]?.querySelector('.achievement-card-count')?.textContent).toBe('55 / 100');
    expect(wins[0]?.querySelector('.achievement-card-status')?.textContent).toBe(
      'Earned Aug 9, 2026',
    );
    expect(page.querySelector('.achievements-page-summary')?.textContent).toBe(
      `1 of ${ACHIEVEMENT_CARD_TOTAL} earned`,
    );
    // An older server without `families`: the tiers the rows prove.
    const fallback = buildProfileAchievementsPage(
      'h',
      [{ id: 'wins:10', awardedAt: AUG(2) }],
      'en',
    );
    const card = fallback.querySelector<HTMLElement>('[data-achievement-id="wins"]');
    expect(card?.dataset.metal).toBe('bronze');
    expect(card?.querySelector('.achievement-card-count')?.textContent).toBe('10 / 50');
  });

  it('says whose page it is, linking back to the profile', () => {
    const page = buildProfileAchievementsPage('river_horse', [], 'en');
    const owner = page.querySelector<HTMLAnchorElement>('.achievements-owner');
    expect(owner?.getAttribute('href')).toBe('/@/river_horse');
    expect(owner?.textContent).toBe('R');
    expect(page.querySelector('.achievements-page-handle')?.textContent).toBe('@river_horse');
  });

  it('?preview=1 adds an Examples group of wins cards in every state, outside the count', () => {
    const plain = buildProfileAchievementsPage('h', [], 'en');
    expect(plain.querySelector('[data-preview]')).toBe(null);
    const page = buildProfileAchievementsPage('h', [], 'en', { preview: true });
    const examples = page.querySelector<HTMLElement>('.achievements-group[data-preview="true"]');
    expect(examples?.querySelector('h2')?.textContent).toBe('Examples');
    const cards = [...(examples?.querySelectorAll<HTMLElement>('.achievement-card') ?? [])];
    expect(cards).toHaveLength(PREVIEW_FAMILY_STATES.length);
    expect(cards.map((card) => card.dataset.metal)).toEqual([
      'none',
      'bronze',
      'silver',
      'gold',
      'platinum',
    ]);
    expect(
      cards.map((card) => card.querySelector('.achievement-card-count')?.textContent ?? null),
    ).toEqual(['3 / 10', '23 / 50', '78 / 100', '143 / 500', null]);
    expect(cards.every((card) => card.querySelector('.achievement-card-status') === null)).toBe(
      true,
    );
    expect(page.querySelector('.achievements-page-summary')?.textContent).toBe(
      `0 of ${ACHIEVEMENT_CARD_TOTAL} earned`,
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
        ? new Response(
            JSON.stringify({
              achievements: [{ id: 'first-game', awardedAt: AUG(1) }],
              families: [{ id: 'wins', level: 0, count: 4, nextThreshold: 10 }],
            }),
          )
        : new Response('{}', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const root = document.createElement('div');
    document.body.append(root);
    await mountProfileAchievements(root, 'river_horse');
    expect(root.querySelectorAll('.achievement-card-earned')).toHaveLength(1);
    expect(root.querySelectorAll('.achievement-card-locked')).toHaveLength(
      ACHIEVEMENT_CARD_TOTAL - 1,
    );
    expect(
      root.querySelector('[data-achievement-id="wins"] .achievement-card-count')?.textContent,
    ).toBe('4 / 10');
  });

  it('every definition has its title, description and hint in all three locales, no em dashes', () => {
    for (const definition of [...ACHIEVEMENTS, ...ACHIEVEMENT_FAMILIES]) {
      for (const locale of SUPPORTED_LOCALES) {
        const keys = [definition.titleKey, definition.descriptionKey, definition.hintKey];
        for (const key of keys as I18nKey[]) {
          expect(hasAppTranslation(locale, key), `${locale} ${key}`).toBe(true);
          expect(t(key, {}, locale), `${locale} ${key}`).not.toContain('—');
        }
      }
    }
    for (const key of [
      'profile.achievementTierOf',
      'profile.achievementMaxTier',
      'profile.achievementExamples',
    ] as I18nKey[]) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(hasAppTranslation(locale, key), `${locale} ${key}`).toBe(true);
        expect(t(key, {}, locale)).not.toContain('—');
      }
    }
  });
});
