// Launch prerequisite for #678. Exercise UNFINISHED matches through the real
// serializers/registrations, checking the entire payload, not just its board.
// At the first deal no tile is public, so even a single tile face is a leak.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createXmjSetup, XIANGQI_MAHJONG_SPEC_ID } from '@mistboard/game';
import { resolveGameExport } from './game-export-tenant.js';
import { tenantGameCard, tenantGamePageMeta } from './og-game-tenant.js';
import type { RecentEveGameRecord } from './persistence.js';
import { xiangqiMahjongPostgameForApi } from './routes/xiangqi-mahjong-games.js';
import './variant-tenant/register-tenants.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantEventsForClient,
  tenantLiveHistoryExtras,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import type { XmjRuntimeRoom } from './xiangqi-mahjong-registration.js';
import { xiangqiMahjongTenant as tenant, type XmjEvent } from './xiangqi-mahjong-tenant.js';
import { xmjLiveWatchPayloadFor } from './xiangqi-mahjong-watch.js';

const SPECTATOR = { id: 'privacy-spectator', seat: 'spectator' as const, solo: false };

function unfinishedMatch(correspondence = false): XmjRuntimeRoom {
  const roomId = correspondence ? 'xmj_privacy-correspondence' : 'xmj_privacy-live';
  const events: XmjEvent[] = [
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
      setup: createXmjSetup(() => 0.25, { correspondence }),
      timeControl: {
        initialMs: 300_000,
        incrementMs: 5_000,
        ...(correspondence ? { daysPerMove: 3 as const } : {}),
      },
    },
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
