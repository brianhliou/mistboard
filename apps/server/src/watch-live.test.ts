import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test, { beforeEach } from 'node:test';
import { GAME_SPECS } from '@mistboard/game';
import { tryHandle } from './routes/games.js';
import type { HttpApiContext } from './routes/lib.js';
import {
  canServeLiveBoard,
  HIDDEN_IDENTITY_LIVE_OBSERVE,
  liveObservePolicy,
} from './server-policy.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';
import {
  collectLiveTvCandidates,
  electLiveTvFeatured,
  LIVE_TV_FRESH_WINDOW_MS,
  LIVE_TV_TOP_CHANNEL_ID,
  registerLiveWatchPayloadBuilder,
  resetLiveTvFeaturedForTest,
} from './watch-live.js';

// ---------------------------------------------------------------------------
// Fail-closed policy conformance: every spec maps through liveObservePolicy.
// Open-visibility specs always serve live; dark NEVER does; hidden-identity
// splits on the explicit symmetric/asymmetric classification. A new visibility
// class fails the liveObservePolicy switch at compile time; a new spec is
// covered here automatically via GAME_SPECS.
// ---------------------------------------------------------------------------

test('liveObservePolicy is exhaustive over every game spec and only open serves live', () => {
  assert.ok(GAME_SPECS.length > 0);
  for (const spec of GAME_SPECS) {
    const policy = liveObservePolicy(spec.visibility, spec.id);
    if (spec.visibility === 'dark') {
      assert.equal(policy, 'sealed', `${spec.id} (fog) must stay sealed`);
      assert.equal(
        canServeLiveBoard(spec.id),
        false,
        `${spec.id} (fog) must NOT serve a live board`,
      );
      continue;
    }
    if (spec.visibility === 'open') {
      assert.equal(policy, 'open', `${spec.id} should be live-servable`);
      assert.equal(canServeLiveBoard(spec.id), true);
      continue;
    }
    // hidden-identity: whatever the classification says, and canServeLiveBoard agrees.
    assert.equal(
      canServeLiveBoard(spec.id),
      policy === 'open',
      `${spec.id} live-servability must follow its hidden-identity classification`,
    );
  }
});

// Every hidden-identity spec must be classified explicitly. A NEW one lands here
// unclassified and fails, which is the point: it stays 'masked' (fail-closed) at
// runtime until someone decides whether its mask is symmetric.
test('every hidden-identity spec is explicitly classified symmetric or asymmetric', () => {
  const hiddenIdentity = GAME_SPECS.filter((spec) => spec.visibility === 'hidden-identity').map(
    (spec) => spec.id,
  );
  assert.ok(hiddenIdentity.length > 0);
  for (const id of hiddenIdentity) {
    assert.ok(
      HIDDEN_IDENTITY_LIVE_OBSERVE[id] !== undefined,
      `${id} is hidden-identity but unclassified in HIDDEN_IDENTITY_LIVE_OBSERVE`,
    );
  }
  for (const id of Object.keys(HIDDEN_IDENTITY_LIVE_OBSERVE)) {
    assert.ok(
      hiddenIdentity.includes(id as (typeof hiddenIdentity)[number]),
      `${id} is no longer hidden-identity`,
    );
  }
});

// The split itself. Symmetric masks (both seats see the identical board) go live;
// asymmetric ones (a player knows something the other does not) stay masked.
test('symmetric hidden-identity variants serve live; asymmetric ones do not', () => {
  for (const id of ['banqi', 'jungle-flip']) {
    assert.equal(canServeLiveBoard(id), true, `${id} is symmetric and should serve live`);
  }
  for (const id of ['jieqi']) {
    assert.equal(canServeLiveBoard(id), false, `${id} is asymmetric and must NOT serve live`);
  }
});

// An unclassified hidden-identity spec falls through to 'masked', never 'open'.
test('an unclassified hidden-identity spec falls back to masked', () => {
  assert.equal(liveObservePolicy('hidden-identity', 'not-a-real-spec'), 'masked');
  assert.equal(liveObservePolicy('hidden-identity'), 'masked');
});

