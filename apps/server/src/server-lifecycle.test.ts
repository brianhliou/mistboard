import assert from 'node:assert/strict';
import test from 'node:test';
import { createClock, type GameEvent } from '@mistboard/game';
import type { WebSocket } from 'ws';
import type { RoomManagerContext } from './room-manager.js';
import {
  clearRoomRuntimeTimers,
  closeRoomClients,
  pauseActiveRoomsOnShutdown,
  waitForRoomWrites,
} from './server-lifecycle.js';
import { clientFixture, roomFixture } from './test-builders.js';

test('clearRoomRuntimeTimers clears pending vacates and releases live engine reservations', async () => {
  let clockFired = false;
  let engineFired = false;
  let pendingVacateFired = false;
  const released: Array<{ reservationId: string; reason: string }> = [];
  const room = roomFixture({
    clockTimer: setTimeout(() => {
      clockFired = true;
    }, 5),
    engineReservationId: 'reservation-1',
    engineTimer: setTimeout(() => {
      engineFired = true;
    }, 5),
    pendingVacates: {
      white: setTimeout(() => {
        pendingVacateFired = true;
      }, 5),
    },
  });

  clearRoomRuntimeTimers(room, {
    clearPendingVacates: true,
    releaseEngineReservation: (reservationId, reason) => {
      released.push({ reservationId, reason });
    },
    reservationReleaseReason: 'test-cleanup',
  });

  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.equal(clockFired, false);
  assert.equal(engineFired, false);
  assert.equal(pendingVacateFired, false);
  assert.equal(room.engineReservationId, null);
  assert.deepEqual(released, [{ reservationId: 'reservation-1', reason: 'test-cleanup' }]);
});

test('closeRoomClients closes every connected room client', () => {
  const closed: string[] = [];
  const white = clientFixture({
    id: 'white-client',
    socket: {
      close(code: number, reason: string) {
        closed.push(`white:${code}:${reason}`);
      },
      send() {},
    } as unknown as WebSocket,
  });
  const spectator = clientFixture({
    id: 'spectator-client',
    seat: 'spectator',
    socket: {
      close(code: number, reason: string) {
        closed.push(`spectator:${code}:${reason}`);
      },
      send() {},
    } as unknown as WebSocket,
  });
  const room = roomFixture({ clients: [white, spectator] });

  closeRoomClients([room]);

  assert.deepEqual(closed, [
    'white:1001:server shutting down',
    'spectator:1001:server shutting down',
  ]);
});

test('closeRoomClients accepts non-chess runtime rooms', () => {
  const closed: string[] = [];
  const room = {
    clients: [
      {
        socket: {
          send() {},
          close(code: number, reason: string) {
            closed.push(`red:${code}:${reason}`);
          },
        },
      },
    ],
  };

  closeRoomClients([room]);

  assert.deepEqual(closed, ['red:1001:server shutting down']);
});

test('shutdown sends each chess client a redacted pause and restart notice before close', async () => {
  const at = Date.now() - 1_000;
  const events: GameEvent[] = [
    { type: 'room-created', at, roomId: 'shutdown-order', variant: 'dark-chess' },
    { type: 'seat-assigned', at, roomId: 'shutdown-order', seat: 'white', clientId: 'white' },
    { type: 'seat-assigned', at, roomId: 'shutdown-order', seat: 'black', clientId: 'black' },
    {
      type: 'clock-started',
      at,
      roomId: 'shutdown-order',
      clock: { ...createClock(at, 60_000, 0), activeColor: 'white', runningSince: at },
    },
  ];
  const received = new Map<string, string[]>();
  const clients = (['white', 'black', 'spectator'] as const).map((seat) => {
    const frames: string[] = [];
    received.set(seat, frames);
    return clientFixture({
      id: seat,
      seat,
      socket: {
        send(raw: string) {
          frames.push(raw);
        },
        close() {
          frames.push('close');
        },
      } as unknown as WebSocket,
    });
  });
  const room = roomFixture({ id: 'shutdown-order', events, clients });
  const ctx: RoomManagerContext = {
    send: (client, payload) => {
      client.socket.send(JSON.stringify(payload));
    },
    recordPersistenceError() {},
    pveBuiltinEngineClientId: 'builtin-random-legal',
    pveEngineMoveDelayMs: 0,
    liveEngineTimeoutMs: 3_000,
    liveClockInitialMs: 60_000,
    liveClockIncrementMs: 0,
  };

  await pauseActiveRoomsOnShutdown([room], ctx);
  closeRoomClients([room]);

  for (const [seat, frames] of received) {
    assert.equal(frames.length, 3, `${seat}: pause, notice, close`);
    const pause = JSON.parse(frames[0]!);
    assert.equal(pause.type, 'snapshot');
    assert.equal(pause.paused, true);
    assert.equal(pause.pauseReason, 'shutdown');
    assert.equal(pause.state.clock.activeColor, null);
    assert.equal(pause.state.clock.runningSince, null);
    assert.deepEqual(JSON.parse(frames[1]!), {
      type: 'server_restart_scheduled',
      phase: 'restarting',
    });
    assert.equal(frames[2], 'close');
    // Check the whole serialized payload, including event history and metadata.
    const hidden = seat === 'white' ? /"e8"|"h8"/ : seat === 'black' ? /"e1"|"h1"/ : /"e8"|"e1"/;
    assert.doesNotMatch(frames[0]!, hidden);
  }
});

test('shutdown still closes every client when sending a restart notice fails', () => {
  const closed: string[] = [];
  closeRoomClients([
    {
      clients: ['closed', 'open'].map((id) => ({
        socket: {
          send() {
            if (id === 'closed') throw new Error('already closed');
          },
          close() {
            closed.push(id);
          },
        },
      })),
    },
  ]);
  assert.deepEqual(closed, ['closed', 'open']);
});

test('waitForRoomWrites waits for all room write chains', async () => {
  const order: string[] = [];
  const first = roomFixture({
    id: 'room-a',
    pendingWrites: Promise.resolve().then(() => {
      order.push('a');
    }),
  });
  const second = roomFixture({
    id: 'room-b',
    pendingWrites: Promise.resolve().then(() => {
      order.push('b');
    }),
  });

  const results = await waitForRoomWrites([first, second]);

  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'fulfilled'],
  );
  assert.deepEqual(order.sort(), ['a', 'b']);
});
