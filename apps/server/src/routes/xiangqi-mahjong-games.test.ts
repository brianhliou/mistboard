import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjRoomSetup,
  type XmjRoomState,
  type XmjSeat,
  xmjPendingAction,
} from '@mistboard/game';
import type { RecentEveGameRecord } from '../persistence.js';
import { xmjBotMove } from '../server-xiangqi-mahjong-bots.js';
import type { XmjEvent } from '../xiangqi-mahjong-tenant.js';
import {
  type XmjPostgamePersistence,
  xiangqiMahjongPostgameForApi,
} from './xiangqi-mahjong-games.js';

const ROOM_ID = 'xmj_review';
const SEATS: readonly XmjSeat[] = ['east', 'west'];

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

type PlayedMatch = { setup: XmjRoomSetup; events: XmjEvent[]; states: XmjRoomState[] };

/** Two bots play a whole match; `states[i]` is the state after the first i moves. */
function playedMatch(seed: number): PlayedMatch {
  const setup = createXmjSetup(seeded(seed));
  const events: XmjEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM_ID,
      gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
      setup,
    },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'e', seat: 'east' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'w', seat: 'west' },
  ];
  let state = createXmjRoomState(setup, ROOM_ID);
  const states = [state];
  let now = 10_000;
  for (let step = 0; step < 4000 && state.status.type === 'playing'; step += 1) {
    now += 10_000;
    let move = null;
    for (const seat of SEATS) {
      move = xmjBotMove(state, seat, now);
      if (move) break;
    }
    if (!move) {
      const pending = xmjPendingAction(state);
      assert.ok(pending, `stuck at move ${state.moveNumber}`);
      move = pending.move;
    }
    state = applyXmjMove(state, move);
    states.push(state);
    events.push({ type: 'move-played', at: move.at, roomId: ROOM_ID, color: move.by, move });
  }
  assert.equal(state.status.type, 'finished');
  return { setup, events, states };
}

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: XIANGQI_MAHJONG_SPEC_ID,
    mode: 'pvp',
    result: 'east-wins',
    termination: 'points',
    plyCount: 1,
    startedAt: new Date(1),
    endedAt: new Date(5),
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
    initialMs: null,
    incrementMs: null,
    ...overrides,
  };
}

function deps(
  record: RecentEveGameRecord | null,
  events: XmjEvent[] | null,
): XmjPostgamePersistence {
  return { getGameSummary: async () => record, loadRoomEvents: async () => events };
}

/** The log cut after `moves` moves: the room as a live match would persist it. */
function cutAfter(match: PlayedMatch, moves: number): XmjEvent[] {
  return match.events.slice(0, 3 + moves);
}

function assertNoWalls(payload: unknown, setup: XmjRoomSetup): void {
  const json = JSON.stringify(payload);
  assert.equal(json.includes('"walls"'), false);
  assert.equal(json.includes('"setup"'), false);
  // No wall in order, not even the first one's untouched tail.
  for (const wall of setup.walls) assert.equal(json.includes(JSON.stringify(wall)), false);
}

const MATCH = playedMatch(3);

test('a finished match replays every move with both hands and every draw face up', async () => {
  const payload = await xiangqiMahjongPostgameForApi(ROOM_ID, deps(gameRecord(), MATCH.events));
  assert.ok(payload);
  assert.equal(payload.game.variant, XIANGQI_MAHJONG_SPEC_ID);
  assert.equal(payload.state.status.type, 'finished');
  const moves = MATCH.states.length - 1;
  assert.equal(payload.history.length, moves + 1);
  assert.deepEqual(
    payload.history.map((snapshot) => snapshot.ply),
    Array.from({ length: moves + 1 }, (_, ply) => ply),
  );
  assert.equal(payload.timeline.filter((entry) => entry.type === 'move-played').length, moves);
  for (const [ply, snapshot] of payload.history.entries()) {
    const truth = MATCH.states[ply]!.match.hand;
    assert.deepEqual(snapshot.view.hands.east, [...truth.hands[0]], `east at ply ${ply}`);
    assert.deepEqual(snapshot.view.hands.west, [...truth.hands[1]], `west at ply ${ply}`);
    assert.equal(snapshot.view.wallCount, truth.wall.length);
    assert.equal(snapshot.view.legal.discard.length, 0);
  }
  // Each seat's draw shows, not only one perspective's.
  const drawers = new Set(
    payload.history
      .filter(({ view }) => view.phase.type === 'discard' && view.phase.drawn !== null)
      .map(({ view }) => view.turn),
  );
  assert.deepEqual([...drawers].sort(), ['east', 'west']);
  // Several hands, each with its result.
  assert.ok(payload.view.results.length > 1);
  assertNoWalls(payload, MATCH.setup);
});

