// Three Kingdoms banqi (#628) prod playtest gate (#684, Brian 2026-10-29: "gate
// behind me"). With the local flag off, which is prod, only an admin account
// may create a room or open one over the WebSocket; a guest and a signed-in
// non-admin are refused, never handed another variant. With the flag on,
// everyone is let in (the local playtest). The cases run the real TK
// registration, so a gate that exists only on a stand-in is caught.
//
// The planted failures are the refusals: a non-admin account (accountRole
// 'player') and a guest must be refused at every door, and a refused create
// must leave no room behind. A gate that admitted any signed-in account, or
// that checked the flag only, fails these.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiLegalMoves,
  THREE_KINGDOMS_BANQI_SPEC_ID,
} from '@mistboard/game';
import { collectLiveRoomStats } from './live-room-stats.js';
import type { UserAccount } from './persistence.js';
import type { HttpApiContext } from './routes/lib.js';
import { resolveWebSocketLiveRuntime } from './server-ws-connection.js';
import { threeKingdomsBanqiAdmits } from './three-kingdoms-banqi-access.js';
import { threeKingdomsBanqiEnginePath } from './three-kingdoms-banqi-engine.js';
import { threeKingdomsBanqiRooms } from './three-kingdoms-banqi-registration.js';
import { threeKingdomsBanqiTenant } from './three-kingdoms-banqi-tenant.js';
import './variant-tenant/register-tenants.js';
import {
  registeredVariantTenants,
  type TenantCreateHttpContext,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';

const FLAG = 'MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED';
const BLITZ = { initialMs: 300_000, incrementMs: 5_000 };

function account(accountRole: UserAccount['accountRole']): UserAccount {
  return {
    id: `${accountRole}-1`,
    handle: accountRole,
    displayName: accountRole,
    accountRole,
    playDisabledAt: null,
  } as UserAccount;
}
const ADMIN = account('admin');
const PLAYER = account('player');

async function withFlag<T>(value: 'true' | undefined, run: () => Promise<T>): Promise<T> {
  const before = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env[FLAG];
    else process.env[FLAG] = before;
  }
}

function registration(): VariantTenantRegistration {
  const found = registeredVariantTenants().find(
    (candidate) => candidate.gameSpecId === THREE_KINGDOMS_BANQI_SPEC_ID,
  );
  assert.ok(found, 'three kingdoms banqi is registered');
  return found;
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
  refusesCreate: () => false,
  drainDeadlineMs: () => null,
  reserveLiveEngineSeat: () => Promise.resolve(null),
  releaseLiveEngineReservation: () => undefined,
};

async function create(
  accountUser: UserAccount | null,
  extra: Record<string, unknown> = {},
): Promise<{ status: number | null; body: string; roomsAdded: number }> {
  const before = threeKingdomsBanqiRooms.size;
  const body = {
    gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
    mode: 'pvp',
    timeControl: BLITZ,
    ...extra,
  };
  const reg = registration();
  assert.ok(reg.http.matchesCreateRequest(body));
  const response = captureResponse();
  // The rooms dispatcher hands a tenant null for a non-rated request; the TK
  // registration resolves the account itself (no session here: a guest).
  await reg.http.handleCreate(createCtx, {} as IncomingMessage, response, body, accountUser);
  return {
    status: response.status,
    body: response.body,
    roomsAdded: threeKingdomsBanqiRooms.size - before,
  };
}

test('the admit rule: admin only with the flag off, everyone with it on', async () => {
  await withFlag(undefined, async () => {
    assert.equal(threeKingdomsBanqiAdmits(null), false, 'guest');
    assert.equal(threeKingdomsBanqiAdmits(PLAYER), false, 'signed-in non-admin');
    assert.equal(threeKingdomsBanqiAdmits(ADMIN), true, 'admin');
  });
  await withFlag('true', async () => {
    assert.equal(threeKingdomsBanqiAdmits(null), true, 'guest, flag on');
    assert.equal(threeKingdomsBanqiAdmits(PLAYER), true, 'non-admin, flag on');
  });
});

