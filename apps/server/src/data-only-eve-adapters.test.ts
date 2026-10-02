// The banqi and jungle EvE adapters (#488): scheduled data games, never rated.
// The game loop runs on a seeded stub engine (a random legal move), so these are
// fast and deterministic; the last two tests ask the real binaries for one move
// each, and skip when the binary is not on this box.

import assert from 'node:assert/strict';
import test from 'node:test';
import './variant-tenant/register-tenants.js';
import { banqiEngineBinaryAvailable } from './banqi-engine.js';
import { banqiEveAdapter, banqiEveEngineWindow } from './banqi-eve-adapter.js';
import type { BanqiEvent } from './banqi-runtime.js';
import { seededUnitRng } from './jieqi-eve-adapter.js';
import { jungleEngineBinaryAvailable } from './jungle-engine.js';
import { jungleEveAdapter, jungleEveStates } from './jungle-eve-adapter.js';
import { type AnyVariantEveAdapter, playVariantEngineGame } from './variant-eve.js';
import { variantTenantForRoomId } from './variant-tenant/registry.js';

// A random legal move from a seeded stream, through the adapter's UCI round trip.
function stubEngine(adapter: AnyVariantEveAdapter, seed: bigint) {
  const rng = seededUnitRng(seed);
  return async (request: { legalMoves: readonly unknown[] }) =>
    adapter.moveToUci(request.legalMoves[Math.floor(rng() * request.legalMoves.length)]);
}

async function playStub(
  adapter: AnyVariantEveAdapter,
  roomId: string,
  first: string,
  second: string,
  seed: string,
) {
  return playVariantEngineGame(adapter, {
    roomId,
    firstEngineId: first,
    secondEngineId: second,
    maxPlies: 3000,
    openingPolicy: { kind: 'standard', seed },
    moveProvider: stubEngine(adapter, BigInt(seed)),
  });
}

const setupOf = (events: readonly unknown[]) => (events[0] as { setup?: unknown }).setup;

test('banqi: MistyBanqi plays itself on a fresh deal per seed, to a finished, exportable game', async () => {
  const a = await playStub(banqiEveAdapter, 'bq_eve_a', 'misty-banqi', 'misty-banqi', '101');
  assert.equal(a.status, 'completed');
  assert.notEqual(a.termination, 'truncated');
  assert.ok(setupOf(a.events), 'the deal is on room-created');
  // A different seed is a different deal; the same seed, the same deal.
  const b = await playStub(banqiEveAdapter, 'bq_eve_b', 'misty-banqi', 'misty-banqi', '202');
  assert.notDeepEqual(setupOf(a.events), setupOf(b.events));
  const again = await playVariantEngineGame(banqiEveAdapter, {
    roomId: 'bq_eve_c',
    firstEngineId: 'misty-banqi',
    secondEngineId: 'misty-banqi',
    maxPlies: 0,
    openingPolicy: { kind: 'standard', seed: '101' },
  });
  assert.deepEqual(setupOf(again.events), setupOf(a.events));
  // The tenant's own export accepts the log and names the whole deal (#484).
  const exported = variantTenantForRoomId('bq_eve_a')?.export?.finishedGame(a.events, 'bq_eve_a');
  assert.ok(exported, 'a finished banqi EvE log exports');
  assert.ok(exported.dealFen && !exported.dealFen.includes('?'));
  // Only the offered bot: the retired tier ids are not something to schedule.
  assert.ok(banqiEveAdapter.tierFor('misty-banqi'));
  assert.equal(banqiEveAdapter.tierFor('misty-banqi-strong'), null);
});

test('banqi: the engine sees the no-progress window, as the live loop builds it', async () => {
  const game = await playStub(banqiEveAdapter, 'bq_eve_w', 'misty-banqi', 'misty-banqi', '303');
  const events = game.events as readonly BanqiEvent[];
  const window = banqiEveEngineWindow(events.slice(0, 31));
  assert.match(window.fen, /\S+ [wbrn-]/);
  for (const uci of window.moves) assert.match(uci, /^[a-h][0-3][a-h][0-3]$/);
});

test('jungle: pairs its tiers on the Rust ladder, and the game exports', async () => {
  const game = await playStub(
    jungleEveAdapter,
    'jgl_eve_a',
    'misty-jungle-level-1',
    'misty-jungle-level-2',
    '404',
  );
  assert.equal(game.status, 'completed');
  assert.notEqual(game.termination, 'truncated');
  const exported = variantTenantForRoomId('jgl_eve_a')?.export?.finishedGame(
    game.events,
    'jgl_eve_a',
  );
  assert.ok(exported, 'a finished jungle EvE log exports');
  // Every Rust tier is playable; an unknown id is not.
  for (const id of ['misty-jungle-level-1', 'misty-jungle-level-2', 'misty-jungle-level-3']) {
    assert.ok(jungleEveAdapter.tierFor(id), id);
  }
  assert.equal(jungleEveAdapter.tierFor('misty-jungle-flip'), null);
  // The repetition seeds start from the real start and grow by one per ply.
  const states = jungleEveStates(game.events.slice(0, 12) as never);
  assert.equal(states.length, 12 - 2);
});

test('banqi: the real MistyBanqi binary answers a legal move', {
  skip: banqiEngineBinaryAvailable() ? false : 'banqi-engine binary not on this box',
}, async () => {
  const start = await playVariantEngineGame(banqiEveAdapter, {
    roomId: 'bq_eve_bin',
    firstEngineId: 'misty-banqi',
    secondEngineId: 'misty-banqi',
    maxPlies: 0,
    openingPolicy: { kind: 'standard', seed: '505' },
  });
  const { best } = await banqiEveAdapter.search(
    'misty-banqi',
    [],
    { movetimeMs: 300 },
    {
      events: start.events,
      color: 'red',
    },
  );
  assert.ok(best);
  const state = (await import('./variant-tenant/runtime.js')).replayTenantEvents(
    banqiEveAdapter.tenant,
    start.events,
  ).state;
  assert.ok(banqiEveAdapter.legalMoveForUci(banqiEveAdapter.legalMoves(state), best), best);
});

test('jungle: the real MistyJungle binary answers a legal move', {
  skip: jungleEngineBinaryAvailable() ? false : 'jungle-engine binary not on this box',
}, async () => {
  const start = await playVariantEngineGame(jungleEveAdapter, {
    roomId: 'jgl_eve_bin',
    firstEngineId: 'misty-jungle-level-1',
    secondEngineId: 'misty-jungle-level-1',
    maxPlies: 0,
  });
  const { best } = await jungleEveAdapter.search(
    'misty-jungle-level-1',
    [],
    { movetimeMs: 300 },
    {
      events: start.events,
      color: 'red',
    },
  );
  assert.ok(best);
  const state = (await import('./variant-tenant/runtime.js')).replayTenantEvents(
    jungleEveAdapter.tenant,
    start.events,
  ).state;
  assert.ok(jungleEveAdapter.legalMoveForUci(jungleEveAdapter.legalMoves(state), best), best);
});
