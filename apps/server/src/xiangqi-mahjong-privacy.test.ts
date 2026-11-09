// Launch prerequisite for #678. Exercise UNFINISHED matches through the real
// serializers/registrations, checking the entire payload, not just its board.
// At the first deal no tile is public, so even a single tile face is a leak.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import test, { mock } from 'node:test';
import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
  type XmjPlayerView,
  type XmjRoomSetup,
  type XmjSeat,
  type XmjTile,
  xmjOrderedTiles,
} from '@mistboard/game';
import { collectCurrentGames } from './current-games.js';
import { resolveGameExport } from './game-export-tenant.js';
import { tenantGameCard, tenantGamePageMeta } from './og-game-tenant.js';
import type { RecentEveGameRecord } from './persistence.js';
import type { HttpApiContext } from './routes/lib.js';
import { xiangqiMahjongPostgameForApi } from './routes/xiangqi-mahjong-games.js';
import { hashSeatToken } from './server-seat-session.js';
import { variantTenantForSpecId } from './variant-tenant/registry.js';
import { collectLiveTvCandidates } from './watch-live.js';
import './variant-tenant/register-tenants.js';
import { appendTenantEvent } from './variant-tenant/events.js';
import { clearTenantRuntimeTimers } from './variant-tenant/lifecycle.js';
import {
  appendTenantRuntimeEvent,
  createTenantClock,
  createTenantRuntimeRoomFromEvents,
  expireTenantClock,
  tenantEventsForClient,
  tenantLiveHistoryExtras,
  tenantPauseEventFor,
  tenantResumeEventFor,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { createTenantWsRuntime } from './variant-tenant/ws.js';
import { type XmjRuntimeRoom, xiangqiMahjongRooms } from './xiangqi-mahjong-registration.js';
import { xiangqiMahjongTenant as tenant, type XmjEvent } from './xiangqi-mahjong-tenant.js';
import { xmjLiveWatchPayloadFor } from './xiangqi-mahjong-watch.js';

const SPECTATOR = { id: 'privacy-spectator', seat: 'spectator' as const, solo: false };

// #990 replay: discard rP at 4000; runtime pass at 5500 (noClaimFront),
// human pass at 9000 (claimFront); poll/reconnect at every sampleAt; discard
// bK at 12000, including the complete release frame. Each schedule reuses its exact walls. The paired walls differ
// only in west's concealed tiles and the unseen wall, so east's whole payload
// and the spectator's whole payload must also match across the two deals.
// Planted failure: MISTBOARD_XMJ_PLANT_PASS_LEAK=1 node --import tsx --test
// --test-name-pattern='claim timing is invariant' src/xiangqi-mahjong-privacy.test.ts
// (from apps/server). The fixture's deliverPassImmediately mutation must fail.
const claimTiming = JSON.parse(
  readFileSync(
    new URL('../src/fixtures/xiangqi-mahjong-claim-timing.json', import.meta.url),
    'utf8',
  ),
) as {
  noClaimFront: XmjTile[];
  claimFront: XmjTile[];
  discardAt: number;
  delayedPassAt: number;
  publicMoveAt: number;
  sampleAt: number[];
  plantedFailure: { deliverPassImmediately: boolean };
};

function timingTable(hasClaim: boolean, plantLeak = false, correspondence = false) {
  const front = hasClaim ? claimTiming.claimFront : claimTiming.noClaimFront;
  const rest = xmjOrderedTiles();
  for (const tile of front) {
    const index = rest.indexOf(tile);
    assert.notEqual(index, -1);
    rest.splice(index, 1);
  }
  const wall = [...front, ...rest];
  const room = unfinishedMatch(correspondence, {
    walls: [wall, wall],
    firstDealer: 'east',
    taiTable: 2,
    ...(correspondence ? { correspondence: true } : {}),
  });
  // A deliberate insecure serializer AND public frontier: this models the
  // original immediate pass delivery, including its state and clock effects.
  const wireTenant = plantLeak
    ? {
        ...tenant,
        visibility: {
          ...tenant.visibility,
          clientEventCount: undefined,
          clientEventFor: (event: XmjEvent, _seat: unknown, ply: number) =>
            tenant.visibility.clientEventFor(
              event,
              event.type === 'move-played' ? event.color : 'east',
              ply,
            ),
        },
      }
    : tenant;
  const runtime = createTenantWsRuntime(wireTenant);
  const live = room as Parameters<typeof runtime.broadcastSnapshot>[0];
  const frames = { east: [] as unknown[], west: [] as unknown[], spectator: [] as unknown[] };
  for (const seat of ['east', 'west', 'spectator'] as const) {
    live.clients.add({
      id: `${seat}-client`,
      seat,
      solo: false,
      displaced: false,
      debugRequested: false,
      messageTimestamps: [],
      roomId: room.id,
      socket: { send: (json: string) => frames[seat].push(JSON.parse(json)) } as never,
    });
  }
  const play = (move: XmjMove) => {
    const event: XmjEvent = {
      type: 'move-played',
      roomId: room.id,
      at: move.at,
      color: move.by,
      move,
    };
    const seq = appendTenantRuntimeEvent(tenant, room, event);
    assert.notEqual(seq, -1);
    runtime.scheduleLifecycleTimers(live);
    clearTenantRuntimeTimers(room);
    runtime.broadcastEventAppended(live, event, seq);
    return event;
  };
  play({ action: 'discard', by: 'east', at: claimTiming.discardAt, tile: 'rP' });
  assert.equal(
    tenant.rules.pendingAction?.(room.projection.state) === null,
    hasClaim || correspondence,
  );
  const payload = (seat: XmjSeat | 'spectator') => {
    const client = { id: `${seat}-client`, seat, solo: false };
    const reloaded = createTenantRuntimeRoomFromEvents(
      tenant,
      JSON.parse(JSON.stringify(room.events)),
    );
    assert.ok(reloaded.ok);
    return JSON.stringify({
      snapshot: tenantSnapshotPayload(wireTenant, room, client),
      history: tenantLiveHistoryExtras(wireTenant, room, client),
      reconnect: {
        snapshot: tenantSnapshotPayload(wireTenant, reloaded.room, client),
        history: tenantLiveHistoryExtras(wireTenant, reloaded.room, client),
      },
      frames: frames[seat],
      ...(seat === 'spectator' && !correspondence
        ? { watch: xmjLiveWatchPayloadFor(room.id, room) }
        : {}),
    });
  };
  return { room, live, runtime, frames, play, payload };
}

function assertClaimTimingInvariant(plantLeak = false): void {
  const automatic = timingTable(false, plantLeak);
  const delayed = timingTable(true, plantLeak);
  const immediate = timingTable(true, plantLeak);
  for (const now of claimTiming.sampleAt) {
    mock.method(Date, 'now', () => now);
    if (now === claimTiming.discardAt) {
      immediate.play({ action: 'pass', by: 'west', at: now });
    }
    if (now === 5500) {
      const pending = tenant.rules.pendingAction?.(automatic.room.projection.state);
      assert.ok(pending);
      automatic.play(pending.move);
    }
    if (now === claimTiming.delayedPassAt) delayed.play({ action: 'pass', by: 'west', at: now });
    if (now === claimTiming.publicMoveAt) {
      for (const table of [automatic, delayed, immediate]) {
        table.play({ action: 'discard', by: 'west', at: now, tile: 'bK' });
      }
    }
    for (const seat of ['east', 'spectator'] as const) {
      assert.equal(
        automatic.payload(seat),
        delayed.payload(seat),
        `${seat} at ${now}: runtime vs delayed pass`,
      );
      assert.equal(
        immediate.payload(seat),
        delayed.payload(seat),
        `${seat} at ${now}: same walls, early vs delayed pass`,
      );
    }
  }
}

test('XMJ privacy: claim timing is invariant in complete wire, reconnect and TV payloads', () => {
  mock.method(Date, 'now', () => claimTiming.discardAt);
  try {
    assertClaimTimingInvariant(process.env.MISTBOARD_XMJ_PLANT_PASS_LEAK === '1');
  } finally {
    mock.restoreAll();
  }
});

test('XMJ privacy: WebSocket refuses early passes and stamps accepted answers at the pause end', async () => {
  mock.method(Date, 'now', () => 4100);
  const table = timingTable(true);
  table.live.clients.clear();
  table.room.seatTokens.west = {
    clientId: 'west-client',
    seat: 'west',
    tokenHash: hashSeatToken('west-token'),
    userId: null,
    userHandle: null,
    userDisplayName: null,
    issuedAt: new Date(0),
    lastSeenAt: new Date(0),
    revokedAt: null,
  };
  let onMessage: ((data: unknown) => void) | undefined;
  const socket = {
    send: (_data: string) => {},
    close: () => {},
    on(event: string, cb: (data: unknown) => void) {
      if (event === 'message') onMessage = cb;
      return this;
    },
  };
  try {
    await table.runtime.handleConnection(
      { wsMessageLimit: 100, wsMessageWindowMs: 1000 },
      socket as never,
      {
        url: '/?client=west-client',
        headers: {
          host: 'localhost',
          'sec-websocket-protocol': 'mistboard-seat.west-token',
        },
      } as IncomingMessage,
      table.live,
    );
    assert.ok(onMessage);
    const before = table.room.events.length;
    const sendPass = async () => {
      onMessage!(Buffer.from(JSON.stringify({ type: 'move', action: 'pass' })));
      await table.room.pendingWrites;
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    };
    await sendPass();
    assert.equal(table.room.events.length, before, 'a custom client cannot pass before the pause');
    mock.method(Date, 'now', () => 5620);
    await sendPass();
    const stored = table.room.events.at(-1);
    assert.equal(stored?.type, 'move-played');
    assert.ok(stored?.type === 'move-played');
    assert.equal(stored.move.action, 'pass');
    assert.equal(stored.move.at, 5500);
    assert.equal(stored.at, 5500, 'clock arithmetic uses the same effective time');
  } finally {
    clearTenantRuntimeTimers(table.room);
    table.live.clients.clear();
    mock.restoreAll();
  }
});

test('XMJ privacy: a fast public move cannot precede the universal claim pause', () => {
  mock.method(Date, 'now', () => 4100);
  try {
    const table = timingTable(true);
    assert.equal(
      tenant.rules.canonicalMove!(
        table.room.projection.state,
        { action: 'pass', by: 'west', at: 0 },
        'west',
      ),
      null,
    );
    const before = table.payload('spectator');
    mock.method(Date, 'now', () => 4300);
    assert.equal(
      tenant.rules.canonicalMove!(
        table.room.projection.state,
        { action: 'discard', by: 'west', at: 0, tile: 'bK' },
        'west',
      ),
      null,
    );
    mock.method(Date, 'now', () => 4100);
    assert.equal(table.payload('spectator'), before);
    mock.method(Date, 'now', () => 5500);
    const pass = tenant.rules.canonicalMove!(
      table.room.projection.state,
      { action: 'pass', by: 'west', at: 0 },
      'west',
    );
    assert.ok(pass);
    table.play(pass);
    assert.ok(
      tenant.rules.canonicalMove!(
        table.room.projection.state,
        { action: 'discard', by: 'west', at: 0, tile: 'bK' },
        'west',
      ),
    );
  } finally {
    mock.restoreAll();
  }
});

test('XMJ privacy: a declared pass waits for the pause and schedules the same discard as an automatic pass', () => {
  const front = ['rK', 'rA', 'rE', 'rP', 'bH', 'bK', 'bA', 'bE', 'bR', 'bP', 'rA'] as XmjTile[];
  const rest = xmjOrderedTiles();
  for (const tile of front) rest.splice(rest.indexOf(tile), 1);
  let state = createXmjRoomState({
    walls: [[...front, ...rest]],
    firstDealer: 'east',
    taiTable: 3,
  });
  for (const move of [
    { action: 'declare-ready', by: 'east', at: 1000, tile: 'bH' },
    { action: 'pass', by: 'west', at: 3000 },
    { action: 'discard', by: 'west', at: 4000, tile: 'bR' },
  ] as XmjMove[])
    state = applyXmjMove(state, move);
  mock.method(Date, 'now', () => 4100);
  try {
    assert.equal(
      tenant.rules.canonicalMove!(state, { action: 'pass', by: 'east', at: 0 }, 'east'),
      null,
    );
    mock.method(Date, 'now', () => 5500);
    const pass = tenant.rules.canonicalMove!(state, { action: 'pass', by: 'east', at: 0 }, 'east');
    assert.ok(pass);
    const pending = tenant.rules.pendingAction!(applyXmjMove(state, pass));
    assert.equal(pending?.at, 7000);
    const automatic = tenant.rules.pendingAction!(state);
    assert.ok(automatic);
    assert.deepEqual(pending, tenant.rules.pendingAction!(applyXmjMove(state, automatic.move)));
  } finally {
    mock.restoreAll();
  }
});

test('XMJ privacy: live lists use the spectator frontier, including the TV eligibility threshold', () => {
  const registration = variantTenantForSpecId(XIANGQI_MAHJONG_SPEC_ID)!;
  mock.method(registration, 'enabled', () => true);
  mock.method(Date, 'now', () => 7000);
  const ctx = { rooms: new Map() } as HttpApiContext;
  const list = () =>
    JSON.stringify({ games: collectCurrentGames(ctx), tv: collectLiveTvCandidates(ctx) });
  try {
    const table = timingTable(true);
    xiangqiMahjongRooms.set(table.room.id, table.room);
    const before = list();
    assert.equal(collectCurrentGames(ctx).length, 1);
    assert.equal(collectLiveTvCandidates(ctx).length, 0);
    table.play({ action: 'pass', by: 'west', at: 6000 });
    assert.equal(list(), before, 'a held pass must not add a TV candidate or change a game card');
    table.play({ action: 'discard', by: 'west', at: 12000, tile: 'bK' });
    const released = list();
    assert.equal(collectLiveTvCandidates(ctx).length, 1);
    table.play({ action: 'pass', by: 'east', at: 14000 });
    assert.equal(
      list(),
      released,
      'an already eligible TV candidate must not expose its next held pass',
    );
  } finally {
    xiangqiMahjongRooms.clear();
    mock.restoreAll();
  }
});

test('XMJ privacy: the claimant sees its active abort deadline until it answers', () => {
  mock.method(Date, 'now', () => 4000);
  try {
    const table = timingTable(true);
    assert.ok(table.room.abortDeadline);
    const west = { id: 'west-client', seat: 'west' as const, solo: false };
    assert.equal(
      tenantSnapshotPayload(tenant, table.room, west).abortDeadline,
      table.room.abortDeadline,
    );
    const before = table.payload('east');
    table.play({ action: 'pass', by: 'west', at: 5500 });
    assert.equal(tenantSnapshotPayload(tenant, table.room, west).abortDeadline, null);
    assert.equal(
      table.payload('east'),
      before,
      'the countdown must not disclose the private answer',
    );
  } finally {
    mock.restoreAll();
  }
});

test('XMJ privacy: the planted immediate-delivery failure is detected', () => {
  mock.method(Date, 'now', () => claimTiming.discardAt);
  try {
    assert.equal(claimTiming.plantedFailure.deliverPassImmediately, true);
    assert.throws(() => assertClaimTimingInvariant(true), /runtime vs delayed pass|same walls/);
  } finally {
    mock.restoreAll();
  }
});

test('XMJ privacy: public shutdown and presence updates do not expose a held pass', () => {
  mock.method(Date, 'now', () => claimTiming.discardAt);
  try {
    const automatic = timingTable(false);
    const deciding = timingTable(true);
    automatic.play(tenant.rules.pendingAction!(automatic.room.projection.state)!.move);
    for (const now of [7000, 8000, 10000]) {
      mock.method(Date, 'now', () => now);
      for (const table of [automatic, deciding]) {
        const event: XmjEvent | null =
          now === 7000
            ? tenantPauseEventFor(table.room.projection, now, 'shutdown')
            : now === 8000
              ? tenantResumeEventFor(table.room.projection, now, 'players-returned')
              : {
                  type: 'seat-assigned',
                  roomId: table.room.id,
                  at: now,
                  seat: 'east',
                  clientId: 'east-reconnected',
                };
        assert.ok(event);
        const seq = appendTenantRuntimeEvent(tenant, table.room, event);
        assert.notEqual(seq, -1);
        table.runtime.broadcastEventAppended(table.live, event, seq);
      }
      for (const seat of ['east', 'spectator'] as const) {
        assert.equal(
          automatic.payload(seat),
          deciding.payload(seat),
          `${seat}: public update at ${now}`,
        );
      }
    }
    const pausedFrame = automatic.frames.spectator[1] as { paused?: boolean };
    assert.equal(pausedFrame.paused, true, 'the public pause still reaches the spectator');
  } finally {
    mock.restoreAll();
  }
});

test('XMJ privacy: own pass draws immediately; others release the ordered log with the discard', () => {
  mock.method(Date, 'now', () => claimTiming.discardAt);
  try {
    const table = timingTable(true);
    const before = tenantSnapshotPayload(tenant, table.room, SPECTATOR);
    const counts = { east: table.frames.east.length, spectator: table.frames.spectator.length };
    const pass = table.play({ action: 'pass', by: 'west', at: 4100 });
    const own = tenantSnapshotPayload(tenant, table.room, {
      id: 'west-client',
      seat: 'west',
      solo: false,
    });
    assert.equal(own.state.phase.type, 'discard');
    assert.equal(own.state.wallCount, before.state.wallCount - 1);
    assert.equal(own.events.at(-1)?.type, 'move-played');
    assert.equal(table.frames.west.length, 2, 'pass and draw arrive without a timer');
    assert.equal(tenant.visibility.clientEventFor(pass, 'east', 2), null);
    assert.equal(tenant.visibility.clientEventFor(pass, 'spectator', 2), null);
    assert.deepEqual(tenantSnapshotPayload(tenant, table.room, SPECTATOR), before);
    assert.equal(table.frames.east.length, counts.east);
    assert.equal(table.frames.spectator.length, counts.spectator);
    table.play({ action: 'discard', by: 'west', at: claimTiming.publicMoveAt, tile: 'bK' });
    for (const seat of ['east', 'spectator'] as const) {
      const released = table.frames[seat].at(-1) as {
        type: string;
        events: Array<{ type: string; ply?: number; move?: XmjMove }>;
        liveHistory: unknown[];
        state: XmjPlayerView;
        event?: { move: XmjMove };
      };
      assert.equal(released.type, 'snapshot', 'atomic release uses the existing full-log frame');
      assert.deepEqual(
        released.events.filter((e) => e.type === 'move-played').map((e) => [e.ply, e.move?.action]),
        [
          [1, 'discard'],
          [2, 'pass'],
          [3, 'discard'],
        ],
      );
      assert.equal(released.liveHistory.length, 4);
      assert.deepEqual(released.state.discards.west, ['bK']);
      assert.equal(released.event?.move.action, 'discard', 'only the public move cues sound');
    }
  } finally {
    mock.restoreAll();
  }
});

test('XMJ privacy: claims are public immediately and correspondence passes keep their delta delivery', () => {
  const claiming = timingTable(true);
  const claim = claiming.room.projection.state.match.hand;
  const legal = tenant.visibility.viewForClient(
    claiming.room.projection.state,
    { id: 'west-client', seat: 'west', solo: false },
    claiming.room.events,
  ).legal.claims[0];
  assert.ok(legal);
  assert.equal(claim.phase.type, 'claim');
  claiming.play({ action: 'claim', by: 'west', at: 4100, ...legal });
  assert.equal(claiming.frames.east.length, 2, 'a real claim is public at once');
  assert.equal(claiming.frames.spectator.length, 2);
  const correspondence = timingTable(true, false, true);
  correspondence.play({ action: 'pass', by: 'west', at: 4100 });
  for (const seat of ['east', 'west', 'spectator'] as const) {
    const frame = correspondence.frames[seat].at(-1) as {
      type: string;
      event: { move: XmjMove };
      state: XmjPlayerView;
    };
    assert.equal(frame.type, 'event-appended');
    assert.equal(frame.event.move.action, 'pass');
    assert.equal(frame.state.phase.type, 'discard');
  }
});

test('XMJ privacy: resignation and clock expiry release held passes and the final view', () => {
  for (const reason of ['seat-resigned', 'clock-expired'] as const) {
    const table = timingTable(true);
    table.play({ action: 'pass', by: 'west', at: 4100 });
    const event: XmjEvent =
      reason === 'seat-resigned'
        ? { type: reason, roomId: table.room.id, at: 12000, color: 'west' }
        : {
            type: reason,
            roomId: table.room.id,
            at: 400000,
            color: 'west',
            clock: expireTenantClock(table.room.projection.clock, 400000, 'west')!,
          };
    const seq = appendTenantRuntimeEvent(tenant, table.room, event);
    assert.notEqual(seq, -1);
    table.runtime.broadcastEventAppended(table.live, event, seq);
    for (const seat of ['east', 'spectator'] as const) {
      const frame = table.frames[seat].at(-1) as {
        events: Array<{ type: string; move?: XmjMove }>;
        state: XmjPlayerView;
      };
      assert.equal(frame.state.status.type, 'finished');
      assert.deepEqual(
        frame.events.filter((e) => e.type === 'move-played').map((e) => e.move?.action),
        ['discard', 'pass'],
      );
      assert.ok(frame.state.hands.east && frame.state.hands.west);
    }
  }
});

test('XMJ privacy: a pass that exhausts the wall is a public hand end', () => {
  const table = timingTable(false);
  for (let step = 0; step < 64; step += 1) {
    const state = table.room.projection.state;
    const phase = state.match.hand.phase;
    const at = 10000 + step * 2000;
    if (phase.type === 'claim') {
      const by = phase.discarder === 0 ? 'west' : 'east';
      const exhausted = state.match.hand.wall.length === 0;
      table.play({ action: 'pass', by, at });
      if (!exhausted) continue;
      for (const seat of ['east', 'west', 'spectator'] as const) {
        const frame = table.frames[seat].at(-1) as {
          events: Array<{ type: string; move?: XmjMove }>;
          state: XmjPlayerView;
        };
        assert.equal(frame.state.phase.type, 'exhausted');
        assert.equal(frame.events.at(-1)?.move?.action, 'pass');
        assert.ok(frame.state.hands.east && frame.state.hands.west);
      }
      return;
    }
    assert.equal(phase.type, 'discard');
    const by = state.match.hand.turn === 0 ? 'east' : 'west';
    const tile = tenant.visibility.viewForClient(
      state,
      { id: `${by}-client`, seat: by, solo: false },
      table.room.events,
    ).legal.discard[0];
    assert.ok(tile);
    table.play({ action: 'discard', by, tile, at });
  }
  assert.fail('the wall must exhaust');
});

function unfinishedMatch(
  correspondence = false,
  setup: XmjRoomSetup = createXmjSetup(() => 0.25, { correspondence }),
): XmjRuntimeRoom {
  const roomId = correspondence ? 'xmj_privacy-correspondence' : 'xmj_privacy-live';
  const events: XmjEvent[] = [
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
      setup,
      timeControl: {
        initialMs: 300_000,
        incrementMs: 5_000,
        ...(correspondence ? { daysPerMove: 3 as const } : {}),
      },
    },
    { type: 'clock-started', at: 1_000, roomId, clock: createTenantClock(tenant, 300_000, 5_000) },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'east-client', seat: 'east' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'west-client', seat: 'west' },
  ];
  const created = createTenantRuntimeRoomFromEvents(tenant, events);
  assert.ok(created.ok);
  const room = created.room as XmjRuntimeRoom;
  const state = room.projection.state;
  assert.equal(state.status.type, 'playing');
  assert.equal(state.match.between, false);
  assert.ok(state.match.hand.hands.every((hand) => hand.length > 0));
  assert.ok(state.match.hand.wall.length > 0);
  return room;
}

