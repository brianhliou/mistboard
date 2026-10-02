import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  createInitialCrazyhouseXiangqiState,
} from '@mistboard/game';
import type { CrazyhouseXiangqiEvent } from '../crazyhouse-xiangqi-tenant.js';
import type { RecentEveGameRecord } from '../persistence.js';
import {
  type CrazyhouseXiangqiPostgamePersistence,
  crazyhouseXiangqiPostgameForApi,
} from './crazyhouse-xiangqi-games.js';

const ROOM_ID = 'chx_postgame';

// A scripted line with a capture each way and a drop:
//   1. Cxh10 (h3h10)   the cannon takes the horse over the h8 cannon: Red holds a horse
//      Rxh10 (i10h10)  the chariot takes the cannon back: Black holds a cannon
//   2. N@e5            Red drops the captured horse
// Then Black resigns.
const LINE: CrazyhouseXiangqiMove[] = [
  { from: 'h3', to: 'h10' },
  { from: 'i10', to: 'h10' },
  { drop: 'horse', to: 'e5' },
];

function finishedGameEvents(): CrazyhouseXiangqiEvent[] {
  const events: CrazyhouseXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: ROOM_ID, gameSpecId: CRAZYHOUSE_XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'b', seat: 'black' },
  ];
  let state: CrazyhouseXiangqiGameState = createInitialCrazyhouseXiangqiState(ROOM_ID);
  let at = 4;
  for (const move of LINE) {
    const color = state.status.type === 'playing' ? state.status.turn : 'red';
    events.push({ type: 'move-played', at: at++, roomId: ROOM_ID, color, move });
    state = applyCrazyhouseXiangqiMove(state, move);
  }
  events.push({ type: 'seat-resigned', at, roomId: ROOM_ID, color: 'black' });
  return events;
}

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: CRAZYHOUSE_XIANGQI_SPEC_ID,
    mode: 'pvp',
    result: 'red-wins',
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
  events: CrazyhouseXiangqiEvent[] | null,
): CrazyhouseXiangqiPostgamePersistence {
  return {
    getGameSummary: async () => record,
    loadRoomEvents: async () => events,
  };
}

test('Crazyhouse Xiangqi postgame returns the finished game with hands in every view', async () => {
  const payload = await crazyhouseXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedGameEvents()),
  );
  assert.ok(payload);
  assert.equal(payload.game.variant, CRAZYHOUSE_XIANGQI_SPEC_ID);
  assert.deepEqual(payload.state.status, {
    type: 'finished',
    winner: 'red',
    reason: 'resignation',
  });
  const moves = payload.timeline.filter((entry) => entry.type === 'move-played');
  assert.equal(moves.length, LINE.length);
  assert.deepEqual(moves[2] && 'move' in moves[2] ? moves[2].move : null, {
    drop: 'horse',
    to: 'e5',
  });
  assert.deepEqual(payload.views.truth, payload.view);

  const truth = payload.history.truth;
  assert.deepEqual(
    truth.map((snapshot) => snapshot.ply),
    [0, 1, 2, 3],
  );
  // Each side starts holding its advisors and elephants.
  const start = { advisor: 2, elephant: 2 };
  assert.deepEqual(truth[0]?.view.hands, { red: start, black: start });
  assert.deepEqual(truth[1]?.view.hands, { red: { ...start, horse: 1 }, black: start });
  assert.deepEqual(truth[2]?.view.hands, {
    red: { ...start, horse: 1 },
    black: { ...start, cannon: 1 },
  });
  // The drop empties the hand and puts the horse on the board.
  assert.equal(truth[3]?.view.hands.red.horse ?? 0, 0);
  assert.deepEqual(truth[3]?.view.board.e5, { color: 'red', role: 'horse' });
});

test('Crazyhouse Xiangqi postgame refuses an unfinished game and another variant', async () => {
  const unfinished = finishedGameEvents().slice(0, -1);
  assert.equal(
    await crazyhouseXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), unfinished)),
    null,
  );
  assert.equal(
    await crazyhouseXiangqiPostgameForApi(
      ROOM_ID,
      deps(gameRecord({ variant: 'xiangqi' }), finishedGameEvents()),
    ),
    null,
  );
});
