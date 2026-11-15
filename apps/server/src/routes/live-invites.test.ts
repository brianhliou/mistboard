import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { type TestContext, test } from 'node:test';
import { type HttpApiContext, handleApiRequest } from '../http-api.js';
import { LIVE_INVITE_RETENTION_MS, LIVE_INVITE_TTL_MS } from '../live-invites.js';
import { type UserRow, userFromRow } from '../persistence-accounts.js';
import { close, getPool, init } from '../persistence-db.js';
import { clearPresence, heartbeatLiveInvites, LIVE_INVITE_LEASE_MS } from '../presence.js';
import { type TenantManagedRoom, variantTenantForSpecId } from '../variant-tenant/registry.js';
import { tryHandle as accountRoute } from './account.js';
import { busyLiveInviteUsers, createLiveInviteHandler } from './live-invites.js';

function row(id: string): UserRow {
  return {
    id,
    email: `${id}@example.test`,
    email_verified_at: new Date(),
    handle: id,
    handle_changed_at: null,
    display_name: id,
    display_name_changed_at: null,
    bio: '',
    location: '',
    profile_links: [],
    display_preferences: {},
    account_preferences: {},
    profile_visibility: 'public',
    account_role: 'player',
    play_disabled_at: null,
    stats_excluded_at: null,
    title: null,
    flair: null,
    locale: null,
    dm_policy: 'always',
    elo_rating: 1500,
    patron_since: null,
    stripe_customer_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    closed_at: null,
  };
}

test('HTTP directed live invite lifecycle is authenticated and private, with acceptance unavailable', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(async () => {
    clearPresence();
    await close();
  });
  const users = new Map(['sender', 'target', 'stranger'].map((id) => [id, row(id)]));
  t.mock.method(getPool(), 'connect', () => assert.fail('unexpected database connection'));
  t.mock.method(getPool(), 'query', async (sql: string, args: unknown[]) => {
    if (sql.includes('UPDATE account_sessions'))
      return { rows: [users.get(String(args[0]))].filter(Boolean) };
    if (sql.includes('FROM users') && sql.includes('lower(handle)'))
      return { rows: [users.get(String(args[0]))].filter(Boolean) };
    if (sql.includes('FROM user_relations'))
      return { rows: sql.includes("relation = 'follow'") ? [{ one: 1 }] : [] };
    assert.fail(`unexpected query: ${sql}`);
  });
  const ctx = {
    rooms: new Map(),
    lobbyTickets: new Map(),
    lobbyQueue: [],
    refusesCreate: () => false,
  } as unknown as HttpApiContext;
  async function request(user: string | null, method: string, path: string, body: unknown = {}) {
    const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
    req.method = method;
    req.url = `/api/live-invites${path}`;
    req.headers = {
      host: 'localhost',
      'content-type': 'application/json',
      ...(user ? { cookie: `mistboard_session=${user}.test` } : {}),
    };
    let status = 0;
    let raw = '';
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      writeHead: (code: number, h: Record<string, string>) => {
        status = code;
        Object.assign(headers, h);
      },
      end: (data: string) => {
        raw = data;
      },
    } as unknown as ServerResponse;
    await handleApiRequest(ctx, req, res);
    return { status, raw, headers, body: JSON.parse(raw) };
  }
  assert.equal((await request(null, 'GET', '')).status, 401);
  assert.equal((await request('target', 'POST', '/heartbeat')).status, 200);
  const created = await request('sender', 'POST', '', {
    targetHandle: 'target',
    gameSpecId: 'dark-chess',
    timeControl: { initialMs: 180000, incrementMs: 2000 },
  });
  assert.equal(created.status, 201);
  const id = created.body.invite.id;
  assert.equal(created.body.invite.canAccept, false);
  assert.equal(created.headers['Cache-Control'], 'no-store');
  assert.equal((await request('stranger', 'GET', `/${id}`)).status, 404);
  assert.deepEqual((await request('stranger', 'GET', '')).body, {
    incoming: [],
    outgoing: [],
    pollAfterMs: 5000,
  });
  assert.equal((await request('target', 'GET', '')).body.incoming[0].id, id);
  assert.equal((await request('sender', 'GET', '')).body.outgoing[0].id, id);
  assert.equal((await request('target', 'POST', `/${id}/accept`)).status, 501);
  assert.equal((await request('sender', 'POST', `/${id}/decline`)).status, 404);
  assert.equal((await request('target', 'POST', `/${id}/decline`)).status, 200);
  assert.equal((await request('sender', 'GET', `/${id}`)).body.invite.status, 'declined');
  assert.deepEqual((await request('target', 'GET', '')).body.incoming, []);
  assert.equal(ctx.rooms.size, 0);
  for (const forbidden of [
    'example.test',
    'email',
    'userId',
    'accountPreferences',
    'play_disabled',
  ])
    assert.equal(created.raw.includes(forbidden), false);
});