function assertNoPrivateTiles(payload: unknown, room: XmjRuntimeRoom): void {
  const serialized = JSON.stringify(payload);
  const hand = room.projection.state.match.hand;
  const created = room.events[0];
  assert.equal(created?.type, 'room-created');
  assert.ok(created.setup);
  // Include every future wall too, so a setup accidentally copied anywhere
  // into a snapshot, history, metadata, or error body is caught.
  const setup = created.setup as ReturnType<typeof createXmjSetup>;
  for (const [source, tiles] of [
    ['east concealed hand', hand.hands[0]],
    ['west concealed hand', hand.hands[1]],
    ['current wall', hand.wall],
    ...setup.walls.map((wall, index) => [`setup.walls[${index}]`, wall] as const),
  ] as const) {
    for (const tile of tiles) {
      assert.equal(serialized.includes(JSON.stringify(tile)), false, `${source}: leaked ${tile}`);
    }
  }
  for (const secret of ['setup', 'walls', 'wall']) {
    assert.equal(serialized.includes(`"${secret}":`), false, `leaked field ${secret}`);
  }
}

// Supply a stale completed row on purpose. Persisted events, not an optimistic
// summary, must decide whether replay/share surfaces may reveal a match.
function summary(room: XmjRuntimeRoom): RecentEveGameRecord {
  return {
    roomId: room.id,
    variant: XIANGQI_MAHJONG_SPEC_ID,
    mode: 'pvp',
    result: 'east-wins',
    termination: 'points',
    plyCount: 0,
    startedAt: new Date(1_000),
    endedAt: new Date(4_000),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: 300_000,
    incrementMs: 5_000,
  };
}

