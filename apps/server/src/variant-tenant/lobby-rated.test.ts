/**
 * Rated matchmaking conformance across every registered variant tenant.
 *
 * POST /api/lobby honours `rated: true` for a tenant whose `lobby.supportsRated`
 * is true and then calls `lobby.createRoom(timeControl, rated)`. Nothing in the
 * type system makes a registration forward that flag: jieqi advertised rated
 * from 2026-08-28 while its createRoom dropped the argument, so every rated
 * jieqi seek produced a casual room and no rating ever moved. These tests drive
 * each tenant's real lobby factory, so a variant cannot advertise rated without
 * threading it into the room, and cannot hold a rating pool while its lobby
 * stays casual-only.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { type GameSpecId, ratingPoolForSpec } from '@mistboard/game';
import { atomicXiangqiTenant } from '../atomic-xiangqi-tenant.js';
import { banqiTenant } from '../banqi-tenant.js';
import { crazyhouseXiangqiTenant } from '../crazyhouse-xiangqi-tenant.js';
import { darkXiangqiTenant } from '../dark-xiangqi-tenant.js';
import { duckXiangqiTenant } from '../duck-xiangqi-tenant.js';
import { fortressXiangqiTenant } from '../fortress-xiangqi-tenant.js';
import { jieqiTenant } from '../jieqi-tenant.js';
import { jungleFlipTenant } from '../jungle-flip-tenant.js';
import { jungleTenant } from '../jungle-tenant.js';
import { createUser, recordGameEnd, type UserAccount } from '../persistence.js';
import {
  definePersistenceTests,
  test as persistenceTest,
  pg,
  TEST_DATABASE_URL,
} from '../persistence-test-support.js';
import { xiangqiTenant } from '../xiangqi-tenant.js';
import { buildTenantGameSummary } from './events.js';
import './register-tenants.js';
import {
  lobbyOffersRated,
  registeredVariantTenants,
  type TenantCreateHttpContext,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './registry.js';
import {
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  tenantSnapshotPayload,
} from './runtime.js';
import { assignTenantSeat, type TenantSeatRoom } from './seat-session.js';
import type { TenantGameStateLike, TenantSeatTokenState, VariantTenant } from './tenant.js';

// 3+2: a rated pace on every tenant's lobby allowlist.
const BLITZ = { initialMs: 180_000, incrementMs: 2_000 };

function lobbyTenants(): VariantTenantRegistration[] {
  return registeredVariantTenants().filter((registration) => registration.lobby !== null);
}

// Every tenant's launch flag follows MISTBOARD_<KIND>_ENABLED (feature-flags.ts).
function enableFlagFor(kind: string): string {
  return `MISTBOARD_${kind.toUpperCase().replace(/-/g, '_')}_ENABLED`;
}

async function withTenantEnabled<T>(
  registration: { kind: string; enabled(): boolean; clearRooms?(): void },
  run: () => Promise<T> | T,
): Promise<T> {
  const flag = enableFlagFor(registration.kind);
  const previous = process.env[flag];
  process.env[flag] = 'true';
  try {
    assert.equal(
      registration.enabled(),
      true,
      `${registration.kind}: ${flag}=true did not enable the tenant; update enableFlagFor`,
    );
    return await run();
  } finally {
    registration.clearRooms?.();
    if (previous === undefined) delete process.env[flag];
    else process.env[flag] = previous;
  }
}

function roomRated(room: TenantManagedRoom | undefined): boolean | undefined {
  return room?.projection?.rated;
}

test('lobby: every matchmaking tenant with a rating pool offers rated seeks', () => {
  const casualOnly = lobbyTenants()
    .filter((registration) => ratingPoolForSpec(registration.gameSpecId as GameSpecId) !== null)
    .filter((registration) => registration.lobby?.supportsRated !== true)
    .map((registration) => registration.gameSpecId);
  assert.deepEqual(
    casualOnly,
    [],
    `tenants with a rating pool whose lobby rejects rated seeks: ${casualOnly.join(', ')}`,
  );
});

test('lobby: no tenant advertises rated without a rating pool to write to', () => {
  const poolless = lobbyTenants()
    .filter((registration) => registration.lobby?.supportsRated === true)
    .filter((registration) => ratingPoolForSpec(registration.gameSpecId as GameSpecId) === null)
    .map((registration) => registration.gameSpecId);
  assert.deepEqual(
    poolless,
    [],
    `tenants advertising rated with no active rating pool (spec rated flag + user_ratings CHECK): ${poolless.join(', ')}`,
  );
});

test('lobby: every rated lobby threads the rated flag into the room it creates', async () => {
  const rated = lobbyTenants().filter((registration) => registration.lobby?.supportsRated);
  assert.ok(rated.length > 0, 'expected at least one rated lobby tenant');
  for (const registration of rated) {
    await withTenantEnabled(registration, async () => {
      const lobby = registration.lobby!;
      const ratedRoom = await lobby.createRoom(BLITZ, true);
      assert.equal(
        roomRated(registration.rooms.get(ratedRoom.id)),
        true,
        `${registration.kind}: a rated lobby match created a casual room (createRoom drops rated)`,
      );
      const casualRoom = await lobby.createRoom(BLITZ, false);
      assert.notEqual(
        roomRated(registration.rooms.get(casualRoom.id)),
        true,
        `${registration.kind}: a casual lobby match created a rated room`,
      );
    });
  }
});

// ── Rated friend rooms (POST /api/rooms, mode 'pvp') ─────────────────────────
//
// Lichess-style: a friend game may be rated on exactly the variants where Find
// opponent is. Until 2026-10-03 each create route kept its own hand-set rated
// policy, and when rated lobby play widened on 2026-10-02 only the lobby moved,
// so seven variants rated their seeks while their friend rooms answered 501.
// These drive every registration's real create handler, so a variant whose
// lobby rates cannot refuse (or silently drop) a rated friend room.

const RATED_FLAG = 'MISTBOARD_RATED_ENABLED';
const ACCOUNT = { id: 'user-friend', handle: 'friend', displayName: 'Friend' } as UserAccount;

const createCtx: TenantCreateHttpContext = {
  databaseRequired: false,
  isDraining: () => false,
  drainDeadlineMs: () => null,
  reserveLiveEngineSeat: () => Promise.resolve(null),
  releaseLiveEngineReservation: () => undefined,
};

type Capture = { body: string; status: number | null };

function captureResponse(): ServerResponse & Capture {
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
  return capture as unknown as ServerResponse & Capture;
}

async function createFriendRoom(
  registration: VariantTenantRegistration,
  body: Record<string, unknown>,
  accountUser: UserAccount | null,
): Promise<{ status: number | null; json: Record<string, unknown> }> {
  const response = captureResponse();
  const request = {} as IncomingMessage;
  const fullBody = { gameSpecId: registration.gameSpecId, ...body };
  assert.ok(
    registration.http.matchesCreateRequest(fullBody),
    `${registration.kind}: POST /api/rooms does not route this body to the tenant`,
  );
  await registration.http.handleCreate(createCtx, request, response, fullBody, accountUser);
  return { status: response.status, json: JSON.parse(response.body) as Record<string, unknown> };
}

async function withRatedOn<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env[RATED_FLAG];
  process.env[RATED_FLAG] = 'true';
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[RATED_FLAG];
    else process.env[RATED_FLAG] = previous;
  }
}

// Registrations that own their spec's create route (not the correspondence-only
// dark-chess slice, whose friend rooms are the legacy chess path).
function routingTenants(): VariantTenantRegistration[] {
  return registeredVariantTenants().filter((registration) => registration.ownsSpecRouting);
}

test('friend rooms: lobbyOffersRated is the lobby capability, per spec', () => {
  for (const registration of routingTenants()) {
    assert.equal(
      lobbyOffersRated(registration.gameSpecId),
      registration.lobby?.supportsRated === true,
      registration.kind,
    );
  }
});

test('friend rooms: every variant whose lobby rates creates a rated friend room', async () => {
  const rated = routingTenants().filter((registration) => registration.lobby?.supportsRated);
  assert.ok(rated.length > 0, 'expected at least one rated lobby tenant');
  await withRatedOn(async () => {
    for (const registration of rated) {
      await withTenantEnabled(registration, async () => {
        const created = await createFriendRoom(
          registration,
          { mode: 'pvp', rated: true, timeControl: BLITZ },
          ACCOUNT,
        );
        assert.equal(
          created.status,
          201,
          `${registration.kind}: Find opponent rates, but a rated friend room was refused: ${JSON.stringify(created.json)}`,
        );
        assert.equal(created.json.rated, true, `${registration.kind}: response says casual`);
        const roomId = created.json.roomId as string;
        assert.equal(
          roomRated(registration.rooms.get(roomId)),
          true,
          `${registration.kind}: the route said rated but the room is casual (rated not forwarded)`,
        );

        const casual = await createFriendRoom(
          registration,
          { mode: 'pvp', rated: false, timeControl: BLITZ },
          ACCOUNT,
        );
        assert.equal(casual.status, 201, registration.kind);
        assert.equal(
          casual.json.rated,
          false,
          `${registration.kind}: a casual friend room is rated`,
        );
      });
    }
  });
});

test('friend rooms: rated needs a signed-in creator, a rated pace and a human opponent', async () => {
  const rated = routingTenants().filter((registration) => registration.lobby?.supportsRated);
  await withRatedOn(async () => {
    for (const registration of rated) {
      await withTenantEnabled(registration, async () => {
        const guest = await createFriendRoom(
          registration,
          { mode: 'pvp', rated: true, timeControl: BLITZ },
          null,
        );
        assert.equal(guest.status, 401, registration.kind);
        assert.deepEqual(guest.json, { error: 'rated_requires_account' }, registration.kind);

        const slow = await createFriendRoom(
          registration,
          { mode: 'pvp', rated: true, timeControl: { initialMs: 600_000, incrementMs: 5_000 } },
          ACCOUNT,
        );
        assert.equal(slow.status, 400, registration.kind);
        assert.deepEqual(slow.json, { error: 'rated_time_control_unsupported' }, registration.kind);

        // Bot games stay casual: refused before any engine seat is reserved.
        const bot = await createFriendRoom(
          registration,
          { mode: 'pve', rated: true, timeControl: BLITZ },
          ACCOUNT,
        );
        assert.equal(bot.status, 501, registration.kind);
        assert.deepEqual(
          bot.json,
          { error: `${registration.errorPrefix}_unsupported_surface` },
          registration.kind,
        );
      });
    }
  });
});

test('friend rooms: a variant whose lobby does not rate refuses a rated friend room', async () => {
  const casualOnly = routingTenants().filter((registration) => !registration.lobby?.supportsRated);
  await withRatedOn(async () => {
    for (const registration of casualOnly) {
      await withTenantEnabled(registration, async () => {
        const created = await createFriendRoom(
          registration,
          { mode: 'pvp', rated: true, timeControl: BLITZ },
          ACCOUNT,
        );
        assert.notEqual(
          created.status,
          201,
          `${registration.kind}: rated room with no rated lobby`,
        );
      });
    }
  });
});

test('friend rooms: a guest is refused either seat of a rated Jieqi friend room', async () => {
  const registration = routingTenants().find(
    (candidate) => candidate.gameSpecId === jieqiTenant.gameSpecId,
  );
  assert.ok(registration, 'jieqi is registered');
  await withRatedOn(() =>
    withTenantEnabled(registration, async () => {
      const created = await createFriendRoom(
        registration,
        { mode: 'pvp', rated: true, timeControl: BLITZ },
        ACCOUNT,
      );
      assert.equal(created.status, 201);
      const room = registration.rooms.get(
        created.json.roomId as string,
      ) as unknown as TenantSeatRoom<'red' | 'black'>;
      assert.ok(room, 'the friend room is live');
      assert.deepEqual(assignTenantSeat(jieqiTenant, room, 'guest-first', undefined, null), {
        ok: false,
        reason: 'rated requires account',
      });
      const creator = assignTenantSeat(jieqiTenant, room, 'creator', undefined, ACCOUNT);
      assert.ok(creator.ok, 'the signed-in creator takes a seat');
      assert.deepEqual(assignTenantSeat(jieqiTenant, room, 'guest-second', undefined, null), {
        ok: false,
        reason: 'rated requires account',
      });
      const friend = assignTenantSeat(jieqiTenant, room, 'friend', undefined, {
        ...ACCOUNT,
        id: 'user-friend-2',
      });
      assert.ok(friend.ok, 'a signed-in friend takes the second seat');
    }),
  );
});

type AnyTenant = VariantTenant<
  string,
  string,
  unknown,
  TenantGameStateLike<string>,
  unknown,
  string
>;

// The tenant objects behind every rated lobby; the first assertion below fails
// when a new rated lobby is missing here, so the summary check cannot go stale.
const RATED_LOBBY_TENANTS = [
  xiangqiTenant,
  fortressXiangqiTenant,
  atomicXiangqiTenant,
  crazyhouseXiangqiTenant,
  duckXiangqiTenant,
  jieqiTenant,
  banqiTenant,
  jungleTenant,
  jungleFlipTenant,
  darkXiangqiTenant,
] as unknown as readonly AnyTenant[];

function userSeatToken(color: string, userId: string): TenantSeatTokenState<string> {
  const now = new Date();
  return {
    clientId: `client-${userId}`,
    seat: color,
    tokenHash: `hash-${userId}`,
    userId,
    userHandle: userId,
    userDisplayName: userId,
    issuedAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
}

test('lobby: a finished rated game between two accounts is summarised as rated', async () => {
  const covered = new Set(RATED_LOBBY_TENANTS.map((tenant) => tenant.gameSpecId));
  const missing = lobbyTenants()
    .filter((registration) => registration.lobby?.supportsRated)
    .map((registration) => registration.gameSpecId)
    .filter((gameSpecId) => !covered.has(gameSpecId));
  assert.deepEqual(missing, [], `add these tenants to RATED_LOBBY_TENANTS: ${missing.join(', ')}`);

  for (const tenant of RATED_LOBBY_TENANTS) {
    await withTenantEnabled(tenant, () => {
      const created = createTenantRuntimeRoom(tenant, `${tenant.roomIdPrefix}rated-summary`, {
        rated: true,
        timeControl: BLITZ,
      });
      assert.ok(created.ok, `${tenant.kind}: room creation failed`);
      const room = created.room;
      assert.equal(room.rated, true, `${tenant.kind}: room-created rated flag not projected`);
      const [first, second] = tenant.colors as readonly [string, string];
      room.seatTokens = {
        [first]: userSeatToken(first, 'user-first'),
        [second]: userSeatToken(second, 'user-second'),
      };
      room.projection.state = tenant.rules.finish(room.projection.state, second, 'resignation');
      const summary =
        tenant.persistence.buildGameSummary?.(room) ?? buildTenantGameSummary(tenant, room);
      assert.equal(summary.variant, tenant.gameSpecId);
      assert.equal(summary.mode, 'pvp');
      assert.equal(summary.rated, true, `${tenant.kind}: rated game summarised as casual`);
      assert.deepEqual(
        summary.participants?.map((participant) => participant.subjectType),
        ['user', 'user'],
      );
    });
  }
});

test('rated rooms: every seat and spectator snapshot says the room is rated', async () => {
  // The room header reads Rated/Casual off the frame's `rated`. It used to ride
  // only in some tenants' snapshotExtras, so rated jieqi, banqi, jungle, flip
  // jungle and Fog Xiangqi games (lobby-paired and friend alike) showed Casual.
  for (const tenant of RATED_LOBBY_TENANTS) {
    await withTenantEnabled(tenant, () => {
      const rated = createTenantRuntimeRoom(tenant, `${tenant.roomIdPrefix}rated-frame`, {
        rated: true,
        timeControl: BLITZ,
      });
      const casual = createTenantRuntimeRoom(tenant, `${tenant.roomIdPrefix}casual-frame`, {
        timeControl: BLITZ,
      });
      assert.ok(rated.ok && casual.ok, `${tenant.kind}: room creation failed`);
      for (const seat of [...tenant.colors, 'spectator']) {
        const client = { id: `client-${seat}`, seat, solo: false };
        assert.equal(
          tenantSnapshotPayload(tenant, rated.room, client).rated,
          true,
          `${tenant.kind}: a rated room's ${seat} snapshot does not say rated`,
        );
        assert.notEqual(
          tenantSnapshotPayload(tenant, casual.room, client).rated,
          true,
          `${tenant.kind}: a casual room's ${seat} snapshot says rated`,
        );
      }
    });
  }
});

// Drop the fields a rated flag may legitimately change (the flag itself) and the
// wall clock, so what is left is everything a client can learn from the room.
function withoutRatedFlag(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRatedFlag);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'rated' && key !== 'serverAt')
        .map(([key, entry]) => [key, withoutRatedFlag(entry)]),
    );
  }
  return value;
}

test('lobby: the rated flag adds no hidden information to any seat or spectator snapshot', async () => {
  // Fog Xiangqi, Jieqi, Banqi and Flip Jungle carry hidden state in the room
  // (a deal, face-down identities). The rated room is the casual room's own
  // event log with rated set on room-created, so the same deal, and every
  // seat's and the spectator's snapshot must differ in nothing but the flag.
  for (const tenant of RATED_LOBBY_TENANTS) {
    await withTenantEnabled(tenant, () => {
      const casual = createTenantRuntimeRoom(tenant, `${tenant.roomIdPrefix}rated-wire`, {
        timeControl: BLITZ,
        now: 1_000,
      });
      assert.ok(casual.ok, `${tenant.kind}: room creation failed`);
      const ratedEvents = casual.room.events.map((event, index) =>
        index === 0 ? { ...event, rated: true } : event,
      );
      const rated = createTenantRuntimeRoomFromEvents(tenant, ratedEvents);
      assert.ok(rated.ok, `${tenant.kind}: rated event log did not hydrate`);
      assert.equal(rated.room.rated, true);
      for (const seat of [...tenant.colors, 'spectator']) {
        const client = { id: `client-${seat}`, seat, solo: false };
        assert.deepEqual(
          withoutRatedFlag(tenantSnapshotPayload(tenant, rated.room, client)),
          withoutRatedFlag(tenantSnapshotPayload(tenant, casual.room, client)),
          `${tenant.kind}: a rated room's ${seat} snapshot differs beyond the rated flag`,
        );
      }
    });
  }
});

// End to end through the database: a seek matched in the lobby, a finished game
// between two accounts, and the result write. The unit tests above prove each
// hop; this proves the pool exists in the user_ratings CHECK (migration 158)
// and both ratings move, the step that failed silently for atomic and duck.
definePersistenceTests('lobby rated', () => {
  persistenceTest('a rated Crazyhouse Xiangqi lobby game moves both ratings', async () => {
    const registration = registeredVariantTenants().find(
      (candidate) => candidate.gameSpecId === crazyhouseXiangqiTenant.gameSpecId,
    );
    assert.ok(registration?.lobby?.supportsRated, 'crazyhouse lobby must offer rated seeks');
    const now = new Date();
    for (const id of ['user_chx_red', 'user_chx_black']) {
      await createUser({
        id,
        email: `${id}@example.com`,
        emailVerifiedAt: now,
        handle: id.replace(/_/g, ''),
        displayName: id,
        now,
      });
    }
    await withTenantEnabled(registration, async () => {
      const created = await registration.lobby!.createRoom(BLITZ, true);
      const room = registration.rooms.get(created.id) as unknown as
        | (ReturnType<typeof createTenantRuntimeRoom> & { ok: true })['room']
        | undefined;
      assert.ok(room, 'the lobby room is live');
      assert.equal(room.rated, true);
      room.seatTokens = {
        red: userSeatToken('red', 'user_chx_red'),
        black: userSeatToken('black', 'user_chx_black'),
      };
      const tenant = crazyhouseXiangqiTenant as unknown as AnyTenant;
      room.projection.state = tenant.rules.finish(room.projection.state, 'black', 'resignation');
      const summary =
        tenant.persistence.buildGameSummary?.(room) ?? buildTenantGameSummary(tenant, room);
      assert.equal(summary.rated, true);
      await recordGameEnd(created.id, summary);
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ user_id: string; elo_rating: number }>(
        `SELECT user_id, elo_rating FROM user_ratings
         WHERE variant = 'crazyhouse_xiangqi' AND time_class = 'blitz'`,
      );
      const red = rows.find((row) => row.user_id === 'user_chx_red');
      const black = rows.find((row) => row.user_id === 'user_chx_black');
      assert.ok(
        red && black,
        `both seats got a crazyhouse_xiangqi rating row: ${JSON.stringify(rows)}`,
      );
      assert.ok(black.elo_rating > 1500, `winner ${black.elo_rating}`);
      assert.ok(red.elo_rating < 1500, `loser ${red.elo_rating}`);
    } finally {
      await client.end();
    }
  });

  persistenceTest('a rated Jieqi friend room game moves both ratings', async () => {
    const registration = routingTenants().find(
      (candidate) => candidate.gameSpecId === jieqiTenant.gameSpecId,
    );
    assert.ok(registration, 'jieqi is registered');
    const now = new Date();
    for (const id of ['user_jq_red', 'user_jq_black']) {
      await createUser({
        id,
        email: `${id}@example.com`,
        emailVerifiedAt: now,
        handle: id.replace(/_/g, ''),
        displayName: id,
        now,
      });
    }
    let roomId = '';
    await withRatedOn(() =>
      withTenantEnabled(registration, async () => {
        const created = await createFriendRoom(
          registration,
          { mode: 'pvp', rated: true, timeControl: BLITZ },
          { ...ACCOUNT, id: 'user_jq_red' },
        );
        assert.equal(created.status, 201, JSON.stringify(created.json));
        roomId = created.json.roomId as string;
        const room = registration.rooms.get(roomId) as unknown as
          | (ReturnType<typeof createTenantRuntimeRoom> & { ok: true })['room']
          | undefined;
        assert.ok(room, 'the friend room is live');
        assert.equal(room.rated, true);
        room.seatTokens = {
          red: userSeatToken('red', 'user_jq_red'),
          black: userSeatToken('black', 'user_jq_black'),
        };
        const tenant = jieqiTenant as unknown as AnyTenant;
        room.projection.state = tenant.rules.finish(room.projection.state, 'red', 'resignation');
        const summary =
          tenant.persistence.buildGameSummary?.(room) ?? buildTenantGameSummary(tenant, room);
        assert.equal(summary.rated, true);
        await recordGameEnd(roomId, summary);
      }),
    );

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ user_id: string; elo_rating: number }>(
        `SELECT user_id, elo_rating FROM user_ratings
         WHERE variant = 'jieqi' AND time_class = 'blitz'`,
      );
      const red = rows.find((row) => row.user_id === 'user_jq_red');
      const black = rows.find((row) => row.user_id === 'user_jq_black');
      assert.ok(red && black, `both seats got a jieqi rating row: ${JSON.stringify(rows)}`);
      assert.ok(red.elo_rating > 1500, `winner ${red.elo_rating}`);
      assert.ok(black.elo_rating < 1500, `loser ${black.elo_rating}`);
    } finally {
      await client.end();
    }
  });
});
