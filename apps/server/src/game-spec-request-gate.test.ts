import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_SPECS, RETIRED_GAME_SPEC_IDS } from '@mistboard/game';
import { gateGameSpecRequest } from './game-spec-request-gate.js';
// Importing register-tenants registers every tenant (module-scope side effect
// of each *-registration.ts module), so the registry-driven test below sees
// the same tenant set the server boots with.
import './variant-tenant/register-tenants.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';

test('game spec gate passes current chess requests', () => {
  assert.deepEqual(gateGameSpecRequest({ variant: 'dark-chess' }), { type: 'pass' });
  assert.deepEqual(gateGameSpecRequest({ gameSpecId: 'dark-chess' }), { type: 'pass' });
  assert.deepEqual(gateGameSpecRequest({}), { type: 'pass' });
  // The WS dispatch passes url.searchParams.get('gameSpecId'), so an absent
  // query param arrives as null: treat it like undefined.
  assert.deepEqual(gateGameSpecRequest({ gameSpecId: null }), { type: 'pass' });
});

test('game spec gate leaves free-string variants to parseVariantId', () => {
  // parseVariantId (routes/lib.ts) owns the legacy collapse: every free string
  // maps to plain dark chess. Legacy clients rely on that, so the gate only
  // rejects a variant string that names a known non-chess spec, a retired
  // spec, or a deleted Draft960 spelling (a client that asked for the draft
  // must not silently get a Fog Chess room without one).
  assert.deepEqual(gateGameSpecRequest({ variant: 'fog' }), { type: 'pass' });
  assert.deepEqual(gateGameSpecRequest({ variant: 'anything-else' }), { type: 'pass' });
  for (const variant of ['draft960', 'dark-draft960', 'fog-draft960']) {
    const decision = gateGameSpecRequest({ variant });
    assert.equal(decision.type === 'reject' && decision.error, 'unknown_game_spec', variant);
    assert.equal(decision.type === 'reject' && decision.httpStatus, 404, variant);
  }
});

test('game spec gate rejects unknown game spec ids', () => {
  // Fail closed: an id the registry does not know cannot be served by the
  // chess stack, and passing it would silently create a dark-chess room.
  for (const gameSpecId of ['fog', 'not-a-spec', '', 42]) {
    assert.deepEqual(
      gateGameSpecRequest({ gameSpecId }),
      {
        type: 'reject',
        error: 'unknown_game_spec',
        httpStatus: 404,
        wsCloseReason: 'unknown game spec',
      },
      `gameSpecId ${JSON.stringify(gameSpecId)}`,
    );
  }
});

test('game spec gate treats legacy Dark Xiangqi variant requests as disabled by default', () => {
  withFlag('MISTBOARD_DARK_XIANGQI_ENABLED', false, () => {
    assert.deepEqual(gateGameSpecRequest({ variant: 'dark-xiangqi' }), {
      type: 'reject',
      error: 'dark_xiangqi_disabled',
      httpStatus: 404,
      wsCloseReason: 'game spec disabled',
    });
  });
});

const RETIRED = {
  type: 'reject',
  error: 'retired_game_spec',
  httpStatus: 410,
  wsCloseReason: 'game spec retired',
} as const;

test('game spec gate refuses every retired spec, by id and by legacy variant, whatever the flag', () => {
  // Retirement is decided in packages/game (runtimeStatus 'retired'); the
  // gate reads it and never consults a launch flag for a retired id. The set
  // is empty since 2026-09-12 (every retired spec has been deleted); the loop
  // stays so the next retirement is covered the moment it lands.
  for (const id of RETIRED_GAME_SPEC_IDS) {
    assert.deepEqual(gateGameSpecRequest({ gameSpecId: id }), RETIRED, `gameSpecId ${id}`);
    assert.deepEqual(gateGameSpecRequest({ variant: id }), RETIRED, `variant ${id}`);
  }
});

test('game spec gate answers the deleted Draft960 ids as unknown', () => {
  // dark-draft960 and its pre-rename alias fog-draft960 were deleted with the
  // draft phase (2026-09-12, #396): no spec, no alias, so 404 rather than 410.
  for (const gameSpecId of ['fog-draft960', 'dark-draft960']) {
    const decision = gateGameSpecRequest({ gameSpecId });
    assert.equal(decision.type === 'reject' && decision.error, 'unknown_game_spec', gameSpecId);
  }
});

test('game spec gate keeps rejecting legacy variant spellings for tenant specs', () => {
  for (const variant of ['jieqi']) {
    assert.equal(gateGameSpecRequest({ variant }).type, 'reject', `variant ${variant}`);
  }
});

test('game spec gate rejects every runtimeStatus future spec, of which there are none today', () => {
  // The five reserved ids (dark-antichess, sun-tzu, lao-tzu, dark-seirawan,
  // dark-omega) left with the retirement sweep (#396). Should one come back,
  // known-but-unrouted must stay distinguishable from unknown_game_spec.
  for (const spec of GAME_SPECS.filter((s) => s.runtimeStatus === 'future')) {
    assert.deepEqual(
      gateGameSpecRequest({ gameSpecId: spec.id }),
      {
        type: 'reject',
        error: `${spec.id.replaceAll('-', '_')}_not_integrated`,
        httpStatus: 501,
        wsCloseReason: 'game spec not integrated',
      },
      spec.id,
    );
  }
});

test('game spec gate fails closed for every registered tenant spec', () => {
  // The gate guards the chess fallback: a tenant spec that passes here would
  // silently create a dark-chess room whenever the tenant registry misses
  // (e.g. a registration import dropped from register-tenants.ts). Tenants
  // with ownsSpecRouting=false (dark-chess correspondence) are skipped: the
  // chess stack IS that spec's primary surface (see variant-tenant/registry.ts).
  //
  // Exhaustiveness is enforced at compile time: GATED_GAME_SPECS in
  // game-spec-request-gate.ts satisfies a Record keyed by every non-chess
  // GameSpecId, so a new union member fails the build until it gets a gate
  // entry. This runtime loop stays as belt-and-braces against a spec landing
  // in CHESS_STACK_SPEC_IDS while a tenant still owns its routing.
  const tenants = registeredVariantTenants().filter((tenant) => tenant.ownsSpecRouting);
  assert.ok(tenants.length > 0, 'expected registered tenants; did register-tenants.ts load?');
  for (const tenant of tenants) {
    for (const input of [{ gameSpecId: tenant.gameSpecId }, { variant: tenant.gameSpecId }]) {
      assert.equal(
        gateGameSpecRequest(input).type,
        'reject',
        `${tenant.gameSpecId}: gate passed ${JSON.stringify(input)}; a registry miss would fall open into the chess stack (check the spec's entry in GATED_GAME_SPECS in game-spec-request-gate.ts)`,
      );
    }
  }
});

function withFlag(name: string, enabled: boolean, fn: () => void): void {
  const before = process.env[name];
  if (enabled) process.env[name] = 'true';
  else delete process.env[name];
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}