test('the registration is wired to the admit rule and stays unlisted with the flag off', async () => {
  const reg = registration();
  assert.equal(reg.admitsConnection, threeKingdomsBanqiAdmits);
  await withFlag(undefined, async () => {
    // Every listing surface (TV, current games, lobby, bot profiles) reads this.
    assert.equal(reg.enabled(), false);
    assert.equal(reg.lobby, null, 'no Find opponent');
    assert.equal(reg.createCorrespondenceGameForSeek, null, 'no correspondence');
  });
});

test('create: a guest and a non-admin are refused with the old 404 and no room', async () => {
  await withFlag(undefined, async () => {
    for (const [who, user] of [
      ['guest', null],
      ['non-admin', PLAYER],
    ] as const) {
      const result = await create(user);
      assert.equal(result.status, 404, `${who}: ${result.body}`);
      assert.deepEqual(JSON.parse(result.body), { error: 'three_kingdoms_banqi_disabled' });
      assert.equal(result.roomsAdded, 0, `${who}: no room`);
    }
  });
});

test('create: an admin gets a casual TK room with the flag off, never a rated one', async () => {
  await withFlag(undefined, async () => {
    const result = await create(ADMIN);
    assert.equal(result.status, 201, result.body);
    const created = JSON.parse(result.body) as { roomId: string; gameSpecId: string };
    assert.equal(created.gameSpecId, THREE_KINGDOMS_BANQI_SPEC_ID);
    assert.ok(created.roomId.startsWith('tkb_'), created.roomId);
    assert.equal(result.roomsAdded, 1);

    const rated = await create(ADMIN, { rated: true });
    assert.notEqual(rated.status, 201, `rated must be refused: ${rated.body}`);
    assert.equal(rated.roomsAdded, 0);
  });
});

test('create: the local flag on admits a guest', async () => {
  await withFlag('true', async () => {
    const result = await create(null);
    assert.equal(result.status, 201, result.body);
  });
});

test('websocket: a live TK room refuses a guest and a non-admin, admits an admin', async () => {
  const reg = registration();
  const room = {
    id: 'tkb_gatelive',
    clients: new Set(),
    pendingWrites: Promise.resolve(),
  } as unknown as TenantManagedRoom;
  const rooms = threeKingdomsBanqiRooms as unknown as Map<string, TenantManagedRoom>;
  rooms.set(room.id, room);
  try {
    await withFlag(undefined, async () => {
      const refused = { kind: 'variant-tenant-unavailable', reason: 'game spec disabled' };
      for (const user of [null, PLAYER]) {
        assert.deepEqual(
          await resolveWebSocketLiveRuntime([reg], room.id, async () => user),
          refused,
          `${user?.accountRole ?? 'guest'} must not reach a live room`,
        );
      }
      // The default (no account resolver) is a guest: refused.
      assert.deepEqual(await resolveWebSocketLiveRuntime([reg], room.id), refused);
      const admitted = await resolveWebSocketLiveRuntime([reg], room.id, async () => ADMIN);
      assert.equal(admitted.kind, 'variant-tenant');
    });
    await withFlag('true', async () => {
      const open = await resolveWebSocketLiveRuntime([reg], room.id, async () => null);
      assert.equal(open.kind, 'variant-tenant', 'flag on: a guest reaches the room');
    });
  } finally {
    rooms.delete(room.id);
  }
});

test('websocket: a persisted TK room id hydrates for an admin only', async () => {
  const reg = registration();
  await withFlag(undefined, async () => {
    for (const user of [null, PLAYER]) {
      assert.deepEqual(
        await resolveWebSocketLiveRuntime([reg], 'tkb_gatepersisted', async () => user),
        { kind: 'variant-tenant-unavailable', reason: 'game spec disabled' },
      );
    }
    // Past the gate, the admin reaches hydration (no database here: unavailable).
    assert.deepEqual(
      await resolveWebSocketLiveRuntime([reg], 'tkb_gatepersisted', async () => ADMIN),
      { kind: 'variant-tenant-unavailable', reason: 'room unavailable' },
    );
  });
});

