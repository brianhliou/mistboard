import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { routes } from './http-api.js';
import { canServeLiveBoard } from './server-policy.js';
import './variant-tenant/register-tenants.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';
import { hasLiveWatchPayloadBuilder } from './watch-live.js';

// Fail-closed conformance backstop for the http-api dispatch array.
//
// Every postgame games route lives in a routes/<variant>-games.ts module that
// exports `tryHandle`, and every such module MUST be added to the `routes`
// array in http-api.ts or its /api/<variant>/games/:id endpoint silently 404s
// in production (a new variant's route file typechecks fine but never runs).
// That exact bug shipped standard Xiangqi's postgame page dead in prod. The
// dispatch array is a hand-maintained mirror with no compile-time enforcement,
// so this test enumerates the route files and asserts each is wired in — the
// same fail-closed pattern the request gate and registry-sync tests apply to
// the other dispatch surfaces.

const routesDir = join(dirname(fileURLToPath(import.meta.url)), 'routes');

test('every routes/*-games.ts module is registered in the http-api dispatch', async () => {
  // Match both the .ts source tree (local tsx runs) and the compiled dist/ tree
  // (hosted CI runs the built .js). Exclude .test.* and .d.ts/.map siblings.
  const gameRouteFiles = readdirSync(routesDir)
    .filter((file) => /-games\.[jt]s$/.test(file) && !file.includes('.test.'))
    .sort();
  assert.ok(gameRouteFiles.length > 0, 'expected to discover games-route modules under routes/');

  // Identity by the tryHandle function reference (stable regardless of how the
  // module namespace object is obtained), not by array membership of the ns.
  const registered = new Set(routes.map((route) => route.tryHandle));

  const unregistered: string[] = [];
  for (const file of gameRouteFiles) {
    const mod = (await import(join(routesDir, file.replace(/\.[jt]s$/, '.js')))) as {
      tryHandle?: unknown;
    };
    assert.equal(
      typeof mod.tryHandle,
      'function',
      `${file} does not export tryHandle — every games route must implement the RouteModule contract`,
    );
    if (!registered.has(mod.tryHandle as (typeof routes)[number]['tryHandle'])) {
      unregistered.push(file);
    }
  }

  assert.deepEqual(
    unregistered,
    [],
    `these games-route modules exist but are NOT wired into http-api.ts's routes[] dispatch array, so their /api/<variant>/games/:id endpoint 404s in production: ${unregistered.join(', ')}. Import the module and add it to the routes array in http-api.ts.`,
  );
});

// Same backstop for the live board. A tenant whose watch channel is open
// (canServeLiveBoard) but whose route module registers no live payload builder
// lists its in-progress games on /games, Watch live and the correspondence inbox
// as a variant icon instead of a board, with nothing failing anywhere (Atomic
// Xiangqi shipped that way). Builders register as a side effect of the route
// modules http-api.ts imports, so this runs after that import.
//
// Known gaps, each a missing builder rather than a policy: remove an entry when
// its builder lands, and never add one for a new variant.
const OPEN_CHANNELS_WITHOUT_LIVE_BUILDER: ReadonlySet<string> = new Set([]);

test('every open watch channel has a live board payload builder', () => {
  const missing: string[] = [];
  const stale: string[] = [];
  for (const registration of registeredVariantTenants()) {
    const channelId = registration.watch?.channelId;
    if (!channelId || !canServeLiveBoard(registration.gameSpecId)) continue;
    const hasBuilder = hasLiveWatchPayloadBuilder(channelId);
    if (OPEN_CHANNELS_WITHOUT_LIVE_BUILDER.has(channelId)) {
      if (hasBuilder) stale.push(channelId);
      continue;
    }
    if (!hasBuilder) missing.push(channelId);
  }
  assert.deepEqual(
    missing,
    [],
    `these open watch channels have no registerLiveWatchPayloadBuilder(...), so their live games show an icon instead of a board: ${missing.join(', ')}`,
  );
  assert.deepEqual(
    stale,
    [],
    `remove from OPEN_CHANNELS_WITHOUT_LIVE_BUILDER: ${stale.join(', ')}`,
  );
});
