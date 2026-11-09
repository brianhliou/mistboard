// The launch switch (a spec's publicSurface in packages/game game-specs.ts) is
// the one place that decides whether a playtest variant is public. Every list
// that names public or allowlisted variants derives from it; this file holds the
// server's lists to it, for the switch as it stands and for the switch flipped.
// The web half is apps/web/src/launch-switch.test.ts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
import type { BotProfile } from './persistence-bots.js';
import {
  countedPublicGame,
  OFF_PUBLIC_GAME_SPEC_IDS,
  offPublicGameSpecIds,
  publicVariant,
} from './persistence-counted-games.js';
import {
  ALLOWLISTED_GAME_SPEC_IDS,
  isAllowlistedGameSpec,
  mayPlayVariant,
} from './persistence-variant-access.js';
import {
  isPublicRatingPool,
  PRIVATE_RATING_POOLS,
  privateRatingPoolsFor,
} from './rating-buckets.js';
import { withoutHiddenSpecs } from './routes/bots.js';
import { serveSitemap } from './server-static-pages.js';

const XMJ = XIANGQI_MAHJONG_SPEC_ID;
const XMJ_RULES_SLUG = 'xiangqi-mahjong-32';
const XMJ_POOL = 'xiangqi_mahjong';

/** Every surface's answer to "is XMJ listed publicly?", from pure derivations
 *  of one public predicate. */
