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
import { eveGameVisibility, eveTermination } from './engine-runner.js';
import { FIRST_PARTY_BOT_PROFILES } from './first-party-bots.js';
import {
  EVE_VARIANT_IDS,
  eveAdapterFor,
  eveRoomId,
  eveWorkerCapabilities,
} from './variant-eve-registry.js';

// Bots whose engines are not UCI ladders the EvE runner plays (the python-worker
// dark-chess engines, the Misty variant engines). Each needs its own reason.
const NOT_EVE_RATED_VARIANTS: ReadonlyMap<string, string> = new Map([
  ['dark-chess', 'python-worker engine; rated by the dark-chess EvE runner, not a tenant adapter'],
  ['dark-xiangqi', 'Misty DXQ, engine-service; no UCI ladder to round-robin'],
  ['jungle-flip', 'one node-budgeted bot, nothing to rank it against'],
]);

// Variants with an adapter that plays scheduled data games (#488) but that is
// NOT ladder-rated: no random floor, so no anchor, so no job of theirs can carry
// a rating_policy and nothing reaches the Elo report. Each needs its reason.
const EVE_DATA_ONLY_VARIANTS: ReadonlyMap<string, string> = new Map([
  ['banqi', 'one node-budgeted bot that plays itself; nothing to rank it against'],
  ['jungle', 'one offered bot (level 2) and two retired levels; never ladder-rated'],
]);

test('data-only adapters have no random floor, so nothing can rate them', () => {
  for (const variant of EVE_VARIANT_IDS) {
    const adapter = eveAdapterFor(variant)!;
    if (EVE_DATA_ONLY_VARIANTS.has(variant)) {
      assert.equal(adapter.randomEngineId, undefined, `${variant} must not have a rating anchor`);
    } else {
      assert.ok(adapter.randomEngineId, `${variant}: a rated adapter needs its random floor`);
    }
  }
  for (const variant of EVE_DATA_ONLY_VARIANTS.keys()) {
    assert.ok(eveAdapterFor(variant), `${variant} is listed data-only but has no adapter`);
  }
});

test('binary-backed adapters ask workers for their engine, and the worker probes it', () => {
  assert.equal(eveAdapterFor('banqi')?.requiredCapability, 'banqi_engine');
  assert.equal(eveAdapterFor('jungle')?.requiredCapability, 'jungle_engine');
  const capabilities = eveWorkerCapabilities();
  assert.deepEqual(Object.keys(capabilities).sort(), ['banqi_engine', 'jungle_engine']);
  for (const value of Object.values(capabilities)) assert.equal(typeof value, 'boolean');
  // A missing binary is false, never an error: point both resolvers at nothing.
  const saved = {
    banqi: process.env.MISTBOARD_BANQI_ENGINE_PATH,
    jungle: process.env.MISTBOARD_JUNGLE_ENGINE_PATH,
  };
  process.env.MISTBOARD_BANQI_ENGINE_PATH = '/nonexistent/banqi-engine';
  process.env.MISTBOARD_JUNGLE_ENGINE_PATH = '/nonexistent/jungle-engine';
  try {
    assert.deepEqual(eveWorkerCapabilities(), { banqi_engine: false, jungle_engine: false });
  } finally {
    for (const [key, value] of [
      ['MISTBOARD_BANQI_ENGINE_PATH', saved.banqi],
      ['MISTBOARD_JUNGLE_ENGINE_PATH', saved.jungle],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

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
    `these bot variants cannot be rated: ${missing.join(', ')}. Add a VariantEveAdapter to ` +
      'apps/server/src/variant-eve-registry.ts, or a reason to NOT_EVE_RATED_VARIANTS in ' +
      'variant-eve-registry.test.ts',
  );
});

test('NOT_EVE_RATED_VARIANTS excuses only bot variants that still lack an adapter', () => {
  // An excuse left behind after its variant gained an adapter, or lost its
  // bot, reads as a live decision and would quietly excuse the next rename.
  const botVariants = new Set(
    FIRST_PARTY_BOT_PROFILES.flatMap((profile) => Object.keys(profile.engines)),
  );
  const stale = [...NOT_EVE_RATED_VARIANTS.keys()].filter(
    (variant) => eveAdapterFor(variant) !== null || !botVariants.has(variant),
  );
  assert.deepEqual(
    stale,
    [],
    `stale NOT_EVE_RATED_VARIANTS entries: ${stale.join(', ')}. Delete them from ` +
      'variant-eve-registry.test.ts (the variant has an adapter now, or no first-party bot).',
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

test('EvE rows store terminations the games table accepts, and only a public ask is public', () => {
  // jieqi's kernel ends a game on 'no-capture-clock'; the column's allowlist
  // spells it 'progress-clock' (games_termination_check), as a live room stores it.
  const jieqi = eveAdapterFor('jieqi')!;
  assert.equal(eveTermination(jieqi, 'no-capture-clock'), 'progress-clock');
  assert.equal(eveTermination(jieqi, 'checkmate'), 'checkmate');
  assert.equal(eveTermination(jieqi, 'truncated'), 'truncated');
  assert.equal(eveTermination(eveAdapterFor('xiangqi')!, 'checkmate'), 'checkmate');

  assert.equal(eveGameVisibility({ visibility: 'public' }), 'public');
  assert.equal(eveGameVisibility({}), 'link');
  assert.equal(eveGameVisibility({ visibility: 'unlisted' }), 'link');
  assert.equal(eveGameVisibility({ visibility: 'PUBLIC' }), 'link');
});
