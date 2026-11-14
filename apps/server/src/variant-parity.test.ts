import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { GAME_SPECS, type GameSpec, type GameSpecId } from '@mistboard/game';
import { FLAIR_KEYS } from './flair.js';
import { GAME_VARIANTS_BY_RATING_POOL } from './persistence-profiles.js';
import { isClientRoute } from './server-policy.js';
import './variant-tenant/register-tenants.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';

// Step 1 of #1052: these are test declarations, not a second runtime registry.
// `rated` already exists. The manifest step will add `flair` and `routeBase`.
// Until then, public playable specs owe flair and a direct game route.
const KNOWN_FLAIR_GAPS = new Set<GameSpecId>([
  'three-kingdoms-banqi', // Launched without variant flair; pin the absence explicitly.
  'xiangqi-mahjong', // Launched without variant flair; do not silently skip it.
]);

type Declaration = GameSpec & { flair: boolean; routeBase: string | null };
const declarations: Declaration[] = GAME_SPECS.map((spec) => ({
  ...spec,
  flair: spec.publicSurface !== 'hidden',
  routeBase: spec.id === 'chess' ? null : spec.id === 'dark-chess' ? '/game' : `/${spec.id}/game`,
}));

const rootUrl = new URL('../../../', import.meta.url);
const root = fileURLToPath(rootUrl);
const readFile = (file: string) => readFileSync(new URL(file, rootUrl), 'utf8');

function latestRatingCheck(): Set<string> {
  // drift-check is a CLI with a top-level process.exit and no exports. Execute
  // only its actual helpers, verbatim, instead of copying its migration parser
  // or changing runtime tooling in this test-only issue.
  const source = readFile('scripts/drift-check.mjs');
  const helper = (name: string) => {
    const match = source.match(new RegExp(`function ${name}\\([^]*?\\n}`));
    assert.ok(match, `drift-check helper ${name} must remain discoverable`);
    return match[0];
  };
  const constraints = runInNewContext(
    `${helper('quotedValues')}\n${helper('latestNamedConstraints')}\nlatestNamedConstraints()`,
    {
      readFile,
      gitLines: (args: string[]) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split('\n'),
    },
  ) as Map<string, Set<string>>;
  const values = constraints.get('user_ratings_variant_check');
  assert.ok(values, 'latest user_ratings CHECK must exist');
  return values;
}

const ratingCheck = latestRatingCheck();
const tenants = registeredVariantTenants();
const poolVariants: Readonly<Record<string, readonly string[]>> = GAME_VARIANTS_BY_RATING_POOL;

// Chess is study-only: its nominal `fog` metadata is shared with Fog Chess,
// not a claim on that pool (see its GAME_SPECS entry). Test absence using its
// own id, rather than incorrectly demanding removal of Fog Chess's CHECK.
const ownedPool = (spec: GameSpec) => (spec.id === 'chess' ? spec.id : spec.ratingPoolBase);

const surfaces = {
  'lobby supportsRated': (spec: Declaration) => {
    // Fog Chess's registration is correspondence-only, lobby:null. Its live
    // lobby is the legacy route in routes/lobby.ts, not a tenant capability.
    const expected = spec.rated === true && spec.id !== 'dark-chess';
    const actual = tenants.some((t) => t.gameSpecId === spec.id && t.lobby?.supportsRated);
    assert.equal(actual, expected, `${spec.id}: lobby supportsRated`);
  },
  GAME_VARIANTS_BY_RATING_POOL: (spec: Declaration) => {
    assert.equal(
      poolVariants[ownedPool(spec)]?.includes(spec.id) ?? false,
      spec.rated === true,
      `${spec.id}: GAME_VARIANTS_BY_RATING_POOL`,
    );
  },
  'latest user_ratings CHECK': (spec: Declaration) => {
    assert.equal(ratingCheck.has(ownedPool(spec)), spec.rated === true, `${spec.id}: rating CHECK`);
  },
  'server flair keys': (spec: Declaration) => {
    assert.equal(
      (FLAIR_KEYS as readonly string[]).includes(`variant-${spec.id}`),
      spec.flair && !KNOWN_FLAIR_GAPS.has(spec.id),
      `${spec.id}: server flair keys`,
    );
  },
  'client route prefixes': (spec: Declaration) => {
    const probe = `${spec.routeBase ?? `/${spec.id}/game`}/parity-room`;
    assert.equal(
      isClientRoute(probe),
      spec.routeBase !== null,
      `${spec.id}: client route prefixes`,
    );
  },
};

function assertParity(specs: readonly Declaration[], surface: keyof typeof surfaces): void {
  for (const spec of specs.filter((s) => s.runtimeStatus === 'live')) surfaces[surface](spec);
}

for (const surface of Object.keys(surfaces) as (keyof typeof surfaces)[]) {
  test(`variant parity: ${surface} for every live spec (on and off)`, () => {
    assertParity(declarations, surface);
  });
  test(`variant parity rejects planted Gomoku capability off: ${surface}`, () => {
    // Like publicSpecPredicate, feed the SAME checker a copied spec list.
    // All actual surfaces stay untouched, so a forgotten hand-list entry is
    // distinguishable from changing both expected and actual together.
    const planted = declarations.map((spec) =>
      spec.id !== 'gomoku'
        ? spec
        : {
            ...spec,
            ...(surface === 'server flair keys'
              ? { flair: false }
              : surface === 'client route prefixes'
                ? { routeBase: null }
                : { rated: false }),
          },
    );
    assert.throws(() => assertParity(planted, surface), {
      code: 'ERR_ASSERTION',
      message: /gomoku/,
    });
  });
}

for (const surface of [
  'lobby supportsRated',
  'GAME_VARIANTS_BY_RATING_POOL',
  'latest user_ratings CHECK',
] as const) {
  test(`variant parity rejects planted Three Kingdoms rated off: ${surface}`, () => {
    const planted = declarations.map((spec) =>
      spec.id === 'three-kingdoms-banqi' ? { ...spec, rated: false } : spec,
    );
    assert.throws(() => assertParity(planted, surface), {
      code: 'ERR_ASSERTION',
      message: /three-kingdoms-banqi/,
    });
  });
}

test('known flair gaps are live, public, and still absent from the server allowlist', () => {
  for (const id of KNOWN_FLAIR_GAPS) {
    const spec = declarations.find((s) => s.id === id);
    assert.equal(spec?.runtimeStatus, 'live');
    assert.equal(spec?.flair, true);
    assert.equal((FLAIR_KEYS as readonly string[]).includes(`variant-${id}`), false);
  }
});
