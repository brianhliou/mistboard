/**
 * Xiangqi mahjong on the listings: the TV channel rail, the live election
 * (homepage live widget, Watch live) and /games current games. Every one keys
 * off the spec's public-surface gate: while `publicSurface` is 'hidden' the
 * variant is on none of them, and once it is public it is on all of them. A
 * live room stays spectatable by its URL either way (xiangqi-mahjong-spectate).
 */

import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  createXmjSetup,
  gameSpecForId,
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
} from '@mistboard/game';
import { collectCurrentGames } from './current-games.js';
import type { HttpApiContext } from './routes/lib.js';
import { canServeLiveBoard } from './server-policy.js';
import { xmjBotMove } from './server-xiangqi-mahjong-bots.js';
import './variant-tenant/register-tenants.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
} from './variant-tenant/runtime.js';
import { gameSpecIsPublic, listedOnSurface, listWatchChannels } from './watch-channels.js';
import { collectLiveTvCandidates, liveWatchPayloadForFeatured } from './watch-live.js';
import { type XmjRuntimeRoom, xiangqiMahjongRooms } from './xiangqi-mahjong-registration.js';
import { type XmjEvent, xiangqiMahjongTenant } from './xiangqi-mahjong-tenant.js';

process.env.MISTBOARD_XIANGQI_MAHJONG_ENABLED = 'true';

const ROOM_ID = 'xmj_listing-1';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A two-human 5+5 room a few moves in, its last move at `lastAt`. */
function liveRoom(lastAt: number): XmjRuntimeRoom {
  const created = createTenantRuntimeRoomFromEvents(xiangqiMahjongTenant, [
    {
      type: 'room-created',
      at: lastAt - 60_000,
      roomId: ROOM_ID,
      gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
      creatorPreference: 'random',
      rated: false,
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
      setup: createXmjSetup(seeded(61)),
    },
    {
      type: 'seat-assigned',
      at: lastAt - 59_000,
      roomId: ROOM_ID,
      clientId: 'c-east',
      seat: 'east',
    },
    {
      type: 'seat-assigned',
      at: lastAt - 58_000,
      roomId: ROOM_ID,
      clientId: 'c-west',
      seat: 'west',
    },
  ]);
  assert.ok(created.ok);
  const room = created.room as XmjRuntimeRoom;
  room.seatTokens = {
    east: { userDisplayName: 'Ada', userHandle: 'ada', userId: 'user-ada' },
    west: { userDisplayName: 'Bo', userHandle: 'bo', userId: 'user-bo' },
  } as unknown as XmjRuntimeRoom['seatTokens'];
  let at = lastAt - 10_000;
  for (let i = 0; i < 6; i += 1) {
    const state = room.projection.state;
    const move: XmjMove | null =
      xmjBotMove(state, 'east', at) ??
      xmjBotMove(state, 'west', at) ??
      xiangqiMahjongTenant.rules.pendingAction?.(state)?.move ??
      null;
    assert.ok(move);
    at = Math.min(lastAt, Math.max(at, move.at));
    const event: XmjEvent = { type: 'move-played', at, roomId: ROOM_ID, color: move.by, move };
    appendTenantRuntimeEvent(xiangqiMahjongTenant, room, event);
    at += 1_600;
  }
  assert.equal(room.projection.state.status.type, 'playing');
  return room;
}

/** Run `check` with the spec's gate set as given, then restore it. */
async function withGate<T>(surface: 'hidden' | 'casual', check: () => T | Promise<T>): Promise<T> {
  const spec = gameSpecForId(XIANGQI_MAHJONG_SPEC_ID) as { publicSurface: string };
  const was = spec.publicSurface;
  spec.publicSurface = surface;
  try {
    return await check();
  } finally {
    spec.publicSurface = was;
  }
}

const ctx = { rooms: new Map() } as unknown as HttpApiContext;
let now = 0;

beforeEach(() => {
  xiangqiMahjongRooms.clear();
  now = 1_800_000_000_000;
  const room = liveRoom(now - 1_000);
  xiangqiMahjongRooms.set(room.id, room);
});

test('xmj listing: the spec ships public, and its live board is servable either way', () => {
  assert.equal(gameSpecForId(XIANGQI_MAHJONG_SPEC_ID).publicSurface, 'casual');
  assert.equal(gameSpecIsPublic(XIANGQI_MAHJONG_SPEC_ID), true);
  assert.equal(gameSpecIsPublic('not-a-spec'), false);
  assert.equal(canServeLiveBoard(XIANGQI_MAHJONG_SPEC_ID), true);
  assert.equal(listedOnSurface(XIANGQI_MAHJONG_SPEC_ID), true);
  // Scoped: the other hidden specs keep their flag-only listing.
  assert.equal(listedOnSurface('atomic-xiangqi'), true);
  assert.equal(listedOnSurface('mahjong'), true);
});

test('xmj listing: gate off, no TV channel, no live candidate, not on /games', async () => {
  await withGate('hidden', () => {
    const channels = listWatchChannels().map((channel) => channel.id);
    assert.equal(channels.includes('xiangqi-mahjong'), false);
    assert.equal(
      collectLiveTvCandidates(ctx, now).some((candidate) => candidate.roomId === ROOM_ID),
      false,
    );
    assert.equal(
      collectCurrentGames(ctx, now).some((game) => game.roomId === ROOM_ID),
      false,
    );
  });
});

test('xmj listing: gate on, the channel, the live candidate and /games all carry it', async () => {
  await withGate('casual', async () => {
    const channel = listWatchChannels().find((entry) => entry.id === 'xiangqi-mahjong');
    assert.ok(channel, 'the TV rail has a Xiangqi Mahjong channel');
    assert.equal(channel.family, 'mahjong');
    assert.deepEqual(channel.gameSpecIds, [XIANGQI_MAHJONG_SPEC_ID]);

    const candidate = collectLiveTvCandidates(ctx, now).find((entry) => entry.roomId === ROOM_ID);
    assert.ok(candidate, 'the live election sees the room');
    assert.equal(candidate.channelId, 'xiangqi-mahjong');
    // The board it would serve is the spectator frame.
    const frame = (await liveWatchPayloadForFeatured(candidate)) as {
      view: { hands: Record<string, unknown> };
      seatDisplayNames: Record<string, string>;
    } | null;
    assert.ok(frame, 'the live builder answers');
    assert.deepEqual(frame.seatDisplayNames, { east: 'Ada', west: 'Bo' });
    assert.deepEqual(frame.view.hands, { east: null, west: null });

    const game = collectCurrentGames(ctx, now).find((entry) => entry.roomId === ROOM_ID);
    assert.ok(game, '/games lists the room');
    assert.equal(game.channelId, 'xiangqi-mahjong');
    assert.equal(game.observe, 'open');
  });
});