test('XMJ privacy: unfinished correspondence spectator payload has no concealed or wall tile', () => {
  const room = unfinishedMatch(true);
  assert.equal(room.projection.state.correspondence, true);
  assertNoPrivateTiles(
    {
      snapshot: tenantSnapshotPayload(tenant, room, SPECTATOR),
      ...tenantLiveHistoryExtras(tenant, room, SPECTATOR),
      events: tenantEventsForClient(tenant, room, SPECTATOR),
    },
    room,
  );
});

test('XMJ privacy: unfinished live spectator payload has no concealed or wall tile', () => {
  const room = unfinishedMatch();
  const payload = xmjLiveWatchPayloadFor(room.id, room);
  assert.ok(payload, 'exercise a real live spectator frame');
  assertNoPrivateTiles(payload, room);
});

test('XMJ privacy: unfinished room-state payload has no concealed or wall tile', () => {
  for (const correspondence of [false, true]) {
    const room = unfinishedMatch(correspondence);
    const payload = tenantSnapshotPayload(tenant, room, SPECTATOR);
    assert.equal(payload.state.status.type, 'playing');
    assertNoPrivateTiles(payload, room);
  }
});

test('XMJ privacy: unfinished replay and export payloads have no concealed or wall tile', async () => {
  for (const correspondence of [false, true]) {
    const room = unfinishedMatch(correspondence);
    const replay = await xiangqiMahjongPostgameForApi(room.id, {
      getGameSummary: async () => summary(room),
      loadRoomEvents: async () => room.events as XmjEvent[],
    });
    assertNoPrivateTiles(replay, room);
    assert.equal(replay, null);
    for (const format of ['json', 'pgn'] as const) {
      const exported = resolveGameExport({
        roomId: room.id,
        format,
        summary: summary(room),
        events: room.events,
      });
      assertNoPrivateTiles(exported, room);
      assert.notEqual(exported.status, 200);
    }
  }
});

