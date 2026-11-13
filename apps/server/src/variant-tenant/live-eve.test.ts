import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDarkXiangqiGameSummary, darkXiangqiTenant } from '../dark-xiangqi-tenant.js';
import { xiangqiTenant } from '../xiangqi-tenant.js';
import { appendTenantEvent, buildTenantGameSummary } from './events.js';
import { createTenantLiveRoom, type TenantRoomEngineSeat } from './room-factory.js';
import {
  createTenantRuntimeRoomFromEvents,
  isTenantEventLog,
  tenantSeatDisplayNames,
  tenantSeatProfiles,
  tenantSnapshotPayload,
} from './runtime.js';

const tenant = { ...xiangqiTenant, enabled: () => true };
const engines: TenantRoomEngineSeat<'red' | 'black'>[] = [
  {
    seat: 'red',
    engineId: 'pikafish-xiangqi-level-8',
    botId: 'pikafish',
    reservationId: 'seat-red',
  },
  {
    seat: 'black',
    engineId: 'fairy-stockfish-xiangqi-level-1',
    botId: 'fairy-stockfish-level-1',
    reservationId: 'seat-black',
  },
];

function context() {
  const starts: Array<{ mode: string }> = [];
  const releases: string[] = [];
  return {
    rooms: new Map(),
    starts,
    releases,
    isRoomIdTaken: () => false,
    createRoomId: () => 'xq_live_eve',
    isPersistenceEnabled: () => true,
    appendRoomEvent: async () => {},
    recordGameStart: async (_id: string, summary: { mode: string }) => {
      starts.push(summary);
    },
    recordPersistenceError: () => {},
    releaseEngineReservation: (id: string) => {
      releases.push(id);
    },
  };
}

test('all-engine rooms record eve, remain casual and preserve each seat identity after replay', async () => {
  const ctx = context();
  const created = await createTenantLiveRoom(tenant, ctx, { engines, rated: true });
  assert.ok(created.ok);
  const room = created.room;
  assert.equal(ctx.starts[0]?.mode, 'eve');
  assert.equal(room.rated, false);
  assert.equal(room.projection.rated, false);
  assert.deepEqual(room.engineReservationIds, { red: 'seat-red', black: 'seat-black' });
  assert.equal(room.engineTimer, null, 'creation does not enable scheduling');
  const replay = createTenantRuntimeRoomFromEvents(tenant, room.events);
  assert.ok(replay.ok);
  assert.deepEqual(tenantSeatProfiles(tenant, replay.room), {
    red: { botId: 'pikafish' },
    black: { botId: 'fairy-stockfish-level-1' },
  });
  assert.deepEqual(tenantSeatDisplayNames(tenant, replay.room), {
    red: 'Pikafish',
    black: 'Fairy-Stockfish Level 1',
  });
  await appendTenantEvent(
    tenant,
    room,
    {
      type: 'seat-resigned',
      at: Date.now(),
      roomId: room.id,
      color: 'red',
    },
    { releaseEngineReservation: ctx.releaseEngineReservation },
  );
  const summary = buildTenantGameSummary(tenant, room);
  assert.equal(summary.mode, 'eve');
  assert.equal(summary.rated, false);
  assert.deepEqual(
    summary.participants?.map((p) => p.subjectId),
    ['pikafish', 'fairy-stockfish-level-1'],
  );
  assert.deepEqual(ctx.releases.sort(), ['seat-black', 'seat-red']);
  assert.deepEqual(room.engineReservationIds, {});
});

test('PvE retains its single-seat reservation and legacy bot identity', async () => {
  const ctx = context();
  const created = await createTenantLiveRoom(tenant, ctx, { engine: engines[1], rated: true });
  assert.ok(created.ok);
  assert.equal(ctx.starts[0]?.mode, 'pve');
  assert.equal(created.room.pveBotId, 'fairy-stockfish-level-1');
  assert.equal(created.room.engineReservationId, 'seat-black');
  assert.equal(created.room.rated, false);
  assert.deepEqual(tenantSeatProfiles(tenant, created.room), {
    black: { botId: 'fairy-stockfish-level-1' },
  });
});

test('EvE moves do not invoke the PvE scheduler', async () => {
  const created = await createTenantLiveRoom(tenant, context(), { engines });
  assert.ok(created.ok);
  const seq = await appendTenantEvent(
    tenant,
    created.room,
    {
      type: 'move-played',
      at: Date.now(),
      roomId: created.room.id,
      color: 'red',
      move: { from: 'a3', to: 'a4' },
    },
    {
      scheduleEngineMove: () => {
        assert.fail('EvE scheduling is disabled');
      },
    },
  );
  assert.ok(seq >= 0);
  assert.equal(created.room.engineTimer, null);
});

