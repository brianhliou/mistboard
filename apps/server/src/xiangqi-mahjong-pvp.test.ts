/**
 * Xiangqi mahjong PvP: two humans at one public table, behind the runtime flag.
 *
 * The invariant is hidden information. A seat sees its own concealed tiles and
 * the public discards and melds; never the other hand, never the walls. This
 * suite plays whole matches through the runtime (the same projection the ws
 * runtime serves) and checks every payload a client could receive: the
 * snapshot, each broadcast event, the event log rebuilt on join and reconnect,
 * and the live history. A live spectator is admitted ('open') and sees
 * neither hand while one is in play (xiangqi-mahjong-spectate.test.ts).
 */

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  createXmjSetup,
  XIANGQI_MAHJONG_SPEC_ID,
  XMJ_CLAIM_PAUSE_MS,
  type XmjMove,
  type XmjPlayerView,
  type XmjSeat,
  type XmjTile,
  xmjOrderedTiles,
} from '@mistboard/game';
import type pg from 'pg';
import type { UserAccount } from './persistence.js';
import { mayPlayVariant } from './persistence-variant-access.js';
import { xmjPveEngineSeat } from './routes/xiangqi-mahjong-rooms.js';
import { canObserveRoom } from './server-policy.js';
import { isXmjBotClientId, XMJ_BOT_CLIENT_ID, xmjBotMove } from './server-xiangqi-mahjong-bots.js';
import { tenantParticipant } from './variant-tenant/events.js';
import {
  clearTenantRuntimeTimers,
  scheduleTenantLifecycleTimers,
  tenantPregameTimeoutLoser,
} from './variant-tenant/lifecycle.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  tenantClockRemainingMs,
  tenantEventsForClient,
  tenantLiveHistoryExtras,
  tenantPlyAtEventIndex,
  tenantSeatProfiles,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { assignTenantSeat } from './variant-tenant/seat-session.js';
import type { TenantSeat } from './variant-tenant/tenant.js';
import { tenantSeatMayAbort, tenantSeatMayResign } from './variant-tenant/ws.js';
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

/** A 5+5 PvP room (rated unless told otherwise) with both seats taken by humans. */
function pvpRoom(seed: number, rated = true): XmjRuntimeRoom {
  const roomId = `xmj_pvp-wire-${seed}`;
  return hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
      creatorPreference: 'random',
      rated,
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

test('xmj pvp: live and finished rooms admit spectators, who see neither live hand', () => {
  assert.equal(canObserveRoom(false, XIANGQI_MAHJONG_SPEC_ID), true);
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
  // The walls are never revealed, so the client cannot replay the match: the
  // finished room keeps sending each viewer its own per-ply views, every ply
  // from the deal to the end, each as that viewer saw it live.
  const moves = reopened.events.filter((event) => event.type === 'move-played').length;
  for (const viewer of VIEWERS) {
    const history = tenantLiveHistoryExtras(tenant, reopened, client(viewer)).liveHistory;
    assertNoWalls(history, `finished liveHistory/${viewer}`);
    assert.ok(history, `a finished room sends ${viewer} its history`);
    assert.deepEqual(
      history.map((entry) => entry.ply),
      Array.from({ length: moves + 1 }, (_, ply) => ply),
    );
    for (const entry of history) {
      assertViewHidesOthers(entry.view, viewer, `finished liveHistory ply ${entry.ply}/${viewer}`);
    }
    assert.equal(history.at(-1)?.view.status.type, 'finished');
  }
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
    // Games stored before the misty-<variant> rename keep their bot seat.
    assert.equal(isXmjBotClientId('xiangqi-mahjong-bot'), true);
    assert.equal(isXmjBotClientId('misty'), false);
    assert.equal(pve.room.projection.seats.east, undefined);
    assert.equal(pve.room.rated, false, 'a bot game never rates');
    const pveExtras = tenant.wire?.snapshotExtras?.(pve.room, client('east')) ?? {};
    assert.equal(pveExtras.roomMode, 'pve');
  } finally {
    if (pvp.ok) xiangqiMahjongRooms.delete(pvp.room.id);
    if (pve.ok) xiangqiMahjongRooms.delete(pve.room.id);
  }
});

