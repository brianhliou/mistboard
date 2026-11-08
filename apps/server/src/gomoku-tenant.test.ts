import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { after, before, test } from 'node:test';
import {
  applyGomokuMove,
  createInitialGomokuState,
  GOMOKU_DEALT_OPENINGS,
  GOMOKU_OPENINGS,
  type GomokuColor,
  type GomokuMove,
  type GomokuRoomState,
  type GomokuSquare,
  getGomokuLegalMoves,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import {
  createGomokuRoom,
  gomokuRooms,
  gomokuWs,
  handleGomokuCreate,
} from './gomoku-registration.js';
import { type GomokuEvent, gomokuTenant, isGomokuEngineClientId } from './gomoku-tenant.js';
import type { UserAccount } from './persistence.js';
import { variantTenantForSpecId } from './variant-tenant/registry.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { assignTenantSeat, mintTenantSeatToken } from './variant-tenant/seat-session.js';
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
  // Preserve the original empty-board referee fixtures; dealt games are
  // exercised separately through the production factory below.
  const created = createTenantRuntimeRoom(
    { ...gomokuTenant, rules: { ...gomokuTenant.rules, createSetup: undefined } },
    `gmk_${id}`,
    { now: 1 },
  );
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

test('Gomoku server deals exclusively from the mined opening pool at every random index', (t) => {
  let index = 0;
  const pick = t.mock.method(crypto, 'randomInt', (max: number) => {
    assert.equal(max, GOMOKU_DEALT_OPENINGS.length);
    return index;
  });
  syncBuiltinESMExports();
  try {
    for (const { stones, turn } of GOMOKU_DEALT_OPENINGS) {
      assert.deepEqual(gomokuTenant.rules.createSetup!(), { stones, turn });
      index += 1;
    }
  } finally {
    pick.mock.restore();
    syncBuiltinESMExports();
  }
});

test('new Gomoku games deal an opening instead of giving Black an empty board', async () => {
  const boards = new Set(
    GOMOKU_DEALT_OPENINGS.map((opening) => JSON.stringify(createInitialGomokuState(opening).board)),
  );
  const dealt = new Set<string>();
  for (let i = 0; i < 24; i += 1) {
    const created = await createGomokuRoom();
    assert.ok(created.ok);
    const state = created.room.projection.state;
    assert.equal(state.ply, 5);
    assert.ok(boards.has(JSON.stringify(state.board)));
    dealt.add(JSON.stringify(state.board));
    assert.equal(state.moveNumber, 1);
    const turn = state.opening!.turn;
    assert.equal(turn, 'black');
    assert.deepEqual(state.status, { type: 'playing', turn });
    assert.deepEqual(
      replayTenantEvents(gomokuTenant, JSON.parse(JSON.stringify(created.room.events))),
      created.room.projection,
    );
    const move = getGomokuLegalMoves({
      ...state,
      status: { type: 'playing', turn },
    })[0]!;
    appendTenantRuntimeEvent(gomokuTenant, created.room, {
      type: 'move-played',
      at: Date.now(),
      roomId: state.id,
      color: turn,
      move,
    });
    assert.equal(created.room.projection.state.ply, state.ply + 1);
    const hydrated = createTenantRuntimeRoomFromEvents(
      gomokuTenant,
      JSON.parse(JSON.stringify(created.room.events)),
    );
    assert.ok(hydrated.ok);
    assert.deepEqual(hydrated.room.projection.state, created.room.projection.state);
    const payload = JSON.stringify(
      tenantSnapshotPayload(gomokuTenant, created.room, {
        id: 'viewer',
        seat: 'spectator',
        solo: false,
      }),
    );
    for (const field of ['screening', 'winrate', 'finalScore', 'score'])
      assert.equal(payload.includes(`"${field}"`), false);
    assert.deepEqual(JSON.parse(payload).state.opening, state.opening);
  }
  assert.ok(dealt.size > 1, 'games must not always receive the same opening');
});

test('Gomoku legacy logs replay from empty, and corrupt opening setups fail closed', () => {
  const event = {
    type: 'room-created',
    at: 1,
    roomId: 'gmk_legacy',
    gameSpecId: 'gomoku',
  } as const;
  const legacy = createTenantRuntimeRoomFromEvents(gomokuTenant, [event]);
  assert.ok(legacy.ok);
  assert.equal(legacy.room.projection.state.ply, 0);
  for (const setup of [
    null,
    {},
    { stones: [], turn: 'white' },
    { stones: [{ square: 'p1', color: 'black' }], turn: 'white' },
  ])
    assert.equal(createTenantRuntimeRoomFromEvents(gomokuTenant, [{ ...event, setup }]).ok, false);
});

test('dealt 3/4/5-stone rooms start their clocks and move numbers from human play', () => {
  const openings = [
    ...[3, 4, 5].map(
      (count) => GOMOKU_OPENINGS.find((entry) => entry.stones.length === count && entry.classicId)!,
    ),
    GOMOKU_OPENINGS.find((entry) => entry.source === 'mined-2B3W-7x7')!,
  ];
  for (const [index, opening] of openings.entries()) {
    const created = createTenantRuntimeRoom(
      { ...gomokuTenant, rules: { ...gomokuTenant.rules, createSetup: () => opening } },
      `gmk_clock_${index}`,
      { now: 1, timeControl: { initialMs: 60_000, incrementMs: 1_000 } },
    );
    assert.ok(created.ok);
    assert.equal(created.room.projection.state.moveNumber, 1);
    for (const [i, to] of ['a1', 'b1'].entries()) {
      const state: GomokuRoomState = created.room.projection.state;
      assert.equal(state.status.type, 'playing');
      if (state.status.type !== 'playing') throw new Error('unexpected terminal state');
      appendTenantRuntimeEvent(gomokuTenant, created.room, {
        type: 'move-played',
        roomId: created.room.id,
        at: 100 + i * 10,
        color: state.status.turn,
        move: { to: to as GomokuSquare },
      });
    }
    assert.equal(created.room.projection.state.moveNumber, 2);
    assert.equal(created.room.projection.clock?.activeColor, opening.turn);
    assert.notEqual(created.room.projection.clock?.runningSince, null);
  }
});

test('Gomoku create route refuses the removed opening field before creating a room', async () => {
  for (const mode of ['pvp', 'pve']) {
    for (const opening of ['free', 'balanced', 'swap2', null, {}]) {
      let status = 0;
      let payload = '';
      await handleGomokuCreate(
        {
          databaseRequired: false,
          refusesCreate: () => false,
          drainDeadlineMs: () => null,
          createGomokuRoom: async () => {
            assert.fail('a removed opening field must not reach the room factory');
          },
        },
        {
          writeHead: (value: number) => {
            status = value;
          },
          end: (value: string) => {
            payload = value;
          },
        } as unknown as ServerResponse,
        { gameSpecId: 'gomoku', mode, opening },
      );
      assert.equal(status, 501);
      assert.equal(JSON.parse(payload).error, 'gomoku_unsupported_surface');
    }
  }
});

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
    const state = created.room.projection.state;
    assert.ok([3, 4, 5].includes(payload.state.ply));
    assert.equal(payload.state.moveNumber, 1);
    assert.deepEqual(payload.state.status, { type: 'playing', turn: state.opening?.turn });
    assert.equal(payload.state.perspective, preferred);
    assert.equal(
      payload.state.legalMoves.length,
      preferred === state.opening?.turn ? 225 - state.ply : 0,
    );
    assert.deepEqual(payload.state.winningLine, []);
    assert.equal(payload.clock.activeColor, null);
    assert.deepEqual(payload.clock.remainingMs, { black: 300_000, white: 300_000 });
  }
});

