import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { type TestContext, test } from 'node:test';
import { type BanqiSetup, isRetiredGameSpec, type JieqiDeal } from '@mistboard/game';
import { createWithAccountSeats } from '../account-room.js';
import { banqiTenant } from '../banqi-tenant.js';
import { jieqiTenant } from '../jieqi-tenant.js';
import { LIVE_INVITE_TTL_MS } from '../live-invites.js';
import * as persistence from '../persistence.js';
import { getPool } from '../persistence-db.js';
import { clearPresence, heartbeatLiveInvites, leaveLiveInvites } from '../presence.js';
import { clearRoomRuntimeTimers } from '../server-lifecycle.js';
import { createRoomLifecycle, type RoomLifecycleConfig } from '../server-room-lifecycle.js';
import { assignSeat } from '../server-seat-session.js';
import type { Room } from '../server-types.js';
import { registeredVariantTenants, variantTenantForSpecId } from '../variant-tenant/registry.js';
import '../variant-tenant/register-tenants.js';
import { getOrLoadTenantRoom } from '../variant-tenant/hydration.js';
import { createTenantLiveRoom } from '../variant-tenant/room-factory.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantLiveHistoryExtras,
  tenantSnapshotPayload,
} from '../variant-tenant/runtime.js';
import { assignTenantSeat } from '../variant-tenant/seat-session.js';
import type { HttpApiContext } from './lib.js';
import { createLiveInviteHandler } from './live-invites.js';

function setFlag(t: TestContext, name: string, value: string) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