// The room's side card linked the human but printed "Misty" as plain text
// (2026-10-27): the room was created with pveBotId 'misty-xiangqi-mahjong', the
// ENGINE id, which names no bot profile, so seatProfiles had no entry for the bot
// seat and the name fell back to the engine's display name. Other variants send
// { botId: 'misty' } and the card links /bot/misty.
test("xmj pvp: the bot seat links to Misty's bot page like every other variant", async () => {
  const pve = await createXiangqiMahjongRoom(FIVE_FIVE, 'east', {
    engineId: XMJ_BOT_CLIENT_ID,
    seat: 'west',
  });
  try {
    assert.ok(pve.ok);
    if (!pve.ok) return;
    assert.deepEqual(tenantSeatProfiles(tenant, pve.room), { west: { botId: 'misty' } });
    const snapshot = tenantSnapshotPayload(tenant, pve.room, client('east'));
    assert.deepEqual(snapshot.seatProfiles, { west: { botId: 'misty' } });
    assert.equal(snapshot.seatDisplayNames.west, 'Misty');
    // A room created before the fix carries the engine id as its pveBotId.
    const legacy = { ...pve.room, pveBotId: XMJ_BOT_CLIENT_ID };
    assert.deepEqual(tenantSeatProfiles(tenant, legacy), { west: { botId: 'misty' } });
  } finally {
    if (pve.ok) xiangqiMahjongRooms.delete(pve.room.id);
  }
});

