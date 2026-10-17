/**
 * Xiangqi mahjong live spectating, at the payload level: the room a spectator
 * joins and the Mistboard TV live frame.
 *
 * The invariant: a spectator sees exactly what BOTH players see, and nothing
 * either one holds alone. While a hand is in play that is the melds, the
 * discards, the hand and wall counts, whose turn it is and the points table;
 * never a concealed tile, never the tile just drawn, never the walls. When a
 * hand ends both hands turn face up for the players, so they do for the
 * spectator too. A finished match reveals everything (roomViewPolicy).
 *
 * Checked after every event of whole matches, on every payload a spectator
 * can receive: the hello snapshot, its live history, each broadcast event, the
 * log a reconnecting spectator is sent, the snapshot after a server restart,
 * and the TV live frame.
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
import { liveObservePolicy, roomViewPolicy } from './server-policy.js';
import { xmjBotMove } from './server-xiangqi-mahjong-bots.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  tenantEventsForClient,
  tenantLiveHistoryExtras,
  tenantPlyAtEventIndex,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import type { TenantSeat } from './variant-tenant/tenant.js';
import type { XmjRuntimeRoom } from './xiangqi-mahjong-registration.js';
import { type XmjEvent, xiangqiMahjongTenant } from './xiangqi-mahjong-tenant.js';
import { xmjLiveWatchPayloadFor, xmjWatchTimeline } from './xiangqi-mahjong-watch.js';

process.env.MISTBOARD_XIANGQI_MAHJONG_ENABLED = 'true';

const tenant = xiangqiMahjongTenant;
const SPECTATOR = { id: 'client-spectator', seat: 'spectator' as const, solo: false };
const SEATS: readonly XmjSeat[] = ['east', 'west'];

// A discard's `handCopy` flag (the drawn tile had a twin in hand and the twin
// was thrown) is a seat's private bookkeeping. The shared room serializer
// (xmjClientEventFor) strips it for every recipient (leak audit 2026-10-16,
// finding 6), and the TV frame strips it again on its own path.

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

function client(seat: TenantSeat<XmjSeat>) {
  return { id: `client-${seat}`, seat, solo: false };
}

/** The payload as it crosses the wire. */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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

function assertNoSecrets(payload: unknown, where: string): void {
  const keys = keysOf(wire(payload));
  for (const secret of ['setup', 'walls', 'wall', 'firstDealer']) {
    assert.equal(keys.has(secret), false, `${where}: carries "${secret}"`);
  }
}

function assertNoHandCopy(payload: unknown, where: string): void {
  assert.equal(keysOf(wire(payload)).has('handCopy'), false, `${where}: carries "handCopy"`);
}

function handInPlay(view: XmjPlayerView): boolean {
  return (
    view.status.type === 'playing' && (view.phase.type === 'discard' || view.phase.type === 'claim')
  );
}

/**
 * What a seat's view shares with the other seat: its own concealed tiles while
 * a hand is in play, the tile it just drew and its legal actions taken out.
 */
function publicPart(view: XmjPlayerView): unknown {
  const live = handInPlay(view);
  return wire({
    ...view,
    perspective: null,
    legal: null,
    hands: live ? { east: null, west: null } : view.hands,
    phase: view.phase.type === 'discard' ? { ...view.phase, drawn: null } : view.phase,
  });
}

/** The spectator view is the public part of each seat's view, exactly. */
function assertSpectatorIsPublic(
  spectator: XmjPlayerView,
  seatViews: Record<XmjSeat, XmjPlayerView>,
  where: string,
): void {
  const seen = publicPart(spectator);
  for (const seat of SEATS) {
    assert.deepEqual(seen, publicPart(seatViews[seat]), `${where}: spectator != ${seat}'s public`);
  }
  assert.deepEqual(
    [spectator.legal.discard.length, spectator.legal.claims.length],
    [0, 0],
    `${where}: a spectator has actions`,
  );
  if (handInPlay(spectator)) {
    assert.deepEqual(spectator.hands, { east: null, west: null }, `${where}: a hand shows`);
  }
  if (spectator.phase.type === 'discard') {
    assert.equal(spectator.phase.drawn, null, `${where}: the drawn tile shows`);
  }
}

function snapshotView(room: XmjRuntimeRoom, viewer: TenantSeat<XmjSeat>): XmjPlayerView {
  return tenantSnapshotPayload(tenant, room, client(viewer)).state as unknown as XmjPlayerView;
}

function hydrate(events: XmjEvent[]): XmjRuntimeRoom {
  const created = createTenantRuntimeRoomFromEvents(tenant, events);
  assert.ok(created.ok, 'the event log must hydrate');
  return created.room as XmjRuntimeRoom;
}

