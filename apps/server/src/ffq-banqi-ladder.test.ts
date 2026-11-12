import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createFFQBanqiSetup, ffqBanqiSeatToMove, getFFQBanqiLegalMoves } from '@mistboard/game';
import { knownEngineIds, loadEngine } from './engine-registry.js';
import * as engine from './ffq-banqi-engine.js';
import { ffqBanqiEveAdapter } from './ffq-banqi-eve-adapter.js';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { seededUnitRng } from './jieqi-eve-adapter.js';
import * as live from './server-ffq-banqi-engine.js';
import { playVariantEngineGame } from './variant-eve.js';
import { eveAdapterFor } from './variant-eve-registry.js';
import { applyTenantEvent, createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';

const L1 = 'misty-ffq-banqi-level-1';
const L2 = 'misty-ffq-banqi-level-2';
const REAL_ENGINE = process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH;
function roomFor(engineId = L2) {
  const events: FFQBanqiEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'ffq_ladder',
      gameSpecId: 'ffq-banqi',
      setup: createFFQBanqiSetup(seededUnitRng(809n)),
    },
    { type: 'seat-assigned', at: 2, roomId: 'ffq_ladder', clientId: engineId, seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: 'ffq_ladder', clientId: 'human', seat: 'black' },
  ];
  const created = createTenantRuntimeRoomFromEvents(ffqBanqiTenant, events);
  assert.ok(created.ok);
  return created.room as live.FFQBanqiEngineRoom;
}
function contextFor(room: live.FFQBanqiEngineRoom) {
  return {
    appendEvent: async (_room: live.FFQBanqiEngineRoom, event: FFQBanqiEvent) => {
      room.projection = applyTenantEvent(ffqBanqiTenant, room.projection, event);
      room.events.push(event);
      return room.events.length;
    },
    broadcastEventAppended: () => {},
  } as unknown as Parameters<typeof live.playFFQBanqiEngineMoveIfReady>[0];
}

test('FFQ provisional tiers are registered and rateable; unknown IDs fail closed', () => {
  assert.deepEqual(
    engine.FFQ_BANQI_PLAYABLE_ENGINES.map((t) => [t.level, t.nodes, t.movetimeCapMs]),
    [
      [1, 0, 3000],
      [2, 128, 3000],
      [3, 512, 3000],
      [4, 2000, 3000],
      [5, 5000, 3000],
      [6, 10000, 3000],
      [7, 25000, 3000],
      [8, 50000, 3000],
    ],
  );
  assert.equal(eveAdapterFor('ffq-banqi'), ffqBanqiEveAdapter);
  assert.equal(ffqBanqiEveAdapter.randomEngineId, L1);
  for (const tier of engine.FFQ_BANQI_PLAYABLE_ENGINES) {
    assert.ok(knownEngineIds().includes(tier.id));
    assert.equal(loadEngine(tier.id).gameSpecId, 'ffq-banqi');
    assert.ok(ffqBanqiEveAdapter.tierFor(tier.id));
    assert.equal(engine.ffqBanqiEngineVersion(tier.id), '0.1.0');
  }
  assert.equal(engine.ffqBanqiEngineTierFor('misty-three-kingdoms-banqi-level-4'), null);
  assert.equal(ffqBanqiEveAdapter.tierFor('unknown'), null);
  assert.equal(engine.ffqBanqiEngineAvailable('unknown'), false);
});

test('FFQ UCI mapping uses four files and zero-based ranks, including every flip', () => {
  for (let from = 0; from < 32; from++)
    for (let to = 0; to < 32; to++) {
      const move = { from, to };
      assert.deepEqual(engine.uciToFFQBanqiMove(engine.ffqBanqiMoveToUci(move)), move);
    }
  assert.equal(engine.ffqBanqiMoveToUci({ from: 6, to: 6 }), 'c1c1');
  for (const invalid of ['a1e1', 'a0a8', 'a0a0extra', '(none)'])
    assert.equal(engine.uciToFFQBanqiMove(invalid), null);
});