test('Gomoku route rejects rated PvE and unsupported modes before calling its factory', async () => {
  for (const body of [{ mode: 'pve', rated: true }, { mode: 'correspondence' }]) {
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

test('Gomoku recognizes exactly eight Rapfi ids and names every level', () => {
  for (const level of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const id = `rapfi-level-${level}`;
    assert.equal(isGomokuEngineClientId(id), true, id);
    assert.equal(gomokuTenant.engine?.displayName(id), `Rapfi Level ${level}`);
  }
  for (const id of [
    undefined,
    '',
    'human',
    'rapfi-level-0',
    'rapfi-level-9',
    'rapfi-level-10',
    'rapfi-level-01',
    'rapfi-level-1.0',
    'rapfi-level-1\n',
    'rapfi-level-8\n',
    'rapfi-level-8 ',
  ]) {
    assert.equal(isGomokuEngineClientId(id), false, String(id));
    if (id !== undefined)
      assert.throws(() => gomokuTenant.engine?.displayName(id), /unknown engine/);
  }
});

test('Gomoku PvE creates all eight Rapfi levels opposite either human colour and rejects unknown ids', async () => {
  for (const human of ['black', 'white'] as const) {
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 0, 9]) {
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
      if (level === 0 || level === 9) {
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

test('Gomoku PvE still defaults to Rapfi level 1', async () => {
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
    { gameSpecId: 'gomoku', mode: 'pve', preferredColor: 'black' },
  );
  assert.equal(status, 201);
  const live = gomokuRooms.get(JSON.parse(payload).roomId)!;
  assert.equal(live.projection.seats.white, 'rapfi-level-1');
  assert.equal(live.rated, false);
});

test('Gomoku lobby forwards rated and casual choices into replayed rooms', async () => {
  const lobby = variantTenantForSpecId('gomoku')!.lobby!;
  assert.equal(lobby.supportsRated, true);
  const tc = { initialMs: 180_000, incrementMs: 2_000 };
  for (const rated of [false, true]) {
    const match = await lobby.createRoom(tc, rated);
    const live = gomokuRooms.get(match.id)!;
    assert.equal(live.rated, rated);
    assert.equal(live.projection.rated, rated);
    assert.equal(live.projection.creatorPreference, 'random');
    assert.deepEqual(live.projection.timeControl, tc);
    const hydrated = createTenantRuntimeRoomFromEvents(
      gomokuTenant,
      JSON.parse(JSON.stringify(live.events)),
    );
    assert.ok(hydrated.ok);
    assert.equal(hydrated.room.rated, rated);
    const wire = JSON.parse(
      JSON.stringify(
        tenantSnapshotPayload(gomokuTenant, hydrated.room, {
          id: 'viewer',
          seat: 'spectator',
          solo: false,
        }),
      ),
    );
    assert.equal(wire.rated, rated);
  }
});

async function ratedFriend(body: Record<string, unknown>, account: UserAccount | null) {
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
      writeHead(value: number) {
        status = value;
      },
      end(value: string) {
        payload = value;
      },
    } as unknown as ServerResponse,
    { gameSpecId: 'gomoku', mode: 'pvp', rated: true, ...body },
    account,
  );
  return { status, body: JSON.parse(payload) };
}

test('rated Gomoku friend rooms require counted accounts and official clocks on both seats', async () => {
  const prior = process.env.MISTBOARD_RATED_ENABLED;
  process.env.MISTBOARD_RATED_ENABLED = 'true';
  const account = {
    id: 'gomoku-test-one',
    handle: 'gomokutestone',
    displayName: 'Test fixture',
  } as UserAccount;
  const tc = { initialMs: 300_000, incrementMs: 5_000 };
  try {
    assert.deepEqual(await ratedFriend({ timeControl: tc }, null), {
      status: 401,
      body: { error: 'rated_requires_account' },
    });
    assert.equal(
      (await ratedFriend({ timeControl: tc }, { ...account, statsExcludedAt: new Date() })).status,
      403,
    );
    // An off-menu pace: every preset rates since 10+5 joined on 2026-11-06.
    for (const timeControl of [undefined, { initialMs: 900_000, incrementMs: 10_000 }]) {
      assert.deepEqual(await ratedFriend({ timeControl }, account), {
        status: 400,
        body: { error: 'rated_time_control_unsupported' },
      });
    }
    const created = await ratedFriend({ timeControl: tc, preferredColor: 'white' }, account);
    assert.equal(created.status, 201);
    assert.equal(created.body.rated, true);
    const live = gomokuRooms.get(created.body.roomId)!;
    assert.equal(live.projection.rated, true);
    assert.deepEqual(
      assignTenantSeat(gomokuTenant, live, 'guest-one', undefined, null, null, true),
      { ok: false, reason: 'rated requires account' },
    );
    assert.ok(assignTenantSeat(gomokuTenant, live, 'creator', undefined, account, null, true).ok);
    assert.deepEqual(
      assignTenantSeat(gomokuTenant, live, 'guest-two', undefined, null, null, true),
      { ok: false, reason: 'rated requires account' },
    );
    assert.ok(
      assignTenantSeat(
        gomokuTenant,
        live,
        'friend',
        undefined,
        { ...account, id: 'gomoku-test-two' },
        null,
        true,
      ).ok,
    );
    const hydrated = createTenantRuntimeRoomFromEvents(
      gomokuTenant,
      JSON.parse(JSON.stringify(live.events)),
    );
    assert.ok(hydrated.ok);
    assert.equal(
      JSON.parse(
        JSON.stringify(
          tenantSnapshotPayload(gomokuTenant, hydrated.room, {
            id: 'creator',
            seat: 'white',
            solo: false,
          }),
        ),
      ).rated,
      true,
    );
  } finally {
    if (prior === undefined) delete process.env.MISTBOARD_RATED_ENABLED;
    else process.env.MISTBOARD_RATED_ENABLED = prior;
  }
});

test('Gomoku WebSocket admits public spectators and binds placements to reserved seats', async () => {
  class Socket extends EventEmitter {
    sent: Record<string, unknown>[] = [];
    closed?: { code?: number; reason?: string };
    send(payload: string) {
      this.sent.push(JSON.parse(payload));
    }
    close(code?: number, reason?: string) {
      this.closed = { code, reason };
    }
  }
  const created = await createGomokuRoom();
  assert.ok(created.ok);
  const live = created.room as Parameters<typeof gomokuWs.handleConnection>[3];
  const black = new Socket();
  const white = new Socket();
  const ctx = { wsMessageLimit: 100, wsMessageWindowMs: 1_000 };
  // Public casual rooms admit spectators; reserved seats still require their tokens.
  const request = (id: string, seat: GomokuColor) => {
    const { rawToken } = mintTenantSeatToken(live, seat, {
      userId: null,
      userHandle: null,
      userDisplayName: null,
    });
    return {
      url: `/?client=${id}`,
      headers: { host: 'localhost', 'sec-websocket-protocol': `mistboard-seat.${rawToken}` },
    } as IncomingMessage;
  };
  const place = async (socket: Socket, to: string) => {
    socket.emit('message', JSON.stringify({ type: 'move', to, color: 'white' }));
    await live.pendingWrites;
  };
  const blackRequest = request('black-player', 'black');
  const whiteRequest = request('white-player', 'white');
  try {
    const stranger = new Socket();
    await gomokuWs.handleConnection(
      ctx,
      stranger as unknown as WebSocket,
      { url: '/?client=stranger', headers: { host: 'localhost' } } as IncomingMessage,
      live,
    );
    assert.equal(stranger.closed, undefined);
    assert.equal(stranger.sent[0]?.seat, 'spectator');
    assert.equal(live.clients.size, 1);
    await gomokuWs.handleConnection(ctx, black as unknown as WebSocket, blackRequest, live);
    assert.equal(black.sent[0]?.seat, 'black');
    const initial = live.projection.state;
    const first = initial.opening!.turn === 'black' ? black : white;
    const second = first === black ? white : black;
    const [move, next] = getGomokuLegalMoves({
      ...initial,
      status: { type: 'playing', turn: initial.opening!.turn },
    });
    assert.ok(move && next);
    await place(black, move.to);
    assert.equal(live.projection.state.ply, initial.ply);
    await gomokuWs.handleConnection(ctx, white as unknown as WebSocket, whiteRequest, live);
    assert.equal(white.sent[0]?.seat, 'white');
    await place(second, move.to);
    assert.equal(live.projection.state.ply, initial.ply);
    await place(first, move.to);
    assert.equal(live.projection.state.ply, initial.ply + 1);
    await place(second, move.to);
    assert.equal(live.projection.state.ply, initial.ply + 1);
    await place(second, next.to);
    assert.equal(live.projection.state.ply, initial.ply + 2);
    assert.deepEqual(replayTenantEvents(gomokuTenant, live.events).state, live.projection.state);
  } finally {
    clearTenantRuntimeTimers(live);
  }
});
