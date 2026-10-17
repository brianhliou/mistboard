// The launch switch (a spec's publicSurface in packages/game game-specs.ts) is
// the one place that decides whether a playtest variant is public. Every list
// that names public or allowlisted variants derives from it; this file holds the
// server's lists to it, for the switch as it stands and for the switch flipped.
// The web half is apps/web/src/launch-switch.test.ts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLISTED_PLAYTEST_SPEC_IDS,
  CANONICAL_VARIANT_ORDER,
  CORRESPONDENCE_ALLOWLISTED_SPEC_IDS,
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  deriveLaunchLists,
  GAME_SPECS,
  type GameSpecId,
  isCorrespondenceAllowlistedSpec,
  isPublicGameSpec,
  PLAYTEST_GAME_SPEC_IDS,
  publicSpecPredicate,
  ratingPoolForSpec,
  XIANGQI_MAHJONG_SPEC_ID,
} from '@mistboard/game';
import { articleIsIndexable, playtestRulesSlugs } from './article-meta.js';
import {
  countedPublicGame,
  OFF_PUBLIC_GAME_SPEC_IDS,
  offPublicGameSpecIds,
  publicVariant,
} from './persistence-counted-games.js';
import { ALLOWLISTED_GAME_SPEC_IDS, isAllowlistedGameSpec } from './persistence-variant-access.js';
import {
  isPublicRatingPool,
  PRIVATE_RATING_POOLS,
  privateRatingPoolsFor,
} from './rating-buckets.js';

const XMJ = XIANGQI_MAHJONG_SPEC_ID;
const XMJ_RULES_SLUG = 'xiangqi-mahjong-32';
const XMJ_POOL = 'xiangqi_mahjong';

/** Every surface's answer to "is XMJ listed publicly?", from pure derivations
 *  of one public predicate. */
function xmjListedUnder(isPublic: (id: GameSpecId) => boolean): Record<string, boolean> {
  const lists = deriveLaunchLists(isPublic);
  const offPublic = offPublicGameSpecIds(lists.allowlisted);
  return {
    'on the variant shelf (CANONICAL_VARIANT_ORDER)': lists.canonicalVariantOrder.includes(XMJ),
    'correspondence for everyone': lists.correspondenceEligible.includes(XMJ),
    'not correspondence-allowlisted': !lists.correspondenceAllowlisted.includes(XMJ),
    'not on the play allowlist': !lists.allowlisted.includes(XMJ),
    'a public rating pool': !privateRatingPoolsFor(lists.allowlisted).includes(XMJ_POOL),
    'rules page indexed': !playtestRulesSlugs(isPublic).includes(XMJ_RULES_SLUG),
    'counted on /stats': !publicVariant('g', offPublic).includes(`'${XMJ}'`),
  };
}

/** The same answers read from the module constants the server actually uses. */
function xmjListedNow(): Record<string, boolean> {
  return {
    'on the variant shelf (CANONICAL_VARIANT_ORDER)': CANONICAL_VARIANT_ORDER.includes(XMJ),
    'correspondence for everyone': CORRESPONDENCE_ELIGIBLE_SPEC_IDS.includes(XMJ),
    'not correspondence-allowlisted': !isCorrespondenceAllowlistedSpec(XMJ),
    'not on the play allowlist': !isAllowlistedGameSpec(XMJ),
    'a public rating pool': isPublicRatingPool(XMJ_POOL),
    'rules page indexed': articleIsIndexable(XMJ_RULES_SLUG),
    'counted on /stats': !countedPublicGame('g').includes(`'${XMJ}'`),
  };
}

function everyValue(record: Record<string, boolean>, value: boolean): Record<string, boolean> {
  return Object.fromEntries(Object.keys(record).map((key) => [key, value]));
}

function withSwitchOn(id: GameSpecId) {
  return GAME_SPECS.map((spec) =>
    spec.id === id ? { ...spec, publicSurface: 'casual' as const } : spec,
  );
}