test('xmj pve: every way to seat the bot stores the seat as Misty, the public bot', async () => {
  // 2026-10-28: a room made with no botId (the setup dialog, a rematch) took the
  // engine id 'misty-xiangqi-mahjong' as its bot id. No bot profile has that id,
  // so 8 of Misty's 12 Xiangqi Mahjong games were missing from /bot/misty.
  const viaSetup = await createXiangqiMahjongRoom(FIVE_FIVE, 'east', {
    engineId: XMJ_BOT_CLIENT_ID,
    seat: 'west',
  });
  const viaBotPage = await createXiangqiMahjongRoom(FIVE_FIVE, 'east', {
    engineId: XMJ_BOT_CLIENT_ID,
    seat: 'west',
    botId: 'misty',
  });
  try {
    assert.ok(viaSetup.ok && viaBotPage.ok);
    if (!viaSetup.ok || !viaBotPage.ok) return;
    // A room created before the fix resumes from a log naming the old id.
    const [created, ...rest] = viaSetup.room.events as XmjEvent[];
    assert.equal(created?.type, 'room-created');
    const beforeFix = hydrate([
      { ...created, pveBotId: 'misty-xiangqi-mahjong' } as XmjEvent,
      ...rest,
    ]);
    for (const [path, room] of [
      ['setup dialog', viaSetup.room],
      ['bot page', viaBotPage.room],
      ['pre-fix event log', beforeFix],
    ] as const) {
      const seat = tenantParticipant(tenant, 'west', room, 'public');
      assert.deepEqual(
        {
          subjectType: seat.subjectType,
          subjectId: seat.subjectId,
          engineId: seat.engineId,
          displayName: seat.displayName,
        },
        {
          subjectType: 'bot',
          subjectId: 'misty',
          engineId: XMJ_BOT_CLIENT_ID,
          displayName: 'Misty',
        },
        path,
      );
    }
  } finally {
    if (viaSetup.ok) xiangqiMahjongRooms.delete(viaSetup.room.id);
    if (viaBotPage.ok) xiangqiMahjongRooms.delete(viaBotPage.room.id);
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

test('xmj pvp: guests and accounts without grants can sit at a launched table', async () => {
  const created = await createXiangqiMahjongRoom(FIVE_FIVE, 'random');
  assert.ok(created.ok);
  if (!created.ok) return;
  const room = created.room;
  try {
    const pool = grantTable(['granted-1']);
    const granted = account('granted-1');
    const stranger = account('stranger-1');
    const admin = account('admin-1', 'admin');

    assert.equal(await mayPlayVariant(null, XIANGQI_MAHJONG_SPEC_ID, pool), true);
    assert.equal(await mayPlayVariant(stranger, XIANGQI_MAHJONG_SPEC_ID, pool), true);
    assert.equal(await mayPlayVariant(granted, XIANGQI_MAHJONG_SPEC_ID, pool), true);
    assert.equal(await mayPlayVariant(admin, XIANGQI_MAHJONG_SPEC_ID, pool), true);

    const guestSeat = assignTenantSeat(
      tenant,
      room,
      'guest',
      undefined,
      null,
      null,
      await mayPlayVariant(null, XIANGQI_MAHJONG_SPEC_ID, pool),
    );
    assert.ok(guestSeat.ok, 'a guest takes a seat');
    const strangerSeat = assignTenantSeat(
      tenant,
      room,
      'c-s',
      undefined,
      stranger,
      null,
      await mayPlayVariant(stranger, XIANGQI_MAHJONG_SPEC_ID, pool),
    );
    assert.ok(strangerSeat.ok, 'an account without a grant takes the other seat');
  } finally {
    xiangqiMahjongRooms.delete(room.id);
  }
});

test('xmj pvp: Find opponent offers every site pace, and nothing off the list', () => {
  assert.equal(xmjLobbyAllowsTimeControl({ initialMs: 60_000, incrementMs: 1_000 }), true);
  assert.equal(xmjLobbyAllowsTimeControl({ initialMs: 180_000, incrementMs: 2_000 }), true);
  assert.equal(xmjLobbyAllowsTimeControl({ initialMs: 300_000, incrementMs: 5_000 }), true);
  assert.equal(xmjLobbyAllowsTimeControl({ initialMs: 600_000, incrementMs: 5_000 }), true);
  assert.equal(xmjLobbyAllowsTimeControl({ initialMs: 420_000, incrementMs: 3_000 }), false);
});

// A seat sees its deal before its first move, so abort was a free redeal of a
// bad hand (Brian, 2026-10-15). No abort from either seat at any move; resign
// is open from the first move instead. A default tenant keeps abort.
test('xmj pvp: neither seat can abort its deal, and either can resign from move 0', () => {
  const room = pvpRoom(7);
  const state = room.projection.state;
  assert.equal(state.status.type, 'playing');
  assert.equal(state.moveNumber, 0);
  for (const seat of tenant.colors) {
    assert.equal(tenantSeatMayAbort(tenant, state, seat), false, `${seat} may not abort`);
  }
  assert.equal(tenantSeatMayResign(tenant, state), true);
  const turn = (state.status as { turn: string }).turn;
  assert.equal(tenantSeatMayAbort({}, state, turn), true, 'a default tenant keeps abort');
  assert.equal(tenantSeatMayResign({}, state), false, 'and resigns only after move 2');
});

test('xmj pvp: a rated seat that saw its deal and lets the first move lapse loses; others abort', () => {
  const dealer = (room: XmjRuntimeRoom) => (room.projection.state.status as { turn: XmjSeat }).turn;

  const unseen = pvpRoom(11);
  assert.equal(tenantPregameTimeoutLoser(tenant, unseen), null, 'never connected: it aborts');

  const seen = pvpRoom(11);
  seen.seatsSeen = { [dealer(seen)]: true };
  assert.equal(tenantPregameTimeoutLoser(tenant, seen), dealer(seen));

  const casual = pvpRoom(11, false);
  casual.seatsSeen = { east: true, west: true };
  assert.equal(tenantPregameTimeoutLoser(tenant, casual), null, 'unrated always aborts');

  const otherSeatOnly = pvpRoom(11);
  otherSeatOnly.seatsSeen = { [dealer(otherSeatOnly) === 'east' ? 'west' : 'east']: true };
  assert.equal(tenantPregameTimeoutLoser(tenant, otherSeatOnly), null, 'only the seat that owes');

  const { userAbort: _userAbort, ratedPregameTimeoutForfeits: _rule, ...plain } = tenant;
  assert.equal(tenantPregameTimeoutLoser(plain, seen), null, 'a tenant without the rule aborts');
});

test('xmj pvp: the first-move timer ends a rated room as a loss for the seat that stalled', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 });
  const room = pvpRoom(12);
  const stalled = (room.projection.state.status as { turn: XmjSeat }).turn;
  room.seatsSeen = { east: true, west: true };
  try {
    const fired = new Promise<XmjEvent>((resolve) => {
      scheduleTenantLifecycleTimers(tenant, room, {
        appendEvent: async (_room, event) => {
          resolve(event as XmjEvent);
          return 0;
        },
        broadcastEventAppended: () => {},
        now: () => Date.now(),
      });
    });
    mock.timers.tick(10 * 60_000);
    const event = await fired;
    assert.equal(event.type, 'seat-forfeited');
    assert.equal((event as { color: XmjSeat }).color, stalled);
    appendTenantRuntimeEvent(tenant, room, event);
    const status = room.projection.state.status as { type: string; winner?: XmjSeat };
    assert.equal(status.type, 'finished');
    assert.notEqual(status.winner, stalled);
  } finally {
    clearTenantRuntimeTimers(room);
    mock.timers.reset();
  }
});