function xmjListedUnder(isPublic: (id: GameSpecId) => boolean): Record<string, boolean> {
  const lists = deriveLaunchLists(isPublic);
  const offPublic = offPublicGameSpecIds(isPublic);
  return {
    'on the variant shelf (CANONICAL_VARIANT_ORDER)': lists.canonicalVariantOrder.includes(XMJ),
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

test('XMJ is launched on every server surface without a playtest grant', async () => {
  assert.equal(isPublicGameSpec(XMJ), true);
  // Held out of correspondence for everyone, granted or not (Brian, 2026-10-25).
  assert.equal(CORRESPONDENCE_ELIGIBLE_SPEC_IDS.includes(XMJ), false);
  assert.equal(isCorrespondenceAllowlistedSpec(XMJ), false);
  const listed = xmjListedNow();
  assert.deepEqual(listed, everyValue(listed, true));
  assert.equal(await mayPlayVariant(null, XMJ), true);
  assert.equal(await mayPlayVariant(null, 'mahjong'), false);

  // /api/bots uses this projection before returning each bot's supported specs.
  const bot = { supportedGameSpecIds: [XMJ, 'mahjong'] } as BotProfile;
  assert.deepEqual(withoutHiddenSpecs(bot).supportedGameSpecIds, [XMJ]);
});

test('the generated sitemap lists XMJ rules and the shared play pages in every locale', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-launch-'));
  const prefixes = ['', '/zh-hans', '/zh-hant'];
  for (const prefix of prefixes) {
    const rulesDir = join(staticDir, prefix, 'rules');
    await mkdir(rulesDir, { recursive: true });
    for (const slug of [XMJ_RULES_SLUG, 'mahjong']) {
      await writeFile(join(rulesDir, `${slug}.html`), '<html>Rules</html>');
    }
  }
  await writeFile(
    join(staticDir, 'prerender-sitemap.json'),
    JSON.stringify(
      prefixes.flatMap((prefix) => [
        { path: `${prefix}/rules/${XMJ_RULES_SLUG}`, lastmod: '2026-11-01' },
        { path: prefix || '/', lastmod: '2026-11-01' },
      ]),
    ),
  );
  let xml = '';
  const response = {
    writeHead() {},
    end(body: string) {
      xml = body;
    },
  } as unknown as ServerResponse;
  await serveSitemap({
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
    section: 'pages',
  });
  for (const prefix of prefixes) {
    assert.ok(xml.includes(`<loc>https://mistboard.test${prefix}/rules/${XMJ_RULES_SLUG}</loc>`));
    // Play setup lives on the home page, including XMJ's ?play= deep links.
    assert.ok(xml.includes(`<loc>https://mistboard.test${prefix || '/'}</loc>`));
    assert.ok(!xml.includes(`<loc>https://mistboard.test${prefix}/rules/mahjong</loc>`));
  }
});

test('every server list agrees with the launch switch as it stands', () => {
  const lists = deriveLaunchLists(isPublicGameSpec);
  assert.deepEqual(CANONICAL_VARIANT_ORDER, lists.canonicalVariantOrder);
  assert.deepEqual(CORRESPONDENCE_ELIGIBLE_SPEC_IDS, lists.correspondenceEligible);
  assert.deepEqual(CORRESPONDENCE_ALLOWLISTED_SPEC_IDS, lists.correspondenceAllowlisted);
  assert.deepEqual(ALLOWLISTED_PLAYTEST_SPEC_IDS, lists.allowlisted);
  assert.deepEqual(ALLOWLISTED_GAME_SPEC_IDS, lists.allowlisted);
  assert.deepEqual(PRIVATE_RATING_POOLS, privateRatingPoolsFor(lists.allowlisted));
  assert.deepEqual(OFF_PUBLIC_GAME_SPEC_IDS, offPublicGameSpecIds(isPublicGameSpec));

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

test('Gomoku is launched with a public rated pool and no public correspondence', async () => {
  assert.equal(isPublicGameSpec('gomoku'), true);
  assert.equal(articleIsIndexable('gomoku'), true);
  assert.equal(CANONICAL_VARIANT_ORDER.at(-1), 'gomoku');
  assert.equal(isAllowlistedGameSpec('gomoku'), false);
  assert.equal(await mayPlayVariant(null, 'gomoku'), true);
  assert.equal(isPublicRatingPool('gomoku'), true);
  assert.ok(!countedPublicGame('g').includes("'gomoku'"));
  assert.equal(CORRESPONDENCE_ELIGIBLE_SPEC_IDS.includes('gomoku'), false);
  assert.equal(isCorrespondenceAllowlistedSpec('gomoku'), false);
  const hidden = publicSpecPredicate(
    GAME_SPECS.map((spec) =>
      spec.id === 'gomoku' ? { ...spec, publicSurface: 'hidden' as const } : spec,
    ),
  );
  const lists = deriveLaunchLists(hidden);
  assert.ok(lists.allowlisted.includes('gomoku'));
  assert.ok(!lists.canonicalVariantOrder.includes('gomoku'));
  assert.ok(privateRatingPoolsFor(lists.allowlisted).includes('gomoku'));
  assert.ok(playtestRulesSlugs(hidden).includes('gomoku'));
  assert.ok(offPublicGameSpecIds(hidden).includes('gomoku'));
  assert.ok(!lists.correspondenceEligible.includes('gomoku'));
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
  assert.deepEqual(
    launched.canonicalVariantOrder.filter((id) => id !== XMJ),
    hidden.canonicalVariantOrder,
  );
  // Correspondence is the one list the switch does not reach: XMJ is held out of
  // it either way (Brian, 2026-10-25), so flipping it leaves that list alone.
  assert.deepEqual(launched.correspondenceEligible, hidden.correspondenceEligible);
  assert.ok(!launched.correspondenceEligible.includes(XMJ));
  assert.ok(!hidden.correspondenceAllowlisted.includes(XMJ));
  // HK mahjong is untouched by XMJ's switch.
  assert.ok(launched.allowlisted.includes('mahjong'));
  assert.ok(playtestRulesSlugs(on).includes('mahjong'));
});

function threeKingdomsListedUnder(isPublic: (id: GameSpecId) => boolean) {
  const id = 'three-kingdoms-banqi';
  const lists = deriveLaunchLists(isPublic);
  return {
    shelf: lists.canonicalVariantOrder.includes(id),
    playWithoutGrant: !lists.allowlisted.includes(id),
    rules: !playtestRulesSlugs(isPublic).includes(id),
    stats: !offPublicGameSpecIds(isPublic).includes(id),
  };
}

test('Three Kingdoms Banqi is launched, casual and unrated, on every server surface', async () => {
  const id = 'three-kingdoms-banqi';
  assert.equal(isPublicGameSpec(id), true);
  assert.equal(articleIsIndexable(id), true);
  assert.equal(CANONICAL_VARIANT_ORDER[CANONICAL_VARIANT_ORDER.indexOf('banqi') + 1], id);
  assert.equal(isAllowlistedGameSpec(id), false);
  assert.equal(await mayPlayVariant(null, id), true);
  assert.equal(ratingPoolForSpec(id), null);
  assert.equal(CORRESPONDENCE_ELIGIBLE_SPEC_IDS.includes(id), false);
  assert.equal(isCorrespondenceAllowlistedSpec(id), false);
  assert.ok(!countedPublicGame('g').includes(`'${id}'`));
  const bot = { supportedGameSpecIds: [id, 'mahjong'] } as BotProfile;
  assert.deepEqual(withoutHiddenSpecs(bot).supportedGameSpecIds, [id]);
  const listed = threeKingdomsListedUnder(isPublicGameSpec);
  assert.deepEqual(listed, everyValue(listed, true));
  const profile = JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../config/product-profile.json'),
      'utf8',
    ),
  );
  assert.equal(profile.serverFlagByGameSpecId[id], 'MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED');
});

test('hiding Three Kingdoms Banqi removes every server listing again', () => {
  const hidden = publicSpecPredicate(
    GAME_SPECS.map((spec) =>
      spec.id === 'three-kingdoms-banqi' ? { ...spec, publicSurface: 'hidden' as const } : spec,
    ),
  );
  const listed = threeKingdomsListedUnder(hidden);
  assert.deepEqual(listed, everyValue(listed, false));
});

test('the generated sitemap indexes the launched English TK rules', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-tk-launch-'));
  await mkdir(join(staticDir, 'rules'), { recursive: true });
  await writeFile(join(staticDir, 'rules/three-kingdoms-banqi.html'), '<html>Rules</html>');
  await writeFile(
    join(staticDir, 'prerender-sitemap.json'),
    JSON.stringify([{ path: '/rules/three-kingdoms-banqi', lastmod: '2026-11-10' }]),
  );
  let xml = '';
  await serveSitemap({
    response: {
      writeHead() {},
      end(body: string) {
        xml = body;
      },
    } as unknown as ServerResponse,
    publicHost: 'https://mistboard.test',
    staticDir,
    section: 'pages',
  });
  assert.ok(xml.includes('<loc>https://mistboard.test/rules/three-kingdoms-banqi</loc>'));
});