test('every server list agrees with the launch switch as it stands', () => {
  const lists = deriveLaunchLists(isPublicGameSpec);
  assert.deepEqual(CANONICAL_VARIANT_ORDER, lists.canonicalVariantOrder);
  assert.deepEqual(CORRESPONDENCE_ELIGIBLE_SPEC_IDS, lists.correspondenceEligible);
  assert.deepEqual(CORRESPONDENCE_ALLOWLISTED_SPEC_IDS, lists.correspondenceAllowlisted);
  assert.deepEqual(ALLOWLISTED_PLAYTEST_SPEC_IDS, lists.allowlisted);
  assert.deepEqual(ALLOWLISTED_GAME_SPEC_IDS, lists.allowlisted);
  assert.deepEqual(PRIVATE_RATING_POOLS, privateRatingPoolsFor(lists.allowlisted));
  assert.deepEqual(OFF_PUBLIC_GAME_SPEC_IDS, offPublicGameSpecIds(lists.allowlisted));

  // Each playtest spec is on exactly one side: allowlisted while hidden,
  // public once launched; its rules page is indexed exactly when public.
  for (const id of PLAYTEST_GAME_SPEC_IDS) {
    assert.equal(isAllowlistedGameSpec(id), !isPublicGameSpec(id), id);
    const pool = ratingPoolForSpec(id);
    if (pool) assert.equal(isPublicRatingPool(pool), isPublicGameSpec(id), id);
  }
  // Nothing hidden is listed, and nothing on a public list is allowlisted.
  for (const id of [...CANONICAL_VARIANT_ORDER, ...CORRESPONDENCE_ELIGIBLE_SPEC_IDS]) {
    assert.ok(isPublicGameSpec(id), `${id} is listed but hidden`);
    assert.ok(!isAllowlistedGameSpec(id), `${id} is listed but allowlisted`);
  }

  assert.deepEqual(xmjListedNow(), everyValue(xmjListedNow(), isPublicGameSpec(XMJ)));
  assert.deepEqual(xmjListedNow(), xmjListedUnder(isPublicGameSpec));
});

// config/product-profile.json is the deploy catalog (dev flags, seed fixtures),
// a JSON file the .mjs scripts read, so it cannot derive from the switch. A
// launched playtest spec must be in it; this is the reminder at launch.
test('a launched playtest spec is in the product profile', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const profile = JSON.parse(
    readFileSync(resolve(repoRoot, 'config/product-profile.json'), 'utf8'),
  ) as { gameSpecIds: string[] };
  for (const id of PLAYTEST_GAME_SPEC_IDS) {
    if (isPublicGameSpec(id)) {
      assert.ok(
        profile.gameSpecIds.includes(id),
        `${id} is public: add it to config/product-profile.json`,
      );
    }
  }
});

test('flipping the XMJ switch lists it on every server surface', () => {
  const on = publicSpecPredicate(withSwitchOn(XMJ));
  const off = publicSpecPredicate(
    GAME_SPECS.map((spec) =>
      spec.id === XMJ ? { ...spec, publicSurface: 'hidden' as const } : spec,
    ),
  );
  const listedOn = xmjListedUnder(on);
  const listedOff = xmjListedUnder(off);
  assert.deepEqual(listedOn, everyValue(listedOn, true));
  assert.deepEqual(listedOff, everyValue(listedOff, false));

  // It takes the shelf's last place; every other variant keeps its place.
  const launched = deriveLaunchLists(on);
  const hidden = deriveLaunchLists(off);
  assert.equal(launched.canonicalVariantOrder.at(-1), XMJ);
  assert.deepEqual(launched.canonicalVariantOrder.slice(0, -1), hidden.canonicalVariantOrder);
  assert.deepEqual(launched.correspondenceEligible.slice(0, -1), hidden.correspondenceEligible);
  // HK mahjong is untouched by XMJ's switch.
  assert.ok(launched.allowlisted.includes('mahjong'));
  assert.ok(playtestRulesSlugs(on).includes('mahjong'));
});
