import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import type { Color } from '@mistboard/game';
import { darkChessTenant } from '../dark-chess-tenant.js';
import type { HttpApiContext } from '../routes/lib.js';
import { tryHandle } from '../routes/lobby.js';
import type { Room } from '../server-types.js';
import './register-tenants.js';
import { registeredVariantTenants } from './registry.js';
import {
  createTenantRuntimeRoom,
  tenantRoomIsLobbyMatch,
  tenantSnapshotPayload,
} from './runtime.js';

// A lobby match must produce a room the rest of the stack can tell apart from an
// invite link: the no-show abort window (lifecycle.ts) and the client's
// "waiting for your opponent to connect" copy both key off it. The lobby route
// marks every tenant's room in one place (createAsLobbyMatch), so this runs the
// real registrations through the real route: a tenant whose lobby.createRoom
// stopped going through createTenantLiveRoom would silently lose the mark and
// fall back to the invite room's 15-minute wait under an invite prompt.

const TENANT_FLAGS = [
  'MISTBOARD_ATOMIC_XIANGQI_ENABLED',
  'MISTBOARD_BANQI_ENABLED',
  'MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED',
  'MISTBOARD_DARK_XIANGQI_ENABLED',
  'MISTBOARD_DUCK_XIANGQI_ENABLED',
  'MISTBOARD_FORTRESS_XIANGQI_ENABLED',
  'MISTBOARD_JIEQI_ENABLED',
  'MISTBOARD_JUNGLE_ENABLED',
  'MISTBOARD_JUNGLE_FLIP_ENABLED',
  'MISTBOARD_XIANGQI_ENABLED',
];

const tc = { initialMs: 180_000, incrementMs: 2_000 };

function lobbyContext(): HttpApiContext {
  return {
    abandonRoom: async () => ({ ok: false, error: 'not_found' }),
    activeGameCount: () => 0,
    annotationsFile: '',
    createRoom: async () => {
      throw new Error('the chess factory is not under test here');
    },
    databaseRequired: false,
    drainDeadlineMs: () => null,
    inMemoryGameSummary: () => null,
    isDraining: () => false,
    liveClockIncrementMs: 2000,
    liveClockInitialMs: 180000,
    lobbyQueue: [],
    lobbyTickets: new Map(),
    pveBuiltinEngineClientId: 'engine',
    releaseLiveEngineReservation: () => {},
    reserveLiveEngineSeat: async () => null,
    rooms: new Map<string, Room>(),
  } as HttpApiContext;
}

async function postSeek(ctx: HttpApiContext, gameSpecId: string): Promise<Record<string, unknown>> {
  const json = JSON.stringify({ gameSpecId, timeControl: tc });
  async function* chunks() {
    yield Buffer.from(json);
  }
  const request = chunks() as unknown as IncomingMessage & Record<string, unknown>;
  request.method = 'POST';
  request.headers = {};
  let body = '';
  const response = {
    writeHead: () => response,
    end: (chunk?: string) => {
      body += chunk ?? '';
      return response;
    },
  } as unknown as ServerResponse;
  assert.equal(await tryHandle(ctx, request, response, '/api/lobby'), true);
  return JSON.parse(body) as Record<string, unknown>;
}

function withTenantFlags(fn: () => Promise<void>): Promise<void> {
  const before = new Map(TENANT_FLAGS.map((flag) => [flag, process.env[flag]]));
  for (const flag of TENANT_FLAGS) process.env[flag] = 'true';
  return fn().finally(() => {
    for (const [flag, value] of before) {
      if (value === undefined) delete process.env[flag];
      else process.env[flag] = value;
    }
  });
}

test('every tenant lobby match creates a room marked as a lobby match', async () => {
  await withTenantFlags(async () => {
    const lobbyTenants = registeredVariantTenants().filter(
      (registration) => registration.lobby !== null && registration.ownsSpecRouting,
    );
    assert.ok(lobbyTenants.length >= 10, `expected every lobby tenant, got ${lobbyTenants.length}`);
    for (const registration of lobbyTenants) {
      assert.ok(registration.enabled(), `${registration.kind} must be enabled for the test`);
      const ctx = lobbyContext();
      const seek = await postSeek(ctx, registration.gameSpecId);
      assert.equal(seek.status, 'waiting', registration.kind);
      const match = await postSeek(ctx, registration.gameSpecId);
      assert.equal(match.status, 'matched', registration.kind);
      const room = registration.rooms.get(match.roomId as string) as
        | { events: readonly { type: string }[] }
        | undefined;
      assert.ok(room, `${registration.kind}: matched room must be live`);
      assert.equal(tenantRoomIsLobbyMatch(room), true, `${registration.kind}: room not marked`);
    }
  });
});

test('a room a tenant creates outside the lobby route is not marked', async () => {
  await withTenantFlags(async () => {
    for (const registration of registeredVariantTenants()) {
      if (!registration.lobby || !registration.ownsSpecRouting) continue;
      const created = await registration.lobby.createRoom(tc, false);
      const room = registration.rooms.get(created.id) as
        | { events: readonly { type: string }[] }
        | undefined;
      assert.ok(room, registration.kind);
      assert.equal(tenantRoomIsLobbyMatch(room), false, `${registration.kind}: leaked mark`);
    }
  });
});

test('the snapshot tells the client a lobby room apart and leaves invite rooms unchanged', () => {
  const client = { id: 'white-client', seat: 'white' as Color, solo: false };
  const lobby = createTenantRuntimeRoom(darkChessTenant, 'dchx_lobby_wire', {
    lobbyMatch: true,
    timeControl: tc,
  });
  const invite = createTenantRuntimeRoom(darkChessTenant, 'dchx_invite_wire', { timeControl: tc });
  assert.ok(lobby.ok && invite.ok);
  assert.equal(tenantSnapshotPayload(darkChessTenant, lobby.room, client).lobbyMatch, true);
  assert.equal(
    'lobbyMatch' in tenantSnapshotPayload(darkChessTenant, invite.room, client),
    false,
    'an invite room carries no new key, so golden wires stay byte-identical',
  );
});
