import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import test from 'node:test';
import { createInitialBanqiState } from '@mistboard/game';
import {
  BANQI_DEFAULT_ENGINE_ID,
  banqiEngineVersion,
  isBanqiEngineClientId,
} from './banqi-engine.js';
import {
  internalBanqiConfiguration,
  internalBanqiMoveProvider,
  internalBanqiStampMatches,
} from './banqi-internal-provider.js';
import { createBanqiHttpProvider } from './banqi-provider.js';
import { createBanqiProviderBridge } from './banqi-provider-bridge.js';
import { buildBanqiProviderRequest, providerResponse } from './banqi-provider-protocol.js';
import { banqiTenant } from './banqi-tenant.js';
import { resolveGameExport } from './game-export-tenant.js';
import {
  INTERNAL_BANQI_CORPUS_ID,
  INTERNAL_BANQI_ENGINE_ID,
  internalEngineTestFor,
} from './internal-engine-test.js';
import {
  countedHumanGame,
  internalHumanGame,
  preLaunchHumanGame,
  shortHumanGame,
} from './persistence-counted-games.js';
import { banqiLiveWatchPayloadFor, banqiPostgameForApi } from './routes/banqi-games.js';
import { type BanqiCreateContext, handleBanqiCreate } from './routes/banqi-rooms.js';
import { createBanqiLiveRoom } from './server-banqi-room-factory.js';
import { handleBanqiWebSocketConnection } from './server-ws-banqi.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  isTenantEventLog,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

function configure() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MISTBOARD_BANQI_ENABLED: 'true',
    MISTBOARD_BANQI_TEST_PROVIDER_ENABLED: 'true',
    MISTBOARD_BANQI_TEST_PROVIDER_URL: 'https://worker.example.test/turn',
    MISTBOARD_BANQI_PROVIDER_TOKEN: 'fixture-only-token',
    MISTBOARD_BANQI_TEST_PROVIDER_VERSION: 'opaque-v3-modelA',
    MISTBOARD_BANQI_TEST_PROVIDER_NAME: 'Private test engine',
    MISTBOARD_BANQI_TEST_PROVIDER_NODES: '2048',
    MISTBOARD_BANQI_TEST_PROVIDER_BUDGET_MS: '1000',
    MISTBOARD_BANQI_TEST_ALLOW_LOOPBACK: 'true',
  });
}
function response() {
  let status = 0,
    body = '';
  const out = {
    writeHead: (s: number) => {
      status = s;
    },
    end: (b: string) => {
      body = b;
    },
  } as unknown as ServerResponse;
  return { out, result: () => ({ status, body: JSON.parse(body) }) };
}
const admin = { id: 'user_test_admin', accountRole: 'admin' } as Parameters<
  typeof handleBanqiCreate
>[3];
const createBody = {
  gameSpecId: 'banqi',
  mode: 'pve',
  engineId: INTERNAL_BANQI_ENGINE_ID,
  internalEngineTest: true,
};
function context() {
  let writes = 0;
  const ctx: BanqiCreateContext = {
    databaseRequired: false,
    refusesCreate: () => false,
    drainDeadlineMs: () => null,
    createBanqiRoom: async (_tc, _seat, engine, rated, stamp) => {
      writes++;
      assert.equal(engine?.engineId, INTERNAL_BANQI_ENGINE_ID);
      assert.equal(rated, false);
      assert.equal(stamp?.engineVersion, 'opaque-v3-modelA');
      return { ok: true, room: { id: 'bq_test', gameSpecId: 'banqi', rated: false } };
    },
  };
  return { ctx, writes: () => writes };
}

test('internal route is admin-only, default off, fixed-identity and refuses malformed operator/client configuration before writes', async () => {
  configure();
  const c = context();
  async function call(body: Record<string, unknown>, user = admin) {
    const r = response();
    await handleBanqiCreate(c.ctx, r.out, body, user);
    return r.result();
  }
  assert.equal((await call(createBody, null)).status, 403);
  assert.equal(
    (await call(createBody, { ...admin, accountRole: 'player' } as typeof admin)).status,
    403,
  );
  process.env.MISTBOARD_BANQI_TEST_PROVIDER_ENABLED = 'false';
  assert.equal((await call(createBody)).status, 503);
  process.env.MISTBOARD_BANQI_TEST_PROVIDER_ENABLED = 'true';
  for (const url of [
    'http://worker.example.test/turn',
    'https://user:pass@worker.example.test/turn',
    'https://worker.example.test/turn?token=x',
    'https://worker.example.test/other',
  ]) {
    process.env.MISTBOARD_BANQI_TEST_PROVIDER_URL = url;
    assert.equal((await call(createBody)).status, 503);
  }
  configure();
  for (const extra of [
    { endpoint: 'https://elsewhere.test/turn' },
    { command: '/tmp/engine' },
    { evalFile: '/tmp/model' },
    { rated: true },
    { botId: 'misty' },
    { internalEngineTest: false },
  ])
    assert.equal((await call({ ...createBody, ...extra })).status, 400);
  assert.equal(c.writes(), 0);
  assert.equal((await call(createBody)).status, 201);
  assert.equal(c.writes(), 1);
  assert.equal(BANQI_DEFAULT_ENGINE_ID, 'misty-banqi');
  assert.equal(isBanqiEngineClientId(INTERNAL_BANQI_ENGINE_ID), true);
  assert.equal(banqiEngineVersion(INTERNAL_BANQI_ENGINE_ID), null, 'never assign builtin version');
});

