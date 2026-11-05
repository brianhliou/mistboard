import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialStandardXiangqiState,
  createInitialXiangqiState,
  createStandardXiangqiStateFromSetup,
  getStandardXiangqiPlayerView,
  standardXiangqiProgressClockLimit,
  XIANGQI_SPEC_ID,
  type XiangqiMove,
} from '@mistboard/game';
import { tenantExportBinding } from './game-export-tenant.js';
import { xiangqiPostgameForApi } from './routes/xiangqi-games.js';
import {
  applyTenantEvent,
  createTenantRuntimeRoom,
  replayTenantEvents,
} from './variant-tenant/runtime.js';
import { xiangqiExportUci, xiangqiPgnWriter, xiangqiWxfLabels } from './xiangqi-game-export.js';
import type { XiangqiEvent } from './xiangqi-runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

process.env.MISTBOARD_XIANGQI_ENABLED = 'true';

// A deterministic legal opening walk: no captures, mates, or threefolds in 120 plies.
const QUIET: XiangqiMove[] =
  'i1-i3 h8-h5 h3-h4 h5-h9 i3-i2 b8-d8 b3-g3 d8-d4 g3-i3 h9-f9 c1-a3 d4-d6 i3-c3 b10-a8 c3-f3 d6-i6 f3-h3 f9-e9 i2-b2 i6-i5 h3-g3 i5-d5 g3-g2 a7-a6 b2-e2 e9-c9 h4-h3 c9-f9 e2-b2 f9-f6 b1-d2 d10-e9 h3-b3 d5-b5 a1-b1 a8-b10 a4-a5 f6-d6 g2-h2 d6-d10 b2-c2 d10-d5 g1-e3 d5-g5 h2-g2 a10-a8 b3-b2 a8-g8 h1-g3 i7-i6 g3-i2 b5-b7 d1-e2 e7-e6 b1-a1 g5-h5 c2-c1 e9-f8 e3-c5 b7-b9 g2-f2 g7-g6 c1-b1 b9-c9 i4-i5 c10-a8 a1-a2 c9-e9 g4-g5 e9-f9 e4-e5 h5-h7 i2-g1 h7-h5 b2-b8 h5-h4 b8-b9 h4-h2 f2-f4 g8-h8 b9-b6 f10-e9 a2-b2 h2-h6 b6-b8 h8-h7 b2-a2 e9-d8 f4-f5 h7-e7 b1-b3 f9-i9 b3-h3 b10-c8 h3-h4 h10-i8 g1-f3 h6-h5 h4-d4 i8-g9 d4-g4 f8-e9 e1-d1 g9-h7 f3-g1 i9-g9 g1-f3 h7-i9 f3-g1 h5-h7 c5-e3 h7-h1 g4-i4 e7-d7 f5-f4 d7-g7 a2-c2 i10-h10 e2-d3 h1-h2'
    .split(' ')
    .map((token) => {
      const [from, to] = token.split('-');
      return { from, to } as XiangqiMove;
    });

function eventLog(count: number, setup?: unknown): XiangqiEvent[] {
  const roomId = 'xq_clock_replay';
  return [
    {
      type: 'room-created',
      at: 1,
      roomId,
      gameSpecId: XIANGQI_SPEC_ID,
      ...(setup === undefined ? {} : { setup }),
    },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'a', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
    ...QUIET.slice(0, count).map(
      (move, index): XiangqiEvent => ({
        type: 'move-played',
        at: 10 + index,
        roomId,
        color: index % 2 === 0 ? 'red' : 'black',
        move,
      }),
    ),
  ];
}

