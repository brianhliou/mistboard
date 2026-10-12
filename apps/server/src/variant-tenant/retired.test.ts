// Retiring a variant (Fortress and Atomic Xiangqi, 2026-10-11) closes every way
// to start a game and keeps every way to look at one. The tenant stays
// registered, so a game in progress finishes (it rehydrates from its event log
// after a restart) and a finished game replays; only the create paths answer
// 410 retired_game_spec. A registry that skipped retired tenants took every
// finished game's review page with it.
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  ATOMIC_XIANGQI_SPEC_ID,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  applyAtomicXiangqiMove,
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  createInitialAtomicXiangqiState,
  FORTRESS_XIANGQI_SPEC_ID,
  isRetiredGameSpec,
  RETIRED_GAME_SPEC_IDS,
} from '@mistboard/game';
import { type AtomicXiangqiEvent, atomicXiangqiTenant } from '../atomic-xiangqi-tenant.js';
import { gateGameSpecRequest } from '../game-spec-request-gate.js';
import { atomicXiangqiPostgameForApi } from '../routes/atomic-xiangqi-games.js';
import type { HttpApiContext } from '../routes/lib.js';
import { tryHandle } from '../routes/lobby.js';
import type { Room } from '../server-types.js';
import './register-tenants.js';
import {
  registeredVariantTenants,
  type TenantCreateHttpContext,
  type VariantTenantRegistration,
} from './registry.js';
import { createTenantRuntimeRoom, createTenantRuntimeRoomFromEvents } from './runtime.js';

const RETIRED = [FORTRESS_XIANGQI_SPEC_ID, ATOMIC_XIANGQI_SPEC_ID] as const;
const FLAGS = ['MISTBOARD_FORTRESS_XIANGQI_ENABLED', 'MISTBOARD_ATOMIC_XIANGQI_ENABLED'];
const BLITZ = { initialMs: 180_000, incrementMs: 2_000 };

// The launch flags stay on in prod (they gate the replay routes), so every
// refusal here is proven with the flag on: retirement, not the flag, refuses.
async function withFlagsOn<T>(run: () => Promise<T>): Promise<T> {
  const before = new Map(FLAGS.map((flag) => [flag, process.env[flag]]));
  for (const flag of FLAGS) process.env[flag] = 'true';
  try {
    return await run();
  } finally {
    for (const [flag, value] of before) {
      if (value === undefined) delete process.env[flag];
      else process.env[flag] = value;
    }
  }
}

function registrationFor(gameSpecId: string): VariantTenantRegistration {
  const registration = registeredVariantTenants().find(
    (candidate) => candidate.gameSpecId === gameSpecId && candidate.ownsSpecRouting,
  );
  assert.ok(registration, `${gameSpecId}: a retired tenant must stay registered`);
  return registration;
}

function captureResponse(): ServerResponse & { body: string; status: number | null } {
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & { body: string; status: number | null };
}

const createCtx: TenantCreateHttpContext = {
  databaseRequired: false,
  isDraining: () => false,
  drainDeadlineMs: () => null,
  reserveLiveEngineSeat: () => Promise.resolve(null),
  releaseLiveEngineReservation: () => undefined,
};

test('retired: Fortress and Atomic Xiangqi are retired and still registered', () => {
  for (const id of RETIRED) {
    assert.ok(RETIRED_GAME_SPEC_IDS.includes(id), id);
    assert.equal(isRetiredGameSpec(id), true, id);
    assert.ok(!CORRESPONDENCE_ELIGIBLE_SPEC_IDS.includes(id as never), `${id}: correspondence`);
    registrationFor(id);
  }
});

test('retired: the gate refuses a new game by id or legacy variant, launch flag on', async () => {
  const refusal = {
    type: 'reject',
    error: 'retired_game_spec',
    httpStatus: 410,
    wsCloseReason: 'game spec retired',
  };
  await withFlagsOn(async () => {
    for (const id of RETIRED) {
      assert.deepEqual(gateGameSpecRequest({ gameSpecId: id }), refusal, id);
      assert.deepEqual(gateGameSpecRequest({ variant: id }), refusal, id);
    }
  });
});

