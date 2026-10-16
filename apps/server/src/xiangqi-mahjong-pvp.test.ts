/**
 * Xiangqi mahjong PvP: two humans at one table, behind the flag and the
 * per-account grant (139).
 *
 * The invariant is hidden information. A seat sees its own concealed tiles and
 * the public discards and melds; never the other hand, never the walls. This
 * suite plays whole matches through the runtime (the same projection the ws
 * runtime serves) and checks every payload a client could receive: the
 * snapshot, each broadcast event, the event log rebuilt on join and reconnect,
 * and the live history. A live spectator is refused outright ('sealed'), and
 * would see neither hand if it were not.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createXmjSetup,
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
  type XmjPlayerView,
  type XmjSeat,
} from '@mistboard/game';
import type pg from 'pg';
import type { UserAccount } from './persistence.js';
import { mayPlayVariant } from './persistence-variant-access.js';
import { xmjPveEngineSeat } from './routes/xiangqi-mahjong-rooms.js';
import { canObserveRoom } from './server-policy.js';
import { isXmjBotClientId, XMJ_BOT_CLIENT_ID, xmjBotMove } from './server-xiangqi-mahjong-bots.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  tenantEventsForClient,
  tenantLiveHistoryExtras,
  tenantPlyAtEventIndex,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { assignTenantSeat } from './variant-tenant/seat-session.js';
import type { TenantSeat } from './variant-tenant/tenant.js';
import type { XmjRuntimeRoom } from './xiangqi-mahjong-registration.js';
import {
  createXiangqiMahjongRoom,
  xiangqiMahjongRooms,
  xmjLobbyAllowsTimeControl,
} from './xiangqi-mahjong-registration.js';
import { type XmjEvent, xiangqiMahjongTenant } from './xiangqi-mahjong-tenant.js';

process.env.MISTBOARD_XIANGQI_MAHJONG_ENABLED = 'true';

const tenant = xiangqiMahjongTenant;
const VIEWERS: readonly TenantSeat<XmjSeat>[] = ['east', 'west', 'spectator'];
const FIVE_FIVE = { initialMs: 300_000, incrementMs: 5_000 };

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

function account(id: string, accountRole: 'player' | 'admin' = 'player'): UserAccount {
  return {
    id,
    handle: id,
    displayName: id,
    accountRole,
    playDisabledAt: null,
  } as UserAccount;
}

function grantTable(grantedUserIds: readonly string[]): pg.Pool {
  return {
    query: async (_text: string, values: unknown[]) => {
      const granted = grantedUserIds.includes(String(values[0]));
      return { rowCount: granted ? 1 : 0, rows: granted ? [{}] : [] };
    },
  } as unknown as pg.Pool;
}

function client(seat: TenantSeat<XmjSeat>) {
  return { id: `client-${seat}`, seat, solo: false };
}

/** Every key anywhere in a payload, so a renamed field cannot slip a wall past. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysOf(child, into);
    }
  }
  return into;
}

function assertNoWalls(payload: unknown, where: string): void {
  const keys = keysOf(payload);
  for (const secret of ['setup', 'walls', 'wall', 'firstDealer']) {
    assert.equal(keys.has(secret), false, `${where}: carries "${secret}"`);
  }
}

/** A hand is live while someone must discard or answer a discard. */
function handIsLive(view: XmjPlayerView): boolean {
  return (
    view.status.type === 'playing' && (view.phase.type === 'discard' || view.phase.type === 'claim')
  );
}

function assertViewHidesOthers(view: XmjPlayerView, viewer: TenantSeat<XmjSeat>, where: string) {
  if (!handIsLive(view)) return;
  for (const seat of tenant.colors) {
    if (seat === viewer) {
      assert.ok(view.hands[seat], `${where}: ${viewer} must see its own hand`);
    } else {
      assert.equal(view.hands[seat], null, `${where}: ${viewer} sees ${seat}'s hand`);
    }
  }
  if (view.phase.type === 'discard' && view.turn !== viewer) {
    assert.equal(view.phase.drawn, null, `${where}: ${viewer} sees the tile ${view.turn} drew`);
  }
  if (viewer === 'spectator') {
    assert.deepEqual(
      [view.legal.discard.length, view.legal.claims.length],
      [0, 0],
      `${where}: a spectator has actions`,
    );
  }
}

function snapshotView(room: XmjRuntimeRoom, viewer: TenantSeat<XmjSeat>) {
  const payload = tenantSnapshotPayload(tenant, room, client(viewer));
  return { payload: { ...payload, serverAt: 0 }, view: payload.state as unknown as XmjPlayerView };
}

function assertEveryPayloadHides(room: XmjRuntimeRoom, where: string): void {
  for (const viewer of VIEWERS) {
    const { payload, view } = snapshotView(room, viewer);
    assertNoWalls(payload, `${where} snapshot/${viewer}`);
    assertViewHidesOthers(view, viewer, `${where} snapshot/${viewer}`);
    const history = tenantLiveHistoryExtras(tenant, room, client(viewer));
    assertNoWalls(history, `${where} liveHistory/${viewer}`);
    for (const entry of history.liveHistory ?? []) {
      assertViewHidesOthers(entry.view, viewer, `${where} liveHistory ply ${entry.ply}/${viewer}`);
    }
  }
}