// Most policy cases use the same HTTP request/response boundary with a fresh
// store and explicit account/relation adapters, so no socket or database is needed.
function harness(t: TestContext) {
  clearPresence();
  t.after(() => clearPresence());
  let now = 1700000000000;
  const users = new Map(
    ['sender', 'target', 'stranger', 'other'].map((id) => [id, userFromRow(row(id))]),
  );
  const follows = new Set(['sender:target', 'sender:other']);
  const blocks = new Set<string>();
  let onFind = () => {};
  const ctx = {
    rooms: new Map(),
    lobbyTickets: new Map(),
    lobbyQueue: [],
    now: () => now,
    refusesCreate: () => false,
  } as unknown as HttpApiContext;
  const handler = createLiveInviteHandler({
    currentUser: async (req) => users.get(String(req.headers['x-user'])) ?? null,
    findUser: async (handle) => {
      onFind();
      return users.get(handle) ?? null;
    },
    hasFollow: async (a, b) => follows.has(`${a}:${b}`),
    hasBlock: async (a, b) => blocks.has(`${a}:${b}`),
    available: () => true,
  });
  const terms = {
    targetHandle: 'target',
    gameSpecId: 'dark-chess',
    timeControl: { initialMs: 180000, incrementMs: 2000 },
  };
  async function request(
    user = 'sender',
    method = 'POST',
    suffix = '',
    body: unknown = terms,
    extraHeaders: Record<string, string> = {},
    raw?: string,
  ) {
    const req = Readable.from([raw ?? JSON.stringify(body)]) as IncomingMessage;
    req.method = method;
    req.headers = {
      'x-user': user,
      'content-type': 'application/json',
      host: 'localhost',
      ...extraHeaders,
    };
    let status = 0;
    let data = '';
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      writeHead: (s: number, h: Record<string, string>) => {
        status = s;
        Object.assign(headers, h);
      },
      end: (s: string) => {
        data = s;
      },
    } as unknown as ServerResponse;
    assert.equal(await handler(ctx, req, res, `/api/live-invites${suffix}`), true);
    return { status, headers, body: JSON.parse(data), raw: data };
  }
  heartbeatLiveInvites('target', now);
  heartbeatLiveInvites('other', now);
  return {
    users,
    follows,
    blocks,
    ctx,
    terms,
    request,
    advance: (ms: number) => {
      now += ms;
    },
    heartbeat: (id: string) => heartbeatLiveInvites(id, now),
    onFind: (callback: () => void) => {
      onFind = callback;
    },
  };
}

test('HTTP sends require follow or follower eligibility, either-direction blocks override it, and self/closed/locked/offline/opted-out targets fail closed', async (t) => {
  const h = harness(t);
  h.follows.clear();
  assert.equal((await h.request()).body.error, 'target_unavailable');
  h.follows.add('target:sender');
  const created = await h.request();
  assert.equal(created.status, 201);
  assert.equal(created.body.invite.rated, false);
  assert.equal((await h.request('target', 'DELETE', `/${created.body.invite.id}`)).status, 404);
  assert.equal(
    (await h.request('sender', 'DELETE', `/${created.body.invite.id}`)).body.invite.status,
    'cancelled',
  );
  for (const block of ['target:sender', 'sender:target']) {
    h.blocks.add(block);
    assert.equal((await h.request()).body.error, 'target_unavailable');
    h.blocks.clear();
  }
  // Rejected attempts count too, so use another sender to inspect more policies.
  h.follows.add('stranger:target');
  const target = h.users.get('target')!;
  target.accountPreferences.liveInvites = false;
  assert.equal((await h.request('stranger')).body.error, 'target_unavailable');
  target.accountPreferences.liveInvites = true;
  target.playDisabledAt = new Date();
  assert.equal((await h.request('stranger')).body.error, 'target_unavailable');
  target.playDisabledAt = null;
  target.closedAt = new Date();
  assert.equal((await h.request('stranger')).body.error, 'target_unavailable');
  target.closedAt = null;
  assert.equal(
    (await h.request('stranger', 'POST', '', { ...h.terms, targetHandle: 'stranger' })).body.error,
    'target_unavailable',
  );
  h.advance(LIVE_INVITE_LEASE_MS);
  assert.equal((await h.request('stranger')).body.error, 'target_unavailable');
});

