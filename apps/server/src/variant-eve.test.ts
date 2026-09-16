import assert from 'node:assert/strict';
import test from 'node:test';
import { duckXiangqiEveAdapter } from './duck-xiangqi-eve-adapter.js';
import {
  DUCK_XIANGQI_RANDOM_ENGINE_ID,
  duckXiangqiEngineTierFor,
} from './duck-xiangqi-fsf-engine.js';
import { fortressXiangqiEveAdapter } from './fortress-xiangqi-eve-adapter.js';
import {
  FORTRESS_XIANGQI_RANDOM_ENGINE_ID,
  fortressXiangqiEngineTierFor,
} from './fortress-xiangqi-fsf-engine.js';
import { playVariantEngineGame, type VariantEveMoveRequest } from './variant-eve.js';

// The adapters wire real kernels and real tenants; only the engine call is
// scripted here, so a game exercises replay, legal-move generation, the UCI
// round-trip and the live-path selection rules end to end.

test('fortress: plays a kernel-validated engine game to its ply cap', async () => {
  const seen: Array<{ engineId: string; historyLength: number }> = [];
  const result = await playVariantEngineGame(fortressXiangqiEveAdapter, {
    roomId: 'fxq_eve_test',
    firstEngineId: 'fairy-stockfish-fortress-xiangqi-level-1',
    secondEngineId: 'fairy-stockfish-fortress-xiangqi-level-2',
    maxPlies: 4,
    startedAt: 1_000,
    moveProvider: async ({ engineId, history, legalMoves }) => {
      seen.push({ engineId, historyLength: history.length });
      return fortressXiangqiEveAdapter.moveToUci(legalMoves[0]!);
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.result, 'draw');
  assert.equal(result.termination, 'truncated');
  assert.equal(result.plyCount, 4);
  assert.deepEqual(seen, [
    { engineId: 'fairy-stockfish-fortress-xiangqi-level-1', historyLength: 0 },
    { engineId: 'fairy-stockfish-fortress-xiangqi-level-2', historyLength: 1 },
    { engineId: 'fairy-stockfish-fortress-xiangqi-level-1', historyLength: 2 },
    { engineId: 'fairy-stockfish-fortress-xiangqi-level-2', historyLength: 3 },
  ]);
  const first = result.events[0]!;
  assert.equal(first.type, 'room-created');
  assert.equal(first.type === 'room-created' && first.gameSpecId, 'fortress-xiangqi');
});

test('fortress: the random floor plays without touching the engine', async () => {
  let engineCalls = 0;
  const result = await playVariantEngineGame(fortressXiangqiEveAdapter, {
    roomId: 'fxq_eve_random',
    firstEngineId: FORTRESS_XIANGQI_RANDOM_ENGINE_ID,
    secondEngineId: FORTRESS_XIANGQI_RANDOM_ENGINE_ID,
    maxPlies: 6,
    rng: () => 0.5,
    moveProvider: async () => {
      engineCalls += 1;
      return null;
    },
  });
  assert.equal(engineCalls, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.plyCount, 6);
});

test('fortress: fails closed on a non-kernel-legal reply', async () => {
  const result = await playVariantEngineGame(fortressXiangqiEveAdapter, {
    roomId: 'fxq_eve_bad',
    firstEngineId: 'fairy-stockfish-fortress-xiangqi-level-1',
    secondEngineId: 'fairy-stockfish-fortress-xiangqi-level-1',
    maxPlies: 4,
    moveProvider: async () => 'a1a1',
  });
  assert.equal(result.status, 'aborted');
  assert.equal(result.termination, 'engine-failure');
  assert.equal(result.plyCount, 0);
});

test('fortress: paired opening seeds give both colour orders the same prefix', async () => {
  const play = (firstEngineId: string, secondEngineId: string) =>
    playVariantEngineGame(fortressXiangqiEveAdapter, {
      roomId: `fxq_eve_${firstEngineId}`,
      firstEngineId,
      secondEngineId,
      maxPlies: 6,
      openingPolicy: { kind: 'random_first_n_plies', n: 6, seed: '20260915' },
      moveProvider: async () => {
        throw new Error('the engine must not be called inside the forced opening');
      },
    });
  const [a, b] = await Promise.all([
    play('fairy-stockfish-fortress-xiangqi-level-1', 'fairy-stockfish-fortress-xiangqi-level-3'),
    play('fairy-stockfish-fortress-xiangqi-level-3', 'fairy-stockfish-fortress-xiangqi-level-1'),
  ]);
  const uci = (result: Awaited<ReturnType<typeof play>>) =>
    result.events
      .filter((event) => event.type === 'move-played')
      .map((event) =>
        event.type === 'move-played' ? fortressXiangqiEveAdapter.moveToUci(event.move) : '',
      );
  assert.equal(uci(a).length, 6);
  assert.deepEqual(uci(a), uci(b));
});

test('fortress: rejects an engine from another ladder', async () => {
  await assert.rejects(
    playVariantEngineGame(fortressXiangqiEveAdapter, {
      roomId: 'fxq_eve_foreign',
      firstEngineId: 'fairy-stockfish-xiangqi-level-4',
      secondEngineId: 'fairy-stockfish-fortress-xiangqi-level-4',
      maxPlies: 2,
      moveProvider: async () => null,
    }),
    /not a fortress-xiangqi engine profile/,
  );
});

test('duck: plays a kernel-validated engine game with turn-shaped UCI', async () => {
  const requests: VariantEveMoveRequest<unknown>[] = [];
  const result = await playVariantEngineGame(duckXiangqiEveAdapter, {
    roomId: 'dkx_eve_test',
    firstEngineId: 'fairy-stockfish-duck-xiangqi-level-1',
    secondEngineId: 'fairy-stockfish-duck-xiangqi-level-2',
    maxPlies: 2,
    moveProvider: async (request) => {
      requests.push(request);
      return duckXiangqiEveAdapter.moveToUci(request.legalMoves[0]!);
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.plyCount, 2);
  // Every ordinary duck turn is `<piece>,<duck>`; the history the engine sees
  // is the same dialect the live loop sends (server-duck-xiangqi-engine.ts).
  assert.equal(requests[1]!.history.length, 1);
  assert.match(requests[1]!.history[0]!, /^[a-i]\d[a-i]\d,[a-i]\d[a-i]\d$/);
  assert.ok(requests.every((request) => request.legalMoves.length > 100));
});

test('duck: the random floor is playable', async () => {
  const result = await playVariantEngineGame(duckXiangqiEveAdapter, {
    roomId: 'dkx_eve_random',
    firstEngineId: DUCK_XIANGQI_RANDOM_ENGINE_ID,
    secondEngineId: 'fairy-stockfish-duck-xiangqi-level-1',
    maxPlies: 2,
    rng: () => 0.25,
    moveProvider: async ({ legalMoves }) => duckXiangqiEveAdapter.moveToUci(legalMoves[0]!),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.plyCount, 2);
});

test('the random floors resolve nowhere in the playable tier tables', () => {
  assert.equal(fortressXiangqiEngineTierFor(FORTRESS_XIANGQI_RANDOM_ENGINE_ID), null);
  assert.equal(duckXiangqiEngineTierFor(DUCK_XIANGQI_RANDOM_ENGINE_ID), null);
});