const clock = { initialMs: 180_000, incrementMs: 2_000 };
const identity = (id: string) => ({ userId: id, userHandle: id, userDisplayName: id });

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// The production transaction writer, factories, reducers and hydrators remain
// real. This adapter models COMMIT/ROLLBACK and holds a write deterministically,
// without requiring sockets or a database process.
function database(t: TestContext) {
  persistence.init('postgres://unused/unused');
  t.after(() => persistence.close());
  const events = new Map<string, persistence.PersistedRoomEvent[]>();
  const seats = new Map<string, Map<string, unknown[]>>();
  const games = new Set<string>();
  const durableBusy = new Set<string>();
  const statements: string[] = [];
  let fail = '';
  let onQuery = async (_sql: string) => {};
  let commits = 0;
  let rollbacks = 0;
  const pool = getPool();
  async function query(sql: string, args: unknown[] = [], staged?: (() => void)[]) {
    statements.push(sql);
    await onQuery(sql);
    if (fail && sql.includes(fail)) {
      fail = '';
      throw new Error('planted write failure');
    }
    const id = String(args[0]);
    if (sql.startsWith('INSERT INTO')) {
      const write = () => {
        if (sql.startsWith('INSERT INTO events')) {
          const log = events.get(id) ?? [];
          assert.equal(args[1], log.length);
          log.push(structuredClone(args[3]) as persistence.PersistedRoomEvent);
          events.set(id, log);
        } else if (sql.startsWith('INSERT INTO room_seat_tokens')) {
          const tokens = seats.get(id) ?? new Map<string, unknown[]>();
          tokens.set(String(args[1]), structuredClone(args));
          seats.set(id, tokens);
        } else if (sql.startsWith('INSERT INTO games')) games.add(id);
        else assert.fail(`unexpected write: ${sql}`);
      };
      if (staged) staged.push(write);
      else write();
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT DISTINCT seats.room_id'))
      return {
        rows: durableBusy.has(id)
          ? [
              {
                room_id: 'unloaded-live-room',
                time_control: clock,
                last_event_seq: 2,
                last_event_at_ms: Date.now(),
              },
            ]
          : [],
      };
    if (sql.includes('SELECT payload FROM events'))
      return {
        rows: (events.get(id) ?? []).map((payload) => ({ payload })),
      };
    if (sql.includes('FROM room_seat_tokens'))
      return {
        rows: [...(seats.get(id)?.values() ?? [])].map((a) => ({
          seat: a[1],
          client_id: a[2],
          token_hash: a[3],
          user_id: a[4],
          issued_at: a[5],
          last_seen_at: a[6],
          revoked_at: a[7],
          device_id: a[8],
          user_handle: a[4],
          user_display_name: a[4],
        })),
      };
    if (sql.includes('FROM variant_access_grants')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('UPDATE room_seat_tokens')) return { rows: [], rowCount: 1 };
    assert.fail(`unexpected query: ${sql}`);
  }
  t.mock.method(pool, 'query', query as typeof pool.query);
  t.mock.method(pool, 'connect', async () => {
    const staged: (() => void)[] = [];
    return {
      query: async (sql: string, args?: unknown[]) => {
        if (sql === 'BEGIN') return { rows: [] };
        if (sql === 'COMMIT') {
          await onQuery(sql);
          if (fail === 'COMMIT') {
            fail = '';
            throw new Error('planted commit failure');
          }
          for (const write of staged) write();
          commits++;
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
          rollbacks++;
          return { rows: [] };
        }
        return query(sql, args, staged);
      },
      release() {},
    };
  });
  return {
    events,
    seats,
    games,
    durableBusy,
    statements,
    fail: (statement: string) => {
      fail = statement;
    },
    onQuery: (callback: typeof onQuery) => {
      onQuery = callback;
    },
    counts: () => ({ commits, rollbacks }),
  };
}

function fixture(t: TestContext) {
  const db = database(t);
  clearPresence();
  let now = Date.now();
  const users = new Map(
    ['sender', 'target', 'other', 'stranger'].map((id) => [
      id,
      {
        id,
        handle: id,
        displayName: id,
        accountPreferences: { liveInvites: true },
        closedAt: null,
        playDisabledAt: null,
        statsExcludedAt: null,
        fairPlayMarkedAt: null,
        accountRole: 'player',
      } as persistence.UserAccount,
    ]),
  );
  const blocks = new Set<string>();
  let follows = true;
  let beforeBlock = async () => {};
  const rooms = new Map<string, Room>();
  const roomMgrCtx: RoomLifecycleConfig['roomMgrCtx'] = {
    send() {},
    recordPersistenceError() {},
    pveBuiltinEngineClientId: 'builtin-random-legal',
    pveEngineMoveDelayMs: 0,
    liveEngineTimeoutMs: 1000,
    liveClockInitialMs: clock.initialMs,
    liveClockIncrementMs: clock.incrementMs,
  };
  const lifecycle = createRoomLifecycle({
    rooms,
    roomMgrCtx,
    defaultRoomRegion: 'global',
    orphanThresholdMs: 300_000,
    guestPrestartAbortMs: 60_000,
    abortPolicySweepMs: 60_000,
    stalePauseMs: 60_000,
    stalePausedSweepMs: 60_000,
    pauseGraceMs: 90_000,
    recordPersistenceError() {},
    releaseLiveEngineReservation() {},
    reserveHydratedLiveEngineSeat: async () => null,
    seatVacateGraceMs: () => 60_000,
  });
  const ctx = {
    rooms,
    now: () => now,
    refusesCreate: () => false,
    createRoom: lifecycle.createRoom,
    pveBuiltinEngineClientId: 'builtin-random-legal',
  } as unknown as HttpApiContext;
  const handler = createLiveInviteHandler({
    currentUser: async (req) => users.get(String(req.headers['x-user'])) ?? null,
    findUser: async (handle) => users.get(handle) ?? null,
    hasFollow: async () => follows,
    hasBlock: async (a, b) => {
      await beforeBlock();
      return blocks.has(`${a}:${b}`);
    },
    available: () => true,
  });
  t.after(() => {
    clearPresence();
    for (const room of rooms.values()) clearRoomRuntimeTimers(room);
    for (const tenant of registeredVariantTenants()) {
      for (const room of tenant.rooms.values()) tenant.clearRuntimeTimers(room);
      tenant.clearRooms();
    }
  });
  for (const id of users.keys()) heartbeatLiveInvites(id, now);
  async function request(user: string, method: string, path: string, body: unknown = {}) {
    const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
    req.method = method;
    req.url = `/api/live-invites${path}`;
    req.headers = { 'x-user': user, host: 'localhost', 'content-type': 'application/json' };
    let status = 0;
    let raw = '';
    const res = {
      setHeader() {},
      writeHead(code: number) {
        status = code;
      },
      end(data: string) {
        raw = data;
      },
    } as unknown as ServerResponse;
    assert.equal(await handler(ctx, req, res, `/api/live-invites${path.split('?')[0]}`), true);
    return { status, raw, body: JSON.parse(raw) };
  }
  async function send(overrides = {}, sender = 'sender') {
    const sent = await request(sender, 'POST', '', {
      targetHandle: 'target',
      gameSpecId: 'dark-chess',
      timeControl: clock,
      preferredColor: 'first',
      ...overrides,
    });
    assert.equal(sent.status, 201, sent.raw);
    return sent.body.invite.id as string;
  }
  return {
    db,
    rooms,
    users,
    blocks,
    ctx,
    lifecycle,
    roomMgrCtx,
    request,
    send,
    noFollow: () => {
      follows = false;
    },
    beforeBlock: (callback: typeof beforeBlock) => {
      beforeBlock = callback;
    },
    advance: (ms: number) => {
      now += ms;
    },
    renew: () => {
      for (const id of users.keys()) heartbeatLiveInvites(id, now);
    },
  };
}

test('picker and send both reject durable seats in unloaded real-time rooms', async (t) => {
  const h = fixture(t);
  const read = () => h.request('sender', 'GET', '/availability?handle=target');
  assert.equal((await read()).body.players[0].availability, 'available');
  h.db.durableBusy.add('target');
  assert.deepEqual((await read()).body.players, [{ handle: 'target', availability: 'busy' }]);
  const sent = await h.request('sender', 'POST', '', {
    targetHandle: 'target',
    gameSpecId: 'dark-chess',
    timeControl: clock,
  });
  assert.equal(sent.body.error, 'target_unavailable');
  assert.equal(h.rooms.size, 0);
  h.db.durableBusy.clear();
  h.db.durableBusy.add('sender');
  assert.equal((await read()).body.players[0].availability, 'unavailable');
});

test('acceptance durably seats both accounts, preserves terms, replays idempotently and exposes only the requester seat', async (t) => {
  const h = fixture(t);
  setFlag(t, 'MISTBOARD_RATED_ENABLED', 'true');
  const id = await h.send({ preferredColor: 'second', rated: true });
  assert.equal((await h.request('sender', 'POST', `/${id}/accept`)).status, 404);
  assert.equal((await h.request('stranger', 'POST', `/${id}/accept`)).status, 404);
  const accepted = await h.request('target', 'POST', `/${id}/accept`);
  assert.equal(accepted.status, 200, accepted.raw);
  const invite = accepted.body.invite;
  assert.equal(invite.status, 'accepted');
  assert.equal(invite.room.seat, 'white');
  const room = h.rooms.get(invite.room.roomId)!;
  assert.ok(room);
  assert.deepEqual(room.projection.timeControl, clock);
  assert.equal(room.rated, true);
  // An accepted challenge is the room's pairing (#1229), stamped by the server.
  assert.equal(room.pairing, 'live-challenge');
  assert.equal(room.seatTokens.white?.userId, 'target');
  assert.equal(room.seatTokens.black?.userId, 'sender');
  assert.equal(h.db.seats.get(room.id)?.size, 2);
  assert.equal(h.db.games.has(room.id), true);
  assert.deepEqual(h.db.counts(), { commits: 1, rollbacks: 0 });
  assert.deepEqual((await h.request('target', 'POST', `/${id}/accept`)).body, accepted.body);
  assert.equal((await h.request('sender', 'GET', `/${id}`)).body.invite.room.seat, 'black');
  assert.equal((await h.request('sender', 'GET', '')).body.outgoing[0].room.roomId, room.id);
  assert.equal((await h.request('stranger', 'GET', `/${id}`)).status, 404);
  for (const key of ['token', 'clientId', 'userId', 'setup', 'senderSeat', 'targetSeat'])
    assert.equal(accepted.raw.includes(key), false, key);
  for (const owner of ['sender', 'target']) {
    const seat = await assignSeat(
      h.roomMgrCtx,
      room,
      `new-${owner}`,
      undefined,
      h.users.get(owner)!,
    );
    assert.equal(seat.seat, owner === 'sender' ? 'black' : 'white');
    assert.equal(seat.seatToken, undefined);
  }
  assert.equal(
    (await assignSeat(h.roomMgrCtx, room, 'intruder', undefined, h.users.get('stranger')!)).seat,
    'spectator',
  );
  h.rooms.delete(room.id);
  clearRoomRuntimeTimers(room);
  const loaded = await h.lifecycle.getOrCreateRoom(room.id, 'dark-chess');
  assert.equal(loaded.rated, true);
  // Durable in the room-created event, so a restart keeps it.
  assert.equal(loaded.pairing, 'live-challenge');
  assert.equal(
    (await assignSeat(h.roomMgrCtx, loaded, 'after-restart', undefined, h.users.get('sender')!))
      .seat,
    'black',
  );
  assert.equal(h.db.counts().commits, 1);
});

test('competing accepts and invites sharing either account create at most one room', async (t) => {
  const h = fixture(t);
  const id = await h.send();
  const other = await h.send({ targetHandle: 'other' });
  const sameTarget = await h.send({}, 'other');
  const entered = deferred();
  const release = deferred();
  t.after(release.release);
  h.db.onQuery(async (sql) => {
    if (sql === 'COMMIT') {
      entered.release();
      await release.promise;
    }
  });
  const first = h.request('target', 'POST', `/${id}/accept`);
  await entered.promise;
  assert.equal(h.rooms.size, 0, 'room is unpublished until both seats commit');
  assert.equal(h.db.seats.size, 0);
  assert.equal((await h.request('target', 'POST', `/${id}/accept`)).status, 409);
  assert.equal((await h.request('other', 'POST', `/${other}/accept`)).status, 409);
  assert.equal((await h.request('target', 'POST', `/${sameTarget}/accept`)).status, 409);
  // A cancellation cannot steal an in-flight creation, and pending polls
  // that began earlier cannot invalidate an already claimed offer.
  assert.equal((await h.request('sender', 'DELETE', `/${id}`)).body.invite.status, 'accepting');
  release.release();
  assert.equal((await first).status, 200);
  assert.equal(h.rooms.size, 1);
  assert.equal(h.db.counts().commits, 1);
});

test('all creation failures roll back and release both account reservations for retry', async (t) => {
  for (const failure of [
    'INSERT INTO events',
    'INSERT INTO room_seat_tokens',
    'INSERT INTO games',
    'COMMIT',
  ]) {
    await t.test(failure, async (t) => {
      const h = fixture(t);
      const id = await h.send();
      h.db.fail(failure);
      assert.equal((await h.request('target', 'POST', `/${id}/accept`)).status, 503);
      assert.equal(h.rooms.size, 0);
      assert.equal(h.db.events.size, 0);
      assert.equal(h.db.seats.size, 0);
      assert.equal(h.db.games.size, 0);
      assert.equal((await h.request('sender', 'GET', `/${id}`)).body.invite.status, 'pending');
      assert.equal((await h.request('target', 'POST', `/${id}/accept`)).status, 200);
      assert.deepEqual(h.db.counts(), { commits: 1, rollbacks: 1 });
    });
  }
});

test('acceptance rechecks policies, availability, leases and expiry', async (t) => {
  const changes: Record<string, (h: ReturnType<typeof fixture>) => void> = {
    block: (h) => {
      h.blocks.add('target:sender');
    },
    reverseBlock: (h) => {
      h.blocks.add('sender:target');
    },
    optOut: (h) => {
      h.users.get('target')!.accountPreferences.liveInvites = false;
    },
    senderLocked: (h) => {
      h.users.get('sender')!.playDisabledAt = new Date();
    },
    targetClosed: (h) => {
      h.users.get('target')!.closedAt = new Date();
    },
    noFollow: (h) => h.noFollow(),
    senderOffline: () => leaveLiveInvites('sender'),
    targetOffline: () => leaveLiveInvites('target'),
    expiry: (h) => {
      h.advance(LIVE_INVITE_TTL_MS);
      h.renew();
    },
    unloadedSeat: (h) => {
      h.db.durableBusy.add('sender');
    },
    ratedEligibility: (h) => {
      h.users.get('sender')!.statsExcludedAt = new Date();
      h.users.get('target')!.statsExcludedAt = new Date();
    },
    markedSender: (h) => {
      h.users.get('sender')!.fairPlayMarkedAt = new Date();
    },
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async (t) => {
      const h = fixture(t);
      setFlag(t, 'MISTBOARD_RATED_ENABLED', 'true');
      const id = await h.send({ rated: true });
      change(h);
      assert.equal((await h.request('target', 'POST', `/${id}/accept`)).status, 409);
      assert.equal(h.rooms.size, 0);
      assert.equal(h.db.counts().commits, 0);
    });
  }
});

