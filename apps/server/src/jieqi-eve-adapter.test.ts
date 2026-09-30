import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JIEQI_DEFAULT_ENGINE_ID,
  JIEQI_RANDOM_ENGINE_ID,
  jieqiEngineTierFor,
} from './jieqi-engine.js';
import { jieqiEveAdapter } from './jieqi-eve-adapter.js';
import { playVariantEngineGame, type VariantEveMoveRequest } from './variant-eve.js';

const PAIRED = { kind: 'random_deal', seed: '12345' };

test('jieqi: plays a kernel-validated engine game on a dealt board', async () => {
  const requests: VariantEveMoveRequest<unknown>[] = [];
  const result = await playVariantEngineGame(jieqiEveAdapter, {
    roomId: 'jq_eve_test',
    firstEngineId: 'pikafish-jieqi-level-1',
    secondEngineId: JIEQI_DEFAULT_ENGINE_ID,
    maxPlies: 6,
    openingPolicy: PAIRED,
    moveProvider: async (request) => {
      requests.push(request);
      return jieqiEveAdapter.moveToUci(request.legalMoves[0]!);
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.plyCount, 6);
  const created = result.events[0]!;
  assert.equal(created.type, 'room-created');
  assert.ok(created.type === 'room-created' && created.setup, 'the deal is on room-created');
  assert.deepEqual(
    requests.map((r) => r.color),
    ['red', 'black', 'red', 'black', 'red', 'black'],
  );
  // The engine gets the event log, room-created (with the deal) first.
  assert.equal((requests[0]!.events[0] as { type: string }).type, 'room-created');
});

test('jieqi: a paired seed deals the same board to both colour orders', async () => {
  const play = (first: string, second: string) =>
    playVariantEngineGame(jieqiEveAdapter, {
      roomId: 'jq_eve_pair',
      firstEngineId: first,
      secondEngineId: second,
      maxPlies: 0,
      openingPolicy: PAIRED,
    });
  const a = await play('pikafish-jieqi-level-2', 'pikafish-jieqi-level-5');
  const b = await play('pikafish-jieqi-level-5', 'pikafish-jieqi-level-2');
  const setupOf = (events: readonly { type: string }[]) => (events[0] as { setup?: unknown }).setup;
  assert.deepEqual(setupOf(a.events), setupOf(b.events));
  const c = await playVariantEngineGame(jieqiEveAdapter, {
    roomId: 'jq_eve_other',
    firstEngineId: 'pikafish-jieqi-level-2',
    secondEngineId: 'pikafish-jieqi-level-5',
    maxPlies: 0,
    openingPolicy: { kind: 'random_deal', seed: '67890' },
  });
  assert.notDeepEqual(setupOf(a.events), setupOf(c.events));
});

test('jieqi: the random floor plays; retired tiers and the floor are not rated rungs', async () => {
  const result = await playVariantEngineGame(jieqiEveAdapter, {
    roomId: 'jq_eve_random',
    firstEngineId: JIEQI_RANDOM_ENGINE_ID,
    secondEngineId: 'pikafish-jieqi-level-1',
    maxPlies: 2,
    openingPolicy: PAIRED,
    rng: () => 0.5,
    moveProvider: async ({ legalMoves }) => jieqiEveAdapter.moveToUci(legalMoves[0]!),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.plyCount, 2);
  assert.equal(jieqiEngineTierFor(JIEQI_RANDOM_ENGINE_ID), null);
  assert.equal(jieqiEveAdapter.tierFor('pikafish-jieqi-amateur'), null);
  assert.ok(jieqiEveAdapter.tierFor('pikafish-jieqi-level-4'));
});