test('canServeLiveBoard refuses unknown spec ids (fail-closed)', () => {
  assert.equal(canServeLiveBoard('no-such-spec'), false);
  assert.equal(canServeLiveBoard(''), false);
});

// ---------------------------------------------------------------------------
// Candidate scan + elector + route, against fake tenant registrations. The
// registry has no unregister, so this file registers its tenants once and
// resets their mutable room maps between tests (routes-meta.test.ts pattern).
// The real registrations are NOT loaded here (no register-tenants import), so
// the registry contains exactly these three tenants.
// ---------------------------------------------------------------------------

const FAKE_ENGINE_PREFIX = 'fake-engine-';

const openRooms = new Map<string, TenantManagedRoom>();
const fogRooms = new Map<string, TenantManagedRoom>();
const hiddenRooms = new Map<string, TenantManagedRoom>();

function fakeRegistration(args: {
  kind: string;
  gameSpecId: string;
  channelId: string;
  roomIdPrefix: string;
  rooms: Map<string, TenantManagedRoom>;
}): VariantTenantRegistration {
  return {
    kind: args.kind,
    gameSpecId: args.gameSpecId,
    roomIdPrefix: args.roomIdPrefix,
    watch: {
      channelId: args.channelId,
      family: 'xiangqi',
      label: args.kind,
      legacyVariants: [args.channelId],
    },
    isEngineClientId: (clientId: string | undefined) =>
      clientId?.startsWith(FAKE_ENGINE_PREFIX) ?? false,
    enabled: () => true,
    rooms: args.rooms,
    activeGameCount: () => 0,
  } as unknown as VariantTenantRegistration;
}

registerVariantTenant(
  fakeRegistration({
    channelId: 'xiangqi',
    gameSpecId: 'xiangqi',
    kind: 'fake-open',
    roomIdPrefix: 'fko_',
    rooms: openRooms,
  }),
);
registerVariantTenant(
  fakeRegistration({
    channelId: 'dark-xiangqi',
    gameSpecId: 'dark-xiangqi',
    kind: 'fake-fog',
    roomIdPrefix: 'fkf_',
    rooms: fogRooms,
  }),
);
registerVariantTenant(
  fakeRegistration({
    channelId: 'jieqi',
    gameSpecId: 'jieqi',
    kind: 'fake-hidden',
    roomIdPrefix: 'fkh_',
    rooms: hiddenRooms,
  }),
);

// Every fake channel gets a payload builder — including the fog and
// hidden-identity ones, proving the VISIBILITY policy (not the capability
// gate) is what excludes them from live TV.
function fakePayloadFor(roomId: string): Record<string, unknown> {
  return { game: { roomId, result: 'in-progress' } };
}
for (const channelId of ['xiangqi', 'dark-xiangqi', 'jieqi']) {
  registerLiveWatchPayloadBuilder(channelId, async (roomId) => fakePayloadFor(roomId));
}

const NOW = 1_800_000_000_000;

function tenantRoom(args: {
  id: string;
  status?: 'playing' | 'finished' | 'waiting';
  seats?: Record<string, string>;
  lastEventAt?: number;
  moveNumber?: number;
  setup?: unknown;
}): TenantManagedRoom {
  const lastEventAt = args.lastEventAt ?? NOW - 1_000;
  return {
    id: args.id,
    clients: [],
    events: [
      {
        type: 'room-created',
        at: lastEventAt - 60_000,
        ...(args.setup !== undefined ? { setup: args.setup } : {}),
      } as { type: string; at?: number },
      { type: 'move-played', at: lastEventAt },
    ],
    projection: {
      state: { status: { type: args.status ?? 'playing' }, moveNumber: args.moveNumber ?? 4 },
      seats: args.seats ?? { black: 'client-b', red: 'client-a' },
      rated: false,
    },
    seatTokens: {
      red: {
        userDisplayName: 'Ada',
        userHandle: 'ada',
        userId: 'user-a',
      },
    },
    pendingWrites: Promise.resolve(),
  };
}

