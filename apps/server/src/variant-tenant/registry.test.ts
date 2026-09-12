import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRetiredGameSpec } from '@mistboard/game';
// Importing register-tenants registers every tenant (module-scope side effect
// of each *-registration.ts module — the "one registry entry" of the tenant
// contract).
import './register-tenants.js';
import {
  registeredVariantTenants,
  registerVariantTenant,
  variantTenantForRoomId,
  variantTenantForSpecId,
} from './registry.js';

test('registry: retired specs never register', () => {
  // registerVariantTenant drops a retired spec on the floor, so no route,
  // prefix or watch channel exists for one even if a registration module
  // still runs at boot.
  for (const entry of registeredVariantTenants()) {
    assert.equal(isRetiredGameSpec(entry.gameSpecId), false, entry.kind);
  }
});

test('registry: Dark Xiangqi registration resolves by room id prefix and spec id', () => {
  assert.equal(variantTenantForRoomId('dxq_some-room')?.kind, 'dark-xiangqi');
  assert.equal(variantTenantForSpecId('dark-xiangqi')?.roomIdPrefix, 'dxq_');
});

test('registry: misses fall through to null (chess fallback stays untouched)', () => {
  assert.equal(variantTenantForRoomId('room_chess-id'), null);
  assert.equal(variantTenantForSpecId('dark-chess'), null);
});

test('registry: every product-profile variant tenant exposes a lobby (Find opponent matchmaking)', () => {
  // The homepage Find-opponent picker offers every product-profile variant, and
  // POST /api/lobby resolves the tenant via variantTenantForSpecId. A tenant with
  // lobby=null answers `${errorPrefix}_not_integrated` (501), which the client
  // surfaces as "Could not join the lobby." dark-chess is the chess-fallback
  // registry MISS (variantTenantForSpecId=null) and matchmakes through the shared
  // room factory, so it is exempt here. This is the guard that a NEW product
  // variant cannot ship into the picker without a matchmaking surface.
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const profile = JSON.parse(
    readFileSync(resolve(repoRoot, 'config/product-profile.json'), 'utf8'),
  ) as { gameSpecIds: string[] };
  const missing = profile.gameSpecIds.filter((gameSpecId) => {
    const registration = variantTenantForSpecId(gameSpecId);
    return registration !== null && registration.lobby === null;
  });
  assert.deepEqual(
    missing,
    [],
    `product variants offered in Find opponent but missing a server lobby (add a lobby to their *-registration.ts): ${missing.join(', ')}`,
  );
});

test('registry: re-registration is idempotent for the same kind, throws across kinds', () => {
  const dxq = registeredVariantTenants().find((entry) => entry.kind === 'dark-xiangqi');
  assert.ok(dxq);
  const before = registeredVariantTenants().length;
  registerVariantTenant(dxq);
  assert.equal(registeredVariantTenants().length, before);
  assert.throws(() => registerVariantTenant({ ...dxq, kind: 'other-variant' }), /prefix collision/);
});