test('HTTP duplicate and reverse sends are atomic, cancellation is owner-only, and send throttles recover', async (t) => {
  const h = harness(t);
  const results = await Promise.all([h.request(), h.request()]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const created = results.find((result) => result.status === 201)!;
  assert.equal(
    (await h.request('target', 'POST', '', { ...h.terms, targetHandle: 'sender' })).body.error,
    'duplicate_invite',
  );
  assert.equal(
    (await h.request('stranger', 'POST', `/${created.body.invite.id}/accept`)).status,
    404,
  );
  for (let i = 0; i < 3; i++) await h.request();
  const throttled = await h.request();
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers['Retry-After'], '60');
  h.advance(LIVE_INVITE_TTL_MS);
  assert.equal(
    (await h.request('target', 'GET', `/${created.body.invite.id}`)).body.invite.status,
    'expired',
  );
  h.heartbeat('target');
  assert.equal((await h.request()).status, 201);
});

test('HTTP polling revalidates opt-out, blocks, relation removal, play locks and lease loss without renewing presence', async (t) => {
  for (const policy of [
    'opt-out',
    'block',
    'unfollow',
    'play-lock',
    'closed',
    'target-offline',
    'sender-offline',
    'leave',
  ] as const) {
    await t.test(policy, async (child) => {
      const h = harness(child);
      const created = await h.request();
      assert.equal(created.status, 201);
      if (policy === 'opt-out') h.users.get('target')!.accountPreferences.liveInvites = false;
      if (policy === 'block') h.blocks.add('target:sender');
      if (policy === 'unfollow') h.follows.clear();
      if (policy === 'play-lock') h.users.get('sender')!.playDisabledAt = new Date();
      if (policy === 'closed') h.users.get('target')!.closedAt = new Date();
      if (policy === 'leave') await h.request('target', 'DELETE', '/heartbeat');
      if (policy === 'target-offline' || policy === 'sender-offline') {
        h.advance(LIVE_INVITE_LEASE_MS);
        h.heartbeat(policy === 'target-offline' ? 'sender' : 'target');
      }
      assert.deepEqual((await h.request('target', 'GET')).body.incoming, []);
      assert.equal(
        (await h.request('sender', 'GET', `/${created.body.invite.id}`)).body.invite.status,
        'unavailable',
      );
    });
  }
});

test('HTTP methods, authentication, body parsing, origin, term validation, play locks and draining are enforced', async (t) => {
  const h = harness(t);
  assert.equal((await h.request('missing', 'GET')).status, 401);
  assert.equal((await h.request('sender', 'PATCH')).status, 405);
  assert.equal(
    (await h.request('sender', 'POST', '', h.terms, { 'sec-fetch-site': 'cross-site' })).status,
    403,
  );
  assert.equal(
    (await h.request('sender', 'POST', '', h.terms, { origin: 'https://attacker.test' })).status,
    403,
  );
  assert.equal(
    (await h.request('sender', 'POST', '', h.terms, { 'content-type': 'text/plain' })).status,
    415,
  );
  assert.equal((await h.request('sender', 'POST', '', {}, {}, '{')).status, 400);
  assert.equal(
    (await h.request('sender', 'POST', '', {}, {}, JSON.stringify({ text: 'x'.repeat(20000) })))
      .status,
    413,
  );
  assert.equal(
    (await h.request('sender', 'POST', '', { ...h.terms, rated: 'true' })).body.error,
    'invalid_invite',
  );
  assert.equal(
    (await h.request('sender', 'POST', '', { ...h.terms, gameSpecId: 'bogus' })).body.error,
    'unsupported_game_spec',
  );
  assert.equal(
    (
      await h.request('sender', 'POST', '', {
        ...h.terms,
        timeControl: { initialMs: 15000, incrementMs: 0 },
      })
    ).body.error,
    'time_control_unsupported',
  );
  h.advance(LIVE_INVITE_TTL_MS);
  h.heartbeat('target');
  assert.equal(
    (await h.request('sender', 'POST', '', { ...h.terms, preferredColor: ['first'] })).body.error,
    'invalid_invite',
  );
  h.ctx.refusesCreate = () => true;
  assert.equal((await h.request()).body.error, 'server_draining');
  h.users.get('sender')!.playDisabledAt = new Date();
  assert.equal((await h.request()).body.error, 'play_disabled');
  assert.equal((await h.request('sender', 'POST', '/heartbeat')).body.error, 'play_disabled');
});

