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

type PublicStats = Parameters<typeof import('./metrics.js').weeklyVariantSeries>[0];

const STATS_WITH_XMJ_GAMES = {
  weeklyCompletedGames: [{ weekStart: '2026-10-12', completedGames: 3 }],
  weeklyByVariant: [
    { variant: 'xiangqi', total: 2, weeks: [{ weekStart: '2026-10-12', completedGames: 2 }] },
    { variant: XMJ, total: 1, weeks: [{ weekStart: '2026-10-12', completedGames: 1 }] },
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
    '/stats per-variant chart': metrics
      .weeklyVariantSeries(STATS_WITH_XMJ_GAMES, 'en')
      .some((series) => series.key === XMJ),
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
    expect(lists.canonicalVariantOrder.slice(0, -1)).toEqual(
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