test('expiry during asynchronous checks refuses creation and draining can be retried', async (t) => {
  const h = fixture(t);
  const id = await h.send();
  h.ctx.refusesCreate = () => true;
  assert.equal((await h.request('target', 'POST', `/${id}/accept`)).body.error, 'server_draining');
  h.ctx.refusesCreate = () => false;
  h.db.onQuery(async (sql) => {
    if (sql.includes('SELECT DISTINCT seats.room_id')) {
      h.advance(LIVE_INVITE_TTL_MS);
      h.renew();
    }
  });
  assert.equal((await h.request('target', 'POST', `/${id}/accept`)).status, 409);
  assert.equal(h.db.counts().commits, 0);
});

test('policy changes while durable availability is being checked refuse acceptance', async (t) => {
  const h = fixture(t);
  const id = await h.send();
  h.db.onQuery(async (sql) => {
    if (sql.includes('SELECT DISTINCT seats.room_id')) h.blocks.add('sender:target');
  });
  assert.equal((await h.request('target', 'POST', `/${id}/accept`)).status, 409);
  assert.equal(h.db.counts().commits, 0);
});

test('acceptance rechecks the registered variant, clock support and rating switches', async (t) => {
  for (const change of ['disabled', 'clock', 'ratedSurface', 'ratedFlag']) {
    await t.test(change, async (t) => {
      const h = fixture(t);
      setFlag(t, 'MISTBOARD_XIANGQI_ENABLED', 'true');
      setFlag(t, 'MISTBOARD_RATED_ENABLED', 'true');
      const registration = variantTenantForSpecId('xiangqi')!;
      const original = { enabled: registration.enabled, lobby: registration.lobby };
      t.after(() => Object.assign(registration, original));
      const id = await h.send({ gameSpecId: 'xiangqi', rated: true });
      if (change === 'disabled') registration.enabled = () => false;
      if (change === 'clock')
        registration.lobby = { ...registration.lobby!, allowsTimeControl: () => false };
      if (change === 'ratedSurface')
        registration.lobby = { ...registration.lobby!, supportsRated: false };
      if (change === 'ratedFlag') process.env.MISTBOARD_RATED_ENABLED = 'false';
      assert.equal((await h.request('target', 'POST', `/${id}/accept`)).status, 409);
      assert.equal(h.db.counts().commits, 0);
    });
  }
});

