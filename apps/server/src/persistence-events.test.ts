import type { GameEvent } from '@mistboard/game';
import { appendEvent, loadRoom } from './persistence.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

definePersistenceTests('events', () => {
  test('loadRoom returns null for an unknown room', async () => {
    const result = await loadRoom('nonexistent-room');
    assert.equal(result, null);
  });

  test('appendEvent + loadRoom round-trips events in seq order', async () => {
    const roomId = 'test-round-trip';
    const events: GameEvent[] = [
      { type: 'room-created', at: 1000, roomId, variant: 'dark-chess' },
      {
        type: 'seat-assigned',
        at: 1001,
        roomId,
        clientId: 'client-white',
        seat: 'white',
      },
      {
        type: 'seat-assigned',
        at: 1002,
        roomId,
        clientId: 'client-black',
        seat: 'black',
      },
      {
        type: 'move-played',
        at: 1003,
        roomId,
        color: 'white',
        move: { from: 'e2', to: 'e4' },
      },
      {
        type: 'move-played',
        at: 1004,
        roomId,
        color: 'black',
        move: { from: 'e7', to: 'e5' },
      },
    ];

    for (let seq = 0; seq < events.length; seq++) {
      await appendEvent(roomId, seq, events[seq]!);
    }

    const loaded = await loadRoom(roomId);
    assert.deepEqual(loaded, events);
  });

  test('appendEvent throws on duplicate (room_id, seq)', async () => {
    const roomId = 'test-duplicate';
    const event: GameEvent = {
      type: 'room-created',
      at: 1,
      roomId,
      variant: 'dark-chess',
    };
    await appendEvent(roomId, 0, event);
    await assert.rejects(() => appendEvent(roomId, 0, event), /duplicate key|unique constraint/i);
  });

  test('rooms are isolated by room_id', async () => {
    const eventA: GameEvent = {
      type: 'room-created',
      at: 1,
      roomId: 'room-a',
      variant: 'dark-chess',
    };
    const eventB: GameEvent = {
      type: 'room-created',
      at: 2,
      roomId: 'room-b',
      variant: 'dark-chess',
    };
    await appendEvent('room-a', 0, eventA);
    await appendEvent('room-b', 0, eventB);

    assert.deepEqual(await loadRoom('room-a'), [eventA]);
    assert.deepEqual(await loadRoom('room-b'), [eventB]);
  });
});