test('retired: POST /api/rooms refuses every new room with 410 and creates none', async () => {
  await withFlagsOn(async () => {
    for (const id of RETIRED) {
      const registration = registrationFor(id);
      registration.clearRooms?.();
      for (const body of [
        { mode: 'pvp', timeControl: BLITZ },
        { mode: 'pvp', rated: true, timeControl: BLITZ },
        { mode: 'pve', timeControl: BLITZ, engineId: 'fairy-stockfish-level-1' },
      ]) {
        const fullBody = { gameSpecId: id, ...body };
        assert.ok(registration.http.matchesCreateRequest(fullBody), id);
        const response = captureResponse();
        await registration.http.handleCreate(
          createCtx,
          {} as IncomingMessage,
          response,
          fullBody,
          null,
        );
        assert.equal(response.status, 410, `${id} ${JSON.stringify(body)}: ${response.body}`);
        assert.deepEqual(JSON.parse(response.body), { error: 'retired_game_spec' });
      }
      assert.equal(registration.rooms.size, 0, `${id}: a refused create left a room`);
    }
  });
});

test('retired: the runtime backstop refuses a room created outside the routes', async () => {
  await withFlagsOn(async () => {
    const created = createTenantRuntimeRoom(atomicXiangqiTenant, 'axq_retired_backstop', {
      timeControl: BLITZ,
    });
    assert.deepEqual(created, { ok: false, error: 'disabled' });
  });
});

async function postSeek(gameSpecId: string): Promise<{ status: number | null; body: string }> {
  const ctx = {
    lobbyQueue: [],
    lobbyTickets: new Map(),
    rooms: new Map<string, Room>(),
    isDraining: () => false,
    databaseRequired: false,
  } as unknown as HttpApiContext;
  const json = JSON.stringify({ gameSpecId, timeControl: BLITZ });
  async function* chunks() {
    yield Buffer.from(json);
  }
  const request = chunks() as unknown as IncomingMessage & Record<string, unknown>;
  request.method = 'POST';
  request.headers = {};
  const response = captureResponse();
  assert.equal(await tryHandle(ctx, request, response, '/api/lobby'), true);
  return { status: response.status, body: response.body };
}

test('retired: Find opponent refuses a seek with 410', async () => {
  await withFlagsOn(async () => {
    for (const id of RETIRED) {
      const seek = await postSeek(id);
      assert.equal(seek.status, 410, `${id}: ${seek.body}`);
      assert.deepEqual(JSON.parse(seek.body), { error: 'retired_game_spec' });
    }
  });
});

const ROOM_ID = 'axq_retired_replay';
const LINE: AtomicXiangqiMove[] = [
  { from: 'b3', to: 'e3' },
  { from: 'a7', to: 'a6' },
  { from: 'e3', to: 'e7' },
];

function gameEvents(): AtomicXiangqiEvent[] {
  const events: AtomicXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: ROOM_ID, gameSpecId: ATOMIC_XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'b', seat: 'black' },
  ];
  let state: AtomicXiangqiGameState = createInitialAtomicXiangqiState(ROOM_ID);
  let at = 4;
  for (const move of LINE) {
    const color = state.status.type === 'playing' ? state.status.turn : 'red';
    events.push({ type: 'move-played', at: at++, roomId: ROOM_ID, color, move });
    state = applyAtomicXiangqiMove(state, move);
  }
  return events;
}

test('retired: a game in progress rehydrates after a restart and plays on', () => {
  const hydrated = createTenantRuntimeRoomFromEvents(atomicXiangqiTenant, gameEvents());
  assert.ok(hydrated.ok, 'a retired variant must still rehydrate its live rooms');
  assert.equal(hydrated.room.projection.state.status.type, 'playing');
});

test('retired: a finished game still replays', async () => {
  const events = [
    ...gameEvents(),
    { type: 'seat-resigned', at: 10, roomId: ROOM_ID, color: 'red' } as AtomicXiangqiEvent,
  ];
  const payload = await atomicXiangqiPostgameForApi(ROOM_ID, {
    getGameSummary: async () =>
      ({
        roomId: ROOM_ID,
        variant: ATOMIC_XIANGQI_SPEC_ID,
        mode: 'pvp',
        result: 'black-wins',
        termination: 'resignation',
        plyCount: LINE.length,
        startedAt: new Date(1),
        endedAt: new Date(10),
        participants: [],
      }) as never,
    loadRoomEvents: async () => events,
  });
  assert.ok(payload, 'a retired variant must still serve its finished games');
  assert.equal(payload.game.variant, ATOMIC_XIANGQI_SPEC_ID);
  assert.equal(
    payload.timeline.filter((entry) => entry.type === 'move-played').length,
    LINE.length,
  );
});
