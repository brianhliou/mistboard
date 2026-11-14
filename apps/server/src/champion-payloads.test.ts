import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { JIEQI_SPEC_ID, STANDARD_JIEQI_DEAL } from '@mistboard/game';
import { jieqiTenant } from './jieqi-tenant.js';
import { buildOpenApiDocument } from './openapi.js';
import { snapshotPayload } from './payloads.js';
import { close, getPool, init } from './persistence-db.js';
import { attachGameParticipants } from './persistence-games.js';
import { type Champion, getChampions } from './persistence-leaderboards.js';
import { getUserProfileByHandle } from './persistence-profiles.js';
import { type RoomManagerContext, seatProfilesForRoom } from './room-manager.js';
import { clearJieqiWatchPostgameCache, jieqiWatchPostgameForApi } from './routes/jieqi-games.js';
import { postgamePlayers } from './routes/lib.js';
import { roomFixture, seatTokenFixture, snapshotClientFixture } from './test-builders.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantSeatProfiles,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

const crowns: Champion[] = [
  { variant: 'xiangqi', timeClass: 'blitz' },
  { variant: 'jieqi', timeClass: 'correspondence' },
];
const championRows = crowns.map(({ variant, timeClass }) => ({
  user_id: 'winner-internal-id',
  handle: 'winner',
  variant,
  time_class: timeClass,
}));
const ctx: RoomManagerContext = {
  send() {},
  recordPersistenceError() {},
  pveBuiltinEngineClientId: 'builtin-random-legal',
  pveEngineMoveDelayMs: 0,
  liveEngineTimeoutMs: 3_000,
  liveClockInitialMs: 180_000,
  liveClockIncrementMs: 2_000,
};

function database(t: TestContext) {
  init('postgres://localhost/champion_payload_test');
  t.after(close);
}

function legacyRoom() {
  const room = roomFixture();
  room.projection.seats = { white: 'white-client', black: 'black-client' };
  room.seatTokens.white = seatTokenFixture({
    seat: 'white',
    userId: 'winner-internal-id',
    userHandle: 'winner',
  });
  return room;
}

function variantRoom() {
  const created = createTenantRuntimeRoomFromEvents(jieqiTenant, [
    {
      type: 'room-created',
      at: 1,
      roomId: 'jq_crowns',
      gameSpecId: JIEQI_SPEC_ID,
      setup: STANDARD_JIEQI_DEAL,
    },
  ]);
  assert.ok(created.ok);
  const room = created.room;
  room.projection.seats = { red: 'red-client', black: 'black-client' };
  room.seatTokens.red = {
    ...seatTokenFixture({ seat: 'white' }),
    seat: 'red',
    clientId: 'red-client',
    userId: 'winner-internal-id',
    userHandle: 'winner',
  };
  return room;
}

test('public profile carries all champion ladders without internal champion identity', async (t) => {
  database(t);
  let visibility = 'public';
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('eligible_count')) return { rows: championRows };
    if (sql.includes('lower(handle) = lower($1)'))
      return {
        rows: [
          {
            id: 'winner-internal-id',
            handle: 'winner',
            display_name: 'Winner',
            profile_visibility: visibility,
            closed_at: null,
            created_at: new Date(),
          },
        ],
      };
    return { rows: [] };
  });
  const profile = await getUserProfileByHandle('winner', null);
  assert.deepEqual(JSON.parse(JSON.stringify(profile)).user.champions, crowns);
  assert.doesNotMatch(JSON.stringify(profile), /winner-internal-id|userId|user_id/);
  visibility = 'private';
  assert.equal(await getUserProfileByHandle('winner', null), null);
  const own = await getUserProfileByHandle('winner', 'winner-internal-id');
  assert.deepEqual(
    JSON.parse(JSON.stringify(own)).user.champions,
    [],
    'private self view has no crown',
  );
});

test('legacy live seats carry champion arrays only for identified human accounts', async (t) => {
  database(t);
  t.mock.method(getPool(), 'query', async () => ({ rows: championRows }));
  await getChampions();
  const room = legacyRoom();
  assert.deepEqual(seatProfilesForRoom(room, ctx), {
    white: { handle: 'winner', champions: crowns },
  });
  const copy = seatProfilesForRoom(room, ctx);
  copy.white!.champions![0]!.variant = 'banqi';
  assert.deepEqual(
    seatProfilesForRoom(room, ctx).white?.champions,
    crowns,
    'callers cannot mutate cached crowns',
  );
  room.seatTokens.white!.userHandle = 'old-handle';
  assert.deepEqual(
    seatProfilesForRoom(room, ctx).white?.champions,
    [],
    'stale handles cannot claim crowns',
  );
  room.seatTokens.white!.userHandle = 'winner';
  room.seatTokens.white!.userId = null;
  assert.deepEqual(seatProfilesForRoom(room, ctx), {}, 'a guest cannot borrow a handle');
  room.seatTokens.white!.userId = 'winner-internal-id';
  room.projection.seats.white = 'python-tier1-v0.9.5';
  assert.doesNotMatch(JSON.stringify(seatProfilesForRoom(room, ctx)), /champions|winner/);
  room.projection.seats.white = 'builtin-random-legal';
  assert.doesNotMatch(JSON.stringify(seatProfilesForRoom(room, ctx)), /champions|winner/);
});