test('XMJ privacy: unfinished share/OG card payload has no concealed or wall tile', async () => {
  for (const correspondence of [false, true]) {
    const room = unfinishedMatch(correspondence);
    const store = {
      summary: async () => summary(room),
      events: async () => room.events,
      analysis: async () => null,
    };
    const payload = {
      card: await tenantGameCard(room.id, store),
      meta: await tenantGamePageMeta(`/room/${room.id}`, store),
    };
    assertNoPrivateTiles(payload, room);
    assert.deepEqual(payload, { card: null, meta: null });
  }
});

test('table-3 complete player, spectator and reconnect payloads redact declaration hints and waits', () => {
  const front: XmjTile[] = ['rK', 'rA', 'rE', 'rP', 'bH', 'bK', 'bA', 'bE', 'rP', 'rP', 'rH', 'bC'];
  const rest = xmjOrderedTiles();
  for (const tile of front) rest.splice(rest.indexOf(tile), 1);
  const wall = [...front, ...rest];
  for (const correspondence of [false, true]) {
    const room = unfinishedMatch(correspondence, {
      walls: [wall, wall],
      firstDealer: 'east',
      taiTable: 3,
      ...(correspondence ? { correspondence: true } : {}),
    });
    const play = (move: XmjMove) => {
      assert.notEqual(
        appendTenantRuntimeEvent(tenant, room, {
          type: 'move-played',
          at: move.at,
          roomId: room.id,
          color: move.by,
          move,
        }),
        -1,
      );
    };
    play({ by: 'east', at: 4_000, action: 'discard', tile: 'bH' });
    play({ by: 'west', at: 6_000, action: 'pass' });
    play({ by: 'west', at: 7_000, action: 'declare-ready', tile: 'rP', handCopy: true });
    assert.deepEqual(room.projection.state.match.hand.drawnDiscards[1], [false]);

    const checkPayloads = (drawn = false) => {
      const hydrated = createTenantRuntimeRoomFromEvents(
        tenant,
        JSON.parse(JSON.stringify(room.events)),
      );
      assert.ok(hydrated.ok);
      assert.deepEqual(hydrated.room.projection.state, room.projection.state);
      for (const seat of ['east', 'west', 'spectator'] as const) {
        const client = { id: `${seat}-client`, seat, solo: false };
        const snapshot = tenantSnapshotPayload(tenant, room, client);
        const payload: Record<string, unknown> = {
          snapshot,
          history: tenantLiveHistoryExtras(tenant, room, client),
          events: tenantEventsForClient(tenant, room, client),
          reconnect: {
            snapshot: tenantSnapshotPayload(tenant, hydrated.room, client),
            history: tenantLiveHistoryExtras(tenant, hydrated.room, client),
            events: tenantEventsForClient(tenant, hydrated.room, client),
          },
          watch:
            !correspondence && seat === 'spectator' ? xmjLiveWatchPayloadFor(room.id, room) : null,
        };
        const json = JSON.stringify(payload);
        const view: XmjPlayerView = snapshot.state;
        assert.deepEqual(view.declared, { east: false, west: true });
        assert.deepEqual(view.legal.declareReady, []);
        for (const key of ['setup', 'wall', 'walls', 'handCopy']) {
          assert.ok(!json.includes(`"${key}":`), `${seat} payload carries ${key}`);
        }
        for (const tile of seat === 'west'
          ? ['rK', 'rA', 'rE']
          : ['bK', 'bA', 'bE', ...(drawn ? ['bC'] : [])]) {
          assert.ok(!json.includes(`"${tile}"`), `${seat} payload leaks ${tile}`);
        }
        if (seat === 'spectator') {
          for (const tile of ['rK', 'rA', 'rE']) assert.ok(!json.includes(`"${tile}"`));
        }
        if (drawn && seat !== 'west') {
          if (correspondence) assert.ok(view.phase.type === 'discard' && view.phase.drawn === null);
          else
            assert.equal(view.phase.type, 'claim', 'the private draw stays under the open discard');
        }
        assert.ok(json.includes('declare-ready'), 'the public declaration event is preserved');
      }
    };
    checkPayloads();
    play({ by: 'east', at: 9_000, action: 'pass' });
    play({ by: 'east', at: 10_000, action: 'discard', tile: 'rH' });
    play({ by: 'west', at: 12_000, action: 'pass' });
    assert.equal(tenant.rules.pendingAction?.(room.projection.state)?.move.action, 'discard');
    checkPayloads(true);
  }
});

