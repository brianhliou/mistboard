// Conformance: every variant that offers a bot ladder can be rated.
//
// The fortress and duck ladders shipped with tiers nobody had measured because
// the EvE runner only knew standard xiangqi. This test makes that impossible to
// repeat: a first-party bot profile that maps a variant to an engine, or a
// registry entry that names a Fairy-Stockfish rung for a variant, fails the
// build until variant-eve-registry.ts has an adapter for that variant.

import assert from 'node:assert/strict';
import test from 'node:test';
import { knownEngineIds, loadEngine } from './engine-registry.js';
import { FIRST_PARTY_BOT_PROFILES } from './first-party-bots.js';
import { EVE_VARIANT_IDS, eveAdapterFor, eveRoomId } from './variant-eve-registry.js';

// Bots whose engines are not UCI ladders the EvE runner plays (the python-worker
// dark-chess engines, the Misty variant engines). Each needs its own reason.
const NOT_EVE_RATED_VARIANTS: ReadonlyMap<string, string> = new Map([
  ['dark-chess', 'python-worker engine; rated by the dark-chess EvE runner, not a tenant adapter'],
  ['dark-xiangqi', 'Misty DXQ, engine-service; no UCI ladder to round-robin'],
  ['jieqi', 'single pikafish-jieqi ladder without a Skill Level knob; no calibration run yet'],
  ['banqi', 'one node-budgeted bot, nothing to rank it against'],
  ['jungle', 'in-process Misty jungle levels; no UCI ladder'],
  ['jungle-flip', 'one node-budgeted bot, nothing to rank it against'],
]);

test('every first-party bot variant has an EvE adapter or a stated reason not to', () => {
  const missing: string[] = [];
  for (const profile of FIRST_PARTY_BOT_PROFILES) {
    for (const variant of Object.keys(profile.engines)) {
      if (eveAdapterFor(variant)) continue;
      if (NOT_EVE_RATED_VARIANTS.has(variant)) continue;
      missing.push(`${profile.id} -> ${variant}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    'these bot variants cannot be rated: add a VariantEveAdapter to variant-eve-registry.ts ' +
      'or a reason to NOT_EVE_RATED_VARIANTS',
  );
});

test('every Fairy-Stockfish registry rung belongs to a variant with an adapter that knows it', () => {
  const orphans: string[] = [];
  for (const engineId of knownEngineIds()) {
    const engine = loadEngine(engineId);
    if (engine.config.kind !== 'fairy-stockfish') continue;
    const adapter = eveAdapterFor(engine.gameSpecId);
    if (!adapter || adapter.tierFor(engineId) === null) orphans.push(engineId);
  }
  assert.deepEqual(orphans, []);
});

test('every adapter ladder and random floor is in the engine registry', () => {
  // The tournament enqueue resolves engines through loadEngine, so a rung the
  // registry does not know cannot be queued even if the adapter plays it.
  const known = new Set<string>(knownEngineIds());
  for (const variant of EVE_VARIANT_IDS) {
    const adapter = eveAdapterFor(variant)!;
    if (adapter.randomEngineId) {
      assert.ok(known.has(adapter.randomEngineId), `${adapter.randomEngineId} not registered`);
      assert.equal(loadEngine(adapter.randomEngineId).gameSpecId, variant);
    }
  }
  for (const engineId of knownEngineIds()) {
    const engine = loadEngine(engineId);
    if (engine.config.kind !== 'fairy-stockfish') continue;
    assert.ok(engine.gameSpecId, `${engineId} has no gameSpecId`);
  }
});

test('EvE room ids sit under the tenant prefix', () => {
  assert.equal(eveRoomId(eveAdapterFor('xiangqi')!, 'task1'), 'xq_eve_task1');
  assert.equal(eveRoomId(eveAdapterFor('fortress-xiangqi')!, 'task1'), 'fxq_eve_task1');
  assert.equal(eveRoomId(eveAdapterFor('duck-xiangqi')!, 'task1'), 'dkx_eve_task1');
  assert.equal(eveAdapterFor('crossroads-chess'), null);
});
