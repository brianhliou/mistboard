import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import {
  applyGomokuMove,
  createInitialGomokuState,
  type GomokuColor,
  type GomokuMove,
  getGomokuLegalMoves,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import {
  createGomokuRoom,
  gomokuRooms,
  gomokuWs,
  handleGomokuCreate,
} from './gomoku-registration.js';
import { type GomokuEvent, gomokuTenant } from './gomoku-tenant.js';
import { variantTenantForSpecId } from './variant-tenant/registry.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { assignTenantSeat } from './variant-tenant/seat-session.js';
import { clearTenantRuntimeTimers } from './variant-tenant/ws.js';

const flag = process.env.MISTBOARD_GOMOKU_ENABLED;
before(() => {
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
});
after(() => {
  if (flag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
  else process.env.MISTBOARD_GOMOKU_ENABLED = flag;
  gomokuRooms.clear();
});

function room(id: string) {
  const created = createTenantRuntimeRoom(gomokuTenant, `gmk_${id}`, { now: 1 });
  assert.ok(created.ok);
  const room = created.room;
  for (const color of gomokuTenant.colors)
    appendTenantRuntimeEvent(gomokuTenant, room, {
      type: 'seat-assigned',
      at: 2,
      roomId: room.id,
      seat: color,
      clientId: color,
    });
  return room;
}

test('Gomoku server referee plays 32 seeded random games to a win and replays/hydrates every placement', () => {
  const winners = new Set<GomokuColor>();
  for (let seed = 1; seed <= 32; seed += 1) {
    const live = room(`random_${seed}`);
    const initial = live.projection.state;
    let kernel = createInitialGomokuState();
    let random = seed;
    while (kernel.status.type === 'playing') {
      const legal = getGomokuLegalMoves(kernel);
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const move = legal[random % legal.length]!;
      assert.ok(gomokuTenant.rules.isLegalMove(live.projection.state, move));
      appendTenantRuntimeEvent(gomokuTenant, live, {
        type: 'move-played',
        at: kernel.ply + 3,
        roomId: live.id,
        color: kernel.status.turn,
        move,
      });
      kernel = applyGomokuMove(kernel, move);
      assert.deepEqual(live.projection.state.board, kernel.board);
      assert.deepEqual(live.projection.state.status, kernel.status);
      assert.equal(live.projection.state.id, live.id);
      assert.equal(live.projection.state.moveNumber, 1 + Math.floor(kernel.ply / 2));
    }
    assert.equal(kernel.status.reason, 'five');
    assert.deepEqual(initial.board, Array(225).fill(null));
    if (kernel.status.winner) winners.add(kernel.status.winner);
    assert.deepEqual(replayTenantEvents(gomokuTenant, live.events), live.projection);
    const hydrated = createTenantRuntimeRoomFromEvents(
      gomokuTenant,
      JSON.parse(JSON.stringify(live.events)),
    );
    assert.ok(hydrated.ok);
    assert.deepEqual(hydrated.room.projection.state, live.projection.state);
    const payload = tenantSnapshotPayload(gomokuTenant, live, {
      id: 'viewer',
      seat: 'spectator',
      solo: false,
    });
    assert.ok(payload.state.winningLine.length >= 5);
    assert.deepEqual(payload.state.legalMoves, []);
    assert.equal(payload.roomMode, 'pvp');
  }
  assert.deepEqual([...winners].sort(), ['black', 'white']);
});

test('Gomoku server plays a legal 225-placement draw from an empty board', () => {
  const live = room('draw');
  const moves: Record<GomokuColor, GomokuMove[]> = { black: [], white: [] };
  for (let i = 0; i < 225; i += 1) {
    const color = ((i % 15) + 2 * Math.floor(i / 15)) % 4 < 2 ? 'black' : 'white';
    moves[color].push({
      to: `${'abcdefghijklmno'[i % 15]}${1 + Math.floor(i / 15)}` as GomokuMove['to'],
    });
  }
  const counts = { black: 0, white: 0 };
  for (let ply = 0; ply < 225; ply += 1) {
    const state = live.projection.state;
    assert.equal(state.status.type, 'playing');
    if (state.status.type !== 'playing') throw new Error('premature ending');
    const color = state.status.turn;
    const move = moves[color][counts[color]++]!;
    assert.ok(gomokuTenant.rules.isLegalMove(state, move));
    appendTenantRuntimeEvent(gomokuTenant, live, {
      type: 'move-played',
      at: ply + 3,
      roomId: live.id,
      color,
      move,
    });
  }
  assert.equal(live.projection.state.ply, 225);
  assert.deepEqual(live.projection.state.status, {
    type: 'finished',
    winner: null,
    reason: 'board-full',
  });
  assert.deepEqual(replayTenantEvents(gomokuTenant, live.events), live.projection);
  assert.deepEqual(
    tenantSnapshotPayload(gomokuTenant, live, { id: 'black', seat: 'black', solo: false }).state
      .winningLine,
    [],
  );
});

test('Gomoku refuses malformed, occupied, out-of-turn and postgame moves', () => {
  const live = room('illegal');
  for (const message of [{}, { to: 'p1' }, { to: 'a0' }, { to: 'a01' }, { to: 'a1\n' }])
    assert.equal(gomokuTenant.rules.moveFromMessage(message), null);
  assert.equal(gomokuTenant.rules.isMove({ to: 1 }), false);
  const move = { to: 'h8' } as const;
  const event: GomokuEvent = { type: 'move-played', roomId: live.id, at: 3, color: 'white', move };
  assert.equal(appendTenantRuntimeEvent(gomokuTenant, live, event), -1);
  appendTenantRuntimeEvent(gomokuTenant, live, { ...event, color: 'black' });
  assert.equal(gomokuTenant.rules.isLegalMove(live.projection.state, move), false);
  assert.throws(
    () => gomokuTenant.rules.applyMove(live.projection.state, move),
    /illegal placement/,
  );
  appendTenantRuntimeEvent(gomokuTenant, live, {
    type: 'seat-resigned',
    roomId: live.id,
    at: 4,
    color: 'white',
  });
  assert.equal(appendTenantRuntimeEvent(gomokuTenant, live, { ...event, move: { to: 'i8' } }), -1);
  assert.throws(() => gomokuTenant.persistence.termination('unknown'), /unmapped/);
  for (const reason of ['five', 'board-full', 'agreement', 'timeout', 'resignation', 'abandonment'])
    assert.ok(gomokuTenant.persistence.termination(reason));
});

test('Gomoku friend creation preserves Black/White preference and exposes complete player views', async () => {
  for (const preferred of ['black', 'white'] as const) {
    const created = await createGomokuRoom({ initialMs: 300_000, incrementMs: 5_000 }, preferred);
    assert.ok(created.ok);
    assert.equal(created.room.rated, false);
    assert.equal(assignTenantSeat(gomokuTenant, created.room, 'creator', undefined, null).ok, true);
    assert.equal(created.room.seatTokens[preferred]?.clientId, 'creator');
    const payload = JSON.parse(
      JSON.stringify(
        tenantSnapshotPayload(gomokuTenant, created.room, {
          id: 'creator',
          seat: preferred,
          solo: false,
        }),
      ),
    );
    for (const key of [
      'roomId',
      'gameSpecId',
      'seat',
      'seats',
      'state',
      'clock',
      'timeControl',
      'events',
      'connectedSeats',
      'abortDeadline',
      'roomMode',
    ])
      assert.ok(key in payload, key);
    assert.equal(payload.state.id, created.room.id);
    assert.equal(payload.state.board.length, 225);
    assert.equal(payload.state.ply, 0);
    assert.equal(payload.state.moveNumber, 1);
    assert.deepEqual(payload.state.status, { type: 'playing', turn: 'black' });
    assert.equal(payload.state.perspective, preferred);
    assert.equal(payload.state.legalMoves.length, preferred === 'black' ? 225 : 0);
    assert.deepEqual(payload.state.winningLine, []);
    assert.equal(payload.clock.activeColor, null);
    assert.deepEqual(payload.clock.remainingMs, { black: 300_000, white: 300_000 });
  }
});

test('Gomoku route rejects rated and unsupported modes before calling its factory', async () => {
  for (const body of [
    { mode: 'pvp', rated: true },
    { mode: 'pve', rated: true },
    { mode: 'correspondence' },
  ]) {
    let status = 0;
    let payload = '';
    const response = {
      writeHead: (value: number) => {
        status = value;
      },
      end: (value: string) => {
        payload = value;
      },
    } as unknown as ServerResponse;
    await handleGomokuCreate(
      {
        databaseRequired: false,
        refusesCreate: () => false,
        drainDeadlineMs: () => null,
        createGomokuRoom: async () => {
          throw new Error('must not create');
        },
      },
      response,
      { gameSpecId: 'gomoku', ...body },
    );
    assert.equal(status, 501);
    assert.deepEqual(JSON.parse(payload), { error: 'gomoku_unsupported_surface' });
  }
});

test('Gomoku PvE creates all five Rapfi levels opposite either human colour and rejects unknown ids', async () => {
  for (const human of ['black', 'white'] as const) {
    for (const level of [1, 2, 3, 4, 5, 0, 6]) {
      let status = 0;
      let payload = '';
      await handleGomokuCreate(
        {
          databaseRequired: false,
          refusesCreate: () => false,
          drainDeadlineMs: () => null,
          createGomokuRoom,
        },
        {
          writeHead: (value: number) => {
            status = value;
          },
          end: (value: string) => {
            payload = value;
          },
        } as unknown as ServerResponse,
        {
          gameSpecId: 'gomoku',
          mode: 'pve',
          preferredColor: human,
          engineId: `rapfi-level-${level}`,
        },
      );
      const result = JSON.parse(payload);
      if (level === 0 || level === 6) {
        assert.equal(status, 400);
        assert.equal(result.error, 'invalid_engine');
        continue;
      }
      assert.equal(status, 201);
      const live = gomokuRooms.get(result.roomId);
      assert.ok(live);
      assert.equal(live.rated, false);
      const bot = human === 'black' ? 'white' : 'black';
      assert.equal(live.projection.seats[bot], `rapfi-level-${level}`);
      assert.equal(live.projection.seats[human], undefined);
      const wire = tenantSnapshotPayload(gomokuTenant, live, {
        id: 'human',
        seat: human,
        solo: false,
      });
      assert.equal(wire.roomMode, 'pve');
      assert.equal(wire.pveEngineId, `rapfi-level-${level}`);
      assert.deepEqual(replayTenantEvents(gomokuTenant, live.events), live.projection);
    }
  }
});

test('Gomoku casual lobby creates a random-seat room and refuses a rated room', async () => {
  const registration = variantTenantForSpecId('gomoku');
  assert.ok(registration?.lobby);
  assert.equal(registration.lobby.supportsRated, false);
  const tc = { initialMs: 180_000, incrementMs: 2_000 };
  assert.ok(registration.lobby.allowsTimeControl(tc));
  const match = await registration.lobby.createRoom(tc, false);
  const live = gomokuRooms.get(match.id);
  assert.ok(live);
  assert.equal(match.region, 'global');
  assert.equal(live.projection.creatorPreference, 'random');
  assert.deepEqual(live.projection.timeControl, tc);
  await assert.rejects(registration.lobby.createRoom(tc, true), /unsupported_surface/);
});

test('Gomoku WebSocket binds placements to the authenticated seat and waits for both players', async () => {
  class Socket extends EventEmitter {
    sent: Record<string, unknown>[] = [];
    send(payload: string) {
      this.sent.push(JSON.parse(payload));
    }
    close() {}
  }
  const created = await createGomokuRoom();
  assert.ok(created.ok);
  const live = created.room as Parameters<typeof gomokuWs.handleConnection>[3];
  const black = new Socket();
  const white = new Socket();
  const ctx = { wsMessageLimit: 100, wsMessageWindowMs: 1_000 };
  const request = (id: string) =>
    ({ url: `/?client=${id}`, headers: { host: 'localhost' } }) as IncomingMessage;
  const place = async (socket: Socket, to: string) => {
    socket.emit('message', JSON.stringify({ type: 'move', to, color: 'white' }));
    await live.pendingWrites;
  };
  try {
    await gomokuWs.handleConnection(
      ctx,
      black as unknown as WebSocket,
      request('black-player'),
      live,
    );
    assert.equal(black.sent[0]?.seat, 'black');
    await place(black, 'h8');
    assert.equal(live.projection.state.ply, 0);
    await gomokuWs.handleConnection(
      ctx,
      white as unknown as WebSocket,
      request('white-player'),
      live,
    );
    assert.equal(white.sent[0]?.seat, 'white');
    await place(white, 'h8');
    assert.equal(live.projection.state.ply, 0);
    await place(black, 'h8');
    assert.equal(live.projection.state.board[112], 'black');
    await place(white, 'h8');
    assert.equal(live.projection.state.ply, 1);
    await place(white, 'i8');
    assert.equal(live.projection.state.board[113], 'white');
    assert.equal(live.projection.state.ply, 2);
    assert.deepEqual(replayTenantEvents(gomokuTenant, live.events).state, live.projection.state);
  } finally {
    clearTenantRuntimeTimers(live);
  }
});