test('websocket: the account is resolved only for an account-gated tenant', async () => {
  let asked = 0;
  const others = registeredVariantTenants().filter((reg) => reg.admitsConnection === undefined);
  assert.ok(others.length > 0);
  await resolveWebSocketLiveRuntime(others, 'room-chess', async () => {
    asked += 1;
    return null;
  });
  assert.equal(asked, 0);
});

test('engine path: unset env falls back to the fetched bin/three-kingdoms-engine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-engine-'));
  try {
    // Planted: nothing fetched yet, so no bot (unless this box has /app/bin).
    const before = threeKingdomsBanqiEnginePath({}, dir);
    assert.ok(before === null || before === '/app/bin/three-kingdoms-engine', String(before));

    mkdirSync(join(dir, 'bin'));
    const fetched = join(dir, 'bin', 'three-kingdoms-engine');
    writeFileSync(fetched, '#!/bin/sh\n');
    chmodSync(fetched, 0o755);
    assert.equal(threeKingdomsBanqiEnginePath({}, dir), fetched);

    // A set path wins, and a set path that is missing means no bot, never a
    // silent fallback to the fetched binary.
    assert.equal(
      threeKingdomsBanqiEnginePath(
        { MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH: join(dir, 'missing') },
        dir,
      ),
      null,
    );
    assert.equal(
      threeKingdomsBanqiEnginePath({ MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH: fetched }, '/'),
      fetched,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live stats: an admin TK game in play never names the variant on /api/live-stats', async () => {
  const roomId = 'tkb_gatestats';
  const now = Date.now();
  const deal = createThreeKingdomsBanqiSetup(Math.random).deal;
  const firstMove = getThreeKingdomsBanqiLegalMoves(
    createThreeKingdomsBanqiStateFromSetup(roomId, { deal }),
  )[0]!;
  const hydrated = createTenantRuntimeRoomFromEvents(threeKingdomsBanqiTenant, [
    {
      type: 'room-created',
      at: now - 3,
      roomId,
      gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
      timeControl: BLITZ,
      setup: { deal },
    },
    { type: 'seat-assigned', at: now - 2, roomId, clientId: 'admin-a', seat: 'red' },
    { type: 'seat-assigned', at: now - 1, roomId, clientId: 'admin-b', seat: 'black' },
    { type: 'move-played', at: now, roomId, color: 'red', move: firstMove },
  ]);
  if (!hydrated.ok) throw new Error(hydrated.error);
  const room = hydrated.room as unknown as TenantManagedRoom;
  (room as unknown as { clients: Set<unknown> }).clients = new Set([
    { id: 'admin-a', userId: 'u_admin_a', seat: 'red' },
    { id: 'admin-b', userId: 'u_admin_b', seat: 'black' },
  ]);
  const rooms = threeKingdomsBanqiRooms as unknown as Map<string, TenantManagedRoom>;
  rooms.set(roomId, room);
  const ctx = { rooms: new Map() } as unknown as HttpApiContext;
  try {
    // Planted: with the local flag on the same room IS counted, so the fixture
    // really is a game in play and the flag-off assertion is not vacuous.
    await withFlag('true', async () => {
      assert.equal(collectLiveRoomStats(ctx).playingBySpec[THREE_KINGDOMS_BANQI_SPEC_ID], 1);
    });
    await withFlag(undefined, async () => {
      const stats = collectLiveRoomStats(ctx);
      assert.equal(stats.playingBySpec[THREE_KINGDOMS_BANQI_SPEC_ID], undefined);
      assert.equal(stats.playingRoomByUserId.has('u_admin_a'), false, 'no Watch link either');
    });
  } finally {
    rooms.delete(roomId);
  }
});