test('either EvE engine failing to move is an aborted engine failure, with eve attribution', async () => {
  for (const failedSeat of ['red', 'black'] as const) {
    const ctx = context();
    const fog = { ...darkXiangqiTenant, enabled: () => true };
    const created = await createTenantLiveRoom(fog, ctx, {
      engines: engines.map((engine) => ({ ...engine, engineId: 'python-fdx-v1.2' })),
    });
    assert.ok(created.ok);
    await appendTenantEvent(
      fog,
      created.room,
      {
        type: 'seat-forfeited',
        at: Date.now(),
        roomId: created.room.id,
        color: failedSeat,
      },
      { releaseEngineReservation: ctx.releaseEngineReservation },
    );
    for (const summary of [
      buildTenantGameSummary(fog, created.room),
      buildDarkXiangqiGameSummary(created.room),
    ]) {
      assert.equal(summary.mode, 'eve');
      assert.equal(summary.abortedAs?.termination, 'engine-failure');
    }
    assert.deepEqual(ctx.releases.sort(), ['seat-black', 'seat-red']);
  }
});

test('aborting releases every reservation once', async () => {
  const ctx = context();
  const created = await createTenantLiveRoom(tenant, ctx, { engines });
  assert.ok(created.ok);
  const room = created.room;
  const event = {
    type: 'game-aborted' as const,
    at: Date.now(),
    roomId: room.id,
    reason: 'user-abort' as const,
  };
  await appendTenantEvent(tenant, room, event, {
    releaseEngineReservation: ctx.releaseEngineReservation,
  });
  await appendTenantEvent(tenant, room, event, {
    releaseEngineReservation: ctx.releaseEngineReservation,
  });
  assert.deepEqual(ctx.releases.sort(), ['seat-black', 'seat-red']);
});

test('failed creation releases every admitted seat, including disabled rooms and exhausted ids', async () => {
  for (const failure of ['disabled', 'collision', 'append', 'start', 'setup'] as const) {
    const ctx = context();
    const configured = {
      ...ctx,
      isRoomIdTaken: () => failure === 'collision',
      appendRoomEvent: async () => {
        if (failure === 'append') throw new Error('write failed');
      },
      recordGameStart: async () => {
        if (failure === 'start') throw new Error('start failed');
      },
    };
    const configuredTenant = {
      ...tenant,
      enabled: () => failure !== 'disabled',
      rules: {
        ...tenant.rules,
        createSetup: () => {
          if (failure === 'setup') throw new Error('setup failed');
        },
      },
    };
    if (failure === 'setup') {
      await assert.rejects(
        createTenantLiveRoom(configuredTenant, configured, { engines }),
        /setup failed/,
      );
    } else {
      assert.equal(
        (await createTenantLiveRoom(configuredTenant, configured, { engines })).ok,
        false,
      );
    }
    assert.deepEqual(ctx.releases.sort(), ['seat-black', 'seat-red'], failure);
    assert.equal(ctx.rooms.size, 0);
  }
});

test('invalid engine seating fails before publication and returns admitted reservations', async () => {
  for (const invalid of [
    [engines[0]!, { ...engines[1]!, seat: 'red' as const }],
    [{ ...engines[0]!, engineId: 'human' }],
  ]) {
    const ctx = context();
    await assert.rejects(createTenantLiveRoom(tenant, ctx, { engines: invalid }), /engine seat/);
    assert.equal(ctx.rooms.size, 0);
    assert.equal(ctx.releases.length, invalid.length);
  }
});

test('Fog EvE snapshots preserve per-seat masking and never serialize reservations', async () => {
  const fog = { ...darkXiangqiTenant, enabled: () => true };
  const ctx = context();
  const created = await createTenantLiveRoom(fog, ctx, {
    engines: engines.map((e) => ({ ...e, engineId: 'python-fdx-v1.2' })),
  });
  assert.ok(created.ok);
  for (const seat of ['red', 'black', 'spectator'] as const) {
    const snapshot: Record<string, unknown> = tenantSnapshotPayload(fog, created.room, {
      id: 'viewer',
      seat,
      solo: false,
    });
    const payload = JSON.stringify(snapshot);
    assert.ok(!payload.includes('seat-red') && !payload.includes('seat-black'));
    assert.ok(!payload.includes('engineReservation'));
    if (seat === 'spectator') assert.deepEqual(JSON.parse(payload).state.board, {});
    const baseline: Record<string, unknown> = tenantSnapshotPayload(
      fog,
      {
        ...created.room,
        projection: {
          ...created.room.projection,
          seats: { red: 'human-red', black: 'human-black' },
        },
      },
      { id: 'viewer', seat, solo: false },
    );
    assert.deepEqual(JSON.parse(payload).state, JSON.parse(JSON.stringify(baseline)).state);
  }
});

test('seat bot metadata rejects unknown seats and malformed identities in durable logs', async () => {
  const created = await createTenantLiveRoom(tenant, context(), { engines });
  assert.ok(created.ok);
  for (const engineBotIds of [{ sideways: 'pikafish' }, { red: 4 }, []]) {
    const events: unknown[] = [
      { ...created.room.events[0], engineBotIds },
      ...created.room.events.slice(1),
    ];
    assert.equal(isTenantEventLog(tenant, events), false);
  }
});