function hydrate(events: XmjEvent[]): XmjRuntimeRoom {
  const created = createTenantRuntimeRoomFromEvents(tenant, events);
  assert.ok(created.ok, 'the event log must hydrate');
  return created.room as XmjRuntimeRoom;
}

/** A rated 5+5 PvP room with both seats taken by humans. */
function pvpRoom(seed: number): XmjRuntimeRoom {
  const roomId = `xmj_pvp-wire-${seed}`;
  return hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
      creatorPreference: 'random',
      rated: true,
      timeControl: FIVE_FIVE,
      setup: createXmjSetup(seeded(seed)),
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-east', seat: 'east' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-west', seat: 'west' },
  ]);
}

/**
 * The next move either human would make (played by the bot policy, which reads
 * only that seat's view), else the deadline the runtime would play.
 */
function nextMove(room: XmjRuntimeRoom, now: number): XmjMove {
  const state = room.projection.state;
  for (const seat of tenant.colors) {
    const move = xmjBotMove(state, seat, now);
    if (move) return move;
  }
  const pending = tenant.rules.pendingAction?.(state);
  assert.ok(pending, `no move and no deadline at move ${state.moveNumber}`);
  return pending.move;
}

/** Play the match to its end, checking every payload after every event. */
function playMatch(room: XmjRuntimeRoom, onStep?: (room: XmjRuntimeRoom) => void): number {
  let now = 10_000;
  let moves = 0;
  while (room.projection.state.status.type === 'playing') {
    assert.ok(moves < 3_000, 'the match must end');
    const move = nextMove(room, now);
    const at = Math.max(now, move.at);
    const before = room.projection.state.moveNumber;
    const event: XmjEvent = {
      type: 'move-played',
      at,
      roomId: room.id,
      color: move.by,
      move,
    };
    const seq = appendTenantRuntimeEvent(tenant, room, event);
    assert.notEqual(room.projection.state.moveNumber, before, `move ${before} was refused`);
    const ply = tenantPlyAtEventIndex(room.events, seq);
    for (const viewer of VIEWERS) {
      const out = tenant.visibility.clientEventFor(event, viewer, ply);
      assertNoWalls(out, `event ${seq}/${viewer}`);
    }
    assertEveryPayloadHides(room, `after event ${seq}`);
    onStep?.(room);
    moves += 1;
    now = at + 1_600;
  }
  return moves;
}

test('xmj pvp: no payload carries the other hand or the walls, over whole matches', () => {
  for (const seed of [21, 22, 23]) {
    const room = pvpRoom(seed);
    assertEveryPayloadHides(room, `seed ${seed} seated`);
    const moves = playMatch(room);
    assert.ok(moves > 20, `seed ${seed}: a match is more than a few moves`);
    const status = room.projection.state.status;
    assert.equal(status.type, 'finished', `seed ${seed}: the match finishes`);
  }
});

test('xmj pvp: the log rebuilt on join and reconnect hides the same things', () => {
  const room = pvpRoom(31);
  let checked = 0;
  playMatch(room, (live) => {
    if (live.projection.state.status.type !== 'playing') return;
    // Reconnect: the whole log, redacted per viewer, as a joining client gets it.
    for (const viewer of VIEWERS) {
      assertNoWalls(tenantEventsForClient(tenant, live, client(viewer)), `log/${viewer}`);
    }
    // Rehydration (a server restart): the persisted log replays to the same
    // projection, and every seat is served the same snapshot it had live.
    if (live.events.length % 7 === 0) {
      const replayed = hydrate(live.events as XmjEvent[]);
      for (const viewer of VIEWERS) {
        assert.deepEqual(
          snapshotView(replayed, viewer).payload,
          snapshotView(live, viewer).payload,
        );
      }
      assertEveryPayloadHides(replayed, 'rehydrated');
      checked += 1;
    }
  });
  assert.ok(checked > 2, 'rehydration was exercised mid-match');
});

test('xmj pvp: a live room refuses spectators and a finished one admits them', () => {
  assert.equal(canObserveRoom(false, XIANGQI_MAHJONG_SPEC_ID), false);
  assert.equal(canObserveRoom(true, XIANGQI_MAHJONG_SPEC_ID), true);
  const room = pvpRoom(41);
  const spectator = snapshotView(room, 'spectator').view;
  assert.equal(spectator.hands.east, null);
  assert.equal(spectator.hands.west, null);
});