test('new rooms persist the 120-ply setup; absent and unknown stamps fail closed to 60', () => {
  const created = createTenantRuntimeRoom(xiangqiTenant, 'xq_new_clock');
  assert.ok(created.ok);
  assert.deepEqual(created.room.events[0], {
    type: 'room-created',
    roomId: 'xq_new_clock',
    gameSpecId: XIANGQI_SPEC_ID,
    at: created.room.events[0]!.at,
    setup: { progressClockLimit: 120 },
  });
  assert.equal(standardXiangqiProgressClockLimit(created.room.projection.state), 120);
  assert.equal(standardXiangqiProgressClockLimit(createInitialStandardXiangqiState('new')), 120);
  for (const setup of [undefined, {}, { progressClockLimit: 99 }, { progressClockLimit: '120' }]) {
    const state = createStandardXiangqiStateFromSetup('old', setup);
    assert.equal(standardXiangqiProgressClockLimit(state), 60);
  }
});

test('an old completed event log keeps its draw; an old in-progress game resumes at the same limit', () => {
  const events = eventLog(60);
  const old = replayTenantEvents(xiangqiTenant, events);
  let live = createInitialXiangqiState('xq_clock_replay');
  for (const move of QUIET.slice(0, 60)) live = xiangqiTenant.rules.applyMove(live, move);
  assert.deepEqual(old.state.board, live.board);
  assert.equal(old.state.progressClock, 60);
  assert.deepEqual(old.state.status, { type: 'finished', winner: null, reason: 'progress-clock' });
  assert.deepEqual(old.state.status, live.status);
  const ongoing = replayTenantEvents(xiangqiTenant, events.slice(0, -1));
  assert.equal(ongoing.state.status.type, 'playing');
  const resumed = applyTenantEvent(xiangqiTenant, ongoing, events.at(-1)!);
  assert.deepEqual(resumed.state, old.state);
  assert.equal(
    replayTenantEvents(xiangqiTenant, eventLog(60, { progressClockLimit: 120 })).state.status.type,
    'playing',
  );
});

test('new event logs and postgame snapshots preserve every ply through the 120-ply draw', async () => {
  const events = eventLog(120, xiangqiTenant.rules.createSetup?.());
  const before = replayTenantEvents(xiangqiTenant, events.slice(0, -1));
  assert.equal(before.state.progressClock, 119);
  assert.equal(before.state.status.type, 'playing');
  const final = replayTenantEvents(xiangqiTenant, events);
  assert.deepEqual(final.state.status, {
    type: 'finished',
    winner: null,
    reason: 'progress-clock',
  });
  assert.equal(final.state.progressClock, 120);
  for (const seat of ['red', 'black'] as const) {
    assert.equal(getStandardXiangqiPlayerView(final.state, seat).progressClockLimit, 120);
  }
  const created = createTenantRuntimeRoom(xiangqiTenant, 'xq_clock_replay');
  assert.ok(created.ok);
  const room = { ...created.room, events, projection: final };
  const payload = await xiangqiPostgameForApi('xq_clock_replay', {
    isPersistenceEnabled: () => false,
    getGameSummary: async () => null,
    loadRoomEvents: async () => null,
    getLiveRoom: () => room,
  });
  assert.ok(payload);
  assert.equal(payload.view.progressClockLimit, 120);
  assert.equal(payload.history.truth.length, 121);
  assert.equal(payload.history.truth[119]?.view.status.type, 'playing');
});

test('export replays old and new logs under their stored rules', async () => {
  const binding = tenantExportBinding(xiangqiTenant, {
    gameRouteBase: '/xiangqi/game',
    uci: xiangqiExportUci,
    san: (moves, state) =>
      xiangqiWxfLabels(moves, createStandardXiangqiStateFromSetup(state.id, state)),
    writePgn: (moves, state) =>
      xiangqiPgnWriter(moves, 'wxf', createStandardXiangqiStateFromSetup(state.id, state)),
  });
  for (const [count, setup] of [
    [60, undefined],
    [120, { progressClockLimit: 120 }],
  ] as const) {
    const result = binding.finishedGame(eventLog(count, setup), 'xq_clock_replay');
    assert.ok(result);
    assert.equal(result.plies.length, count);
    assert.ok(result.plies.every((ply) => ply.san !== null));
    assert.ok(result.writePgn?.({}, '1/2-1/2').includes('1/2-1/2'));
  }
});