test('every enabled live tenant uses its own durable two-seat factory with unchanged terms', async (t) => {
  for (const flag of [
    'XIANGQI',
    'DARK_XIANGQI',
    'DUCK_XIANGQI',
    'ATOMIC_XIANGQI',
    'CRAZYHOUSE_XIANGQI',
    'FORTRESS_XIANGQI',
    'JIEQI',
    'BANQI',
    'JUNGLE',
    'JUNGLE_FLIP',
    'THREE_KINGDOMS_BANQI',
    'GOMOKU',
    'XIANGQI_MAHJONG',
    'RATED',
  ])
    setFlag(t, `MISTBOARD_${flag}_ENABLED`, 'true');
  for (const tenant of registeredVariantTenants().filter(
    (entry) =>
      entry.ownsSpecRouting &&
      entry.lobby &&
      entry.enabled() &&
      !isRetiredGameSpec(entry.gameSpecId),
  )) {
    await t.test(tenant.gameSpecId, async (t) => {
      const h = fixture(t);
      for (const user of h.users.values()) user.accountRole = 'admin';
      // Xiangqi mahjong supports the longer live clocks, not 3+2.
      const timeControl = tenant.lobby!.allowsTimeControl(clock)
        ? clock
        : { initialMs: 600_000, incrementMs: 5000 };
      const id = await h.send({
        gameSpecId: tenant.gameSpecId,
        timeControl,
        preferredColor: 'second',
        rated: tenant.lobby!.supportsRated,
      });
      const result = await h.request('target', 'POST', `/${id}/accept`);
      assert.equal(result.status, 200, result.raw);
      const roomId = result.body.invite.room.roomId;
      const room = tenant.rooms.get(roomId)!;
      assert.ok(room);
      assert.equal(
        (h.db.events.get(roomId)![0] as unknown as { gameSpecId: string }).gameSpecId,
        tenant.gameSpecId,
      );
      assert.equal(h.db.seats.get(roomId)?.size, 2);
      const created = h.db.events.get(roomId)![0] as unknown as {
        timeControl: unknown;
        rated?: boolean;
        pairing?: string;
      };
      assert.deepEqual(created.timeControl, timeControl);
      assert.equal(created.pairing, 'live-challenge', 'the accepted challenge pairing (#1229)');
      assert.equal(created.rated === true, tenant.lobby!.supportsRated);
      const owned = Object.values(room.seatTokens!).filter((token) => token?.userId);
      assert.equal(owned.length, 2);
      assert.equal(room.seatTokens![result.body.invite.room.seat]?.userId, 'target');
    });
  }
});