// Finished-game links (profile rows, the bell, the database, featured cards)
// open the room itself: the table has no postgame page. A finished room is
// rebuilt from its log for the visitor, who sees both final hands, and still
// never the walls the match was dealt from.
test('xmj pvp: a finished room, rebuilt from its log, shows a spectator every hand and no wall', () => {
  const played = pvpRoom(42);
  playMatch(played);
  assert.equal(played.projection.state.status.type, 'finished');
  const reopened = hydrate(played.events as XmjEvent[]);
  const { payload, view } = snapshotView(reopened, 'spectator');
  assertNoWalls(payload, 'finished snapshot/spectator');
  assert.equal(view.status.type, 'finished');
  assert.ok(view.hands.east, 'the finished table shows east');
  assert.ok(view.hands.west, 'the finished table shows west');
  assert.deepEqual([view.legal.discard.length, view.legal.claims.length], [0, 0]);
  const history = tenantLiveHistoryExtras(tenant, reopened, client('spectator'));
  assertNoWalls(history, 'finished liveHistory/spectator');
});

test('xmj pvp: a friend room seats no bot and carries the rated flag', async () => {
  const pvp = await createXiangqiMahjongRoom(FIVE_FIVE, 'random', undefined, true);
  const pve = await createXiangqiMahjongRoom(FIVE_FIVE, 'east', {
    engineId: XMJ_BOT_CLIENT_ID,
    seat: 'west',
  });
  try {
    assert.ok(pvp.ok && pve.ok);
    if (!pvp.ok || !pve.ok) return;
    assert.deepEqual(pvp.room.projection.seats, {}, 'both seats open for humans');
    assert.equal(pvp.room.rated, true);
    const pvpExtras = tenant.wire?.snapshotExtras?.(pvp.room, client('east')) ?? {};
    assert.equal(pvpExtras.roomMode, 'pvp');

    assert.equal(isXmjBotClientId(pve.room.projection.seats.west), true);
    assert.equal(pve.room.projection.seats.east, undefined);
    assert.equal(pve.room.rated, false, 'a bot game never rates');
    const pveExtras = tenant.wire?.snapshotExtras?.(pve.room, client('east')) ?? {};
    assert.equal(pveExtras.roomMode, 'pve');
  } finally {
    if (pvp.ok) xiangqiMahjongRooms.delete(pvp.room.id);
    if (pve.ok) xiangqiMahjongRooms.delete(pve.room.id);
  }
});

test('xmj pvp: against the bot the human keeps east unless they named west', () => {
  const bot = { engineId: XMJ_BOT_CLIENT_ID, seat: 'east' as XmjSeat };
  assert.equal(xmjPveEngineSeat(bot, 'random')?.seat, 'west');
  assert.equal(xmjPveEngineSeat(bot, undefined)?.seat, 'west');
  assert.equal(xmjPveEngineSeat(bot, 'east')?.seat, 'west');
  assert.equal(xmjPveEngineSeat(bot, 'west')?.seat, 'east');
  assert.equal(xmjPveEngineSeat(undefined, 'west'), undefined, 'PvP seats no bot');
});

test('xmj pvp: only granted accounts sit down, and a guest never does', async () => {
  const created = await createXiangqiMahjongRoom(FIVE_FIVE, 'random');
  assert.ok(created.ok);
  if (!created.ok) return;
  const room = created.room;
  try {
    const pool = grantTable(['granted-1']);
    const granted = account('granted-1');
    const stranger = account('stranger-1');
    const admin = account('admin-1', 'admin');

    assert.equal(await mayPlayVariant(null, XIANGQI_MAHJONG_SPEC_ID, pool), false);
    assert.equal(await mayPlayVariant(stranger, XIANGQI_MAHJONG_SPEC_ID, pool), false);
    assert.equal(await mayPlayVariant(granted, XIANGQI_MAHJONG_SPEC_ID, pool), true);
    assert.equal(await mayPlayVariant(admin, XIANGQI_MAHJONG_SPEC_ID, pool), true);

    const guestSeat = assignTenantSeat(tenant, room, 'guest', undefined, null, null, false);
    assert.equal(guestSeat.ok, false);
    assert.equal(!guestSeat.ok && guestSeat.reason, 'variant not granted');
    const strangerSeat = assignTenantSeat(tenant, room, 'c-s', undefined, stranger, null, false);
    assert.equal(!strangerSeat.ok && strangerSeat.reason, 'variant not granted');

    const first = assignTenantSeat(tenant, room, 'c-g', undefined, granted, null, true);
    assert.ok(first.ok, 'a granted account takes a seat');
  } finally {
    xiangqiMahjongRooms.delete(room.id);
  }
});

test('xmj pvp: Find opponent offers 5+5 and 10+5 only', () => {
  assert.equal(xmjLobbyAllowsTimeControl({ initialMs: 300_000, incrementMs: 5_000 }), true);
  assert.equal(xmjLobbyAllowsTimeControl({ initialMs: 600_000, incrementMs: 5_000 }), true);
  assert.equal(xmjLobbyAllowsTimeControl({ initialMs: 180_000, incrementMs: 2_000 }), false);
  assert.equal(xmjLobbyAllowsTimeControl({ initialMs: 60_000, incrementMs: 1_000 }), false);
});