function context(): HttpApiContext {
  return { rooms: new Map() } as unknown as HttpApiContext;
}

type ResponseCapture = { body: string; status: number | null };

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    status: null as number | null,
    setHeader() {
      return capture;
    },
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}

async function getLive(
  query = '',
): Promise<{ status: number | null; payload: Record<string, unknown> }> {
  const response = captureResponse();
  const url = `/api/watch/live${query}`;
  const handled = await tryHandle(
    context(),
    { method: 'GET', url, headers: {} } as unknown as IncomingMessage,
    response,
    '/api/watch/live',
    new URL(url, 'http://localhost'),
  );
  assert.equal(handled, true);
  return { payload: JSON.parse(response.body) as Record<string, unknown>, status: response.status };
}

beforeEach(() => {
  openRooms.clear();
  fogRooms.clear();
  hiddenRooms.clear();
  resetLiveTvFeaturedForTest();
});

test('a playing open-visibility tenant room becomes a live candidate', () => {
  openRooms.set('fko_1', tenantRoom({ id: 'fko_1' }));
  const candidates = collectLiveTvCandidates(context(), NOW);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.roomId, 'fko_1');
  assert.equal(candidate.channelId, 'xiangqi');
  assert.equal(candidate.composition, 'pvp');
  assert.equal(candidate.ply, 4);
  const named = candidate.players.find((player) => player.name === 'Ada');
  assert.ok(named, 'seat-token display name should surface');
});

test('fog and hidden-identity rooms NEVER become candidates, playing or not', () => {
  fogRooms.set('fkf_1', tenantRoom({ id: 'fkf_1' }));
  hiddenRooms.set('fkh_1', tenantRoom({ id: 'fkh_1' }));
  assert.deepEqual(collectLiveTvCandidates(context(), NOW), []);
});

test('finished, stale, and half-seated rooms are excluded', () => {
  openRooms.set('fko_done', tenantRoom({ id: 'fko_done', status: 'finished' }));
  openRooms.set(
    'fko_stale',
    tenantRoom({ id: 'fko_stale', lastEventAt: NOW - LIVE_TV_FRESH_WINDOW_MS - 1 }),
  );
  openRooms.set('fko_half', tenantRoom({ id: 'fko_half', seats: { red: 'client-a' } }));
  assert.deepEqual(collectLiveTvCandidates(context(), NOW), []);
});

// The hero board is not a lobby: a room nobody has answered yet can be
// abandoned a move later, which leaves the homepage frozen on an untouched
// board. moveNumber 2 is the first position both players have moved in.
test('a room where only the first player has moved is not a candidate', () => {
  openRooms.set('fko_opening', tenantRoom({ id: 'fko_opening', moveNumber: 1 }));
  assert.deepEqual(collectLiveTvCandidates(context(), NOW), []);

  openRooms.set('fko_answered', tenantRoom({ id: 'fko_answered', moveNumber: 2 }));
  const candidates = collectLiveTvCandidates(context(), NOW);
  assert.deepEqual(
    candidates.map((candidate) => candidate.roomId),
    ['fko_answered'],
  );
});

test('an engine seat labels the game pve and surfaces the engine client id', () => {
  openRooms.set(
    'fko_pve',
    tenantRoom({ id: 'fko_pve', seats: { black: `${FAKE_ENGINE_PREFIX}l4`, red: 'client-a' } }),
  );
  const candidates = collectLiveTvCandidates(context(), NOW);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.composition, 'pve');
  const engineSeat = candidates[0]!.players.find((player) => player.isEngine);
  assert.equal(engineSeat?.name, `${FAKE_ENGINE_PREFIX}l4`);
});