function pvpRoom(seed: number): XmjRuntimeRoom {
  const roomId = `xmj_spectate-${seed}`;
  return hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
      creatorPreference: 'random',
      rated: false,
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
      setup: createXmjSetup(seeded(seed)),
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-east', seat: 'east' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-west', seat: 'west' },
  ]);
}

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

/**
 * Whenever the drawn tile has a twin in the hand, throw that face and say it is
 * the twin, so every match exercises `handCopy` discards.
 */
function withHandCopy(room: XmjRuntimeRoom, move: XmjMove): XmjMove {
  if (move.action !== 'discard') return move;
  const own = snapshotView(room, move.by);
  if (own.phase.type !== 'discard' || own.phase.drawn === null) return move;
  const drawn = own.phase.drawn;
  const copies = (own.hands[move.by] ?? []).filter((tile) => tile === drawn).length;
  return copies > 1 ? { ...move, tile: drawn, handCopy: true } : move;
}

type Step = { room: XmjRuntimeRoom; event: XmjEvent; seq: number };

function playMatch(room: XmjRuntimeRoom, onStep: (step: Step) => void): void {
  let now = 10_000;
  let moves = 0;
  while (room.projection.state.status.type === 'playing') {
    assert.ok(moves < 3_000, 'the match must end');
    const move = withHandCopy(room, nextMove(room, now));
    const at = Math.max(now, move.at);
    const event: XmjEvent = { type: 'move-played', at, roomId: room.id, color: move.by, move };
    const seq = appendTenantRuntimeEvent(tenant, room, event);
    onStep({ room, event, seq });
    moves += 1;
    now = at + 1_600;
  }
}

test('xmj spectate: the live room is open to spectators, HK mahjong stays sealed', () => {
  assert.equal(liveObservePolicy('concealed-hands', XIANGQI_MAHJONG_SPEC_ID), 'open');
  assert.equal(liveObservePolicy('concealed-hands', 'mahjong'), 'sealed');
  assert.equal(
    roomViewPolicy('concealed-hands', false, 'spectator', XIANGQI_MAHJONG_SPEC_ID),
    'public-view',
  );
  assert.equal(roomViewPolicy('concealed-hands', false, 'spectator', 'mahjong'), 'nothing');
  assert.equal(
    roomViewPolicy('concealed-hands', true, 'spectator', XIANGQI_MAHJONG_SPEC_ID),
    'truth',
  );
});

test('xmj spectate: snapshot, live history, events and reconnect log hold only what both seats see', () => {
  let between = 0;
  let checked = 0;
  for (const seed of [51, 52]) {
    const room = pvpRoom(seed);
    playMatch(room, ({ room: live, event, seq }) => {
      const ply = tenantPlyAtEventIndex(live.events, seq);
      const where = `seed ${seed} event ${seq}`;
      // The broadcast event a spectator receives.
      assertNoSecrets(tenant.visibility.clientEventFor(event, 'spectator', ply), `${where} event`);
      // The hello: snapshot (with the redacted log inside it) and live history.
      const snapshot = tenantSnapshotPayload(tenant, live, SPECTATOR);
      assertNoSecrets(snapshot, `${where} snapshot`);
      const seatViews = { east: snapshotView(live, 'east'), west: snapshotView(live, 'west') };
      const spectator = snapshot.state as unknown as XmjPlayerView;
      if (live.projection.state.status.type === 'playing') {
        assertSpectatorIsPublic(spectator, seatViews, `${where} snapshot`);
      }
      if (spectator.status.type === 'playing' && spectator.between) between += 1;
      // The reconnect log.
      assertNoSecrets(tenantEventsForClient(tenant, live, SPECTATOR), `${where} log`);
      if (seq % 9 !== 0 || live.projection.state.status.type !== 'playing') return;
      // The live history (every ply as the spectator saw it), checked against
      // each seat's history ply by ply, and a restart's rebuilt room.
      const history = tenantLiveHistoryExtras(tenant, live, SPECTATOR).liveHistory ?? [];
      assertNoSecrets(history, `${where} liveHistory`);
      const seatHistories = {
        east: tenantLiveHistoryExtras(tenant, live, client('east')).liveHistory ?? [],
        west: tenantLiveHistoryExtras(tenant, live, client('west')).liveHistory ?? [],
      };
      assert.equal(history.length, ply + 1, `${where}: one history entry per ply`);
      for (const [index, entry] of history.entries()) {
        assertSpectatorIsPublic(
          entry.view,
          { east: seatHistories.east[index]!.view, west: seatHistories.west[index]!.view },
          `${where} liveHistory ply ${entry.ply}`,
        );
      }
      const replayed = hydrate(live.events as XmjEvent[]);
      assert.deepEqual(
        wire({ ...tenantSnapshotPayload(tenant, replayed, SPECTATOR), serverAt: 0 }),
        wire({ ...snapshot, serverAt: 0 }),
        `${where}: a restart serves the spectator the same snapshot`,
      );
      checked += 1;
    });
    assert.equal(room.projection.state.status.type, 'finished');
  }
  assert.ok(checked > 4, 'live history and rehydration were exercised');
  assert.ok(between > 0, 'the pause between two hands was exercised');
});