for (const incrementMs of [0, 1_000]) {
  test(`table-3 forced discard never charges its timer wait (${incrementMs} ms increment)`, async () => {
    const front: XmjTile[] = ['rK', 'rA', 'rE', 'rP', 'bH', 'bK', 'bA', 'bE', 'bR', 'bP', 'rA'];
    const rest = xmjOrderedTiles();
    for (const tile of front) rest.splice(rest.indexOf(tile), 1);
    const roomId = `xmj_forced-discard-${incrementMs}`;
    const drawAt = 13_000 + 60_000 + incrementMs - 100;
    const moves: XmjMove[] = [
      { by: 'east', at: 10_000, action: 'declare-ready', tile: 'bH' },
      { by: 'west', at: 12_000, action: 'pass' },
      { by: 'west', at: 13_000, action: 'discard', tile: 'bR' },
      { by: 'east', at: drawAt, action: 'pass' },
    ];
    const room = hydrate([
      {
        type: 'room-created',
        at: 1_000,
        roomId,
        gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
        timeControl: { initialMs: 60_000, incrementMs },
        setup: { walls: [[...front, ...rest]], firstDealer: 'east', taiTable: 3 },
      },
      {
        type: 'clock-started',
        at: 1_000,
        roomId,
        clock: {
          initialMs: 60_000,
          incrementMs,
          remainingMs: { east: 60_000, west: 60_000 },
          activeColor: null,
          runningSince: null,
        },
      },
      { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-east', seat: 'east' },
      { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-west', seat: 'west' },
      ...moves.map(
        (move): XmjEvent => ({
          type: 'move-played',
          at: move.at,
          roomId,
          color: move.by,
          move,
        }),
      ),
    ]);
    const clock = room.projection.clock;
    assert.ok(clock);
    assert.ok(tenantClockRemainingMs(clock, 'east', drawAt) < XMJ_CLAIM_PAUSE_MS);
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: drawAt });
    try {
      const ctx = {
        appendEvent: async (_room: unknown, event: XmjEvent) =>
          appendTenantRuntimeEvent(tenant, room, event),
        broadcastEventAppended: () => {},
      };
      scheduleTenantLifecycleTimers(tenant, room, ctx);
      mock.timers.tick(XMJ_CLAIM_PAUSE_MS + 25);
      await Promise.resolve();
      assert.equal(room.projection.state.status.type, 'playing', 'a forced wait cannot flag east');
      assert.equal(
        room.events.some((event) => event.type === 'clock-expired'),
        false,
      );
      assert.equal(room.projection.state.lastMove?.action, 'discard');
      assert.equal(room.projection.state.lastMove?.by, 'east');
      assert.equal(room.projection.state.lastMove?.at, drawAt + XMJ_CLAIM_PAUSE_MS);
      assert.deepEqual(room.projection.state.match.hand.hands[0], ['rK', 'rA', 'rE', 'rP']);
      const after = room.projection.clock;
      assert.ok(after);
      assert.equal(
        after.remainingMs.east,
        100 + incrementMs,
        'one increment and no forced-wait cost',
      );
      assert.equal(
        after.remainingMs.west,
        clock.remainingMs.west,
        'neither seat pays for the wait',
      );
      assert.equal(after.activeColor, 'west', 'the next claim decision starts west’s clock');
      assert.equal(after.runningSince, Date.now());
      const restored = hydrate(JSON.parse(JSON.stringify(room.events)));
      assert.deepEqual(
        restored.projection,
        room.projection,
        'reconnect preserves the paused clock',
      );
      scheduleTenantLifecycleTimers(tenant, room, ctx);
      mock.timers.tick(100);
      assert.equal(tenantClockRemainingMs(after, 'west', Date.now()), after.remainingMs.west - 100);
    } finally {
      clearTenantRuntimeTimers(room);
      mock.timers.reset();
    }
  });
}