test('variant live seats carry champion arrays and exclude guests, bots and raw engines', async (t) => {
  database(t);
  t.mock.method(getPool(), 'query', async () => ({ rows: championRows }));
  await getChampions();
  const room = variantRoom();
  assert.deepEqual(tenantSeatProfiles(jieqiTenant, room), {
    red: { handle: 'winner', champions: crowns },
  });
  room.seatTokens.red!.userId = null;
  assert.deepEqual(tenantSeatProfiles(jieqiTenant, room), {});
  room.seatTokens.red!.userId = 'winner-internal-id';
  assert.ok(jieqiTenant.engine);
  const withRawEngine = {
    ...jieqiTenant,
    engine: {
      ...jieqiTenant.engine,
      isEngineClientId: (id: string | undefined) =>
        id === 'raw-test-engine' || jieqiTenant.engine!.isEngineClientId(id),
    },
  };
  for (const id of ['pikafish-jieqi-strongest', 'raw-test-engine']) {
    room.projection.seats.red = id;
    assert.doesNotMatch(
      JSON.stringify(tenantSeatProfiles(withRawEngine, room)),
      /champions|winner/,
    );
  }
});

test('seat reads refresh a cold or expired shared cache without serving stale crowns', async (t) => {
  database(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let rows = championRows;
  let queries = 0;
  let fail = false;
  t.mock.method(getPool(), 'query', async () => {
    queries++;
    if (fail) throw new Error('offline');
    return { rows };
  });
  const legacy = legacyRoom();
  const variant = variantRoom();
  assert.deepEqual(
    JSON.parse(JSON.stringify(seatProfilesForRoom(legacy, ctx))).white.champions,
    [],
  );
  tenantSeatProfiles(jieqiTenant, variant);
  await setImmediate();
  assert.equal(queries, 1, 'both stacks share one cold refresh');
  assert.deepEqual(
    JSON.parse(JSON.stringify(tenantSeatProfiles(jieqiTenant, variant))).red.champions,
    crowns,
  );
  rows = [];
  t.mock.timers.tick(30_001);
  assert.deepEqual(
    JSON.parse(JSON.stringify(seatProfilesForRoom(legacy, ctx))).white.champions,
    [],
  );
  tenantSeatProfiles(jieqiTenant, variant);
  await setImmediate();
  assert.equal(queries, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(tenantSeatProfiles(jieqiTenant, variant))).red.champions,
    [],
  );
  fail = true;
  t.mock.timers.tick(30_001);
  seatProfilesForRoom(legacy, ctx);
  await setImmediate();
  fail = false;
  rows = championRows;
  seatProfilesForRoom(legacy, ctx);
  await setImmediate();
  assert.deepEqual(
    JSON.parse(JSON.stringify(seatProfilesForRoom(legacy, ctx))).white.champions,
    crowns,
  );
  assert.equal(queries, 4, 'failed refreshes are handled and retried');
});

test('postgame players strip champion and account fields from every unlinkable subject', () => {
  const participant = {
    color: 'white',
    subjectType: 'user',
    subjectId: 'winner-internal-id',
    handle: 'winner',
    displayName: 'Winner',
    visibility: 'public',
    champions: crowns,
    title: 'xgm',
    flair: 'variant-xiangqi',
  } as const;
  assert.deepEqual(JSON.parse(JSON.stringify(postgamePlayers([participant])))[0].champions, crowns);
  for (const subjectType of ['guest', 'bot', 'engine-version', 'manual', 'imported'] as const) {
    const player = postgamePlayers([{ ...participant, subjectType, subjectId: 'pikafish' }]);
    assert.doesNotMatch(
      JSON.stringify(player),
      /champions|"handle":"winner"|title|flair|winner-internal-id/,
    );
  }
  for (const changes of [{ visibility: 'private' as const }, { handle: null }]) {
    const player = postgamePlayers([{ ...participant, ...changes }]);
    assert.doesNotMatch(JSON.stringify(player), /champions|"handle":"winner"|title|flair/);
  }
});

test('public schemas document the same champion pairs on profiles and finished players', () => {
  const doc = JSON.parse(JSON.stringify(buildOpenApiDocument('https://mistboard.com')));
  const championSchema = doc.components.schemas.LeaderboardEntry.properties.champions;
  assert.deepEqual(doc.components.schemas.PostgamePlayer.properties.champions, championSchema);
  assert.deepEqual(
    doc.components.schemas.GameRecord.properties.participants.items.properties.champions,
    championSchema,
  );
  const profile =
    doc.paths['/api/users/{handle}/profile'].get.responses['200'].content['application/json'].schema
      .properties.profile;
  assert.deepEqual(profile.properties.user.properties.champions, championSchema);
  assert.deepEqual(Object.keys(championSchema.items.properties), ['variant', 'timeClass']);
});

