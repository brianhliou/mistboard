// The launch switch (a spec's publicSurface in packages/game game-specs.ts)
// decides whether a playtest variant is public. This file holds the web lists to
// it: the variant's public surface, its rules page, the leaderboard and profile
// rating rows and the /stats breakdown, for the switch as it stands and with
// Xiangqi Mahjong's switch flipped on. The server half is
// apps/server/src/launch-switch.test.ts.

import type * as Game from '@mistboard/game';
import {
  CANONICAL_VARIANT_ORDER,
  deriveLaunchLists,
  GAME_SPECS,
  isPublicGameSpec,
  publicSpecPredicate,
  XIANGQI_MAHJONG_SPEC_ID,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';

const XMJ = XIANGQI_MAHJONG_SPEC_ID;
const XMJ_RULES_SLUG = 'xiangqi-mahjong-32';

type PublicStats = Parameters<typeof import('./metrics.js').publicVariantEntries>[0];

const STATS_WITH_XMJ_GAMES = {
  variantTotals: [
    { variant: 'xiangqi', count: 2 },
    { variant: XMJ, count: 1 },
  ],
} as unknown as PublicStats;

/** Every web surface's answer to "is XMJ listed publicly?", read from freshly
 *  imported modules so a mocked switch reaches them. */
async function xmjListedOnWeb(): Promise<Record<string, boolean>> {
  const surfaces = await import('./variant-public-surfaces.js');
  const variants = await import('./variants.js');
  const metrics = await import('./metrics.js');
  return {
    'public surface': surfaces.variantPublicSurfaceEnabled(XMJ),
    'rules page listed and indexed': surfaces.rulesSlugPublicSurfaceEnabled(XMJ_RULES_SLUG),
    leaderboard: variants.leaderboardVariants.some((v) => v.gameSpecId === XMJ),
    'profile rating card': variants.profileRatingVariants.some((v) => v.gameSpecId === XMJ),
    '/stats variant breakdown':
      // xiangqi is always listed, so a second row is XMJ.
      metrics.publicVariantEntries(STATS_WITH_XMJ_GAMES, 'en').length === 2,
  };
}

function everyValue(record: Record<string, boolean>, value: boolean): Record<string, boolean> {
  return Object.fromEntries(Object.keys(record).map((key) => [key, value]));
}

afterEach(() => {
  vi.doUnmock('@mistboard/game');
  vi.resetModules();
});

describe('launch switch on the web', () => {
  it('XMJ is public on every web surface', async () => {
    expect(isPublicGameSpec(XMJ)).toBe(true);
    const listed = await xmjListedOnWeb();
    expect(listed).toEqual(everyValue(listed, true));
  });

  it('every web surface agrees with the switch as it stands', async () => {
    const listed = await xmjListedOnWeb();
    expect(listed).toEqual(everyValue(listed, isPublicGameSpec(XMJ)));
  });

  it('flipping the XMJ switch lists it on every web surface', async () => {
    const isPublic = publicSpecPredicate(
      GAME_SPECS.map((spec) =>
        spec.id === XMJ ? { ...spec, publicSurface: 'casual' as const } : spec,
      ),
    );
    const lists = deriveLaunchLists(isPublic);
    expect(lists.canonicalVariantOrder.filter((id) => id !== XMJ)).toEqual(
      CANONICAL_VARIANT_ORDER.filter((id) => id !== XMJ),
    );
    vi.resetModules();
    vi.doMock('@mistboard/game', async (importOriginal) => {
      const actual = await importOriginal<typeof Game>();
      return {
        ...actual,
        isPublicGameSpec: (id: string | null | undefined) => id != null && isPublic(id),
        CANONICAL_VARIANT_ORDER: lists.canonicalVariantOrder,
        CORRESPONDENCE_ELIGIBLE_SPEC_IDS: lists.correspondenceEligible,
        CORRESPONDENCE_ALLOWLISTED_SPEC_IDS: lists.correspondenceAllowlisted,
        ALLOWLISTED_PLAYTEST_SPEC_IDS: lists.allowlisted,
      };
    });
    const listed = await xmjListedOnWeb();
    expect(listed).toEqual(everyValue(listed, true));
  });
});

async function mockGomokuSurface(surface: 'hidden' | 'casual') {
  const isPublic = publicSpecPredicate(
    GAME_SPECS.map((spec) => (spec.id === 'gomoku' ? { ...spec, publicSurface: surface } : spec)),
  );
  const lists = deriveLaunchLists(isPublic);
  vi.resetModules();
  vi.doMock('@mistboard/game', async (importOriginal) => {
    const actual = await importOriginal<typeof Game>();
    return {
      ...actual,
      isPublicGameSpec: (id: string | null | undefined) => id != null && isPublic(id),
      CANONICAL_VARIANT_ORDER: lists.canonicalVariantOrder,
      CORRESPONDENCE_ELIGIBLE_SPEC_IDS: lists.correspondenceEligible,
      CORRESPONDENCE_ALLOWLISTED_SPEC_IDS: lists.correspondenceAllowlisted,
      ALLOWLISTED_PLAYTEST_SPEC_IDS: lists.allowlisted,
    };
  });
}

it.each(['hidden', 'casual'] as const)(
  'Gomoku rating definition follows publicSurface %s without a runtime flag change',
  async (surface) => {
    await mockGomokuSurface(surface);
    const registry = await import('./variants.js');
    expect(registry.VARIANTS.find((variant) => variant.id === 'gomoku')).toBeDefined();
    for (const grid of [registry.leaderboardVariants, registry.profileRatingVariants]) {
      expect(grid.some((variant) => variant.id === 'gomoku')).toBe(surface === 'casual');
    }
  },
);

it.each(['hidden', 'casual'] as const)(
  'Gomoku open title follows publicSurface %s',
  async (surface) => {
    await mockGomokuSurface(surface);
    const page = await import('./champions-page.js');
    expect(page.OPEN_TITLES.some((title) => title.gameId === 'gomoku')).toBe(surface === 'casual');
    expect(page.buildChampions('en').querySelector('[data-game="gomoku"]') !== null).toBe(
      surface === 'casual',
    );
  },
);

it.each(['hidden', 'casual'] as const)(
  'Gomoku flair picker follows publicSurface %s without invalidating existing wearers',
  async (surface) => {
    await mockGomokuSurface(surface);
    const flair = await import('./flair.js');
    expect(flair.isFlairKey('variant-gomoku')).toBe(true);
    expect(flair.flairOfferedInPicker('variant-gomoku')).toBe(surface === 'casual');
    for (const key of ['variant-dark-chess', 'variant-atomic-xiangqi']) {
      expect(flair.isFlairKey(key)).toBe(true);
      expect(flair.buildFlairIcon(key).querySelector('.flair-mask')).not.toBeNull();
    }
    expect(flair.flairOfferedInPicker('variant-dark-chess')).toBe(true);
    expect(flair.flairOfferedInPicker('variant-atomic-xiangqi')).toBe(false);
  },
);

async function gomokuListedOnWeb() {
  const surfaces = await import('./variant-public-surfaces.js');
  const variants = await import('./variants.js');
  const metrics = await import('./metrics.js');
  const game = await import('@mistboard/game');
  return {
    public: surfaces.variantPublicSurfaceEnabled('gomoku'),
    rules: surfaces.rulesSlugPublicSurfaceEnabled('gomoku'),
    leaderboard: variants.leaderboardVariants.some((v) => v.gameSpecId === 'gomoku'),
    profile: variants.profileRatingVariants.some((v) => v.gameSpecId === 'gomoku'),
    stats:
      metrics.publicVariantEntries(
        { variantTotals: [{ variant: 'gomoku', count: 1 }] } as unknown as PublicStats,
        'en',
      ).length === 1,
    shelf: game.CANONICAL_VARIANT_ORDER.includes('gomoku'),
  };
}

it('Gomoku is public with rated live play and casual-only correspondence', async () => {
  const game = await import('@mistboard/game');
  expect(game.gameSpecForId('gomoku')).toMatchObject({ publicSurface: 'casual', rated: true });
  const listed = await gomokuListedOnWeb();
  expect(listed).toEqual(everyValue(listed, true));
  expect(game.CORRESPONDENCE_ELIGIBLE_SPEC_IDS).toContain('gomoku');
  expect(game.isCorrespondenceRatedSpec('gomoku')).toBe(false);
});

it('a hidden Gomoku switch removes every public listing again', async () => {
  await mockGomokuSurface('hidden');
  const listed = await gomokuListedOnWeb();
  expect(listed).toEqual(everyValue(listed, false));
});

async function threeKingdomsListedOnWeb() {
  const surfaces = await import('./variant-public-surfaces.js');
  const metrics = await import('./metrics.js');
  const game = await import('@mistboard/game');
  return {
    public: surfaces.variantPublicSurfaceEnabled('three-kingdoms-banqi'),
    rules: surfaces.rulesSlugPublicSurfaceEnabled('three-kingdoms-banqi'),
    indexable: !surfaces.articleIsNoindex({ kind: 'rules', slug: 'three-kingdoms-banqi' }),
    shelf: game.CANONICAL_VARIANT_ORDER.includes('three-kingdoms-banqi'),
    stats:
      metrics.publicVariantEntries(
        {
          variantTotals: [{ variant: 'three-kingdoms-banqi', count: 1 }],
        } as unknown as PublicStats,
        'en',
      ).length === 1,
  };
}

it('Three Kingdoms Banqi is launched and live-rated, with casual-only correspondence', async () => {
  const game = await import('@mistboard/game');
  expect(game.gameSpecForId('three-kingdoms-banqi')).toMatchObject({ publicSurface: 'casual' });
  expect(game.gameSpecForId('three-kingdoms-banqi').rated).toBe(true);
  expect(game.ratingPoolForSpec('three-kingdoms-banqi')).toBe('three_kingdoms_banqi');
  expect(game.isCorrespondenceRatedSpec('three-kingdoms-banqi')).toBe(false);
  const listed = await threeKingdomsListedOnWeb();
  expect(listed).toEqual(everyValue(listed, true));
  // Correspondence follows launch (#1002 built it), casual only.
  expect(game.CORRESPONDENCE_ELIGIBLE_SPEC_IDS).toContain('three-kingdoms-banqi');
});

it('hiding Three Kingdoms Banqi removes every public web listing again', async () => {
  vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'false');
  const isPublic = publicSpecPredicate(
    GAME_SPECS.map((spec) =>
      spec.id === 'three-kingdoms-banqi' ? { ...spec, publicSurface: 'hidden' as const } : spec,
    ),
  );
  const lists = deriveLaunchLists(isPublic);
  vi.resetModules();
  vi.doMock('@mistboard/game', async (importOriginal) => ({
    ...(await importOriginal<typeof Game>()),
    isPublicGameSpec: (id: string | null | undefined) => id != null && isPublic(id),
    CANONICAL_VARIANT_ORDER: lists.canonicalVariantOrder,
  }));
  const listed = await threeKingdomsListedOnWeb();
  expect(listed).toEqual(everyValue(listed, false));
  vi.unstubAllEnvs();
});
