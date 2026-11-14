import assert from 'node:assert/strict';
import test from 'node:test';
import { DARK_XIANGQI_SPEC_ID } from '@mistboard/game';
import { darkXiangqiTenant } from '../dark-xiangqi-tenant.js';
import { DARK_XIANGQI_DEFAULT_ENGINE_ID } from '../engines/registry.js';
import { restoreHydratedTenantEngineReservation } from './hydration.js';
import { createTenantRuntimeRoomFromEvents } from './runtime.js';

const ROOM_ID = 'dxq_restart_reservation';

function hydratedDarkXiangqiPveRoom() {
  const hydrated = createTenantRuntimeRoomFromEvents(darkXiangqiTenant, [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM_ID,
      gameSpecId: DARK_XIANGQI_SPEC_ID,
    },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: ROOM_ID,
      clientId: 'human-red',
      seat: 'red',
    },
    {
      type: 'seat-assigned',
      at: 3,
      roomId: ROOM_ID,
      clientId: DARK_XIANGQI_DEFAULT_ENGINE_ID,
      seat: 'black',
    },
  ]);
  assert.ok(hydrated.ok, 'restart fixture must hydrate');
  return hydrated.room;
}

test('Fog Xiangqi hydration reacquires the external engine reservation before serving the room', async () => {
  const room = hydratedDarkXiangqiPveRoom();
  assert.equal(room.engineReservationId, null);

  const requests: Array<{ color: string; engineId: string; roomId: string }> = [];
  const ready = await restoreHydratedTenantEngineReservation(
    darkXiangqiTenant,
    room,
    async (request) => {
      requests.push(request);
      return 'replacement-reservation';
    },
  );

  assert.equal(ready, true);
  assert.equal(room.engineReservationId, 'replacement-reservation');
  assert.deepEqual(requests, [
    {
      color: 'black',
      engineId: DARK_XIANGQI_DEFAULT_ENGINE_ID,
      roomId: ROOM_ID,
    },
  ]);
});

test('Fog Xiangqi hydration stays unavailable rather than resuming without a reservation', async () => {
  const room = hydratedDarkXiangqiPveRoom();

  const ready = await restoreHydratedTenantEngineReservation(
    darkXiangqiTenant,
    room,
    async () => null,
  );

  assert.equal(ready, false);
  assert.equal(room.engineReservationId, null);
});

function hydratedEveRoom() {
  const room = hydratedDarkXiangqiPveRoom();
  room.projection.seats.red = DARK_XIANGQI_DEFAULT_ENGINE_ID;
  return room;
}

test('EvE hydration acquires distinct reservations for identical engines in different seats', async () => {
  const room = hydratedEveRoom();
  const requests: string[] = [];
  const reserve = async ({ color }: { color: string }) => {
    requests.push(color);
    return `restored-${color}`;
  };
  assert.equal(
    await restoreHydratedTenantEngineReservation(darkXiangqiTenant, room, reserve),
    true,
  );
  assert.deepEqual(requests, ['white', 'black']);
  assert.deepEqual(room.engineReservationIds, { red: 'restored-white', black: 'restored-black' });
  assert.equal(room.engineReservationId, null, 'EvE has no single-seat alias');
  assert.equal(
    await restoreHydratedTenantEngineReservation(darkXiangqiTenant, room, reserve),
    true,
  );
  assert.deepEqual(requests, ['white', 'black'], 'an already restored seat is not reserved twice');
});

test('partial EvE hydration releases admitted seats on refusal or exception and can retry cleanly', async () => {
  for (const throws of [false, true]) {
    const room = hydratedEveRoom();
    const released: string[] = [];
    assert.equal(
      await restoreHydratedTenantEngineReservation(
        darkXiangqiTenant,
        room,
        async ({ color }) => {
          if (color === 'white') return 'first-seat';
          if (throws) throw new Error('worker unavailable');
          return null;
        },
        (id) => {
          released.push(id);
        },
      ),
      false,
    );
    assert.deepEqual(released, ['first-seat']);
    assert.deepEqual(room.engineReservationIds, {});
    assert.equal(room.engineReservationId, null);
    assert.equal(
      await restoreHydratedTenantEngineReservation(
        darkXiangqiTenant,
        room,
        async ({ color }) => `retry-${color}`,
      ),
      true,
    );
    assert.deepEqual(room.engineReservationIds, { red: 'retry-white', black: 'retry-black' });
  }
});

test('finished and aborted EvE rooms never reacquire worker capacity', async () => {
  for (const status of [
    { type: 'finished' as const, winner: null, reason: 'agreement' as const },
    { type: 'aborted' as const, reason: 'user-abort' as const },
  ]) {
    const room = hydratedEveRoom();
    room.projection.state.status = status;
    assert.equal(
      await restoreHydratedTenantEngineReservation(darkXiangqiTenant, room, async () => {
        assert.fail('terminal game attempted admission');
      }),
      true,
    );
  }
});