test('stamp survives real event hydration; masked snapshots and provider payload never reveal deal or private room owner', async () => {
  configure();
  const stamp = internalBanqiConfiguration('user_test_admin')!;
  const created = await createBanqiLiveRoom(
    {
      banqiRooms: new Map(),
      isRoomIdTaken: () => false,
      appendRoomEvent: async () => {},
      isPersistenceEnabled: () => false,
      recordPersistenceError: () => {},
    },
    undefined,
    'red',
    { engineId: INTERNAL_BANQI_ENGINE_ID, seat: 'black' },
    false,
    stamp,
  );
  assert.ok(created.ok);
  const room = created.room;
  let denied = 0;
  const beforeJoin = room.events.length;
  await handleBanqiWebSocketConnection(
    { defaultRoomRegion: 'global', wsMessageLimit: 40, wsMessageWindowMs: 1000 },
    {
      close: (code: number) => {
        denied = code;
      },
    } as never,
    { headers: {}, url: `/?room=${room.id}` } as never,
    room,
  );
  assert.equal(denied, 1008);
  assert.equal(room.events.length, beforeJoin, 'anonymous WS cannot claim or observe the room');
  appendTenantRuntimeEvent(banqiTenant, room, {
    type: 'seat-assigned',
    at: Date.now(),
    roomId: room.id,
    clientId: 'human',
    seat: 'red',
  });
  assert.ok(isTenantEventLog(banqiTenant, room.events, room.id));
  const hydrated = createTenantRuntimeRoomFromEvents(
    banqiTenant,
    JSON.parse(JSON.stringify(room.events)),
  );
  assert.ok(hydrated.ok);
  assert.deepEqual(internalEngineTestFor(hydrated.room.events), stamp);
  assert.ok(internalBanqiStampMatches(stamp));
  process.env.MISTBOARD_BANQI_TEST_PROVIDER_VERSION = 'different-v4';
  assert.equal(internalBanqiStampMatches(stamp), false);
  configure();
  const view = tenantSnapshotPayload(banqiTenant, room, { id: 'human', seat: 'red', solo: false });
  assert.equal(JSON.stringify(view).includes('ownerUserId'), false);
  assert.equal(JSON.stringify(view).includes('setup'), false);
  assert.equal(view.seatDisplayNames?.black, stamp.displayName);
  const changed = structuredClone(room.events);
  const setup = (changed[0] as { setup: { deal: unknown[] } }).setup;
  const other = setup.deal.findIndex(
    (piece) => JSON.stringify(piece) !== JSON.stringify(setup.deal[0]),
  );
  assert.ok(other > 0);
  [setup.deal[0], setup.deal[other]] = [setup.deal[other], setup.deal[0]];
  const alternate = createTenantRuntimeRoomFromEvents(banqiTenant, changed);
  assert.ok(alternate.ok);
  const a = buildBanqiProviderRequest({
    state: room.projection.state,
    requestId: 'request-1',
    engineId: INTERNAL_BANQI_ENGINE_ID,
    nowMs: 1234,
    budgetMs: 1000,
    remainingMs: null,
    incrementMs: 0,
  });
  const b = buildBanqiProviderRequest({
    state: alternate.room.projection.state,
    requestId: 'request-1',
    engineId: INTERNAL_BANQI_ENGINE_ID,
    nowMs: 1234,
    budgetMs: 1000,
    remainingMs: null,
    incrementMs: 0,
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const otherView = tenantSnapshotPayload(banqiTenant, alternate.room, {
    id: 'human',
    seat: 'red',
    solo: false,
  });
  assert.equal(
    JSON.stringify({ ...view, serverAt: 0 }),
    JSON.stringify({ ...otherView, serverAt: 0 }),
  );
  appendTenantRuntimeEvent(banqiTenant, room, {
    type: 'seat-resigned',
    at: Date.now(),
    roomId: room.id,
    color: 'red',
  });
  const summary = buildTenantGameSummary(banqiTenant, room);
  assert.equal(summary.visibility, 'private');
  assert.equal(summary.corpusId, INTERNAL_BANQI_CORPUS_ID);
  assert.equal(summary.rated, false);
  const engine = summary.participants?.find((p) => p.subjectType === 'engine-version');
  assert.equal(engine?.engineVersion, stamp.engineVersion);
  assert.equal(engine?.subjectId, INTERNAL_BANQI_ENGINE_ID);
  const finished = tenantSnapshotPayload(banqiTenant, room, {
    id: 'human',
    seat: 'red',
    solo: false,
  });
  assert.ok(Object.values(finished.state.board).every((p) => p?.faceDown === true));
  assert.equal(JSON.stringify(finished).includes('ownerUserId'), false);
  assert.equal(banqiLiveWatchPayloadFor(room.id, room), null);
  const record = { ...summary, roomId: room.id } as never;
  assert.notEqual(
    resolveGameExport({ roomId: room.id, format: 'json', summary: record, events: room.events })
      .status,
    200,
  );
  const deps = { getGameSummary: async () => record, loadRoomEvents: async () => room.events };
  assert.equal(await banqiPostgameForApi(room.id, deps), null);
  const owner = await banqiPostgameForApi(room.id, deps, stamp.ownerUserId);
  assert.ok(owner);
  assert.equal('revealed' in owner.history, false);
  assert.ok(Object.values(owner.view.board).every((p) => p?.faceDown === true));
  for (const predicate of [countedHumanGame, preLaunchHumanGame, shortHumanGame])
    assert.ok(predicate().includes(`corpus_id IS DISTINCT FROM '${INTERNAL_BANQI_CORPUS_ID}'`));
  assert.ok(
    internalHumanGame().includes(`corpus_id IS NOT DISTINCT FROM '${INTERNAL_BANQI_CORPUS_ID}'`),
  );
});

test('authenticated health pins worker identity and shares deadline; unavailable/version changes reject without move fallback', async () => {
  configure();
  let calls = 0;
  const bridge = createBanqiProviderBridge(
    {
      turn: async (req) => {
        calls++;
        return providerResponse(req, req.legalMoves[0]!);
      },
    },
    'fixture-only-token',
    'opaque-v3-modelA',
  );
  await new Promise<void>((done) => bridge.listen(0, '127.0.0.1', done));
  const address = bridge.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/turn`;
  try {
    process.env.MISTBOARD_BANQI_TEST_PROVIDER_URL = endpoint;
    const stamp = internalBanqiConfiguration('user_test_admin')!;
    const provider = internalBanqiMoveProvider(stamp);
    const req = () =>
      buildBanqiProviderRequest({
        state: createInitialBanqiState('test-health'),
        requestId: 'health-request',
        engineId: INTERNAL_BANQI_ENGINE_ID,
        nowMs: Date.now(),
        budgetMs: 1000,
        remainingMs: null,
        incrementMs: 0,
      });
    const turn = req();
    const result = await provider(
      INTERNAL_BANQI_ENGINE_ID,
      turn.position.fen,
      { noProgressLimit: 60 },
      turn,
    );
    assert.equal(result.best, turn.legalMoves[0]);
    assert.equal(calls, 1);
    const wrong = createBanqiHttpProvider({
      endpoint,
      token: 'fixture-only-token',
      allowLocalhostHttp: true,
      expectedVersion: 'wrong-build',
    });
    await assert.rejects(wrong.turn(req()), /invalid-response/);
    assert.equal(calls, 1);
    assert.notEqual((await fetch(endpoint.replace('/turn', '/health'))).status, 200);
    process.env.MISTBOARD_BANQI_TEST_PROVIDER_ENABLED = 'false';
    const failed = internalBanqiMoveProvider(stamp);
    const t = req();
    await assert.rejects(
      failed(INTERNAL_BANQI_ENGINE_ID, t.position.fen, { noProgressLimit: 60 }, t),
      /transport/,
    );
    assert.equal(calls, 1);
  } finally {
    bridge.closeAllConnections();
    await new Promise<void>((done) => bridge.close(() => done()));
  }
});

test('health body is inside the same absolute deadline and external cancellation', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const provider = createBanqiHttpProvider({
    endpoint: `http://127.0.0.1:${addr.port}/turn`,
    token: 'fixture-only-token',
    allowLocalhostHttp: true,
    expectedVersion: 'opaque-v3-modelA',
  });
  const req = (budget: number) =>
    buildBanqiProviderRequest({
      state: createInitialBanqiState('test-health-timeout'),
      requestId: 'health-deadline',
      engineId: INTERNAL_BANQI_ENGINE_ID,
      nowMs: Date.now(),
      budgetMs: budget,
      remainingMs: null,
      incrementMs: 0,
    });
  try {
    const began = Date.now();
    await assert.rejects(provider.turn(req(60)), /deadline/);
    assert.ok(Date.now() - began < 1000);
    const controller = new AbortController();
    const turn = provider.turn(req(1000), controller.signal);
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(turn, /cancelled/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
