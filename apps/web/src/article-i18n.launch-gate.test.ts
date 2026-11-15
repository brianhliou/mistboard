import { DARK_CHESS_SPEC_ID, GAME_SPECS, type GameSpec } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { TRANSLATED_ARTICLE_SLUGS } from './article-i18n.js';
import { rulesSlugForGameSpec } from './variant-public-surfaces.js';

type LaunchSpec = Pick<GameSpec, 'id' | 'publicSurface' | 'runtimeStatus'>;

function unlockedLaunchedRules(
  specs: readonly LaunchSpec[],
  lockedSlugs: ReadonlySet<string>,
): string[] {
  return specs
    .filter((spec) => spec.publicSurface !== 'hidden' && spec.runtimeStatus === 'live')
    .flatMap((spec) => {
      const slug = rulesSlugForGameSpec(spec.id);
      return lockedSlugs.has(slug) ? [] : [`${spec.id}: /rules/${slug}`];
    });
}

const launchedFixture: LaunchSpec = {
  id: DARK_CHESS_SPEC_ID,
  publicSurface: 'casual',
  runtimeStatus: 'live',
};

describe('launched game rules translation gate', () => {
  it('catches a planted launched game whose rules slug is missing from the locked set', () => {
    const locked = new Set<string>(TRANSLATED_ARTICLE_SLUGS);
    locked.delete('fog-chess');
    expect(unlockedLaunchedRules([launchedFixture], locked)).toEqual([
      'dark-chess: /rules/fog-chess',
    ]);
  });

  it('requires the mapped rules slug rather than the game spec id', () => {
    expect(unlockedLaunchedRules([launchedFixture], new Set(['dark-chess']))).toEqual([
      'dark-chess: /rules/fog-chess',
    ]);
    expect(unlockedLaunchedRules([launchedFixture], new Set(['fog-chess']))).toEqual([]);
  });

  it.each([
    { publicSurface: 'hidden', runtimeStatus: 'live' },
    { publicSurface: 'casual', runtimeStatus: 'future' },
    { publicSurface: 'casual', runtimeStatus: 'retired' },
  ] as const)('does not gate $publicSurface / $runtimeStatus games', (status) => {
    expect(unlockedLaunchedRules([{ ...launchedFixture, ...status }], new Set())).toEqual([]);
  });

  it('every launched game has translation-locked rules in both Chinese scripts', () => {
    // Membership opts the article into every article-i18n.coverage.test.ts
    // check: prose, update notes, SVG/card labels, SEO and zh-Hant parallelism.
    // An untranslated-article exemption cannot satisfy this launch contract.
    const missing = unlockedLaunchedRules(GAME_SPECS, new Set(TRANSLATED_ARTICLE_SLUGS));
    expect(
      missing,
      `Launched games require rules in TRANSLATED_ARTICLE_SLUGS; exemptions do not count:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