test('xmj spectate: between hands both hands are face up for every viewer alike', () => {
  const room = pvpRoom(53);
  let seen = 0;
  playMatch(room, ({ room: live }) => {
    if (live.projection.state.status.type !== 'playing') return;
    const spectator = snapshotView(live, 'spectator');
    if (handInPlay(spectator)) return;
    const east = snapshotView(live, 'east');
    const west = snapshotView(live, 'west');
    assert.ok(spectator.hands.east && spectator.hands.west, 'a finished hand shows both hands');
    assert.deepEqual(spectator.hands, east.hands);
    assert.deepEqual(spectator.hands, west.hands);
    seen += 1;
  });
  assert.ok(seen > 0, 'a hand ended mid-match');
});

test('xmj spectate: no room payload carries handCopy', () => {
  const room = pvpRoom(54);
  let flagged = 0;
  playMatch(room, ({ room: live, event, seq }) => {
    if (event.type === 'move-played' && 'handCopy' in event.move) flagged += 1;
    const ply = tenantPlyAtEventIndex(live.events, seq);
    assertNoHandCopy(tenant.visibility.clientEventFor(event, 'spectator', ply), `event ${seq}`);
    assertNoHandCopy(tenantSnapshotPayload(tenant, live, SPECTATOR), `snapshot ${seq}`);
  });
  assert.ok(flagged > 0, 'the match threw a drawn tile twin');
});

test('xmj spectate: the TV live frame is the spectator view, with no handCopy and no walls', () => {
  const room = pvpRoom(55);
  let frames = 0;
  let flagged = 0;
  playMatch(room, ({ room: live, event }) => {
    if (event.type === 'move-played' && 'handCopy' in event.move) flagged += 1;
    const frame = xmjLiveWatchPayloadFor(live.id, live);
    if (live.projection.state.status.type !== 'playing') {
      assert.equal(frame, null, 'a finished match has no live frame');
      return;
    }
    assert.ok(frame, 'a live match has a frame');
    const where = `TV frame ${live.events.length}`;
    assertNoSecrets(frame, where);
    assertNoHandCopy(frame, where);
    const sent = wire(frame) as {
      view: XmjPlayerView;
      history: { spectator: Array<{ ply: number; view: XmjPlayerView }> } & Record<string, unknown>;
      timeline: unknown[];
      game: { variant: string; result: string };
    };
    assert.deepEqual(Object.keys(sent.history), ['spectator'], `${where}: one track only`);
    assert.equal(sent.game.variant, XIANGQI_MAHJONG_SPEC_ID);
    assert.equal(sent.game.result, 'in-progress');
    // The frame's views are the room spectator's, ply for ply.
    const roomHistory = wire(tenantLiveHistoryExtras(tenant, live, SPECTATOR).liveHistory ?? []);
    assert.deepEqual(sent.history.spectator, roomHistory, `${where}: history != room spectator's`);
    assert.deepEqual(sent.view, roomHistory.at(-1)?.view, `${where}: view != latest`);
    assert.equal(sent.timeline.length, roomHistory.length - 1, `${where}: one move per ply`);
    assertSpectatorIsPublic(
      sent.view,
      { east: snapshotView(live, 'east'), west: snapshotView(live, 'west') },
      where,
    );
    frames += 1;
  });
  assert.ok(frames > 20, 'frames were built across the match');
  assert.ok(flagged > 0, 'a handCopy discard went through the TV timeline');
  assert.equal(xmjLiveWatchPayloadFor('xmj_other', room), null);
});

test('xmj spectate: the TV timeline keeps each move public fields only', () => {
  const room = pvpRoom(56);
  playMatch(room, () => {});
  const timeline = xmjWatchTimeline(room.events as XmjEvent[]);
  const allowed = new Set(['action', 'by', 'at', 'tile', 'kind', 'fromHand']);
  for (const entry of timeline) {
    for (const key of Object.keys(entry.move)) {
      assert.ok(allowed.has(key), `ply ${entry.ply}: move carries "${key}"`);
    }
  }
  assert.deepEqual(
    timeline.map((entry) => entry.ply),
    timeline.map((_, index) => index + 1),
  );
});