test('persisted participant loading enriches only public user seats and strips private handles', async (t) => {
  database(t);
  let championQueries = 0;
  const participantRows = [
    {
      subject_type: 'user',
      subject_id: 'winner-internal-id',
      handle: 'winner',
      visibility: 'public',
    },
    {
      subject_type: 'user',
      subject_id: 'winner-internal-id',
      handle: 'winner',
      visibility: 'private',
    },
    { subject_type: 'user', subject_id: 'private-internal-id', handle: null, visibility: 'public' },
    { subject_type: 'guest', subject_id: 'private-device-id', handle: null, visibility: 'public' },
    { subject_type: 'bot', subject_id: 'pikafish', handle: null, visibility: 'public' },
    { subject_type: 'engine-version', subject_id: 'engine', handle: null, visibility: 'public' },
  ].map((row, i) => ({ ...row, game_id: `game${i}`, color: 'white', display_name: 'Seat' }));
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('eligible_count')) {
      championQueries++;
      return { rows: championRows };
    }
    return { rows: participantRows };
  });
  const records = participantRows.map((row) => ({ roomId: row.game_id }));
  // Only participant loading is under test; no other game columns are read.
  const enriched = await attachGameParticipants(
    records as Parameters<typeof attachGameParticipants>[0],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(enriched[0])).participants[0].champions, crowns);
  for (const record of enriched.slice(1)) {
    assert.doesNotMatch(JSON.stringify(record.participants), /champions|private-device-id/);
  }
  assert.equal(championQueries, 1, 'one champion read for the whole participant batch');
});

test('champion-enriched hidden room snapshots keep the whole wire payload masked', async (t) => {
  database(t);
  t.mock.method(getPool(), 'query', async () => ({ rows: championRows }));
  await getChampions();
  const legacy = legacyRoom();
  legacy.projection.state.board = {
    e1: { color: 'white', role: 'king' },
    e8: { color: 'black', role: 'king' },
    h8: { color: 'black', role: 'queen' },
  };
  for (const seat of ['white', 'black', 'spectator'] as const) {
    const client = snapshotClientFixture({ seat });
    const baseline = snapshotPayload(legacy, client);
    const enriched = snapshotPayload(
      { ...legacy, seatProfiles: seatProfilesForRoom(legacy, ctx) },
      client,
    );
    assert.deepEqual(enriched.state, baseline.state);
    assert.deepEqual(enriched.events, baseline.events);
    const wire = JSON.stringify(enriched);
    assert.match(wire, /"champions":\[/);
    assert.doesNotMatch(wire, /winner-internal-id|tokenHash|seatTokens|"userId"/);
    if (seat !== 'black') assert.doesNotMatch(wire, /"h8"|queen/);
  }
  const variant = variantRoom();
  for (const seat of ['red', 'black', 'spectator'] as const) {
    const payload = tenantSnapshotPayload(jieqiTenant, variant, {
      id: 'viewer',
      seat,
      solo: false,
    });
    const wire = JSON.stringify(payload);
    assert.match(wire, /"champions":\[/);
    assert.doesNotMatch(wire, /winner-internal-id|tokenHash|seatTokens|"setup"|"userId"/);
    for (const piece of Object.values(payload.state.board)) {
      if (piece?.faceDown) assert.equal('role' in piece, false);
    }
  }
});

test('cached finished Jieqi replay refreshes player crowns without replaying hidden data', async (t) => {
  database(t);
  clearJieqiWatchPostgameCache();
  t.after(clearJieqiWatchPostgameCache);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let rows = championRows;
  let eventReads = 0;
  const room = variantRoom();
  const events = [
    ...room.events,
    { type: 'seat-resigned', at: 2, roomId: room.id, color: 'black' },
  ];
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('eligible_count')) return { rows };
    if (sql.includes('FROM events')) {
      eventReads++;
      return { rows: events.map((payload) => ({ payload })) };
    }
    if (sql.includes('FROM game_participants'))
      return {
        rows: [
          {
            game_id: room.id,
            color: 'red',
            subject_type: 'user',
            subject_id: 'winner-internal-id',
            handle: 'winner',
            display_name: 'Winner',
            visibility: 'public',
          },
        ],
      };
    if (sql.includes('FROM games'))
      return {
        rows: [
          {
            room_id: room.id,
            variant: 'jieqi',
            mode: 'pvp',
            result: 'red-wins',
            termination: 'resignation',
            ply_count: 0,
            started_at: new Date(1),
            ended_at: new Date(2),
            visibility: 'public',
          },
        ],
      };
    assert.fail(`Unexpected query: ${sql}`);
  });
  const first = await jieqiWatchPostgameForApi(room.id);
  assert.deepEqual(first?.game.players[0]?.champions, crowns);
  rows = [];
  t.mock.timers.tick(30_001);
  const second = await jieqiWatchPostgameForApi(room.id);
  assert.deepEqual(second?.game.players[0]?.champions, []);
  assert.equal(eventReads, 1, 'the immutable replay stays cached');
  assert.deepEqual(second?.history, first?.history);
  assert.doesNotMatch(JSON.stringify(second), /winner-internal-id|"setup"/);
});