test('FFQ binary resolution rejects missing, non-executable, directory and unknown paths; L1 needs no binary', async () => {
  const dir = mkdtempSync('/tmp/ffq-availability-');
  const saved = process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH;
  try {
    const file = join(dir, 'not-executable');
    writeFileSync(file, 'fixture');
    chmodSync(file, 0o600);
    for (const path of [join(dir, 'missing'), dir, file]) {
      process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH = path;
      assert.equal(engine.ffqBanqiEnginePath(), null);
      assert.equal(engine.ffqBanqiEngineAvailable(L2), false);
      assert.equal(ffqBanqiEveAdapter.available?.(), false);
      assert.equal(engine.ffqBanqiEngineAvailable(L1), true);
    }
    const room = roomFor(L1);
    await live.playFFQBanqiEngineMoveIfReady(
      contextFor(room),
      room,
      async () => assert.fail('L1 spawned a process'),
      () => 0,
    );
    assert.equal(room.projection.state.ply, 1);
    await assert.rejects(
      engine.ffqBanqiLiveEngineMove(
        live.ffqBanqiTierRequestFor(roomFor().projection.state, L2, 50),
      ),
      /FFQ banqi engine unavailable/,
    );
    const failed = roomFor();
    await live.playFFQBanqiEngineMoveIfReady(contextFor(failed), failed);
    assert.deepEqual(failed.projection.state.status, {
      type: 'finished',
      winner: 'black',
      reason: 'resignation',
    });
  } finally {
    if (saved === undefined) delete process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH;
    else process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FFQ rejects illegal/correlation-mismatched responses and discards stale searches', async () => {
  for (const wrongId of [false, true]) {
    const room = roomFor();
    let calls = 0;
    await live.playFFQBanqiEngineMoveIfReady(contextFor(room), room, async (request) => {
      calls++;
      return {
        protocolVersion: '1',
        gameId: wrongId ? 'other-game' : request.gameId,
        sessionId: request.sessionId,
        move: wrongId ? request.legalMoves[0]! : { from: 99, to: 99 },
      };
    });
    assert.equal(calls, 2);
    assert.equal(room.projection.state.status.type, 'finished');
  }
  const room = roomFor();
  const ctx = contextFor(room);
  await live.playFFQBanqiEngineMoveIfReady(ctx, room, async (request) => {
    await ctx.appendEvent(room, { type: 'seat-resigned', at: 10, roomId: room.id, color: 'black' });
    return {
      protocolVersion: '1',
      gameId: request.gameId,
      sessionId: request.sessionId,
      move: request.legalMoves[0]!,
    };
  });
  assert.equal(room.projection.state.ply, 0);
  assert.equal(room.events.at(-1)?.type, 'seat-resigned');
});

test('FFQ all native search levels answer legal moves through EngineTurnRequest/Response', {
  skip: !REAL_ENGINE,
}, async () => {
  for (const tier of engine.FFQ_BANQI_PLAYABLE_ENGINES.slice(1)) {
    const room = roomFor(tier.id);
    const request = live.ffqBanqiTierRequestFor(room.projection.state, tier.id, 500);
    assert.deepEqual(engine.buildFFQBanqiEngineCommands(request), [
      'uci',
      'ucinewgame',
      'isready',
      `position fen ${request.position.fen}`,
      `go nodes ${tier.nodes} movetime 500`,
    ]);
    const response = await engine.ffqBanqiLiveEngineMove(request);
    assert.equal(response.gameId, request.gameId);
    assert.ok(
      request.legalMoves.some((m) => m.from === response.move.from && m.to === response.move.to),
    );
  }
});

test('FFQ full PvE game uses live lifecycle and real binary until a kernel ending', {
  skip: !REAL_ENGINE,
  timeout: 120000,
}, async (t) => {
  const room = roomFor('misty-ffq-banqi-level-4');
  const ctx = contextFor(room);
  const rng = seededUnitRng(123n);
  let botMoves = 0;
  while (room.projection.state.status.type === 'playing' && room.projection.state.ply < 1000) {
    const before = room.projection.state;
    if (ffqBanqiSeatToMove(before) === 'red') {
      await live.playFFQBanqiEngineMoveIfReady(ctx, room);
      botMoves++;
      assert.equal(
        room.projection.state.ply,
        before.ply + 1,
        'bot must play, not resign on engine failure',
      );
    } else {
      const legal = getFFQBanqiLegalMoves(before);
      const move = legal[Math.floor(rng() * legal.length)]!;
      await ctx.appendEvent(room, {
        type: 'move-played',
        at: Date.now(),
        roomId: room.id,
        color: 'black',
        move,
      });
    }
  }
  const state = room.projection.state;
  assert.equal(state.status.type, 'finished');
  assert.ok(
    state.status.type === 'finished' &&
      ['hp', 'no-progress', 'no-legal-move'].includes(state.status.reason),
  );
  t.diagnostic(JSON.stringify({ ply: state.ply, botMoves, hp: state.hp, status: state.status }));
});

test('FFQ EvE native ladder completes a rateable game through the shared adapter', {
  skip: !REAL_ENGINE,
  timeout: 120000,
}, async (t) => {
  const result = await playVariantEngineGame(ffqBanqiEveAdapter, {
    roomId: 'ffq_eve_809',
    firstEngineId: 'misty-ffq-banqi-level-4',
    secondEngineId: L1,
    maxPlies: 1000,
    openingPolicy: { seed: '809' },
    rng: seededUnitRng(123n),
  });
  assert.equal(result.status, 'completed');
  assert.ok(['hp', 'no-progress', 'no-legal-move'].includes(result.termination));
  t.diagnostic(
    JSON.stringify({
      eveResult: result.result,
      ply: result.plyCount,
      termination: result.termination,
    }),
  );
});
