import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATOMIC_XIANGQI_SPEC_ID,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  applyAtomicXiangqiMove,
  createInitialAtomicXiangqiState,
} from '@mistboard/game';
import type { AtomicXiangqiEvent } from '../atomic-xiangqi-tenant.js';
import type { RecentEveGameRecord } from '../persistence.js';
import {
  type AtomicXiangqiPostgamePersistence,
  atomicXiangqiPostgameForApi,
} from './atomic-xiangqi-games.js';

const ROOM_ID = 'axq_postgame';

// A scripted line with one capture in it:
//   1. Che3 (b3e3)   a6 (a7a6)
//   2. Cxe7 (e3e7)   the cannon takes the black soldier on e7 over Red's own e4
// A cannon's capture takes only its target (D13), so the aftermath is one point.
// Then Red resigns, so the game is finished without anyone being blown up.
const LINE: AtomicXiangqiMove[] = [
  { from: 'b3', to: 'e3' },
  { from: 'a7', to: 'a6' },
  { from: 'e3', to: 'e7' },
];

function finishedGameEvents(): AtomicXiangqiEvent[] {
  const events: AtomicXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: ROOM_ID, gameSpecId: ATOMIC_XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'b', seat: 'black' },
  ];
  let state: AtomicXiangqiGameState = createInitialAtomicXiangqiState(ROOM_ID);
  let at = 4;
  for (const move of LINE) {
    if (state.status.type !== 'playing') break;
    const color = state.status.turn;
    events.push({ type: 'move-played', at: at++, roomId: ROOM_ID, color, move });
    state = applyAtomicXiangqiMove(state, move);
  }
  events.push({ type: 'seat-resigned', at, roomId: ROOM_ID, color: 'red' });
  return events;
}

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: ATOMIC_XIANGQI_SPEC_ID,
    mode: 'pvp',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: LINE.length,
    startedAt: new Date(1),
    endedAt: new Date(100),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'private',
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
  events: AtomicXiangqiEvent[] | null,
): AtomicXiangqiPostgamePersistence {
  return {
    getGameSummary: async () => record,
    loadRoomEvents: async () => events,
  };
}

test('Atomic Xiangqi postgame returns the finished-game envelope with a truth view', async () => {
  const payload = await atomicXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedGameEvents()),
  );
  assert.ok(payload);
  assert.equal(payload.game.roomId, ROOM_ID);
  assert.equal(payload.game.variant, ATOMIC_XIANGQI_SPEC_ID);
  assert.equal(payload.game.result, 'black-wins');
  assert.deepEqual(payload.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'resignation',
  });
  assert.equal(
    payload.timeline.filter((entry) => entry.type === 'move-played').length,
    LINE.length,
  );
  // Open information: one view, from Red's perspective, and it IS `views.truth`.
  assert.equal(payload.view.perspective, 'red');
  assert.deepEqual(payload.views.truth, payload.view);
  const resign = payload.timeline.find((entry) => entry.type === 'seat-resigned');
  assert.ok(resign);
  assert.equal(resign.winner, 'black');
});

test('Atomic Xiangqi postgame history snapshots every ply with its aftermath', async () => {
  const payload = await atomicXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedGameEvents()),
  );
  assert.ok(payload);
  const truth = payload.history.truth;
  assert.deepEqual(
    truth.map((snapshot) => snapshot.ply),
    Array.from({ length: LINE.length + 1 }, (_, i) => i),
  );
  // Quiet plies carry an empty aftermath; the cannon shot carries its target
  // and nothing else (D13), and the cannon itself is gone from the board.
  assert.deepEqual(truth[1]?.view.lastBlast, []);
  assert.deepEqual(truth[2]?.view.lastBlast, []);
  assert.deepEqual(
    truth[3]?.view.lastBlast.map((victim) => `${victim.square}:${victim.piece.role}`),
    ['e7:soldier'],
  );
  assert.equal(truth[3]?.view.board.e7, undefined);
  assert.equal(truth[3]?.view.board.e3, undefined);
  assert.equal(truth[3]?.view.board.e4?.role, 'soldier', 'the screen survives a cannon shot');
});

test('Atomic Xiangqi postgame returns null for an unfinished game', async () => {
  const events = finishedGameEvents().slice(0, -1);
  assert.equal(await atomicXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), events)), null);
});

test('Atomic Xiangqi postgame rejects a record from another variant', async () => {
  const payload = await atomicXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord({ variant: 'xiangqi' }), finishedGameEvents()),
  );
  assert.equal(payload, null);
});

test('Atomic Xiangqi postgame returns null when there is no game or event log', async () => {
  assert.equal(await atomicXiangqiPostgameForApi(ROOM_ID, deps(null, finishedGameEvents())), null);
  assert.equal(await atomicXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), null)), null);
});

test('Atomic Xiangqi postgame rejects an event log belonging to another room', async () => {
  const foreign = finishedGameEvents().map((event) => ({ ...event, roomId: 'axq_other' }));
  assert.equal(
    await atomicXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), foreign as AtomicXiangqiEvent[])),
    null,
  );
});

test('Atomic Xiangqi postgame does not require the launch env flag', async () => {
  const previous = process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
  delete process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
  try {
    const payload = await atomicXiangqiPostgameForApi(
      ROOM_ID,
      deps(gameRecord(), finishedGameEvents()),
    );
    assert.ok(payload);
    assert.equal(payload.game.variant, ATOMIC_XIANGQI_SPEC_ID);
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
    else process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED = previous;
  }
});
