import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { FFQ_BANQI_SPEC_ID, gameSpecForId } from '@mistboard/game';
import { collectCurrentGames } from './current-games.js';
import { ffqBanqiEnabled } from './feature-flags.js';
import { ffqBanqiRooms } from './ffq-banqi-registration.js';
import './variant-tenant/register-tenants.js';
import { collectLiveRoomStats } from './live-room-stats.js';
import { onlineFollowingRows } from './online-following.js';
import { close, getPool, init } from './persistence-db.js';
import { filterReplayableGames, markUnavailableGames } from './replayable-games.js';
import { clearWatchInitialReplayCache, tryHandle } from './routes/games.js';
import type { HttpApiContext } from './routes/lib.js';
import { canServeLiveBoard } from './server-policy.js';
import { registeredVariantTenants, type TenantManagedRoom } from './variant-tenant/registry.js';
import { listedOnSurface, listWatchChannels, watchChannelForId } from './watch-channels.js';
import {
  collectLiveTvCandidates,
  liveWatchPayloadForFeatured,
  registerLiveWatchPayloadBuilder,
} from './watch-live.js';
import { clearWatchRailCache } from './watch-rail-cache.js';

const FLAG = 'MISTBOARD_FFQ_BANQI_ENABLED';
const ROOM = 'ffq_discovery';
const SECRET = 'FFQ-CANONICAL-SETUP-MUST-NOT-REACH-DISCOVERY';
const now = 1_800_000_000_000;
const ctx = { rooms: new Map() } as unknown as HttpApiContext;

test('FFQ discovery drops prefixed and legacy rows before replay or page lookup', async (t) => {
  const previous = process.env[FLAG];
  process.env[FLAG] = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });
  assert.equal(ffqBanqiEnabled(), true);
  const rows = [
    { roomId: ROOM, variant: FFQ_BANQI_SPEC_ID, setup: SECRET },
    { roomId: 'legacy-ffq', variant: FFQ_BANQI_SPEC_ID, setup: SECRET },
    { roomId: 'ffq_metadata-mismatch', variant: 'banqi', setup: SECRET },
    { roomId: 'bq_public', variant: 'banqi' },
  ];
  const lookedUp: string[] = [];
  const loaded: string[][] = [];
  const deps = {
    registrationForRoomId: (roomId: string) => {
      lookedUp.push(roomId);
      return { replays: () => true };
    },
    loadRoomsEvents: async (ids: readonly string[]) => {
      loaded.push([...ids]);
      return new Map(ids.map((id) => [id, []]));
    },
    gamePageUrl: (roomId: string) => {
      assert.equal(roomId, 'bq_public', 'excluded rows must not reach page lookup');
      return `/banqi/game/${roomId}`;
    },
  };
  const discovery = await filterReplayableGames(rows, deps);
  assert.deepEqual(discovery, [rows[3]]);
  assert.deepEqual(loaded, [['bq_public']]);
  assert.deepEqual(lookedUp, ['bq_public']);
  const history = await markUnavailableGames(rows, deps);
  assert.deepEqual(history, [rows[3]], 'profiles and favorites must drop FFQ, not mark it');
  assert.doesNotMatch(JSON.stringify({ discovery, history }), /ffq|FFQ|setup/);
  assert.deepEqual(await filterReplayableGames([{ roomId: ROOM }], deps), []);
});