test('HTTP delayed policy reads cannot return an invite snapshot beyond expiry or retention', async (t) => {
  for (const delay of [
    LIVE_INVITE_LEASE_MS,
    LIVE_INVITE_TTL_MS,
    LIVE_INVITE_TTL_MS + LIVE_INVITE_RETENTION_MS,
  ]) {
    await t.test(String(delay), async (child) => {
      const h = harness(child);
      const created = await h.request();
      h.onFind(() => {
        h.advance(delay);
        h.onFind(() => {});
      });
      const inspected = await h.request('sender', 'GET', `/${created.body.invite.id}`);
      if (delay >= LIVE_INVITE_TTL_MS + LIVE_INVITE_RETENTION_MS)
        assert.equal(inspected.status, 404);
      else
        assert.equal(
          inspected.body.invite.status,
          delay >= LIVE_INVITE_TTL_MS ? 'expired' : 'unavailable',
        );
      assert.deepEqual((await h.request('target', 'GET')).body.incoming, []);
    });
  }
});

test('busy accounts include disconnected real-time seats but exclude spectators, terminal games and correspondence', async (t) => {
  const h = harness(t);
  const room = {
    projection: { state: { status: { type: 'playing' } }, timeControl: {} },
    seatTokens: { white: { userId: 'target' } },
    clients: [],
  };
  h.ctx.rooms.set('room', room as unknown as Parameters<typeof h.ctx.rooms.set>[1]);
  assert.equal(busyLiveInviteUsers(h.ctx).has('target'), true);
  assert.equal((await h.request()).body.error, 'target_unavailable');
  room.projection.state.status.type = 'finished';
  assert.equal(busyLiveInviteUsers(h.ctx).has('target'), false);
  room.projection.state.status.type = 'playing';
  room.projection.timeControl = { daysPerMove: 2 };
  assert.equal(busyLiveInviteUsers(h.ctx).has('target'), false);
  h.ctx.rooms.clear();
  const created = await h.request();
  assert.equal(created.status, 201);
  h.ctx.rooms.set('room', room as unknown as Parameters<typeof h.ctx.rooms.set>[1]);
  room.projection.timeControl = {};
  assert.deepEqual((await h.request('target', 'GET')).body.incoming, []);
  h.ctx.rooms.clear();
  const spectatorRoom = {
    projection: { state: { status: { type: 'playing' } } },
    seatTokens: {},
    clients: [{ userId: 'target', seat: 'spectator' }],
  };
  h.ctx.rooms.set(
    'spectator-room',
    spectatorRoom as unknown as Parameters<typeof h.ctx.rooms.set>[1],
  );
  assert.equal(busyLiveInviteUsers(h.ctx).has('target'), false);
});

test('HTTP pending cap counts an account in either direction', async (t) => {
  const h = harness(t);
  for (let i = 0; i < 4; i++) {
    const name = `friend${i}`;
    h.users.set(name, userFromRow(row(name)));
    h.follows.add(`sender:${name}`);
    h.heartbeat(name);
    const response = await h.request('sender', 'POST', '', { ...h.terms, targetHandle: name });
    assert.equal(response.status, i < 3 ? 201 : 409);
    if (i === 3) assert.equal(response.body.error, 'pending_invite_limit');
  }
});