test("a timed match carries each seat's clock per ply; an untimed one carries none", async () => {
  const untimed = await xiangqiMahjongPostgameForApi(ROOM_ID, deps(gameRecord(), MATCH.events));
  assert.ok(untimed);
  assert.ok(untimed.history.every((snapshot) => snapshot.clock === undefined));

  const [created, ...rest] = MATCH.events;
  assert.equal(created?.type, 'room-created');
  const timedEvents = [
    { ...created, timeControl: { initialMs: 600_000, incrementMs: 5_000 } } as XmjEvent,
    {
      type: 'clock-started',
      at: 1,
      roomId: ROOM_ID,
      clock: {
        activeColor: null,
        incrementMs: 5_000,
        initialMs: 600_000,
        remainingMs: { east: 600_000, west: 600_000 },
        runningSince: null,
      },
    } as XmjEvent,
    ...rest,
  ];
  const timed = await xiangqiMahjongPostgameForApi(ROOM_ID, deps(gameRecord(), timedEvents));
  assert.ok(timed);
  assert.equal(timed.history.length, untimed.history.length);
  assert.deepEqual(timed.history[0]!.clock?.remainingMs, { east: 600_000, west: 600_000 });
  for (const snapshot of timed.history) {
    assert.ok(snapshot.clock, `clock at ply ${snapshot.ply}`);
    for (const seat of SEATS) {
      const ms = snapshot.clock.remainingMs[seat];
      assert.ok(Number.isFinite(ms) && ms >= 0, `${seat} at ply ${snapshot.ply}`);
    }
  }
  // The clock moves with the moves rather than standing still.
  const distinct = new Set(timed.history.map((s) => JSON.stringify(s.clock?.remainingMs)));
  assert.ok(distinct.size > 2);
  // The views are the same; only the clocks are added.
  assert.deepEqual(
    timed.history.map((s) => s.view),
    untimed.history.map((s) => s.view),
  );
  assertNoWalls(timed, MATCH.setup);
});

// HIDDEN-INFO REGRESSION. A finished game record is written at game end, but
// the route trusts only the log: a live match answers 404 (null here) whatever
// the record says, so neither the opponent nor a spectator can read concealed
// tiles, the drawn tile or the wall through it.
test('a live match mid-hand reveals nothing, even with a finished game record', async () => {
  const midHand = MATCH.states.findIndex(
    (state, i) =>
      i > 0 &&
      !state.match.between &&
      state.match.hand.phase.type === 'discard' &&
      state.match.hand.phase.drawn !== null,
  );
  assert.ok(midHand > 0);
  assert.equal(MATCH.states[midHand]!.status.type, 'playing');
  const events = cutAfter(MATCH, midHand);
  assert.equal(await xiangqiMahjongPostgameForApi(ROOM_ID, deps(gameRecord(), events)), null);
  assert.equal(await xiangqiMahjongPostgameForApi(ROOM_ID, deps(null, events)), null);
});

test('a match between two hands reveals nothing', async () => {
  const between = MATCH.states.findIndex(
    (state) => state.status.type === 'playing' && state.match.between,
  );
  assert.ok(between > 0, 'the match pauses between hands');
  assert.ok(MATCH.states[between]!.match.handIndex < MATCH.setup.walls.length - 1);
  const events = cutAfter(MATCH, between);
  assert.equal(await xiangqiMahjongPostgameForApi(ROOM_ID, deps(gameRecord(), events)), null);
});

test('an aborted match, another variant and a foreign log reveal nothing', async () => {
  const aborted: XmjEvent[] = [
    ...cutAfter(MATCH, 0),
    { type: 'game-aborted', at: 9, roomId: ROOM_ID, reason: 'pregame-timeout' },
  ];
  assert.equal(await xiangqiMahjongPostgameForApi(ROOM_ID, deps(gameRecord(), aborted)), null);
  assert.equal(
    await xiangqiMahjongPostgameForApi(
      ROOM_ID,
      deps(gameRecord({ variant: 'mahjong' }), MATCH.events),
    ),
    null,
  );
  // Another room's log under this id.
  assert.equal(
    await xiangqiMahjongPostgameForApi('xmj_other', deps(gameRecord(), MATCH.events)),
    null,
  );
  assert.equal(await xiangqiMahjongPostgameForApi(ROOM_ID, deps(gameRecord(), null)), null);
});
