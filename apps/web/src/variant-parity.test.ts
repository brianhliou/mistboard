import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_SPECS, type GameSpec, type GameSpecId, publicSpecPredicate } from '@mistboard/game';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TITLES } from './champions-page.js';
import { FLAIR_KEYS, flairOfferedInPicker } from './flair.js';
import { type LandingGameSpecId, landingVariantSupportsRated } from './landing-play.js';
import { webVariantTenantForSpecId } from './variant-tenant/registry.js';

// Pin fully enabled rating grids, independently of local .env/build flags.
vi.stubEnv('DEV', true);
vi.stubEnv('VITE_XIANGQI_ENABLED', 'true');
vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'true');
vi.stubEnv('VITE_JIEQI_ENABLED', 'true');
vi.stubEnv('VITE_BANQI_ENABLED', 'true');
// landing-play imports variants too; reload its module after setting the flags.
vi.resetModules();
const { leaderboardVariants, profileRatingVariants, ratingVariantLabel } = await import(
  './variants.js'
);
afterAll(() => vi.unstubAllEnvs());

// Step 1 of #1052. The manifest step will add `flair` and `championsTitle`.
// Flair is owed by public playable specs. Champions eligibility is independent
// of rated play: pin today's TITLES membership here until that field exists.
const CHAMPIONS_TITLE_SPECS = new Set<GameSpecId>([
  'xiangqi',
  'jieqi',
  'banqi',
  'duck-xiangqi',
  'crazyhouse-xiangqi',
  'dark-xiangqi',
  'dark-chess',
  'jungle',
  'jungle-flip',
  'xiangqi-mahjong',
  'gomoku',
]);
const KNOWN_FLAIR_GAPS = new Set<GameSpecId>([
  'three-kingdoms-banqi', // Launched without flair; assert absence, not a silent skip.
  'xiangqi-mahjong', // Same known gap on server and web.
]);
type Declaration = GameSpec & { flair: boolean; championsTitle: boolean };
const declarations: Declaration[] = GAME_SPECS.map((spec) => ({
  ...spec,
  flair: spec.publicSurface !== 'hidden',
  championsTitle: CHAMPIONS_TITLE_SPECS.has(spec.id),
}));

// This hand-list is private to profile.ts. Read its literal without exporting
// it or importing the entire profile UI just for a test-only conformance pin.
const profileSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'profile.ts'),
  'utf8',
);
const profileLabelsLiteral = profileSource.match(
  /const PROFILE_VARIANT_LABEL_KEY[^=]*=\s*\{([\s\S]*?)\n\};/,
);
expect(profileLabelsLiteral, 'profile label map must remain discoverable').not.toBeNull();
const profileLabelPools = new Set(
  [...(profileLabelsLiteral?.[1] ?? '').matchAll(/^\s*(\w+):\s*'variant\.[^']+\.name'/gm)].map(
    (match) => match[1],
  ),
);

// Study-only Chess borrows nominal `fog` metadata but owns no rating pool.
const ownedPool = (spec: GameSpec) => (spec.id === 'chess' ? spec.id : spec.ratingPoolBase);

const surfaces = {
  'leaderboard rows': (spec: Declaration, isPublic: (id: string) => boolean) => {
    expect(
      leaderboardVariants.some((v) => v.gameSpecId === spec.id),
      spec.id,
    ).toBe(spec.rated === true && isPublic(spec.id));
  },
  'profile rows': (spec: Declaration, isPublic: (id: string) => boolean) => {
    expect(
      profileRatingVariants.some((v) => v.gameSpecId === spec.id),
      spec.id,
    ).toBe(spec.rated === true && isPublic(spec.id));
  },
  'profile labels': (spec: Declaration) => {
    expect(profileLabelPools.has(ownedPool(spec)), spec.id).toBe(spec.rated === true);
    expect(ratingVariantLabel(ownedPool(spec)) !== null, spec.id).toBe(spec.rated === true);
  },
  'landing-play rated support': (spec: Declaration) => {
    const tenant = webVariantTenantForSpecId(spec.id);
    // Fog Chess is the legacy landing fallback. Study-only Chess has no
    // landing entry and is deliberately outside LandingGameSpecId.
    const actual =
      spec.id === 'dark-chess' || tenant?.landing
        ? landingVariantSupportsRated(spec.id as LandingGameSpecId)
        : false;
    expect(actual, spec.id).toBe(spec.rated === true);
  },
  'champions title presence': (spec: Declaration, isPublic: (id: string) => boolean) => {
    expect(
      TITLES.some((title) => title.gameId === spec.id),
      spec.id,
    ).toBe(spec.championsTitle && isPublic(spec.id));
  },
  'flair picker keys': (spec: Declaration, isPublic: (id: string) => boolean) => {
    const key = `variant-${spec.id}`;
    expect(FLAIR_KEYS.includes(key) && flairOfferedInPicker(key), spec.id).toBe(
      spec.flair && isPublic(spec.id) && !KNOWN_FLAIR_GAPS.has(spec.id),
    );
  },
  'registry capabilities.supportsRated': (spec: Declaration) => {
    // Fog Chess's rated capability lives in landing-play, not a tenant row.
    expect(
      webVariantTenantForSpecId(spec.id)?.landing?.capabilities.supportsRated ?? false,
      spec.id,
    ).toBe(spec.rated === true && spec.id !== 'dark-chess');
  },
};

function assertParity(specs: readonly Declaration[], surface: keyof typeof surfaces): void {
  const isPublic = publicSpecPredicate(specs);
  for (const spec of specs.filter((s) => s.runtimeStatus === 'live'))
    surfaces[surface](spec, isPublic);
}

describe('variant parity', () => {
  for (const surface of Object.keys(surfaces) as (keyof typeof surfaces)[]) {
    it(`${surface} agrees for every live spec (on and off)`, () => {
      assertParity(declarations, surface);
    });
    it(`rejects planted Gomoku capability off: ${surface}`, () => {
      const planted = declarations.map((spec) =>
        spec.id !== 'gomoku'
          ? spec
          : {
              ...spec,
              ...(surface === 'flair picker keys'
                ? { flair: false }
                : surface === 'champions title presence'
                  ? { championsTitle: false }
                  : { rated: false }),
            },
      );
      expect(() => assertParity(planted, surface)).toThrow(/gomoku/);
    });
  }

  for (const surface of [
    'leaderboard rows',
    'profile rows',
    'profile labels',
    'landing-play rated support',
    'registry capabilities.supportsRated',
    'champions title presence',
  ] as const) {
    it(`rejects planted Three Kingdoms capability on: ${surface}`, () => {
      const planted = declarations.map((spec) =>
        spec.id !== 'three-kingdoms-banqi'
          ? spec
          : {
              ...spec,
              ...(surface === 'champions title presence'
                ? { championsTitle: true }
                : { rated: true }),
            },
      );
      expect(() => assertParity(planted, surface)).toThrow(/three-kingdoms-banqi/);
    });
  }

  it('keeps known flair gaps live, public, and absent from the picker keys', () => {
    for (const id of KNOWN_FLAIR_GAPS) {
      const spec = declarations.find((s) => s.id === id);
      expect(spec?.runtimeStatus, id).toBe('live');
      expect(spec?.flair, id).toBe(true);
      expect(FLAIR_KEYS, id).not.toContain(`variant-${id}`);
    }
  });
});