test('accepted hidden-information rooms hydrate, reclaim seats and serialize only masked payloads', async (t) => {
  for (const spec of ['banqi', 'jieqi'] as const) {
    await t.test(spec, async (t) => {
      t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
      const h = fixture(t);
      setFlag(t, `MISTBOARD_${spec.toUpperCase()}_ENABLED`, 'true');
      const id = await h.send({ gameSpecId: spec });
      const accepted = await h.request('target', 'POST', `/${id}/accept`);
      assert.equal(accepted.status, 200, accepted.raw);
      const registration = variantTenantForSpecId(spec)!;
      const roomId = accepted.body.invite.room.roomId;
      registration.clearRooms();
      const room = await registration.getOrLoadRoom(roomId);
      assert.ok(room);
      assert.equal(room.seatTokens?.red?.userId, 'sender');
      assert.equal(room.seatTokens?.black?.userId, 'target');
      // Keep each tenant's concrete state type at its own masking boundary.
      if (spec === 'banqi') {
        const loaded = await getOrLoadTenantRoom(banqiTenant, new Map(), roomId);
        assert.ok(loaded);
        const events = structuredClone(loaded.events);
        const created = events[0]!;
        if (created.type !== 'room-created') assert.fail('expected setup');
        const setup = created.setup as BanqiSetup;
        const index = setup.deal.findIndex(
          (piece) => JSON.stringify(piece) !== JSON.stringify(setup.deal[0]),
        );
        assert.ok(index > 0);
        [setup.deal[0], setup.deal[index]] = [setup.deal[index]!, setup.deal[0]!];
        const alternate = createTenantRuntimeRoomFromEvents(banqiTenant, events);
        assert.ok(alternate.ok);
        alternate.room.seatTokens = structuredClone(loaded.seatTokens);
        for (const seat of ['red', 'black', 'spectator'] as const) {
          const viewer: { id: string; seat: 'red' | 'black' | 'spectator'; solo: boolean } = {
            id: loaded.seatTokens[seat === 'red' ? 'red' : 'black']!.clientId,
            seat,
            solo: false,
          };
          const raw: string = JSON.stringify({
            acceptance: accepted.body,
            snapshot: tenantSnapshotPayload(banqiTenant, loaded, viewer),
            history: tenantLiveHistoryExtras(banqiTenant, loaded, viewer),
          });
          for (const key of ['"setup"', '"deal"', 'tokenHash', '"userId"'])
            assert.equal(raw.includes(key), false, key);
          // The pairing tag (#1229) rides the same payload, survives hydration, and
          // is the same for every seat, so the equality below covers it too.
          assert.equal(
            tenantSnapshotPayload(banqiTenant, loaded, viewer).pairing,
            'live-challenge',
          );
          assert.equal(
            JSON.stringify({
              acceptance: accepted.body,
              snapshot: tenantSnapshotPayload(banqiTenant, alternate.room, viewer),
              history: tenantLiveHistoryExtras(banqiTenant, alternate.room, viewer),
            }),
            raw,
            `whole ${seat} payload must be independent of the hidden deal`,
          );
        }
        const rejoined = assignTenantSeat(
          banqiTenant,
          loaded,
          'rejoined',
          undefined,
          h.users.get('target')!,
        );
        assert.ok(rejoined.ok);
        assert.equal(rejoined.seat, 'black');
        assert.equal(
          assignTenantSeat(banqiTenant, loaded, 'intruder', undefined, h.users.get('stranger')!).ok,
          false,
        );
      } else {
        const loaded = await getOrLoadTenantRoom(jieqiTenant, new Map(), roomId);
        assert.ok(loaded);
        const events = structuredClone(loaded.events);
        const created = events[0]!;
        if (created.type !== 'room-created') assert.fail('expected setup');
        const setup = created.setup as JieqiDeal;
        const index = setup.red.findIndex((role) => role !== setup.red[0]);
        assert.ok(index > 0);
        [setup.red[0], setup.red[index]] = [setup.red[index]!, setup.red[0]!];
        const alternate = createTenantRuntimeRoomFromEvents(jieqiTenant, events);
        assert.ok(alternate.ok);
        alternate.room.seatTokens = structuredClone(loaded.seatTokens);
        for (const seat of ['red', 'black', 'spectator'] as const) {
          const viewer: { id: string; seat: 'red' | 'black' | 'spectator'; solo: boolean } = {
            id: loaded.seatTokens[seat === 'red' ? 'red' : 'black']!.clientId,
            seat,
            solo: false,
          };
          const raw: string = JSON.stringify({
            acceptance: accepted.body,
            snapshot: tenantSnapshotPayload(jieqiTenant, loaded, viewer),
            history: tenantLiveHistoryExtras(jieqiTenant, loaded, viewer),
          });
          for (const key of ['"setup"', '"deal"', 'tokenHash', '"userId"'])
            assert.equal(raw.includes(key), false, key);
          // The pairing tag (#1229) rides the same payload, survives hydration, and
          // is the same for every seat, so the equality below covers it too.
          assert.equal(
            tenantSnapshotPayload(jieqiTenant, loaded, viewer).pairing,
            'live-challenge',
          );
          assert.equal(
            JSON.stringify({
              acceptance: accepted.body,
              snapshot: tenantSnapshotPayload(jieqiTenant, alternate.room, viewer),
              history: tenantLiveHistoryExtras(jieqiTenant, alternate.room, viewer),
            }),
            raw,
            `whole ${seat} payload must be independent of the hidden deal`,
          );
        }
      }
    });
  }
});

test('tenant factories refuse publication when the second seat write fails', async (t) => {
  const db = database(t);
  setFlag(t, 'MISTBOARD_BANQI_ENABLED', 'true');
  const rooms = new Map();
  let inserts = 0;
  db.onQuery(async (sql) => {
    if (sql.startsWith('INSERT INTO room_seat_tokens') && ++inserts === 2)
      throw new Error('second seat unavailable');
  });
  await assert.rejects(
    createWithAccountSeats(identity('a'), identity('b'), async () => {
      const created = await createTenantLiveRoom(
        banqiTenant,
        {
          rooms,
          isRoomIdTaken: () => false,
          appendRoomEvent: persistence.appendRoomEvent,
          isPersistenceEnabled: () => true,
          recordPersistenceError() {},
        },
        { timeControl: clock },
      );
      if (created.ok) assert.fail('failed creation must not publish a room');
      throw new Error(created.error);
    }),
    /persistence_failure/,
  );
  assert.equal(rooms.size, 0);
  assert.equal(db.events.size, 0);
  assert.equal(db.seats.size, 0);
  assert.deepEqual(db.counts(), { commits: 0, rollbacks: 1 });
});