test('HTTP registered variants retain their live capability, clock and rating gates', async (t) => {
  const h = harness(t);
  const previousRated = process.env.MISTBOARD_RATED_ENABLED;
  t.after(() => {
    if (previousRated === undefined) delete process.env.MISTBOARD_RATED_ENABLED;
    else process.env.MISTBOARD_RATED_ENABLED = previousRated;
  });
  const registration = variantTenantForSpecId('xiangqi');
  assert.ok(registration);
  const original = {
    enabled: registration.enabled,
    lobby: registration.lobby,
    rooms: registration.rooms,
  };
  const rooms = new Map<string, TenantManagedRoom>();
  t.after(() => Object.assign(registration, original));
  registration.enabled = () => false;
  registration.lobby = null;
  registration.rooms = rooms;
  const terms = { ...h.terms, gameSpecId: 'xiangqi' };
  assert.equal((await h.request('sender', 'POST', '', terms)).body.error, 'unsupported_game_spec');
  registration.enabled = () => true;
  assert.equal((await h.request('sender', 'POST', '', terms)).body.error, 'unsupported_game_spec');
  registration.lobby = {
    supportsRated: false,
    allowsTimeControl: () => false,
    createRoom: async () => assert.fail('acceptance must not create a room'),
  };
  assert.equal(
    (await h.request('sender', 'POST', '', terms)).body.error,
    'time_control_unsupported',
  );
  registration.lobby!.allowsTimeControl = () => true;
  process.env.MISTBOARD_RATED_ENABLED = 'false';
  assert.equal(
    (await h.request('sender', 'POST', '', { ...terms, rated: true })).body.error,
    'rated_disabled',
  );
  process.env.MISTBOARD_RATED_ENABLED = 'true';
  assert.equal(
    (await h.request('sender', 'POST', '', { ...terms, rated: true })).body.error,
    'rated_unsupported_surface',
  );
  h.advance(LIVE_INVITE_TTL_MS);
  h.heartbeat('target');
  registration.lobby!.supportsRated = true;
  h.users.get('target')!.statsExcludedAt = new Date();
  assert.equal(
    (await h.request('sender', 'POST', '', { ...terms, rated: true })).body.error,
    'rated_requires_counted_account',
  );
  h.users.get('target')!.statsExcludedAt = null;
  h.users.get('sender')!.fairPlayMarkedAt = new Date();
  assert.equal(
    (await h.request('sender', 'POST', '', { ...terms, rated: true })).body.error,
    'rated_account_marked',
  );
  h.users.get('sender')!.fairPlayMarkedAt = null;
  const created = await h.request('sender', 'POST', '', { ...terms, rated: true });
  assert.equal(created.status, 201);
  const tenantRoom = {
    projection: { state: { status: { type: 'playing' } } },
    seatTokens: { first: { userId: 'target' } },
    clients: [],
  };
  rooms.set('tenant-room', tenantRoom as unknown as TenantManagedRoom);
  assert.equal(busyLiveInviteUsers(h.ctx).has('target'), true);
  rooms.clear();
  registration.enabled = () => false;
  assert.deepEqual((await h.request('target', 'GET')).body.incoming, []);
});

test('HTTP preference PATCH persists the live invite opt-out and reloads it from account JSON', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(async () => {
    clearPresence();
    await close();
  });
  const user = row('prefs');
  t.mock.method(getPool(), 'query', async (sql: string, args: unknown[]) => {
    if (sql.includes('UPDATE account_sessions')) return { rows: [user] };
    assert.ok(sql.includes('jsonb_set'));
    assert.equal(args[1], 'liveInvites');
    user.account_preferences = {
      ...(user.account_preferences as object),
      liveInvites: JSON.parse(String(args[2])),
    };
    return { rows: [user] };
  });
  for (const enabled of [false, true, false]) {
    const req = Readable.from([JSON.stringify({ liveInvites: enabled })]) as IncomingMessage;
    req.method = 'PATCH';
    req.headers = { cookie: 'mistboard_session=prefs.test' };
    let status = 0;
    let data = '';
    const res = {
      writeHead: (s: number) => {
        status = s;
      },
      end: (s: string) => {
        data = s;
      },
    } as unknown as ServerResponse;
    await accountRoute({}, req, res, '/api/account/preferences');
    assert.equal(status, 200);
    assert.equal(JSON.parse(data).user.accountPreferences.liveInvites, enabled);
    assert.equal(userFromRow(user).accountPreferences.liveInvites, enabled);
    assert.equal(userFromRow(user).accountPreferences.challengesBell, true);
  }
  for (const value of [undefined, 'false', 0, null]) {
    user.account_preferences = { liveInvites: value, challengesBell: false };
    assert.equal(userFromRow(user).accountPreferences.liveInvites, true);
    assert.equal(userFromRow(user).accountPreferences.challengesBell, false);
  }
});