test('FFQ stays off current games, TV and presence Watch links with an enabled tenant', async (t) => {
  const previous = process.env[FLAG];
  process.env[FLAG] = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });
  assert.equal(
    registeredVariantTenants().some((entry) => entry.gameSpecId === FFQ_BANQI_SPEC_ID),
    true,
    'exercise the production FFQ registration',
  );
  const rooms = ffqBanqiRooms as unknown as Map<string, TenantManagedRoom>;
  const room = {
    id: ROOM,
    clients: new Set([
      { id: 'red-client', userId: 'admin-red', seat: 'red' },
      { id: 'black-client', userId: 'admin-black', seat: 'black' },
    ]),
    projection: {
      state: { status: { type: 'playing' }, moveNumber: 10 },
      seats: { red: 'red-client', black: 'black-client' },
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    },
    events: [{ type: 'move-played', at: now - 1_000 }],
    seatTokens: { red: { userHandle: 'red-admin' }, black: { userHandle: 'black-admin' } },
    pendingWrites: Promise.resolve(),
  } as unknown as TenantManagedRoom;
  rooms.set(ROOM, room);
  const registration = registeredVariantTenants().find(
    (entry) => entry.gameSpecId === FFQ_BANQI_SPEC_ID,
  )!;
  for (const capability of [
    'watch',
    'lobby',
    'export',
    'card',
    'createCorrespondenceGameForSeek',
  ] as const)
    assert.equal(registration[capability], null, capability);
  t.after(() => rooms.clear());
  let built = 0;
  registerLiveWatchPayloadBuilder(FFQ_BANQI_SPEC_ID, async () => {
    built += 1;
    return { setup: SECRET };
  });
  assert.equal(canServeLiveBoard(FFQ_BANQI_SPEC_ID), true, 'the public mask remains valid');
  assert.equal(listedOnSurface(FFQ_BANQI_SPEC_ID), false);
  assert.equal(watchChannelForId(FFQ_BANQI_SPEC_ID), null);
  const channels = listWatchChannels();
  const games = collectCurrentGames(ctx, now);
  const candidates = collectLiveTvCandidates(ctx, now);
  assert.deepEqual(games, []);
  assert.deepEqual(candidates, []);
  const stats = collectLiveRoomStats(ctx, now);
  assert.equal(stats.playing, 0, 'playtest rooms do not inflate public activity totals');
  assert.equal(stats.playingBySpec[FFQ_BANQI_SPEC_ID], undefined);
  assert.equal(stats.playingRoomByUserId.size, 0);
  assert.equal(stats.onlineIdentities.has('u:admin-red'), true, 'online presence is retained');
  const following = onlineFollowingRows(
    [
      {
        userId: 'admin-red',
        handle: 'red-admin',
        displayName: 'Red admin',
        title: null,
        profileVisibility: 'public',
        lastSeenMs: now,
      },
    ],
    stats,
    new Map(),
  );
  assert.equal(following[0]?.roomUrl, null);
  assert.doesNotMatch(JSON.stringify({ channels, games, candidates, following }), /ffq|FFQ|setup/);
  assert.equal(
    await liveWatchPayloadForFeatured({
      channelId: FFQ_BANQI_SPEC_ID,
      gameSpecId: FFQ_BANQI_SPEC_ID,
      roomId: ROOM,
    } as Parameters<typeof liveWatchPayloadForFeatured>[0]),
    null,
  );
  assert.equal(built, 0, 'even a stale election cannot invoke the FFQ payload builder');

  const spec = gameSpecForId(FFQ_BANQI_SPEC_ID) as { publicSurface: string };
  const surface = spec.publicSurface;
  spec.publicSurface = 'casual';
  try {
    assert.equal(listedOnSurface(FFQ_BANQI_SPEC_ID), false, 'exclusion is permanent');
  } finally {
    spec.publicSurface = surface;
  }
});

test('FFQ never seeds initial watch replay or leaks through serialized public lists', async (t) => {
  const previous = process.env[FLAG];
  process.env[FLAG] = 'true';
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  clearWatchRailCache();
  clearWatchInitialReplayCache();
  t.after(async () => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
    clearWatchRailCache();
    clearWatchInitialReplayCache();
    await close();
  });
  t.mock.method(getPool(), 'connect', () => assert.fail('unexpected database connection'));
  // Deliberately return a bad row despite SQL filters, to check the response
  // boundary independently of persistence. The metadata itself is sensitive.
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('FROM game_participants')) return { rows: [] };
    if (sql.includes('FROM games')) {
      if (sql.includes("games.status = 'running'")) return { rows: [{ count: 0 }] };
      return {
        rows: [
          {
            room_id: ROOM,
            variant: FFQ_BANQI_SPEC_ID,
            mode: 'pvp',
            result: 'draw',
            termination: 'draw',
            ply_count: 30,
            started_at: new Date(now - 60_000),
            ended_at: new Date(now),
            white_name: SECRET,
            black_name: SECRET,
            visibility: 'public',
            time_control: { setup: SECRET },
          },
        ],
      };
    }
    assert.fail(`excluded room reached event loading: ${sql}`);
  });
  for (const url of [
    '/api/watch',
    '/api/watch?curated=0',
    '/api/games/recent',
    '/api/games/showcase',
    '/api/eve-games/recent',
  ]) {
    let status = 0;
    let body = '';
    const response = {
      writeHead: (code: number) => {
        status = code;
      },
      end: (value: string) => {
        body = value;
      },
    } as unknown as ServerResponse;
    const parsedUrl = new URL(url, 'http://localhost');
    const handled = await tryHandle(
      ctx,
      { method: 'GET', url } as IncomingMessage,
      response,
      parsedUrl.pathname,
      parsedUrl,
    );
    assert.equal(handled, true, url);
    assert.equal(status, 200, url);
    assert.doesNotMatch(body, /ffq|FFQ|setup|initialReplay/, url);
    const payload = JSON.parse(body);
    assert.deepEqual(payload.unlocked ?? payload.games, [], url);
    if (payload.channels) {
      for (const channel of payload.channels) {
        assert.equal(channel.unlockedCount, 0);
        assert.equal(channel.topPlayer, null);
      }
    }
  }
});