test('elector: pvp outranks pve; hysteresis holds within a tier; pool empty clears', () => {
  const pve = collectLiveTvCandidates(context(), NOW); // build shapes via real scan
  assert.deepEqual(pve, []);

  openRooms.set(
    'fko_a',
    tenantRoom({
      id: 'fko_a',
      lastEventAt: NOW - 5_000,
      seats: { black: `${FAKE_ENGINE_PREFIX}x`, red: 'c1' },
    }),
  );
  let featured = electLiveTvFeatured(
    LIVE_TV_TOP_CHANNEL_ID,
    collectLiveTvCandidates(context(), NOW),
  );
  assert.equal(featured?.roomId, 'fko_a');

  // A fresher same-tier candidate does not displace the current featured game.
  openRooms.set(
    'fko_b',
    tenantRoom({
      id: 'fko_b',
      lastEventAt: NOW - 1_000,
      seats: { black: `${FAKE_ENGINE_PREFIX}x`, red: 'c2' },
    }),
  );
  featured = electLiveTvFeatured(LIVE_TV_TOP_CHANNEL_ID, collectLiveTvCandidates(context(), NOW));
  assert.equal(featured?.roomId, 'fko_a');

  // A live PvP game takes the hero over any engine game.
  openRooms.set('fko_pvp', tenantRoom({ id: 'fko_pvp', lastEventAt: NOW - 9_000 }));
  featured = electLiveTvFeatured(LIVE_TV_TOP_CHANNEL_ID, collectLiveTvCandidates(context(), NOW));
  assert.equal(featured?.roomId, 'fko_pvp');

  openRooms.clear();
  featured = electLiveTvFeatured(LIVE_TV_TOP_CHANNEL_ID, collectLiveTvCandidates(context(), NOW));
  assert.equal(featured, null);
});

// The 'top' channel is the default landing channel and its only tiebreak used
// to be recency, so a bot game on any variant could hold the hero board while
// standard xiangqi was live. These drive electLiveTvFeatured with literal
// candidates rather than the room scan, because the flagship rule keys on
// gameSpecId and needs two different specs in one pool.
function candidate(args: {
  roomId: string;
  gameSpecId: string;
  composition: 'pvp' | 'pve';
  lastActivityAt: number;
}): Parameters<typeof electLiveTvFeatured>[1][number] {
  return {
    roomId: args.roomId,
    gameSpecId: args.gameSpecId,
    channelId: args.gameSpecId,
    composition: args.composition,
    players: [],
    ply: 4,
    rated: false,
    startedAt: NOW - 60_000,
    lastActivityAt: args.lastActivityAt,
    timeControl: null,
    clock: null,
  };
}

test('elector: standard xiangqi takes the hero over a fresher non-xiangqi game at equal composition', () => {
  resetLiveTvFeaturedForTest();
  const featured = electLiveTvFeatured(LIVE_TV_TOP_CHANNEL_ID, [
    candidate({
      roomId: 'jungle',
      gameSpecId: 'jungle-flip',
      composition: 'pve',
      lastActivityAt: NOW - 1_000,
    }),
    candidate({
      roomId: 'xq',
      gameSpecId: 'xiangqi',
      composition: 'pve',
      lastActivityAt: NOW - 30_000,
    }),
  ]);
  assert.equal(featured?.roomId, 'xq');
});

test('elector: the flagship bonus never lifts a xiangqi engine game over a human game', () => {
  resetLiveTvFeaturedForTest();
  const featured = electLiveTvFeatured(LIVE_TV_TOP_CHANNEL_ID, [
    candidate({
      roomId: 'xq-bot',
      gameSpecId: 'xiangqi',
      composition: 'pve',
      lastActivityAt: NOW - 1_000,
    }),
    candidate({
      roomId: 'jungle-humans',
      gameSpecId: 'jungle-flip',
      composition: 'pvp',
      lastActivityAt: NOW - 30_000,
    }),
  ]);
  assert.equal(featured?.roomId, 'jungle-humans');
});