test('automatic clock discards serialize complete player, spectator and reconnect payloads without hidden tiles', async () => {
  const front: XmjTile[] = ['rK', 'rA', 'rE', 'rP', 'bH', 'bK', 'bA', 'bE', 'bR', 'bP', 'rP'];
  const rest = xmjOrderedTiles();
  for (const tile of front) rest.splice(rest.indexOf(tile), 1);
  const wall = [...front, ...rest];
  for (const correspondence of [false, true]) {
    const room = unfinishedMatch(correspondence, {
      walls: [wall, wall],
      firstDealer: 'east',
      taiTable: 3,
      correspondence,
    });
    for (const move of [
      { by: 'east', at: 4_000, action: 'declare-ready', tile: 'bH' },
      { by: 'west', at: 6_000, action: 'pass' },
      { by: 'west', at: 7_000, action: 'discard', tile: 'bR' },
      { by: 'east', at: 9_000, action: 'pass' },
    ] as XmjMove[]) {
      await appendTenantEvent(tenant, room, {
        type: 'move-played',
        at: move.at,
        roomId: room.id,
        color: move.by,
        move,
      });
    }
    const clock = room.projection.clock!;
    const at = clock.runningSince! + clock.remainingMs.east;
    await appendTenantEvent(tenant, room, {
      type: 'clock-expired',
      at,
      roomId: room.id,
      color: 'east',
      clock: expireTenantClock(clock, at, 'east')!,
    });
    assert.equal(room.events.at(-1)?.type, 'move-played');
    assert.equal(room.projection.state.status.type, 'playing');
    const hydrated = createTenantRuntimeRoomFromEvents(
      tenant,
      JSON.parse(JSON.stringify(room.events)),
    );
    assert.ok(hydrated.ok);
    assert.deepEqual(hydrated.room.projection, room.projection);
    for (const seat of ['east', 'west', 'spectator'] as const) {
      const client = { id: `${seat}-client`, seat, solo: false };
      const serialize = (r: typeof room) => ({
        snapshot: tenantSnapshotPayload(tenant, r, client),
        events: tenantEventsForClient(tenant, r, client),
        history: tenantLiveHistoryExtras(tenant, r, client),
      });
      const payload = {
        ...serialize(room),
        reconnect: serialize(hydrated.room),
        watch:
          !correspondence && seat === 'spectator' ? xmjLiveWatchPayloadFor(room.id, room) : null,
      };
      const json = JSON.stringify(payload);
      for (const key of ['setup', 'walls', 'wall', 'handCopy'])
        assert.ok(!json.includes(`"${key}":`), `${seat} leaked ${key}`);
      const hidden = [
        ...(seat !== 'east' ? ['rK', 'rA', 'rE'] : []),
        ...(seat !== 'west' ? ['bK', 'bA', 'bE', 'bP'] : []),
      ];
      for (const tile of hidden) assert.ok(!json.includes(`"${tile}"`), `${seat} leaked ${tile}`);
      assert.ok(json.includes('"tile":"rP"'), 'the automatic discard is public');
    }
  }
});
