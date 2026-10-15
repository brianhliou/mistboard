/**
 * #559 step 2: a release drain lets PvE through on the engine paths that
 * survive a web restart, and does not wait for those games.
 *
 * What "survives" means, each pinned below on a representative path:
 *   - the room is restored from its event log on the new build,
 *   - the bot picks its turn back up (and a search that lands during the
 *     pause neither moves nor resigns it),
 *   - the clock is frozen across the gap,
 *   - hidden information stays hidden (jieqi's deal and face-down pieces).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getJieqiLegalMoves,
  getStandardXiangqiLegalMoves,
  type RoomTimeControl,
} from '@mistboard/game';
import {
  censusDeployGate,
  countDeployGatingRooms,
  deployGateReasonFor,
  isGameInPlay,
  RESUMABLE_PVE_GAME_SPECS,
  resumablePveRoomPredicate,
} from './deploy-gate.js';
import { JIEQI_DEFAULT_ENGINE_ID } from './jieqi-engine.js';
import { getJieqiClientView, jieqiTenant } from './jieqi-tenant.js';
import { createDrainController } from './server-drain.js';
import {
  playXiangqiEngineMoveIfReady,
  type XiangqiEngineMoveProvider,
} from './server-xiangqi-engine.js';
import {
  clearTenantRuntimeTimers,
  pauseTenantRoomsOnShutdown,
  scheduleTenantLifecycleTimers,
} from './variant-tenant/lifecycle.js';
import './variant-tenant/register-tenants.js';
import {
  variantTenantDeployGateCensus,
  variantTenantForSpecId,
} from './variant-tenant/registry.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  tenantClockRemainingMs,
  tenantEventsForClient,
} from './variant-tenant/runtime.js';
import { XIANGQI_DEFAULT_ENGINE_ID, xiangqiMoveToPikafishUci } from './xiangqi-engine-catalog.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

process.env.MISTBOARD_XIANGQI_ENABLED = 'true';
process.env.MISTBOARD_JIEQI_ENABLED = 'true';

const LIVE_TC: RoomTimeControl = { initialMs: 180_000, incrementMs: 2_000 };
const HUMAN = 'human-client';

// A live xiangqi game against the default bot, three plies in, the engine
// (black) on move. Stamped `start` onwards.
function xiangqiPveRoom(
  roomId: string,
  start: number,
  seats = { red: HUMAN, black: XIANGQI_DEFAULT_ENGINE_ID },
) {
  const created = createTenantRuntimeRoom(xiangqiTenant, roomId, {
    now: start,
    timeControl: LIVE_TC,
  });
  if (!created.ok) throw new Error(created.error);
  const room = created.room;
  for (const [seat, clientId] of Object.entries(seats) as Array<['red' | 'black', string]>) {
    const seq = appendTenantRuntimeEvent(xiangqiTenant, room, {
      type: 'seat-assigned',
      at: start + 1_000,
      roomId,
      clientId,
      seat,
    });
    assert.ok(seq >= 0, `seat ${seat} assigned`);
  }
  // Three plies: the clock starts once both sides have moved, so black is on
  // move with its clock running since start + 10s.
  for (const [color, at] of [
    ['red', start + 5_000],
    ['black', start + 7_000],
    ['red', start + 10_000],
  ] as const) {
    const move = getStandardXiangqiLegalMoves(room.projection.state)[0]!;
    const seq = appendTenantRuntimeEvent(xiangqiTenant, room, {
      type: 'move-played',
      at,
      roomId,
      color,
      move,
    });
    assert.ok(seq >= 0, `${color} move at ${at} accepted`);
  }
  assert.ok(room.projection.clock?.runningSince, 'the clock is running');
  assert.equal(room.projection.state.status.type, 'playing');
  return room;
}

type XiangqiRoom = ReturnType<typeof xiangqiPveRoom>;

function asLive(room: XiangqiRoom) {
  return Object.assign(room, {
    clients: new Set<{ seat: 'red' | 'black' | 'spectator'; displaced: boolean }>(),
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

test('only a listed spec with an engine in a seat is resumable PvE', () => {
  const now = Date.now();
  const pve = xiangqiPveRoom('xq_gate_pve', now - 20_000);
  const pvp = xiangqiPveRoom('xq_gate_pvp', now - 20_000, { red: HUMAN, black: 'human-two' });
  const isResumablePve = resumablePveRoomPredicate(xiangqiTenant);
  assert.ok(isResumablePve, 'xiangqi is on the resumable list');

  assert.equal(deployGateReasonFor(pve, now, isResumablePve), 'pve');
  assert.equal(deployGateReasonFor(pvp, now, isResumablePve), 'gating');
  assert.equal(countDeployGatingRooms([pve, pvp], now, isResumablePve), 1);
  assert.deepEqual(censusDeployGate([pve, pvp], now, isResumablePve), {
    gating: 1,
    'not-playing': 0,
    paused: 0,
    correspondence: 0,
    idle: 0,
    pve: 1,
  });
  // A game the deploy does not wait for is still a game being played.
  assert.equal(isGameInPlay(pve, now), true);

  // Fog xiangqi and Fog chess bots run on the engine-worker under a seat
  // reservation the restart neither releases nor persists: never resumable.
  for (const spec of ['dark-xiangqi', 'dark-chess', 'mahjong']) {
    assert.equal(RESUMABLE_PVE_GAME_SPECS.has(spec), false, spec);
    assert.equal(
      resumablePveRoomPredicate({ gameSpecId: spec, engine: { isEngineClientId: () => true } }),
      undefined,
      spec,
    );
  }
  // Without the predicate every live room gates, as before.
  assert.equal(countDeployGatingRooms([pve, pvp], now), 2);
});

test('the xiangqi registration and the drain stop waiting for a PvE game', () => {
  const registration = variantTenantForSpecId('xiangqi');
  assert.ok(registration);
  const rooms = registration.rooms as Map<string, unknown>;
  const now = Date.now();
  const pve = asLive(xiangqiPveRoom('xq_drain_pve', now - 20_000));
  const pvp = asLive(
    xiangqiPveRoom('xq_drain_pvp', now - 20_000, { red: HUMAN, black: 'human-two' }),
  );
  rooms.set(pve.id, pve);
  rooms.set(pvp.id, pvp);
  try {
    assert.equal(registration.activeGameCount(), 1, 'only the PvP game holds a release');
    const census = variantTenantDeployGateCensus(now);
    assert.equal(census.pve, 1, 'the census names the PvE game it let go');
    assert.equal(census.gating, 1);

    const drain = createDrainController({
      drainWindowDefaultMs: 1_000,
      drainWindowMaxMs: 2_000,
      rooms: new Map(),
    });
    assert.equal(drain.activeGameCount(), 1);
    rooms.delete(pvp.id);
    assert.equal(drain.activeGameCount(), 0, 'a drain with only a bot game left can commit');
  } finally {
    rooms.delete(pve.id);
    rooms.delete(pvp.id);
  }
});

test('a pending drain lets resumable PvE creates through and refuses everything else', async () => {
  const drain = createDrainController({
    drainWindowDefaultMs: 60_000,
    drainWindowMaxMs: 120_000,
    rooms: new Map(),
  });
  assert.equal(drain.refusesCreate({ resumablePve: true }), false, 'no drain, no refusal');
  await drain.handleRequest(
    {
      headers: {},
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{}');
      },
    } as never,
    { writeHead: () => {}, end: () => {} } as never,
    '/admin/drain',
  );
  assert.equal(drain.restartPhase(), 'pending');
  assert.equal(drain.refusesCreate(), true, 'PvP, lobby and correspondence still wait');
  assert.equal(drain.refusesCreate({ resumablePve: false }), true);
  assert.equal(drain.refusesCreate({ resumablePve: true }), false);

  // Once shutdown starts the pause walk is under way: nothing new may appear.
  await drain.finalizeOnShutdown();
  assert.equal(drain.refusesCreate({ resumablePve: true }), true);
});

// A search in flight when the server stops used to land on the paused room:
// a move was handed to the writer (and broadcast) on a room that takes none,
// and a failed search resigned the bot, because the room still read as the
// engine's turn.
test('a search that lands after the shutdown pause neither moves nor resigns the bot', async () => {
  for (const outcome of ['legal move', 'unusable output'] as const) {
    const room = asLive(xiangqiPveRoom(`xq_inflight_${outcome.length}`, Date.now() - 20_000));
    const handed: string[] = [];
    const ctx = {
      appendEvent: async (target: XiangqiRoom, event: { type: string }) => {
        handed.push(event.type);
        return appendTenantRuntimeEvent(xiangqiTenant, target, event as never);
      },
      broadcastEventAppended: () => {},
    };
    const legal = xiangqiMoveToPikafishUci(getStandardXiangqiLegalMoves(room.projection.state)[0]!);
    const provider: XiangqiEngineMoveProvider = async () => {
      // The server stops while the engine thinks.
      await pauseTenantRoomsOnShutdown(xiangqiTenant, [room as never], ctx as never, Date.now());
      return { best: outcome === 'legal move' ? legal : 'z9z9', cp: 0, mate: null, depth: 1 };
    };

    await playXiangqiEngineMoveIfReady(ctx as never, room as never, provider);

    assert.deepEqual(handed, ['clock-paused'], `${outcome}: only the pause reaches the writer`);
    assert.equal(
      room.projection.state.status.type,
      'playing',
      `${outcome}: the bot did not resign`,
    );
    clearTenantRuntimeTimers(room as never);
  }
});

test('a PvE game created mid-drain survives a restart: restored, clock frozen, bot moves', async () => {
  const roomId = 'xq_restart';
  const start = Date.now() - 300_000;
  const before = asLive(xiangqiPveRoom(roomId, start));

  // Old build: the shutdown pause lands 15s into the bot's think.
  const oldCtx = {
    appendEvent: async (target: XiangqiRoom, event: unknown) =>
      appendTenantRuntimeEvent(xiangqiTenant, target, event as never),
    broadcastEventAppended: () => {},
  };
  const pausedAt = start + 25_000;
  const paused = await pauseTenantRoomsOnShutdown(
    xiangqiTenant,
    [before as never],
    oldCtx as never,
    pausedAt,
  );
  assert.equal(paused, 1);
  const log = [...before.events];
  const frozenBlackMs = tenantClockRemainingMs(before.projection.clock!, 'black', pausedAt);
  // 180s, +2s for its first move, 15s thought before the pause.
  assert.equal(frozenBlackMs, 167_000);

  // New build, ~4.5 minutes later: the room hydrates from the log on the
  // human's reconnect. The engine seat counts as present, so it resumes at
  // once, and the resume reschedules the bot, as the tenant ws writer does.
  const hydrated = createTenantRuntimeRoomFromEvents(xiangqiTenant, log);
  assert.ok(hydrated.ok, 'the paused log hydrates on the new build');
  const room = asLive(hydrated.room as XiangqiRoom);
  room.clients = new Set([{ seat: 'red', displaced: false }]);
  assert.ok(room.projection.paused, 'restored paused');

  const appended: Array<{ type: string; color?: string }> = [];
  const searches: Promise<void>[] = [];
  const asked: string[][] = [];
  const provider: XiangqiEngineMoveProvider = async (_engineId, moves) => {
    asked.push(moves);
    const reply = getStandardXiangqiLegalMoves(room.projection.state)[0]!;
    return { best: xiangqiMoveToPikafishUci(reply), cp: 0, mate: null, depth: 1 };
  };
  const ctx = {
    now: () => Date.now(),
    appendEvent: async (target: XiangqiRoom, event: { type: string; color?: string }) => {
      const seq = appendTenantRuntimeEvent(xiangqiTenant, target, event as never);
      if (seq >= 0) appended.push(event);
      scheduleTenantLifecycleTimers(xiangqiTenant, target as never, ctx as never);
      // The ws writer's scheduleEngineMove: never on a paused room.
      if (!target.projection.paused) {
        searches.push(playXiangqiEngineMoveIfReady(ctx as never, target as never, provider));
      }
      return seq;
    },
    broadcastEventAppended: () => {},
  };
  const resumedAt = Date.now();
  scheduleTenantLifecycleTimers(xiangqiTenant, room as never, ctx as never);
  await settle();
  await Promise.all(searches);

  assert.equal(appended[0]?.type, 'clock-resumed', 'the human back resumes the room at once');
  assert.equal(asked.length, 1, 'the bot searched again on the restored room');
  assert.equal(asked[0]!.length, 3, 'from the restored history');
  assert.deepEqual(
    appended.slice(1).map((event) => [event.type, event.color]),
    [['move-played', 'black']],
    'the bot played its turn',
  );
  // The gap (~4.5 minutes) is not charged: black had 167s at the pause and
  // spent only the stub's think since the resume, then took the increment.
  const blackMs = room.projection.clock!.remainingMs.black;
  assert.ok(blackMs > 167_000 && blackMs <= 169_000, `black keeps its clock (${blackMs})`);
  assert.ok(Date.now() - resumedAt < 2_000);
  assert.equal(room.projection.state.status.type, 'playing');
  assert.equal(room.projection.paused, undefined);
  clearTenantRuntimeTimers(room as never);
});

// Jieqi is the hidden-information path on the resumable list: the deal is a
// server secret and every unmoved piece is face down. The restart path must
// not hand any of it to a client.
test('jieqi PvE through a restart: the deal and face-down pieces stay hidden', async () => {
  const roomId = 'jq_restart';
  const start = Date.now() - 300_000;
  const created = createTenantRuntimeRoom(jieqiTenant, roomId, {
    now: start,
    timeControl: LIVE_TC,
  });
  if (!created.ok) throw new Error(created.error);
  const room = asLive(created.room as never) as unknown as typeof created.room & {
    clients: Set<{ seat: 'red' | 'black' | 'spectator'; displaced: boolean }>;
  };
  for (const [seat, clientId] of [
    ['red', HUMAN],
    ['black', JIEQI_DEFAULT_ENGINE_ID],
  ] as const) {
    appendTenantRuntimeEvent(jieqiTenant, room, {
      type: 'seat-assigned',
      at: start + 1_000,
      roomId,
      clientId,
      seat,
    });
  }
  appendTenantRuntimeEvent(jieqiTenant, room, {
    type: 'move-played',
    at: start + 10_000,
    roomId,
    color: 'red',
    move: getJieqiLegalMoves(room.projection.state)[0]!,
  });
  assert.equal(room.projection.state.status.type, 'playing');
  assert.ok(resumablePveRoomPredicate(jieqiTenant)?.(room), 'a resumable PvE room');

  const viewFor = (state: typeof room.projection.state, seat: 'red' | 'spectator') =>
    getJieqiClientView(state, { id: seat, seat, solo: false });
  const redBefore = viewFor(room.projection.state, 'red');
  const spectatorBefore = viewFor(room.projection.state, 'spectator');

  const oldCtx = {
    appendEvent: async (target: typeof room, event: unknown) =>
      appendTenantRuntimeEvent(jieqiTenant, target, event as never),
    broadcastEventAppended: () => {},
  };
  assert.equal(
    await pauseTenantRoomsOnShutdown(jieqiTenant, [room as never], oldCtx as never, start + 25_000),
    1,
  );

  const hydrated = createTenantRuntimeRoomFromEvents(jieqiTenant, [...room.events]);
  assert.ok(hydrated.ok);
  const restored = Object.assign(hydrated.room, {
    clients: new Set([{ seat: 'red' as const, displaced: false }]),
  });
  assert.deepEqual(
    restored.projection.state.board,
    room.projection.state.board,
    'the same deal on the new build',
  );
  const appended: string[] = [];
  const ctx = {
    now: () => Date.now(),
    appendEvent: async (target: typeof restored, event: { type: string }) => {
      const seq = appendTenantRuntimeEvent(jieqiTenant, target, event as never);
      if (seq >= 0) appended.push(event.type);
      return seq;
    },
    broadcastEventAppended: () => {},
  };
  scheduleTenantLifecycleTimers(jieqiTenant, restored as never, ctx as never);
  await settle();
  assert.deepEqual(appended, ['clock-resumed'], 'the bot seat counts as back');

  for (const seat of ['red', 'black', 'spectator'] as const) {
    const visible = tenantEventsForClient(jieqiTenant, restored as never, {
      id: seat,
      seat,
      solo: false,
    });
    assert.equal(
      visible.some((event) => 'setup' in event),
      false,
      `${seat}: no deal in the replayed events`,
    );
    assert.equal(
      visible.some((event) => event.type === 'clock-paused' || event.type === 'clock-resumed'),
      false,
      `${seat}: no pause bookkeeping on the wire`,
    );
  }
  const redAfter = viewFor(restored.projection.state, 'red');
  const spectatorAfter = viewFor(restored.projection.state, 'spectator');
  assert.deepEqual(redAfter.board, redBefore.board, 'the human sees exactly what they saw');
  assert.deepEqual(spectatorAfter.board, spectatorBefore.board);
  for (const entry of Object.values(redAfter.board)) {
    if (entry?.faceDown) assert.ok(!('role' in entry), 'a face-down piece carries no role');
  }
  clearTenantRuntimeTimers(restored as never);
});