test('elector: on a variant-filtered channel the flagship bonus cancels and recency still wins', () => {
  resetLiveTvFeaturedForTest();
  const featured = electLiveTvFeatured('jungle-flip', [
    candidate({
      roomId: 'old',
      gameSpecId: 'jungle-flip',
      composition: 'pve',
      lastActivityAt: NOW - 30_000,
    }),
    candidate({
      roomId: 'fresh',
      gameSpecId: 'jungle-flip',
      composition: 'pve',
      lastActivityAt: NOW - 1_000,
    }),
  ]);
  assert.equal(featured?.roomId, 'fresh');
});

test('GET /api/watch/live: empty pool answers featured null', async () => {
  const { payload, status } = await getLive();
  assert.equal(status, 200);
  assert.equal(payload.channel, LIVE_TV_TOP_CHANNEL_ID);
  assert.equal(payload.featured, null);
});

test('GET /api/watch/live rejects unknown channels', async () => {
  const { status } = await getLive('?channel=no-such-channel');
  assert.equal(status, 404);
});

test('GET /api/watch/live serves the featured open game with its payload, omitted when unchanged', async () => {
  openRooms.set('fko_1', tenantRoom({ id: 'fko_1' }));
  const { payload, status } = await getLive('?channel=xiangqi');
  assert.equal(status, 200);
  const featured = payload.featured as Record<string, unknown>;
  assert.equal(featured.roomId, 'fko_1');
  assert.equal(featured.kind, 'live');
  assert.deepEqual(featured.payload, fakePayloadFor('fko_1'));

  // A follower already at the featured ply gets the moment without the payload.
  const ply = featured.ply as number;
  const unchanged = await getLive(`?channel=xiangqi&room=fko_1&ply=${ply}`);
  const unchangedFeatured = unchanged.payload.featured as Record<string, unknown>;
  assert.equal(unchangedFeatured.roomId, 'fko_1');
  assert.equal('payload' in unchangedFeatured, false);

  // A stale ply (or another room) gets the payload again.
  const stale = await getLive(`?channel=xiangqi&room=fko_1&ply=${ply - 1}`);
  assert.deepEqual(
    (stale.payload.featured as Record<string, unknown>).payload,
    fakePayloadFor('fko_1'),
  );
});

test('an open tenant WITHOUT a live payload builder never yields candidates (capability gate)', () => {
  // fortress-xiangqi is a real open spec whose channel has no registered
  // builder in this test file — its playing room must not become a candidate,
  // mirroring prod (bespoke watch renderer, no live path yet).
  const rooms = new Map<string, TenantManagedRoom>();
  registerVariantTenant(
    fakeRegistration({
      channelId: 'fortress-xiangqi',
      gameSpecId: 'fortress-xiangqi',
      kind: 'fake-open-unrenderable',
      roomIdPrefix: 'fku_',
      rooms,
    }),
  );
  rooms.set('fku_1', tenantRoom({ id: 'fku_1' }));
  assert.deepEqual(collectLiveTvCandidates(context(), NOW), []);
  rooms.clear();
});

test('GET /api/watch/live withholds the moment when the payload builder comes up empty', async () => {
  const rooms = new Map<string, TenantManagedRoom>();
  registerVariantTenant(
    fakeRegistration({
      channelId: 'banqi',
      gameSpecId: 'banqi',
      kind: 'fake-open-vanishing',
      roomIdPrefix: 'fkv_',
      rooms,
    }),
  );
  registerLiveWatchPayloadBuilder('banqi', async () => null);
  rooms.set('fkv_1', tenantRoom({ id: 'fkv_1' }));
  const { payload } = await getLive('?channel=banqi');
  assert.equal(payload.featured, null);
  rooms.clear();
});

test('GET /api/watch/live never features a playing fog game (route-level fail-closed)', async () => {
  fogRooms.set('fkf_live', tenantRoom({ id: 'fkf_live' }));
  const top = await getLive();
  assert.equal(top.payload.featured, null);
  const channel = await getLive('?channel=dark-xiangqi');
  assert.equal(channel.payload.featured, null);
});
